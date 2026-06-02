'use client'
// components/ui/Modal.tsx
// Shared modal wrapper: overlay + dialog box.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string   // Tailwind max-w class, e.g. 'max-w-2xl'
  height?: string  // Tailwind max-h class, e.g. 'max-h-[80vh]'
  zIndex?: number
}

export function Modal({ open, onClose, title, children, width = 'max-w-2xl', height = 'max-h-[90vh]', zIndex = 1000 }: ModalProps) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const CLOSE_ANIMATION_MS = 180

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

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
        className={cn(
          'fixed inset-0 bg-[rgba(10,20,40,0.55)] z-[999]',
          closing ? 'animate-overlay-fade-out' : 'animate-overlay-fade'
        )}
        style={{ zIndex: zIndex - 1 }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className={cn(
          'fixed inset-0 z-[1000] flex items-center justify-center p-3 md:p-4'
        )}
        style={{ zIndex }}
      >
        <div
          className={cn(
            'bg-white rounded-2xl shadow-2xl w-[95vw] max-h-[90vh] overflow-auto',
            closing ? 'animate-modal-pop-out' : 'animate-modal-pop',
            width, height
            
          )}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative flex items-center justify-center px-6 py-1.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-600 tracking-wide">{title}</h2>
            <button
              onClick={onClose}
              className="absolute right-4 text-slate-400 hover:text-slate-700 transition p-1 rounded-lg hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          {children}
        </div>
      </div>
    </>
  )
}