'use client'
// components/modals/ForwardDocumentModal.tsx
//
// FIX: Added pre-flight Drive metadata validation.
//   Before this fix, forwarding a document that had no Drive metadata
//   (gdrive_file_id = "" or pool_account_id = "") would silently create a
//   forwarded_documents row with empty strings. The recipient would then hit
//   a 422 "missing Drive metadata" error when trying to save it.
//
//   Now the modal checks upfront whether the document has valid Drive fields.
//   If not, it shows a clear inline warning and blocks the forward entirely,
//   telling the user to re-upload the document via the Drive pool first.

import React, { useState, useMemo } from 'react'
import { Modal }        from '@/components/ui/Modal'
import { Button }       from '@/components/ui/Button'
import { Badge }        from '@/components/ui/Badge'
import {
  forwardDocument,
  flattenAttachmentsForForward,
  type ForwardPayload,
  type DocumentType,
} from '@/lib/forwarding'
import { AdminRole }    from '@/lib/auth'
import { useToast }     from '@/components/ui/Toast'
import { FileText, Users, AlertTriangle } from 'lucide-react'

interface ForwardDocumentModalProps {
  open:         boolean
  onClose:      () => void
  document: {
    id:             string
    title:          string
    type:           string
    documentType:   DocumentType
    gdriveFileId:   string
    gdriveUrl:      string
    poolAccountId:  string
    fileName?:      string
    fileSizeBytes?: number
    mimeType?:      string
  }
  attachmentsMap: Map<string, any[]>
  onForwarded:  () => void
  senderRole:   AdminRole
}

const ALL_FORWARDABLE_ROLES: AdminRole[] = [
  'DPDA', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'
]

const ROLE_LABELS: Partial<Record<AdminRole, string>> = {
  DPDA: 'Deputy Director A',
  P1:   'Records Officer',
  P2:   'Classified Documents',
}

// ── Helper: checks whether a string field actually has a usable value ─────────
// Empty string "" is treated the same as null/undefined — it means the field
// was never populated (e.g. document uploaded before Drive pool was set up).
function hasValue(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0
}

