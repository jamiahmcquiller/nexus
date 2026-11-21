// NULL design system — status and severity badges.
// Colors come from theme.ts (statusTone / statusBadgeClasses), so
// the semantic meaning of a value never drifts between screens.

import { statusBadgeClasses, statusTone } from '../theme'

type BadgeProps = {
  value: string | undefined | null
  size?: 'sm' | 'md'
}

/** Pill for a lifecycle / status value (open, testing, deployed…). */
export function StatusBadge({ value, size = 'md' }: BadgeProps) {
  const { color, background } = statusBadgeClasses(value)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium capitalize ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      style={{ color, background }}
      title={`Status tone: ${statusTone(value)}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {value || '—'}
    </span>
  )
}

/** Pill for a severity / priority value (critical, high, medium, low). */
export function SeverityBadge({ value, size = 'md' }: BadgeProps) {
  const { color, background } = statusBadgeClasses(value)
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold uppercase tracking-wide ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      }`}
      style={{ color, background }}
    >
      {value || '—'}
    </span>
  )
}
