// app/api/backup/pending-local-saves/route.ts
//
// Returns backup jobs that completed successfully but have not yet been saved
// to the admin's local device (local_saved = false).
//
// The Backup & Recovery page calls this on load and after each job completes
// so it can process the queue via processPendingLocalSaves().

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, AuthError } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await requireAdmin()
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json(err.toJSON(), { status: 403 })
    }
    return NextResponse.json({
      error:  'Auth check failed.',
      code:   'AUTH_UNEXPECTED',
      detail: err?.message ?? String(err),
    }, { status: 403 })
  }

  const db = getServiceClient()

  const { data, error } = await db
    .from('backup_jobs')
    .select('id, module_name, download_url, backup_folder_name, completed_at')
    .eq('status', 'completed')
    .eq('local_saved', false)
    .not('download_url', 'is', null)
    .order('completed_at', { ascending: true })

  if (error) {
    // If the column doesn't exist yet (migration not run), return empty
    // rather than crashing — the feature degrades gracefully.
    if (error.code === '42703') {
      console.warn(
        '[PendingLocalSaves] local_saved column not found. ' +
        'Run: ALTER TABLE backup_jobs ADD COLUMN IF NOT EXISTS local_saved BOOLEAN DEFAULT FALSE;'
      )
      return NextResponse.json({ data: [] })
    }

    return NextResponse.json({
      error:  'Failed to fetch pending local saves.',
      code:   'PENDING_FETCH_ERROR',
      detail: `${error.code}: ${error.message}`,
    }, { status: 500 })
  }

  const formatted = (data ?? []).map(job => ({
    id:           job.id,
    module_name:  job.module_name,
    download_url: job.download_url,
    folderName:   job.backup_folder_name ?? `Backup_${job.module_name}`,
    completed_at: job.completed_at,
  }))

  return NextResponse.json({ data: formatted })
}