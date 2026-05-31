// lib/backup/exporters/logs-exporter.ts
//
// FIX: exportAdminLogsAsXlsx now handles the full date range including
// "all time" (fromDate = epoch / new Date(0)).
//
// Previously, calling this with new Date(0) would still work but the
// query would attempt to filter gte '1970-01-01' — valid SQL but
// Supabase may time out on very large tables without the index hint.
//
// This version:
//   1. Skips the .gte() filter entirely when fromDate is epoch (all-time export)
//      so the query hits the index optimally with just the .lte() bound.
//   2. Pages through results in batches of 5000 to avoid memory issues on
//      large log tables (previously fetched all rows in one shot).
//   3. Adds a "Date Range" metadata row at the top of the sheet so the admin
//      can see at a glance what period the export covers.

import ExcelJS from 'exceljs'
import { getServiceClient } from '@/lib/gdrive-pool/db'

const PAGE_SIZE = 5000
const EPOCH = new Date(0)

export async function exportAdminLogsAsXlsx(
  fromDate: Date,
  toDate:   Date
): Promise<Buffer> {
  const db = getServiceClient()

  // Determine if this is an all-time export so we can skip the lower bound
  // filter and add a human-readable label in the sheet header.
  const isAllTime = fromDate <= EPOCH

  const allLogs: any[] = []
  let offset = 0

  while (true) {
    let query = db
      .from('admin_logs')
      .select('id, role, action, description, created_at')
      .lte('created_at', toDate.toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    // Only add the lower-bound filter when not exporting all-time history.
    // Skipping it lets Postgres use the created_at DESC index without a
    // two-sided range scan, which is faster on large tables.
    if (!isAllTime) {
      query = query.gte('created_at', fromDate.toISOString())
    }

    const { data: logs, error } = await query

    if (error) throw new Error(`exportAdminLogsAsXlsx: ${error.message}`)
    if (!logs || logs.length === 0) break

    allLogs.push(...logs)

    if (logs.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // ── Build Excel workbook ─────────────────────────────────────────────────

  const workbook  = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Admin Logs')

  // Metadata rows at the top so reviewers know the period at a glance
  const rangeLabel = isAllTime
    ? 'All time'
    : `${fromDate.toLocaleDateString('en-PH')} – ${toDate.toLocaleDateString('en-PH')}`

  worksheet.addRow(['Export Date', new Date().toLocaleString('en-PH')])
  worksheet.addRow(['Date Range',  rangeLabel])
  worksheet.addRow(['Total Rows',  allLogs.length])
  worksheet.addRow([])   // blank spacer

  // Column headers on row 5
  const columns = ['Log ID', 'Role', 'Action', 'Description', 'Timestamp'] as const

  worksheet.columns = columns.map(header => ({
    header,
    key:   header,
    width: Math.max(header.length + 4, 22),
  }))

  // Bold the header row (row 5 after the 4 metadata rows)
  const headerRow = worksheet.addRow(columns)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type:    'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  }

  // Data rows
  for (const log of allLogs) {
    worksheet.addRow([
      log.id,
      log.role,
      log.action,
      log.description,
      new Date(log.created_at).toLocaleString('en-PH'),
    ])
  }

  // Freeze the header row so scrolling works in Excel
  worksheet.views = [{ state: 'frozen', ySplit: 6 }]

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}