// lib/data201.ts
// Personnel 201 file data helpers.
// File uploads now route through /api/personnel/documents (Google Drive Pool).
// Archiving routes through /api/personnel/archive (Drive folder move).

import { supabase } from '@/lib/supabase'
import { logArchivePersonnel } from '@/lib/adminLogger'
import type { Personnel201, Doc201Item, Doc201Status, Doc201Category } from '@/types'

// ── Category display labels ────────────────────────────────────────────────
export const CATEGORY_LABELS: Record<Doc201Category, string> = {
  PERSONAL_DATA:  'Personal Data',
  CIVIL_DOCUMENTS:'Civil Documents',
  ACADEMIC:       'Academic',
  TRAINING:       'Training',
  ELIGIBILITY:    'Eligibility',
  SPECIAL_ORDERS: 'Special Orders',
  ASSIGNMENTS:    'Assignments',
  PROMOTIONS:     'Promotions',
  AWARDS:         'Awards',
  FIREARMS:       'Firearms',
  MEDICAL:        'Medical',
  CASES:          'Cases',
  LEAVE:          'Leave',
  PAY_RECORDS:    'Pay Records',
  FINANCIAL:      'Financial',
  TAXATION:       'Taxation',
  IDENTIFICATION: 'Identification',
}

function generateId(): string {
  return crypto.randomUUID()
}

// ── Create a new personnel 201 record ─────────────────────────────────────
export async function createPersonnel201(
  input: Partial<Personnel201> & {
    name: string
    rank: string
    initials: string
    avatarColor: string
    status?: string
    inactiveReason?: string
    separatedReason?: string
    dateOfSeparation?: string
  }
): Promise<Personnel201 | null> {
  const today = new Date().toISOString().split('T')[0]
  const now   = new Date().toISOString()

  const row: Record<string, unknown> = {
    id:          generateId(),
    name:         input.name,
    rank:         input.rank,
    serial_no:    input.serialNo  ?? '',
    unit:         input.unit      ?? '',
    date_created: today,
    last_updated: today,
    initials:     input.initials,
    avatar_color: input.avatarColor,
    status:       input.status    ?? 'In Service',
    created_at:   now,
  }

  if (input.photoUrl         != null) row.photo_url          = input.photoUrl
  if (input.contactNo        != null) row.contact_no         = input.contactNo
  if (input.address          != null) row.address            = input.address
  if (input.tin              != null) row.tin                = input.tin
  if (input.pagIbigNo        != null) row.pag_ibig_no        = input.pagIbigNo
  if (input.philHealthNo     != null) row.phil_health_no     = input.philHealthNo
  if (input.firearmSerialNo  != null) row.firearm_serial_no  = input.firearmSerialNo
  if (input.inactiveReason   != null) row.inactive_reason    = input.inactiveReason
  if (input.separatedReason  != null) row.separated_reason   = input.separatedReason
  if (input.dateOfSeparation != null) row.date_of_separation = input.dateOfSeparation

  const { data, error } = await supabase
    .from('personnel_201')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('createPersonnel201 error:', error.message)
    return null
  }

  return {
    id:               data.id,
    name:             data.name,
    rank:             data.rank,
    serialNo:         data.serial_no      ?? '',
    unit:             data.unit           ?? '',
    dateCreated:      data.date_created   ?? '',
    lastUpdated:      data.last_updated   ?? '',
    initials:         data.initials       ?? '',
    avatarColor:      data.avatar_color   ?? '#3b63b8',
    photoUrl:         data.photo_url      ?? undefined,
    address:          data.address        ?? undefined,
    contactNo:        data.contact_no     ?? undefined,
    status:           data.status         ?? 'In Service',
    inactiveReason:   data.inactive_reason   ?? undefined,
    separatedReason:  data.separated_reason  ?? undefined,
    dateOfSeparation: data.date_of_separation ?? undefined,
    firearmSerialNo:  data.firearm_serial_no  ?? undefined,
    pagIbigNo:        data.pag_ibig_no        ?? undefined,
    philHealthNo:     data.phil_health_no     ?? undefined,
    tin:              data.tin                ?? undefined,
    documents:        [],
  } as Personnel201
}

// ── Update a doc201 item status ────────────────────────────────────────────
export async function updateDoc201Status(
  docId: string,
  status: Doc201Status,
  fileUrl?: string,
  fileSize?: string,
  filedBy?: string
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]

  const updates: Record<string, any> = {
    status,
    date_updated: today,
    filed_by:     filedBy ?? 'Admin',
  }

  if (fileUrl)  updates.file_url  = fileUrl
  if (fileSize) updates.file_size = fileSize

  const { error } = await supabase
    .from('personnel_201_docs')
    .update(updates)
    .eq('id', docId)

  if (error) {
    console.error('updateDoc201Status error:', error.message)
    return false
  }

  return true
}

