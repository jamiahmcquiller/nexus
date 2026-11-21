// NULL design system — data table.
// Client-side search / sort / pagination, bulk selection, export
// slot, empty state. Generic over row shape; rows must carry a
// stable string `id`.

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export type DataTableColumn<T> = {
  key: string
  label: string
  sortable?: boolean
  /** Render a cell from the row; defaults to String(row[key]). */
  render?: (row: T) => ReactNode
}

type DataTableProps<T extends { id: string }> = {
  columns: DataTableColumn<T>[]
  rows: T[]
  /** Show the built-in search box (client-side filter). */
  search?: boolean
  onSearch?: (query: string) => void
  pageSize?: number
  /** Controlled bulk selection; pass both or neither. */
  selectedIds?: string[]
  onSelect?: (ids: string[]) => void
  /** Rendered as an Export button when provided. */
  onExport?: () => void
  emptyState?: ReactNode
}

type SortDir = 'asc' | 'desc'

function cellValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = a === undefined || a === null ? '' : String(a)
  const sb = b === undefined || b === null ? '' : String(b)
  return sa.localeCompare(sb)
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  search = false,
  onSearch,
  pageSize = 10,
  selectedIds,
  onSelect,
  onExport,
  emptyState,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)

  const selectable = selectedIds !== undefined && onSelect !== undefined

  const filtered = useMemo(() => {
    let out = rows
    const q = query.trim().toLowerCase()
    if (q) {
      out = out.filter((row) =>
        Object.values(row).some((v) => v !== undefined && v !== null && String(v).toLowerCase().includes(q)),
      )
    }
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => compareValues(cellValue(a, sortKey), cellValue(b, sortKey)) * dir)
    }
    return out
  }, [rows, query, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  const handleSearch = (value: string) => {
    setQuery(value)
    onSearch?.(value)
    setPage(0)
  }

  const allSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds!.includes(r.id))
  const toggleAll = () => {
    if (!onSelect || !selectedIds) return
    const pageIds = pageRows.map((r) => r.id)
    onSelect(allSelected ? selectedIds.filter((id) => !pageIds.includes(id)) : [...new Set([...selectedIds, ...pageIds])])
  }
  const toggleOne = (id: string) => {
    if (!onSelect || !selectedIds) return
    onSelect(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  return (
    <div>
      {(search || onExport) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {search && (
            <label className="relative min-w-56 flex-1">
              <span className="sr-only">Search table</span>
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-null-muted dark:text-[#8AA0B8]">
                <Icon name="search" size={16} />
              </span>
              <input
                className="null-input py-2 pl-9 pr-3 text-sm"
                placeholder="Search…"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </label>
          )}
          <span className="flex-1" />
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-1.5 rounded border border-null-line bg-white px-3 py-2 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-null-navy2"
            >
              <Icon name="download" size={14} />
              Export
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-null-line text-left text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
              {selectable && (
                <th className="w-8 py-2 pr-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all rows on this page" />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.key} className="py-2 pr-2 font-semibold">
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-null-ink dark:hover:text-white"
                      aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {col.label}
                      <span aria-hidden className="text-[10px]">
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '△'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id} className="null-table-row border-b border-null-line align-top last:border-0 dark:border-white/10">
                {selectable && (
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedIds!.includes(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Select row ${row.id}`}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="py-2 pr-2 text-null-ink dark:text-white">
                    {col.render ? col.render(row) : String(cellValue(row, col.key) ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="py-6 text-center">
                  {emptyState ?? <span className="text-sm text-null-muted dark:text-[#8AA0B8]">No records found.</span>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-null-muted dark:text-[#8AA0B8]">
        <span>
          {filtered.length === 0 ? '0 results' : `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}`}
          {selectedIds && selectedIds.length > 0 && ` · ${selectedIds.length} selected`}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="inline-flex items-center gap-1 rounded border border-null-line px-2 py-1 hover:bg-null-cloud disabled:opacity-40 dark:border-white/10 dark:hover:bg-null-navy2"
          >
            <Icon name="chevron-left" size={14} />
            Prev
          </button>
          <span className="px-2">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
            className="inline-flex items-center gap-1 rounded border border-null-line px-2 py-1 hover:bg-null-cloud disabled:opacity-40 dark:border-white/10 dark:hover:bg-null-navy2"
          >
            Next
            <Icon name="chevron-right" size={14} />
          </button>
        </span>
      </div>
    </div>
  )
}
