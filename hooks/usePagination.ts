import { useState, useMemo, useEffect } from 'react'

interface UsePaginationOptions<T> {
  items: T[]
  defaultPageSize?: number
  /** Pass any filter value here — page resets to 1 whenever it changes */
  resetDeps?: unknown[]
}

interface UsePaginationReturn<T> {
  currentPage:       number
  pageSize:          number
  totalPages:        number
  paginatedItems:    T[]
  setCurrentPage:    (page: number) => void
  setPageSize:       (size: number) => void
}

export function usePagination<T>({
  items,
  defaultPageSize = 10,
  resetDeps = [],
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize,    setPageSize]    = useState(defaultPageSize)

  // Reset to page 1 whenever the filtered list or any filter dep changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setCurrentPage(1) }, [items.length, ...resetDeps])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  // Clamp current page if the filter shrinks the total
  const safePage = Math.min(currentPage, totalPages)

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, safePage, pageSize])

  return {
    currentPage: safePage,
    pageSize,
    totalPages,
    paginatedItems,
    setCurrentPage,
    setPageSize,
  }
}
