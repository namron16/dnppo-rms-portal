'use client'

import React from 'react'

interface PaginationProps {
  currentPage: number
  totalPages:  number
  totalItems:  number
  pageSize:    number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  // Build the page number list with "..." gaps
  const pages = buildPageList(currentPage, totalPages)

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endItem   = Math.min(currentPage * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50">

      {/* Left: item count */}
      <p className="text-xs text-slate-500 flex-shrink-0 min-w-fit">
        {totalItems === 0
          ? 'No results'
          : `${startItem}–${endItem} of ${totalItems}`}
      </p>

      {/* Centre: page buttons */}
      <div className="flex items-center gap-1 flex-1 justify-center">
        <NavButton
          label="«"
          title="First page"
          disabled={currentPage === 1}
          onClick={() => onPageChange(1)}
        />
        <NavButton
          label="‹"
          title="Previous page"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        />

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-xs text-slate-400 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`min-w-[28px] h-7 rounded-md text-xs font-semibold transition
                ${p === currentPage
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
            >
              {p}
            </button>
          )
        )}

        <NavButton
          label="›"
          title="Next page"
          disabled={currentPage === totalPages || totalPages === 0}
          onClick={() => onPageChange(currentPage + 1)}
        />
        <NavButton
          label="»"
          title="Last page"
          disabled={currentPage === totalPages || totalPages === 0}
          onClick={() => onPageChange(totalPages)}
        />
      </div>

      {/* Right: page size selector */}
      {/* {onPageSizeChange && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-slate-400">Rows</span>
          <select
            value={pageSize}
            onChange={e => {
              onPageSizeChange(Number(e.target.value))
              onPageChange(1)   // always go back to page 1 when size changes
            }}
            className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600
                       focus:outline-none focus:border-blue-400"
          >
            {pageSizeOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )} */}
    </div>
  )
}

// ── Small helper components ────────────────────────────────────────

function NavButton({
  label, title, disabled, onClick,
}: { label: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="min-w-[28px] h-7 rounded-md text-xs font-bold border border-slate-200
                 bg-white text-slate-500 hover:bg-slate-100 transition disabled:opacity-40
                 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  )
}

// ── Builds the page number array with ellipsis gaps ────────────────
// e.g. [1, '...', 4, 5, 6, '...', 20]

function buildPageList(current: number, total: number): (number | '...')[] {
  if (total <= 7) return range(1, total)

  if (current <= 4) return [...range(1, 5), '...', total]

  if (current >= total - 3)
    return [1, '...', ...range(total - 4, total)]

  return [1, '...', current - 1, current, current + 1, '...', total]
}

function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}
