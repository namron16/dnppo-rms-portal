// app/api/backup/notifications/route.ts
// Enhanced: structured error codes on every failure path.

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