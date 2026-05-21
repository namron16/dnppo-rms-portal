// components/dpda-inbox/ForwardedFileCard.tsx
// Card display for individual forwarded file

'use client'

import React from 'react'
import { FileText, Calendar, User, ChevronRight, Paperclip } from 'lucide-react'
import { DPDAStatusBadge } from '@/components/ui/DPDAStatusBadge'
import { PriorityBadge } from '@/components/ui/PriorityBadge'

interface ForwardedFileCardProps {
  id: string
  title: string
  senderRole: string
  documentType: string
  priority?: string
  status: 'pending' | 'approved' | 'disapproved' | 'returned_with_comments' | 'returned'
  dateForwarded: string
  attachmentCount: number
  onView: () => void
}

const DOC_TYPE_LABELS: Record<string, string> = {
  master_document: 'Master Document',
  admin_order: 'Admin Order',
  daily_journal: 'Daily Journal',
  library: 'E-Library',
}

const DOC_TYPE_COLORS: Record<string, string> = {
  master_document: 'text-blue-600 bg-blue-50',
  admin_order: 'text-purple-600 bg-purple-50',
  daily_journal: 'text-green-600 bg-green-50',
  library: 'text-amber-600 bg-amber-50',
}

export function ForwardedFileCard({
  id,
  title,
  senderRole,
  documentType,
  priority = 'medium',
  status,
  dateForwarded,
  attachmentCount,
  onView,
}: ForwardedFileCardProps) {
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateString
    }
  }

  const docTypeLabel = DOC_TYPE_LABELS[documentType] || documentType
  const docTypeColor = DOC_TYPE_COLORS[documentType] || 'text-slate-600 bg-slate-50'

  return (
    <div
      className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-all duration-200 cursor-pointer group"
      onClick={onView}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          <div className={`p-2.5 rounded-lg ${docTypeColor}`}>
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 text-base truncate hover:text-blue-600 transition-colors">
              {title}
            </h3>
            <div className="flex items-center gap-2 mt-1 text-sm text-slate-600">
              <User className="w-3.5 h-3.5" />
              <span className="font-medium">{senderRole}</span>
              <span className="text-slate-400">•</span>
              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                {docTypeLabel}
              </span>
            </div>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 flex-shrink-0 transition-colors" />
      </div>

      {/* Status and Priority */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <DPDAStatusBadge status={status} size="sm" />
        <PriorityBadge priority={priority as any} size="sm" />
      </div>

      {/* Metadata Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-sm text-slate-600">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>{formatDate(dateForwarded)}</span>
          </div>
          {attachmentCount > 0 && (
            <div className="flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" />
              <span>{attachmentCount} file{attachmentCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
