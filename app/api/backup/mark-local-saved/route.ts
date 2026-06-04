// app/api/backup/mark-local-saved/route.ts
//
// Marks a backup_jobs row as locally saved so the pending-local-saves
// queue never re-downloads the same file.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, AuthError } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

export async function POST(request: Request) {
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
      error: 'Invalid JSON body.',
      code:  'INVALID_BODY',
    }, { status: 400 })
  }

  const { jobId } = body

  if (!jobId) {
    return NextResponse.json({
      error: 'jobId is required.',
      code:  'MISSING_FIELD',
    }, { status: 400 })
  }

  const db = getServiceClient()

  const { error } = await db
    .from('backup_jobs')
    .update({ local_saved: true })
    .eq('id', jobId)

  if (error) {
    return NextResponse.json({
      error:  `Failed to mark job ${jobId} as locally saved.`,
      code:   'UPDATE_ERROR',
      detail: `${error.code}: ${error.message}`,
    }, { status: 500 })
  }

  return NextResponse.json({ data: { success: true, jobId } })
}