// ── Upload a 201 document file ─────────────────────────────────────────────
export async function uploadDoc201File(
  docId: string,
  file: File,
  uploadedBy: string
): Promise<string | null> {
  try {
    const formData = new FormData()
    formData.append('file',       file)
    formData.append('docId',      docId)
    formData.append('uploadedBy', uploadedBy)

    const res = await fetch('/api/personnel/documents', {
      method: 'POST',
      body:   formData,
    })

    const json = await res.json()

    if (!res.ok || !json.data) {
      console.error('uploadDoc201File error:', json.error ?? `HTTP ${res.status}`)
      return null
    }

    return json.data.fileUrl ?? null
  } catch (err) {
    console.error('uploadDoc201File exception:', err)
    return null
  }
}

// ── Auto-archive expired separated personnel records ───────────────────────
//
// WHAT THIS DOES:
//   1. Finds all "Separated from Service" records past the 15-year threshold
//   2. Updates their DB status to 'Archived'
//   3. Calls /api/personnel/archive to move their Drive files into:
//        DDNPPO RMS → Personnel Files → {Name} - Archived
//
// The Drive move is fire-and-forget from the client side — it happens via
// an API route so it doesn't block the page load. If it fails, the DB is
// already marked Archived and the files stay in place (harmless — they're
// just not in the archive folder yet). The route can be retried.
//
// Returns a Set of IDs that were newly archived (for the UI to filter them out).
export async function archiveExpiredPersonnel201Records(
  records: Array<{
    id: string
    name?: string
    rank?: string
    status: string
    date_of_separation?: string | null
  }>
): Promise<Set<string>> {
  const ARCHIVE_AFTER_YEARS = 15
  const archivedIds = new Set<string>()

  const expired = records.filter(r => {
    if (r.status !== 'Separated from Service') return false
    if (!r.date_of_separation) return false
    const separated = new Date(r.date_of_separation)
    const threshold = new Date(separated)
    threshold.setFullYear(threshold.getFullYear() + ARCHIVE_AFTER_YEARS)
    return new Date() >= threshold
  })

  if (expired.length === 0) return archivedIds

  const today = new Date().toISOString().split('T')[0]
  const ids   = expired.map(r => r.id)

  // ── Step 1: Update DB status ───────────────────────────────────────────────
  const { error } = await supabase
    .from('personnel_201')
    .update({ status: 'Archived', last_updated: today })
    .in('id', ids)

  if (error) {
    console.error('archiveExpiredPersonnel201Records error:', error.message)
    return archivedIds
  }

  ids.forEach(id => archivedIds.add(id))

  // ── Step 2: Write audit logs ───────────────────────────────────────────────
  try {
    expired.forEach(rec => {
      const name = rec.name ?? rec.id
      void logArchivePersonnel(name)
    })
  } catch (err) {
    console.warn('archiveExpiredPersonnel201Records: logging error', err)
  }

  // ── Step 3: Trigger Drive file archiving (non-blocking) ────────────────────
  // We fire this off without awaiting so it doesn't block the page load.
  // The API route handles the actual Google Drive folder moves server-side.
  try {
    const payload = expired.map(r => ({
      personnelId: r.id,
      name:        r.name  ?? 'Unknown',
      rank:        r.rank  ?? '',
    }))

    void fetch('/api/personnel/archive', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ records: payload }),
    }).then(res => {
      if (!res.ok) {
        res.json().then(j =>
          console.warn('[data201] archive API warning:', j.error ?? res.status)
        ).catch(() => {})
      } else {
        res.json().then(j =>
          console.log(`[data201] archive API: moved ${j.totalFilesMoved ?? 0} file(s)`)
        ).catch(() => {})
      }
    }).catch(err => {
      console.warn('[data201] archive API fetch error (non-fatal):', err.message)
    })
  } catch (err) {
    // Logging only — Drive archive is best-effort from the client trigger.
    // The server-side API route can always be called manually to retry.
    console.warn('[data201] Could not trigger archive API (non-fatal):', err)
  }

  return archivedIds
}

// ── Get all personnel 201 records (lightweight) ────────────────────────────
export async function getAllPersonnel201(): Promise<Array<{
  id: string
  name: string
  rank: string
  status: string
}>> {
  const { data, error } = await supabase
    .from('personnel_201')
    .select('id, name, rank, status')
    .order('name', { ascending: true })

  if (error) {
    console.error('getAllPersonnel201 error:', error.message)
    return []
  }

  return data ?? []
}

