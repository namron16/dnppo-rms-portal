'use client'
// app/admin/forwarded/page.tsx
// Inbox page for receiving forwarded documents.

import React, { useEffect, useState, useCallback } from 'react'
import { Badge }       from '@/components/ui/Badge'
import { Button }      from '@/components/ui/Button'
import { Pagination }  from '@/components/ui/Pagination'
import { usePagination } from '@/hooks'
import { buildAttachmentTree } from '@/lib/forwarding'
import {
  FileText, Inbox, Clock, CheckCircle,
  ChevronRight, Download, Save, XCircle,
} from 'lucide-react'

type ForwardedDocument = {
  id:                   string
  sender_role:          string
  document_type:        string
  title:                string
  notes:                string | null
  gdrive_url:           string
  gdrive_file_id:       string
  status:               'pending' | 'saved' | 'dismissed'
  received_at:          string
  saved_at:             string | null
  forwarded_attachments: any[]
}

const DOC_TYPE_LABELS: Record<string, string> = {
  master_document: 'Master Document',
  admin_order:     'Admin Order',
  daily_journal:   'Daily Journal',
  library:         'E-Library',
}

const DOC_TYPE_COLORS: Record<string, string> = {
  master_document: 'bg-blue-100 text-blue-700',
  admin_order:     'bg-purple-100 text-purple-700',
  daily_journal:   'bg-green-100 text-green-700',
  library:         'bg-amber-100 text-amber-700',
}

export default function ForwardedInboxPage() {
  const [documents, setDocuments]   = useState<ForwardedDocument[]>([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<'pending' | 'saved' | 'dismissed'>('pending')
  const [saving, setSaving]         = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)

  const fetchInbox = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/forward/inbox?status=${activeTab}`)
      const json = await res.json()
      setDocuments(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { fetchInbox() }, [fetchInbox])

  const handleSave = async (doc: ForwardedDocument) => {
    setSaving(doc.id)
    try {
      const res  = await fetch(`/api/forward/${doc.id}/save`, { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        fetchInbox()
      } else {
        alert(`Save failed: ${json.error}`)
      }
    } finally {
      setSaving(null)
    }
  }

  const handleDismiss = async (doc: ForwardedDocument) => {
    setDismissing(doc.id)
    try {
      await fetch(`/api/forward/${doc.id}/dismiss`, { method: 'PATCH' })
      fetchInbox()
    } finally {
      setDismissing(null)
    }
  }

  const {
    currentPage,
    pageSize,
    totalPages,
    paginatedItems,
    setCurrentPage,
    setPageSize,
  } = usePagination({
    items: documents,
    defaultPageSize: 15,
    resetDeps: [activeTab],
  })

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6 text-slate-600" />
          <h1 className="text-xl font-bold text-slate-900">Forwarded Documents</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['pending', 'saved', 'dismissed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition
              ${activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Document List */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">Loading…</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          No {activeTab} documents.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginatedItems.map(doc => {
              const tree = buildAttachmentTree(doc.forwarded_attachments ?? [])
              const isExpanded = expanded === doc.id

              return (
                <div
                  key={doc.id}
                  className="border rounded-xl bg-white shadow-sm overflow-hidden"
                >
                  {/* Main Row */}
                  <div className="p-4 flex items-start gap-3">
                    <FileText className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 truncate">
                          {doc.title}
                        </span>
                        <Badge className={`text-xs ${DOC_TYPE_COLORS[doc.document_type]}`}>
                          {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                        </Badge>
                      </div>

                      <p className="text-xs text-slate-500 mt-0.5">
                        From <strong>{doc.sender_role}</strong> ·{' '}
                        {new Date(doc.received_at).toLocaleString('en-PH')}
                        {doc.forwarded_attachments?.length > 0 && (
                          <> · {doc.forwarded_attachments.length} attachment{doc.forwarded_attachments.length !== 1 ? 's' : ''}</>
                        )}
                      </p>

                      {doc.notes && (
                        <p className="text-xs text-slate-600 mt-1 italic">"{doc.notes}"</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {doc.forwarded_attachments?.length > 0 && (
                        <button
                          onClick={() => setExpanded(isExpanded ? null : doc.id)}
                          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-0.5"
                        >
                          <ChevronRight className={`w-3.5 h-3.5 transition ${isExpanded ? 'rotate-90' : ''}`} />
                          Attachments
                        </button>
                      )}

                      <a
                        href={doc.gdrive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg border text-slate-600 hover:bg-slate-50"
                        title="Preview in Drive"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>

                      {activeTab === 'pending' && (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleSave(doc)}
                            disabled={saving === doc.id}
                            className="text-xs"
                          >
                            <Save className="w-3 h-3 mr-1" />
                            {saving === doc.id
                              ? 'Saving…'
                              : `Save to ${DOC_TYPE_LABELS[doc.document_type] ?? 'Storage'}`}
                          </Button>

                          <button
                            onClick={() => handleDismiss(doc)}
                            disabled={dismissing === doc.id}
                            className="p-1.5 rounded-lg border text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition"
                            title="Dismiss"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      {activeTab === 'saved' && (
                        <div className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Saved
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Attachments Accordion */}
                  {isExpanded && tree.length > 0 && (
                    <div className="border-t bg-slate-50 px-4 py-3 space-y-1.5">
                      <p className="text-xs font-medium text-slate-600 mb-2">Attachments</p>
                      <AttachmentTree nodes={tree} depth={0} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {!loading && documents.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={documents.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 15, 25, 50]}
            />
          )}
        </>
      )}
    </div>
  )
}

function AttachmentTree({ nodes, depth }: { nodes: any[]; depth: number }) {
  return (
    <div className={depth > 0 ? 'ml-4 border-l pl-3' : ''}>
      {nodes.map((node: any) => (
        <div key={node.id} className="py-1">
          <div className="flex items-center gap-2">
            <FileText className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-700 truncate flex-1">{node.title}</span>
            <a
              href={node.gdrive_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline flex-shrink-0"
            >
              View
            </a>
          </div>
          {node.children?.length > 0 && (
            <AttachmentTree nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  )
}