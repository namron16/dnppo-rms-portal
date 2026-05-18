// app/api/backup/cron/route.ts
// Called by Vercel's cron scheduler — NOT by a human user.
// Authentication is via CRON_SECRET (set in Vercel environment variables),
// NOT by admin role, since there is no session in a cron context.
//
// Vercel cron configuration in vercel.json:
// { "crons": [{ "path": "/api/backup/cron", "schedule": "0 2 * * *" }] }

import { NextResponse } from 'next/server'
import { runScheduledBackup } from '@/lib/backup/engine'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  // Validate Vercel cron secret — this is the correct auth mechanism for
  // machine-to-machine calls. The admin role check (requireAdmin) is only
  // for human-initiated requests that carry a Supabase session.
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const frequency = determineFrequency()

  // triggered_by = 'system' distinguishes cron-initiated backups from
  // admin-initiated ones in the backup_jobs log.
  const result = await runScheduledBackup({
    frequency,
    triggeredBy: 'system',
  })

  return NextResponse.json({ data: result })
}

function determineFrequency(): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  const now   = new Date()
  const day   = now.getDay()    // 0=Sun, 1=Mon
  const date  = now.getDate()
  const month = now.getMonth()  // 0=Jan

  if (month === 0 && date === 1) return 'yearly'
  if (date === 1)                return 'monthly'
  if (day === 1)                 return 'weekly'
  return 'daily'
}