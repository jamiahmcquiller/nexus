// NULL design system — generic record detail drawer.
// Drill-down for one record from a module table, built on the shared
// DetailDrawer. The field list comes from the section's
// ModulePresentation (detailFields). Credential-bearing keys are
// never rendered: any key containing token, password, secret, or
// hash is skipped silently, so secrets can never surface in UI.

import { DetailDrawer } from './DetailDrawer'
import { formatLocalDateTime, parseBackendDate } from '../time'

export type RecordDetailDrawerProps = {
  open: boolean
  record: any | null
  title: string
  fields: string[]
  onClose: () => void
}

// Keys that must never be rendered, even if a presentation lists
// them. Matched case-insensitively against the full key.
const SENSITIVE_KEY_PARTS = ['token', 'password', 'secret', 'hash']

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part))
}

// "2026-11-21T15:54:55" or "2026-11-21" — a backend datetime, not
// a free-text string that happens to contain digits.
const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

function formatValue(value: any): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') {
    // Date-like strings render viewer-local via the shared helpers
    // (naive UTC parsed as UTC); anything else renders as-is.
    if (ISO_DATE_LIKE.test(value.trim()) && parseBackendDate(value)) {
      return formatLocalDateTime(value)
    }
    return value || '—'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const named = value.name || value.title || value.platform
    if (typeof named === 'string' && named) return named
    return `${Object.keys(value).length} fields`
  }
  return String(value)
}

function formatLabel(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function RecordDetailDrawer({ open, record, title, fields, onClose }: RecordDetailDrawerProps) {
  if (!record) return null

  const visibleFields = fields.filter((key) => !isSensitiveKey(key))

  return (
    <DetailDrawer open={open} onClose={onClose} title={title}>
      <dl>
        {visibleFields.map((key) => (
          <div
            key={key}
            className="flex items-start justify-between gap-4 border-b border-null-line py-2 last:border-b-0 dark:border-white/10"
          >
            <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
              {formatLabel(key)}
            </dt>
            <dd className="min-w-0 break-words text-right text-sm text-null-ink dark:text-white">
              {formatValue(record[key])}
            </dd>
          </div>
        ))}
        {visibleFields.length === 0 && (
          <p className="py-4 text-sm text-null-muted dark:text-[#8AA0B8]">No details to show for this record.</p>
        )}
      </dl>
    </DetailDrawer>
  )
}
