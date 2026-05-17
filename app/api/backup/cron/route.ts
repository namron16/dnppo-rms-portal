// app/api/backup/cron/route.ts
// Vercel cron job configuration in vercel.json:
// { "crons": [{ "path": "/api/backup/cron", "schedule": "0 2 * * *" }] }

import { NextResponse } from 'next/server'
import { runScheduledBackup } from '@/lib/backup/engine'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  // Validate Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const frequency = determineFrequency()
  const result = await runScheduledBackup({ frequency, triggeredBy: 'scheduler' })

  return NextResponse.json({ data: result })
}

function determineFrequency(): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  const now = new Date()
  const day = now.getDay()    // 0=Sun, 1=Mon
  const date = now.getDate()
  const month = now.getMonth() // 0=Jan

  if (month === 0 && date === 1) return 'yearly'
  if (date === 1)                return 'monthly'
  if (day === 1)                 return 'weekly'
  return 'daily'
}