'use client'
// hooks/useRealtimeCollections.ts
// Realtime hooks for Daily Journals, e-Library, Archive, and Classified Documents.

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// ══════════════════════════════════════════════
// Daily Journals
// ══════════════════════════════════════════════

interface JournalRecord {
  id: string
  title: string
  type: string
  author: string
  date: string
  content?: string
  summary?: string
  status: string
  attachments: number
  archived?: boolean
}

function normaliseJournal(row: any): JournalRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    author: row.author,
    date: row.date,
    content: row.content ?? undefined,
    summary: row.summary ?? undefined,
    status: row.status ?? 'Draft',
    attachments: row.attachments ?? 0,
    archived: row.archived ?? false,
  }
}

export function useRealtimeDailyJournals(
  setEntries: React.Dispatch<React.SetStateAction<any[]>>
) {
  const ref = useRef(setEntries)
  useEffect(() => { ref.current = setEntries }, [setEntries])

  useEffect(() => {
    const ch = supabase
      .channel('rt_daily_journals')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'daily_journals' }, payload => {
        const row = payload.new as any
        if (row.archived) return
        const j = normaliseJournal(row)
        ref.current(prev => {
          // Dedupe: if this row already exists (e.g. from an optimistic
          // local insert elsewhere), merge instead of duplicating.
          const idx = prev.findIndex(e => e.id === j.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...next[idx], ...j }
            return next
          }
          return [j, ...prev]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'daily_journals' }, payload => {
        const row = payload.new as any
        if (row.archived) {
          ref.current(prev => prev.filter(e => e.id !== row.id))
          return
        }
        ref.current(prev => {
          const idx = prev.findIndex(e => e.id === row.id)
          if (idx === -1) {
            // Row updated but not present locally (e.g. filtered out
            // before) — ignore rather than inserting out of context.
            return prev
          }
          const next = [...prev]
          next[idx] = { ...next[idx], ...normaliseJournal(row) }
          return next
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'daily_journals' }, payload => {
        ref.current(prev => prev.filter(e => e.id !== (payload.old as any).id))
      })
      .subscribe()

    return () => { void supabase.removeChannel(ch) }
  }, [])
}

// ══════════════════════════════════════════════
// e-Library Items
// ══════════════════════════════════════════════

interface LibraryItemRow {
  id: string
  title: string
  category: string
  size: string
  dateAdded: string
  fileUrl?: string
  description?: string
}

function normaliseLibItem(row: any): LibraryItemRow {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    size: row.size,
    dateAdded: row.date_added,
    fileUrl: row.file_url ?? undefined,
    description: row.description ?? undefined,
  }
}

export function useRealtimeLibraryItems(
  setItems: React.Dispatch<React.SetStateAction<LibraryItemRow[]>>
) {
  const ref = useRef(setItems)
  useEffect(() => { ref.current = setItems }, [setItems])

  useEffect(() => {
    const ch = supabase
      .channel('rt_library_items')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'library_items' }, payload => {
        const row = payload.new as any
        if (row.archived) return
        const item = normaliseLibItem(row)
        ref.current(prev => {
          const idx = prev.findIndex(i => i.id === item.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...next[idx], ...item }
            return next
          }
          return [item, ...prev]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'library_items' }, payload => {
        const row = payload.new as any
        if (row.archived) {
          ref.current(prev => prev.filter(i => i.id !== row.id))
          return
        }
        ref.current(prev => prev.map(i => i.id === row.id ? normaliseLibItem(row) : i))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'library_items' }, payload => {
        ref.current(prev => prev.filter(i => i.id !== (payload.old as any).id))
      })
      .subscribe()

    return () => { void supabase.removeChannel(ch) }
  }, [])
}

// ══════════════════════════════════════════════
// Archived Documents
// ══════════════════════════════════════════════

interface ArchivedItem {
  id: string
  title: string
  type: string
  archivedDate: string
  archivedBy: string
}

function normaliseArchived(row: any): ArchivedItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    archivedDate: row.archived_date ?? row.archivedDate ?? '',
    archivedBy: row.archived_by ?? row.archivedBy ?? 'Admin',
  }
}