// ── Get a single personnel 201 record by ID ────────────────────────────────
export async function getPersonnel201ById(id: string): Promise<Personnel201 | null> {
  const { data, error } = await supabase
    .from('personnel_201')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('getPersonnel201ById error:', error.message)
    return null
  }

  const { data: docs, error: docsError } = await supabase
    .from('personnel_201_docs')
    .select('*')
    .eq('personnel_id', id)
    .order('created_at', { ascending: true })

  if (docsError) {
    console.error('getPersonnel201ById docs error:', docsError.message)
  }

  const documents: Doc201Item[] = (docs ?? []).map((d: any) => ({
    id:          d.id,
    category:    d.category,
    label:       d.label,
    sublabel:    d.sublabel  ?? undefined,
    status:      d.status,
    dateUpdated: d.date_updated ?? '',
    filedBy:     d.filed_by  ?? undefined,
    fileSize:    d.file_size ?? undefined,
    fileUrl:     d.file_url  ?? undefined,
    remarks:     d.remarks   ?? undefined,
  }))

  return {
    id:               data.id,
    name:             data.name,
    rank:             data.rank,
    serialNo:         data.serial_no           ?? '',
    unit:             data.unit                ?? '',
    dateCreated:      data.date_created        ?? '',
    lastUpdated:      data.last_updated        ?? '',
    initials:         data.initials            ?? '',
    avatarColor:      data.avatar_color        ?? '#3b63b8',
    photoUrl:         data.photo_url           ?? undefined,
    address:          data.address             ?? undefined,
    contactNo:        data.contact_no          ?? undefined,
    status:           data.status              ?? 'In Service',
    inactiveReason:   data.inactive_reason     ?? undefined,
    separatedReason:  data.separated_reason    ?? undefined,
    dateOfSeparation: data.date_of_separation  ?? undefined,
    firearmSerialNo:  data.firearm_serial_no   ?? undefined,
    pagIbigNo:        data.pag_ibig_no         ?? undefined,
    philHealthNo:     data.phil_health_no      ?? undefined,
    tin:              data.tin                 ?? undefined,
    documents,
  } as Personnel201
}

// ── Delete a personnel 201 record ──────────────────────────────────────────
export async function deletePersonnel201(id: string): Promise<boolean> {
  await supabase
    .from('personnel_201_docs')
    .delete()
    .eq('personnel_id', id)

  const { error } = await supabase
    .from('personnel_201')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('deletePersonnel201 error:', error.message)
    return false
  }

  return true
}

// ── Update a personnel 201 profile ─────────────────────────────────────────
export async function updatePersonnel201Profile(
  id: string,
  updates: Partial<{
    name:             string
    rank:             string
    unit:             string
    status:           string
    contactNo:        string
    address:          string
    photoUrl:         string
    tin:              string
    pagIbigNo:        string
    philHealthNo:     string
    firearmSerialNo:  string
    inactiveReason:   string
    separatedReason:  string
    dateOfSeparation: string
  }>
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]

  const row: Record<string, any> = { last_updated: today }

  if (updates.name            !== undefined) row.name              = updates.name
  if (updates.rank            !== undefined) row.rank              = updates.rank
  if (updates.unit            !== undefined) row.unit              = updates.unit
  if (updates.status          !== undefined) row.status            = updates.status
  if (updates.contactNo       !== undefined) row.contact_no        = updates.contactNo
  if (updates.address         !== undefined) row.address           = updates.address
  if (updates.photoUrl        !== undefined) row.photo_url         = updates.photoUrl
  if (updates.tin             !== undefined) row.tin               = updates.tin
  if (updates.pagIbigNo       !== undefined) row.pag_ibig_no       = updates.pagIbigNo
  if (updates.philHealthNo    !== undefined) row.phil_health_no    = updates.philHealthNo
  if (updates.firearmSerialNo !== undefined) row.firearm_serial_no = updates.firearmSerialNo
  if (updates.inactiveReason  !== undefined) row.inactive_reason   = updates.inactiveReason ?? null
  if (updates.separatedReason !== undefined) row.separated_reason  = updates.separatedReason ?? null
  if (updates.dateOfSeparation !== undefined) row.date_of_separation = updates.dateOfSeparation ?? null

  const { error } = await supabase
    .from('personnel_201')
    .update(row)
    .eq('id', id)

  if (error) {
    console.error('updatePersonnel201Profile error:', error.message)
    return false
  }

  return true
}