export function ForwardDocumentModal({
  open,
  onClose,
  document,
  attachmentsMap,
  onForwarded,
  senderRole,
}: ForwardDocumentModalProps) {
  const [selectedRecipients, setSelectedRecipients] = useState<Set<AdminRole>>(new Set())
  const [isForwarding, setIsForwarding]             = useState(false)
  const { toast } = useToast()

  // ── Pre-flight: does this document have the Drive metadata needed for saving?
  // If either field is missing/empty the recipient will hit a 422 on save.
  // We surface this now so the sender knows to re-upload before forwarding.
  const missingDriveMetadata =
    !hasValue(document.gdriveFileId) || !hasValue(document.poolAccountId)

  const availableRecipients = useMemo(
    () => ALL_FORWARDABLE_ROLES.filter(r => r !== senderRole),
    [senderRole]
  )

  const attachments = useMemo(
    () => flattenAttachmentsForForward(document.id, attachmentsMap),
    [document.id, attachmentsMap]
  )

  const handleSelectAll = () => {
    setSelectedRecipients(
      selectedRecipients.size === availableRecipients.length
        ? new Set()
        : new Set(availableRecipients)
    )
  }

  const handleToggle = (role: AdminRole) => {
    const next = new Set(selectedRecipients)
    next.has(role) ? next.delete(role) : next.add(role)
    setSelectedRecipients(next)
  }

  const handleForward = async () => {
    // Guard: should not reach here if missingDriveMetadata, but belt-and-suspenders
    if (missingDriveMetadata) {
      toast.error('This document is missing Drive metadata. Please re-upload it before forwarding.')
      return
    }

    if (selectedRecipients.size === 0) {
      toast.error('Please select at least one recipient.')
      return
    }

    setIsForwarding(true)
    try {
      const payload: ForwardPayload = {
        recipients:     Array.from(selectedRecipients),
        originalDocId:  document.id,
        documentType:   document.documentType,
        title:          document.title,
        gdriveFileId:   document.gdriveFileId,
        gdriveUrl:      document.gdriveUrl,
        poolAccountId:  document.poolAccountId,
        fileName:       document.fileName,
        fileSizeBytes:  document.fileSizeBytes,
        mimeType:       document.mimeType,
        attachments,
      }

      const result = await forwardDocument(payload)

      if (result.success) {
        toast.success(
          `Forwarded to ${result.count} recipient${result.count !== 1 ? 's' : ''}.`
        )
        onForwarded()
        onClose()
        setSelectedRecipients(new Set())
      } else {
        toast.error('Forward failed. Please try again.')
      }
    } catch (err) {
      console.error('Forward error:', err)
      toast.error('An unexpected error occurred.')
    } finally {
      setIsForwarding(false)
    }
  }

  const handleClose = () => {
    if (!isForwarding) {
      onClose()
      setSelectedRecipients(new Set())
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Forward Document" width="max-w-lg">
      <div className="p-4 md:p-5 space-y-4">

        {/* Document Preview */}
        <div className="bg-slate-50 rounded-lg p-3 border">
          <div className="flex items-start gap-2.5">
            <FileText className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-slate-900 truncate">{document.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {document.type} · {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/*
          ── FIX: Drive metadata warning banner ────────────────────────────────
          Shown when the document has no gdrive_file_id or pool_account_id.
          This means it was uploaded before the Drive pool system was set up
          (or the upload failed silently). Forwarding it would create a row
          the recipient can never save.

          The user needs to delete and re-upload the document through the
          normal "+ Upload" / "+ New SO" / "+ Add Entry" flow so it gets
          proper Drive metadata before it can be forwarded.
        */}
        {missingDriveMetadata && (
          <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-semibold text-amber-900">Cannot forward — missing Drive file</p>
              <p>
                This document was uploaded before the Google Drive system was set up,
                so it has no Drive file ID or storage account linked to it.
              </p>
              <p>
                To fix this, <strong>delete this document and re-upload it</strong> using
                the normal upload button. Once re-uploaded, it will have the Drive
                metadata needed for forwarding and saving.
              </p>
              <p className="text-amber-700">
                Missing fields:{' '}
                {[
                  !hasValue(document.gdriveFileId)  && 'gdrive_file_id',
                  !hasValue(document.poolAccountId) && 'pool_account_id',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Recipient Selection — only shown when Drive metadata is present */}
        {!missingDriveMetadata && (
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <Users className="w-3.5 h-3.5 text-slate-600" />
              <label className="text-sm font-medium text-slate-900">Select Recipients</label>
              <Button variant="ghost" size="sm" onClick={handleSelectAll} className="ml-auto text-xs">
                {selectedRecipients.size === availableRecipients.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {availableRecipients.map(role => (
                <label
                  key={role}
                  className="flex items-center gap-2 p-2.5 border rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedRecipients.has(role)}
                    onChange={() => handleToggle(role)}
                    className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">{role}</span>
                    {ROLE_LABELS[role] && (
                      <span className="text-xs text-slate-500 ml-1.5">{ROLE_LABELS[role]}</span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            {selectedRecipients.size > 0 && (
              <div className="mt-3">
                <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                  {selectedRecipients.size} recipient{selectedRecipients.size !== 1 ? 's' : ''} selected
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Forward summary */}
        {!missingDriveMetadata && selectedRecipients.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
            <p className="font-medium text-blue-900 mb-1">Forward Summary</p>
            <p>• Document: <strong>{document.title}</strong></p>
            <p>• To: <strong>{Array.from(selectedRecipients).join(', ')}</strong></p>
            <p>• Attachments: <strong>{attachments.length} file{attachments.length !== 1 ? 's' : ''}</strong></p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2.5 pt-3 border-t">
          <Button variant="outline" onClick={handleClose} disabled={isForwarding}>
            Cancel
          </Button>

          {/* Forward button is hidden entirely when Drive metadata is missing */}
          {!missingDriveMetadata && (
            <Button
              variant="primary"
              onClick={handleForward}
              disabled={selectedRecipients.size === 0 || isForwarding}
            >
              {isForwarding
                ? 'Forwarding...'
                : `Forward to ${selectedRecipients.size} Recipient${selectedRecipients.size !== 1 ? 's' : ''}`}
            </Button>
          )}
        </div>

      </div>
    </Modal>
  )
}