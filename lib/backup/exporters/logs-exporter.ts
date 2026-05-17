import * as XLSX from 'xlsx'
import { getServiceClient } from '@/lib/gdrive-pool/db'

export async function exportAdminLogsAsXlsx(
  fromDate: Date,
  toDate: Date
): Promise<Buffer> {
  const db = getServiceClient()

  const { data: logs } = await db
    .from('admin_logs')
    .select('id, role, action, description, created_at')
    .gte('created_at', fromDate.toISOString())
    .lte('created_at', toDate.toISOString())
    .order('created_at', { ascending: false })

  const rows = (logs ?? []).map(log => ({
    'Log ID':     log.id,
    'Role':       log.role,
    'Action':     log.action,
    'Description': log.description,
    'Timestamp':  new Date(log.created_at).toLocaleString('en-PH'),
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Admin Logs')

  // Auto-size columns
  const colWidths = Object.keys(rows[0] ?? {}).map(key => ({
    wch: Math.max(key.length, 20)
  }))
  ws['!cols'] = colWidths

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}