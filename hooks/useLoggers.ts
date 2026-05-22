'use client'
// hooks/useLogger.ts
// Convenience React hook that wraps adminLogger with the current user's role

import { useCallback } from 'react'
import { useAuth } from '@/lib/auth'
import {
  logAction,
  logViewDocument,
  logDownloadDocument,
  logUploadDocument,
  logEditDocument,
  logArchiveDocument,
  logRestoreDocument,
  logRequestAccess,
  logApproveRequest,
  logRejectRequest,
  logForwardDocument,
  logForwardAttachment,
  logAddAttachment,
  logReviewDocument,
  logApproveDocument,
  logRejectDocument,
  type LogActionType,
} from '@/lib/adminLogger'
import type { AdminRole } from '@/lib/auth'

export function useLogger() {
  const { user } = useAuth()

  const log = useCallback(
    (action: LogActionType, description: string) => {
      if (!user) return
      logAction(action, description)
    },
    [user]
  )

  return {
    log,
    logViewDocument,
    logDownloadDocument,
    logUploadDocument,
    logEditDocument,
    logArchiveDocument,
    logRestoreDocument,
    logForwardDocument,
    logForwardAttachment,
    logAddAttachment,
    logReviewDocument,
    logApproveDocument,
    logRejectDocument,

    // Contextual wrappers that auto-include the current user
    logRequestAccess: (docTitle: string) => {
      if (user) logRequestAccess(user.role as AdminRole)
    },
    logApproveRequest: (requesterId: string, docTitle: string) => {
      logApproveRequest(requesterId, docTitle)
    },
    logRejectRequest: (requesterId: string, docTitle: string, reason?: string) => {
      logRejectRequest(requesterId, docTitle, reason)
    },
  }
}