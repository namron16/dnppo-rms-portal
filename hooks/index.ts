// hooks/index.ts
// ─────────────────────────────────────────────
// Shared custom React hooks used across the app.

import { useState, useCallback, useMemo } from 'react'

// ════════════════════════════════════════════
// useSearch
// Filters an array by a search query string
// against a list of string-valued keys.
//
// The keys array should only contain keys whose
// values are strings (name, rank, unit, etc.).
// Non-string values are skipped silently.
//
// Usage:
//   const { query, setQuery, filtered } = useSearch(items, ['title', 'author'])
// ════════════════════════════════════════════
export function useSearch<T>(
  items: T[],
  keys: Array<keyof T>,
) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item =>
      keys.some(key => {
        // Cast to unknown first, then check — satisfies strict TS without
        // requiring T to extend Record<string, unknown>
        const val: unknown = item[key]
        return typeof val === 'string' && val.toLowerCase().includes(q)
      })
    )
  }, [items, keys, query])

  return { query, setQuery, filtered }
}

// ════════════════════════════════════════════
// useModal
// Manages open/close state for a single modal.
//
// Usage:
//   const { isOpen, open, close } = useModal()
// ════════════════════════════════════════════
export function useModal(initialOpen = false) {
  const [isOpen, setOpen] = useState(initialOpen)
  const open   = useCallback(() => setOpen(true),    [])
  const close  = useCallback(() => setOpen(false),   [])
  const toggle = useCallback(() => setOpen(v => !v), [])
  return { isOpen, open, close, toggle }
}

// ════════════════════════════════════════════
// useDisclosure
// Like useModal but carries a typed payload.
// Useful when a modal needs to know which item
// it was opened for.
//
// Usage:
//   const { isOpen, payload, open, close } = useDisclosure<MyType>()
//   open(item) → opens modal with item as payload
// ════════════════════════════════════════════
export function useDisclosure<T = undefined>() {
  const [state, setState] = useState<{ isOpen: boolean; payload: T | undefined }>({
    isOpen: false,
    payload: undefined,
  })

  const open  = useCallback((payload?: T) => setState({ isOpen: true,  payload }), [])
  const close = useCallback(()            => setState({ isOpen: false, payload: undefined }), [])

  return { isOpen: state.isOpen, payload: state.payload, open, close }
}

// ════════════════════════════════════════════
// useActiveTab
// Simple tab state manager.
//
// Usage:
//   const { active, setActive } = useActiveTab('ALL')
// ════════════════════════════════════════════
export function useActiveTab<T extends string>(defaultTab: T) {
  const [active, setActive] = useState<T>(defaultTab)
  return { active, setActive }
}

// ════════════════════════════════════════════
// usePagination
// Handles pagination state for filtered lists.
//
// Usage:
//   const { currentPage, pageSize, totalPages, paginatedItems, setCurrentPage, setPageSize }
//     = usePagination({ items: filtered, defaultPageSize: 25, resetDeps: [query, filter] })
// ════════════════════════════════════════════
export { usePagination } from './usePagination'