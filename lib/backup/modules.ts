
export const BACKUP_MODULES = {
  master_documents: {
    label: 'Master Documents',
    tables: ['master_documents', 'master_document_attachments'],
    gdrive_category: 'master_documents',
    entity_type: 'master_document',
    attachment_table: 'master_document_attachments',
    attachment_fk: 'master_document_id',
  },
  admin_orders: {
    label: 'Admin Orders',
    tables: ['special_orders', 'special_order_attachments'],
    gdrive_category: 'special_orders',
    entity_type: 'special_order',
    attachment_table: 'special_order_attachments',
    attachment_fk: 'special_order_id',
  },
  daily_journals: {
    label: 'Daily Journals',
    tables: ['daily_journals', 'daily_journal_attachments'],
    gdrive_category: 'daily_journals',
    entity_type: 'daily_journal',
    attachment_table: 'daily_journal_attachments',
    attachment_fk: 'daily_journal_id',
  },
  e_library: {
    label: 'E-Library',
    tables: ['library_items', 'library_item_attachments'],
    gdrive_category: 'library_items',
    entity_type: 'library_item',
    attachment_table: 'library_item_attachments',
    attachment_fk: 'library_item_id',
  },
  classified_documents: {
    label: 'Classified Documents',
    tables: ['confidential_docs'],
    gdrive_category: 'classified_documents',
    entity_type: 'classified_document',
    attachment_table: null,
    attachment_fk: null,
    extra_encryption: true,  // double-encrypted for classified
  },
  archived_files: {
    label: 'Archived Files',
    tables: ['master_documents', 'special_orders', 'daily_journals', 'library_items', 'confidential_docs'],
    gdrive_category: 'all',
    filter: { archived: true },
    attachment_table: null,
    attachment_fk: null,
  },
  admin_logs: {
    label: 'Admin Logs',
    tables: ['admin_logs'],
    gdrive_category: null,
    entity_type: null,
    attachment_table: null,
    attachment_fk: null,
    export_format: 'xlsx',  // logs export as Excel
  },
  personnel_201: {
    label: '201 Files',
    tables: ['personnel_201', 'personnel_201_docs'],
    gdrive_category: 'personnel_201',
    entity_type: 'doc_201',
    attachment_table: null,
    attachment_fk: null,
  },
  organization: {
    label: 'Organization Chart',
    tables: ['org_members'],
    gdrive_category: 'organization',
    entity_type: null,
    attachment_table: null,
    attachment_fk: null,
  },
} as const

export type BackupModuleName = keyof typeof BACKUP_MODULES