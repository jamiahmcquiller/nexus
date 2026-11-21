// Shared timestamp helpers — every backend datetime is naive UTC
// (stored TIMESTAMP WITHOUT TIME ZONE, serialized with no zone
// designator, e.g. "2026-11-21T15:54:55"). Parsing such a string
// with `new Date(value)` makes the browser read it as LOCAL time,
// which then renders 5h off in America/Detroit — and also skews
// any age math done on it (a 10-minute-old check-in computes as
// 5h10m and reads "Stale"). Append 'Z' first so it is parsed as
// UTC, then render with toLocaleString() in the viewer's local time
// — the same treatment the dashboard homes use (their parseDate).
//
// Kept to erasable syntax only (type annotations, no enums or
// parameter properties) so Node can run this file directly with
// type stripping for unit-level checks.

/** Parse a backend datetime as the UTC instant it denotes.
    Values that already carry a zone designator (Z, or a +hh:mm /
    -hh:mm offset) pass through unchanged. Returns null for a
    missing or unparseable value. */
export function parseBackendDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const v = value.includes('T') && !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? `${value}Z` : value
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Render a backend datetime in the viewer's local time, like the
    dashboard homes do. Returns '—' for a missing value and echoes
    the raw string when it cannot be parsed. No "UTC" suffix — the
    instant is shown in local time, so labelling it UTC would lie. */
export function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = parseBackendDate(value)
  if (!d) return value
  return d.toLocaleString()
}

/** "just now" / "5 min ago" / "2h 10m ago" / "3d 4h ago", computed
    from the instant the backend value denotes (naive UTC). */
export function relativeAge(value: string | null | undefined): string {
  const d = parseBackendDate(value)
  if (!d) return ''
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h ago`
}
