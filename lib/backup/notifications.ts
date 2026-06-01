// lib/backup/notifications.ts
// Backup notification utilities and API handlers.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, AuthError } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

/**
 * Notifies about a backup result by creating a database record.
 * Called from the backup engine on success or failure.
 */
export async function notifyBackupResult(params: {
  jobId: string
  module_name: string
  success: boolean
  folderName?: string
  durationSecs?: number
  totalBytes?: number
  error?: string
}): Promise<void> {
  const { jobId, module_name, success, folderName, durationSecs, totalBytes, error } = params
  
  try {
    const db = getServiceClient()
    const message = success
      ? `Backup completed for ${module_name} (${durationSecs}s, ${totalBytes} bytes)`
      : `Backup failed for ${module_name}: ${error || 'unknown error'}`

    await db.from('backup_notifications').insert({
      job_id: jobId,
      module_name,
      message,
      is_success: success,
      folder_name: folderName || null,
      duration_seconds: durationSecs || null,
      total_size_bytes: totalBytes || null,
      error_message: error || null,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[Backup] Failed to create notification:', err?.message ?? String(err))
    // Don't throw; notifications are non-critical
  }
}

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
    .from('backup_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    const isMissingTable =
      error.code === '42P01' || error.message.includes('does not exist')

    return NextResponse.json({
      error:  'Failed to fetch backup notifications.',
      code:   'NOTIFICATIONS_FETCH_ERROR',
      detail: isMissingTable
        ? 'The backup_notifications table does not exist. Run migration 004.'
        : `${error.code}: ${error.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
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

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({
      error:  'Invalid request body — expected JSON.',
      code:   'INVALID_BODY',
    }, { status: 400 })
  }

  const { ids } = body

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({
      error:  'ids must be a non-empty array of notification UUIDs.',
      code:   'INVALID_FIELD',
      detail: 'Example: { "ids": ["uuid-1", "uuid-2"] }',
    }, { status: 400 })
  }

  const db = getServiceClient()
  const { error } = await db
    .from('backup_notifications')
    .update({ is_read: true })
    .in('id', ids)

  if (error) {
    return NextResponse.json({
      error:  'Failed to mark notifications as read.',
      code:   'NOTIFICATIONS_UPDATE_ERROR',
      detail: `${error.code}: ${error.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({ data: { success: true, updated: ids.length } })
}