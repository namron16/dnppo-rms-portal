'use client'
// app/admin/master/useRealtimeMasterDocs.ts
// FIXED:
//  1. FK column: `master_document_id` used throughout (was `document_id` in TS interface).
//  2. normaliseAtt reads `master_document_id` from DB row.
//  3. Map key consistently uses `att.parent_id ?? att.master_document_id`.
//  4. Initial load removed from this hook — the page's own loadAll useEffect
//     handles it to prevent double-load / race condition. This hook now handles
//     ONLY realtime INSERT / UPDATE / DELETE events.
//  5. INSERT attachment: deduplication key fixed to use master_document_id.
//  6. FIX (cross-user leak): INSERT handler now checks uploaded_by before
//     adding a new document to state. Without this, every user's page received
//     every other user's newly-uploaded documents in real time.

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { AdminRole } from '@/lib/auth'

interface DocEnriched {
  id: string
  title: string
  level: string
  type: string
  date: string
  size: string
  tag: string
  fileUrl?: string
  taggedAdminAccess?: string[]
  taggedRoles?: AdminRole[]
  approval?: any
  canView?: boolean
  isRestricted: boolean
  children?: any[]
}

// FIX: FK column is `master_document_id`, not `document_id`
interface DocAttachment {
  id: string
  master_document_id: string        // FIX: was `document_id`
  parent_id: string | null
  depth: number
  title: string
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  gdrive_file_id: string
  gdrive_url: string
  pool_account_id: string
  created_at: string
}

// Roles that can see ALL documents regardless of uploader
const PRIVILEGED_ROLES = ['admin', 'DPDA', 'DPDO']

function normaliseDoc(row: any): DocEnriched {
  return {
    id:                 row.id,
    title:              row.title,
    level:              row.level,
    type:               row.type,
    date:               row.date,
    size:               row.size,
    tag:                row.tag,
    fileUrl:            row.file_url ?? undefined,
    taggedAdminAccess:  Array.isArray(row.tagged_admin_access) ? row.tagged_admin_access : undefined,
    taggedRoles:        Array.isArray(row.tagged_admin_access) ? row.tagged_admin_access : [],
    canView:            true,
    isRestricted:       false,
  }
}

// FIX: reads `master_document_id` from DB row
function normaliseAtt(row: any): DocAttachment {
  return {
    id:                  row.id,
    master_document_id:  row.master_document_id,   // FIX
    parent_id:           row.parent_id ?? null,
    depth:               row.depth ?? 0,
    title:               row.title ?? '',
    file_name:           row.file_name ?? null,
    file_size_bytes:     row.file_size_bytes ?? null,
    mime_type:           row.mime_type ?? null,
    gdrive_file_id:      row.gdrive_file_id,
    gdrive_url:          row.gdrive_url,
    pool_account_id:     row.pool_account_id,
    created_at:          row.created_at,
  }
}

interface Options {
  setDocuments:      React.Dispatch<React.SetStateAction<any[]>>
  setAttachmentsMap: React.Dispatch<React.SetStateAction<Map<string, DocAttachment[]>>>
  user:              { role: string } | null
  isPrivileged:      boolean
  isP1:              boolean
}

export function useRealtimeMasterDocs({
  setDocuments,
  setAttachmentsMap,
  user,
  isPrivileged,
  isP1,
}: Options) {
  const setDocsRef = useRef(setDocuments)
  const setAttsRef = useRef(setAttachmentsMap)
  // Keep a stable ref to user so the closure inside useEffect sees the current value
  const userRef = useRef(user)
  useEffect(() => { setDocsRef.current = setDocuments },      [setDocuments])
  useEffect(() => { setAttsRef.current = setAttachmentsMap }, [setAttachmentsMap])
  useEffect(() => { userRef.current    = user },              [user])

  // ── Realtime subscriptions only ───────────────────────────────────────
  // NOTE: Initial data load is intentionally NOT here — the page component's
  // own loadAll useEffect handles the first fetch. Doing it here too caused
  // a race condition where setDocuments([]) from the hook ran after loadAll
  // had already populated state, wiping real data.
  useEffect(() => {

    // ── Master documents ──────────────────────────────────────────────
    const docsChannel = supabase
      .channel('rt_master_documents')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'master_documents' },
        payload => {
          const row = payload.new as any
          if (row.archived) return

          // FIX: only add this document to the current user's state if they
          // own it (uploaded_by matches) or they are a privileged role.
          // Without this check, every user's page would receive every new
          // document uploaded by anyone, in real time.
          const currentUser = userRef.current
          if (
            currentUser &&
            !PRIVILEGED_ROLES.includes(currentUser.role) &&
            row.uploaded_by !== currentUser.role
          ) return

          const doc = normaliseDoc(row)
          setDocsRef.current(prev => {
            if (prev.some(d => d.id === doc.id)) return prev
            return [...prev, doc]
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'master_documents' },
        payload => {
          const row = payload.new as any
          if (row.archived) {
            setDocsRef.current(prev => prev.filter(d => d.id !== row.id))
            return
          }
          setDocsRef.current(prev =>
            prev.map(d =>
              d.id === row.id
                ? {
                    ...d,
                    title:             row.title,
                    level:             row.level,
                    type:              row.type,
                    date:              row.date,
                    tag:               row.tag,
                    taggedAdminAccess: Array.isArray(row.tagged_admin_access) ? row.tagged_admin_access : undefined,
                    taggedRoles:       Array.isArray(row.tagged_admin_access) ? row.tagged_admin_access : [],
                  }
                : d
            )
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'master_documents' },
        payload => {
          const row = payload.old as any
          setDocsRef.current(prev => prev.filter(d => d.id !== row.id))
        }
      )
      .subscribe()

    // ── Attachments ───────────────────────────────────────────────────
    const attsChannel = supabase
      .channel('rt_master_doc_attachments')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'master_document_attachments' },
        payload => {
          const att = normaliseAtt(payload.new)
          // FIX: key by parent_id if present, else by master_document_id
          const mapKey = att.parent_id ?? att.master_document_id
          setAttsRef.current(prev => {
            const next = new Map(prev)
            const existing = next.get(mapKey) ?? []
            if (existing.some(a => a.id === att.id)) return prev
            next.set(mapKey, [...existing, att])
            return next
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'master_document_attachments' },
        payload => {
          const att = normaliseAtt(payload.new)
          setAttsRef.current(prev => {
            const next = new Map(prev)
            // Update in whichever bucket holds this attachment ID
            for (const [k, list] of next) {
              if (list.some(a => a.id === att.id)) {
                next.set(k, list.map(a => (a.id === att.id ? att : a)))
              }
            }
            return next
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'master_document_attachments' },
        payload => {
          const row = payload.old as any
          setAttsRef.current(prev => {
            const next = new Map(prev)
            for (const [k, list] of next) {
              if (list.some(a => a.id === row.id)) {
                next.set(k, list.filter(a => a.id !== row.id))
              }
            }
            return next
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(docsChannel)
      void supabase.removeChannel(attsChannel)
    }
  }, [user, isPrivileged, isP1])
}