export function useRealtimeArchivedDocs(
  setItems: React.Dispatch<React.SetStateAction<ArchivedItem[]>>
) {
  const ref = useRef(setItems)
  useEffect(() => { ref.current = setItems }, [setItems])

  useEffect(() => {
    const ch = supabase
      .channel('rt_archived_docs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'archived_docs' }, payload => {
        const item = normaliseArchived(payload.new)
        ref.current(prev => {
          const idx = prev.findIndex(i => i.id === item.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...next[idx], ...item }
            return next
          }
          return [item, ...prev]
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'archived_docs' }, payload => {
        ref.current(prev => prev.filter(i => i.id !== (payload.old as any).id))
      })
      .subscribe()

    return () => { void supabase.removeChannel(ch) }
  }, [])
}

// ══════════════════════════════════════════════
// Classified Documents (P2-only)
// ══════════════════════════════════════════════

interface ClassifiedRow {
  id: string
  title: string
  classification: 'RESTRICTED' | 'CONFIDENTIAL'
  date: string
  access: string
  fileUrl?: string
  passwordHash?: string
  archived?: boolean
}

function normaliseClassified(row: any): ClassifiedRow {
  return {
    id: row.id,
    title: row.title,
    classification: row.classification,
    date: row.date,
    access: row.access,
    fileUrl: row.file_url ?? undefined,
    passwordHash: row.password_hash ?? undefined,
    archived: row.archived ?? false,
  }
}

interface ClassifiedOptions {
  setDocs: React.Dispatch<React.SetStateAction<any[]>>
}

export function useRealtimeClassifiedDocs({ setDocs }: ClassifiedOptions) {
  const ref = useRef(setDocs)
  useEffect(() => { ref.current = setDocs }, [setDocs])

  useEffect(() => {
    const ch = supabase
      .channel('rt_confidential_docs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'confidential_docs' }, payload => {
        const row = payload.new as any
        if (row.archived) return
        const doc = normaliseClassified(row)

        ref.current(prev => {
          const idx = prev.findIndex(d => d.id === doc.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = { ...next[idx], ...doc }
            return next
          }
          return [{ ...doc, visibleRoles: ['P2'] }, ...prev]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'confidential_docs' }, payload => {
        const row = payload.new as any
        if (row.archived) {
          ref.current(prev => prev.filter(d => d.id !== row.id))
          return
        }

        const updatedDoc = normaliseClassified(row)
        ref.current(prev => prev.map(d => d.id === row.id ? { ...d, ...updatedDoc } : d))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'confidential_docs' }, payload => {
        ref.current(prev => prev.filter(d => d.id !== (payload.old as any).id))
      })
      .subscribe()

    return () => { void supabase.removeChannel(ch) }
  }, [])
}

// ══════════════════════════════════════════════
// Org Members
// ══════════════════════════════════════════════

interface OrgMember {
  id: string
  name: string
  rank: string
  position: string
  unit?: string
  contactNo?: string
  photoUrl?: string
  initials: string
  color: string
  parentId?: string
}

function normaliseOrgMember(row: any): OrgMember {
  return {
    id: row.id,
    name: row.name,
    rank: row.rank ?? '',
    position: row.position,
    unit: row.unit ?? undefined,
    contactNo: row.contact_no ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    initials: row.initials,
    color: row.color,
    parentId: row.parent_id ?? undefined,
  }
}

export function useRealtimeOrgMembers(
  setMembers: React.Dispatch<React.SetStateAction<OrgMember[]>>
) {
  const ref = useRef(setMembers)
  useEffect(() => { ref.current = setMembers }, [setMembers])

  useEffect(() => {
    const ch = supabase
      .channel('rt_org_members')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'org_members' }, payload => {
        const m = normaliseOrgMember(payload.new)
        ref.current(prev => {
          if (prev.some(x => x.id === m.id)) return prev
          return [...prev, m]
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'org_members' }, payload => {
        const m = normaliseOrgMember(payload.new)
        ref.current(prev => prev.map(x => x.id === m.id ? m : x))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'org_members' }, payload => {
        ref.current(prev => prev.filter(x => x.id !== (payload.old as any).id))
      })
      .subscribe()

    return () => { void supabase.removeChannel(ch) }
  }, [])
}