// app/api/backup/health/route.ts
// Enhanced: structured error codes on every failure path.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, AuthError } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

export async function GET(request: Request) {
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

  try {
    const db = getServiceClient()

    const [summaryRes, recentJobsRes, moduleStatusRes, unreadNotifRes] =
      await Promise.all([
        db.rpc('get_backup_health_summary'),
        db.from('backup_jobs')
          .select('id, module_name, status, backup_type, frequency, started_at, completed_at, total_size_bytes, error_message, download_url')
          .order('created_at', { ascending: false })
          .limit(20),
        db.from('backup_configs')
          .select('*'),
        db.from('backup_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('is_read', false),
      ])

    // Check each query individually so the error message names the exact table
    if (summaryRes.error) {
      const isPgFnMissing = summaryRes.error.code === '42883'
      return NextResponse.json({
        error:  'Failed to call get_backup_health_summary RPC.',
        code:   'HEALTH_SUMMARY_RPC_ERROR',
        detail: isPgFnMissing
          ? 'The get_backup_health_summary function does not exist. Run migration 004.'
          : `${summaryRes.error.code}: ${summaryRes.error.message}`,
      }, { status: 500 })
    }

    if (recentJobsRes.error) {
      return NextResponse.json({
        error:  'Failed to fetch recent backup_jobs.',
        code:   'JOBS_FETCH_ERROR',
        detail: `${recentJobsRes.error.code}: ${recentJobsRes.error.message}. ` +
          `Check that migration 004 has been run and the download_url column exists.`,
      }, { status: 500 })
    }

    if (moduleStatusRes.error) {
      return NextResponse.json({
        error:  'Failed to fetch backup_configs.',
        code:   'CONFIG_FETCH_ERROR',
        detail: `${moduleStatusRes.error.code}: ${moduleStatusRes.error.message}. ` +
          `Check that migration 004 has been run.`,
      }, { status: 500 })
    }

    if (unreadNotifRes.error) {
      // Non-fatal: missing notifications table shouldn't crash the health page
      console.warn(
        '[Health] Could not count unread notifications:',
        unreadNotifRes.error.message
      )
    }

    const summary      = (summaryRes.data as any[])?.[0] ?? {}
    const recentJobs   = recentJobsRes.data ?? []
    const moduleStatus = moduleStatusRes.data ?? []
    const unreadCount  = unreadNotifRes.count ?? 0

    return NextResponse.json({
      data: {
        summary,
        recentJobs,
        moduleStatus,
        unreadNotifications: unreadCount,
      }
    })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[Health] Unexpected error:', msg)
    return NextResponse.json({
      error:  'Health check failed with an unexpected server error.',
      code:   'HEALTH_UNEXPECTED',
      detail: msg,
    }, { status: 500 })
  }
}