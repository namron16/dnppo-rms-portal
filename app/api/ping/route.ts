// app/api/ping/route.ts
//
// Keep-alive endpoint — called by the Vercel cron job every 5 minutes
// to prevent the serverless function from going cold.
//
// Also useful as a lightweight health check: returns the current
// server timestamp so you can verify the deployment is responsive.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    ok:        true,
    timestamp: new Date().toISOString(),
    message:   'pong',
  })
}