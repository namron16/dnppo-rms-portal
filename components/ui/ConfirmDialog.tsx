'use client'
// components/ui/ConfirmDialog.tsx
// ─────────────────────────────────────────────
// Reusable confirmation dialog for destructive
// actions (delete, archive, restore).
//
// Usage:
//   const { isOpen, payload, open, close } = useDisclosure<string>()
//   <ConfirmDialog
//     open={isOpen}
//     title="Archive Document"
//     message={`Archive "${payload}"? This can be undone from the Archive page.`}
//     confirmLabel="Archive"
//     variant="danger"
//     onConfirm={() => { handleArchive(payload); close() }}
//     onCancel={close}
//   />

import { useEffect, useState } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  isLoading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  variant      = 'danger',
  isLoading    = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const CLOSE_ANIMATION_MS = 180

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    if (open) {
      setMounted(true)
      requestAnimationFrame(() => setClosing(false))
    } else if (mounted) {
      setClosing(true)
      timeoutId = setTimeout(() => setMounted(false), CLOSE_ANIMATION_MS)
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [open, mounted])

  if (!mounted) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={[
          'fixed inset-0 bg-slate-950/45 backdrop-blur-[2px] z-[1100]',
          closing ? 'animate-overlay-fade-out' : 'animate-overlay-fade',
        ].join(' ')}
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
        <div
          className={[
            'w-[min(420px,95vw)] rounded-2xl bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.24)] transform-gpu',
            closing ? 'animate-modal-pop-out' : 'animate-modal-pop',
          ].join(' ')}
          onClick={e => e.stopPropagation()}
        >
          <h3 className="mb-2 text-base font-bold text-slate-800">{title}</h3>
          <p className="mb-6 text-sm leading-relaxed text-slate-500">{message}</p>
          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={onCancel} disabled={isLoading}>{cancelLabel}</Button>
            <Button variant={variant} onClick={onConfirm} disabled={isLoading}>
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
