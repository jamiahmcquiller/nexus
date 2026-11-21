// NULL design system — KPI panel.
// Compact, clickable stat card with optional trend + sparkline.
// Teal is the default accent; semantic accents only when the
// number itself carries a status meaning.

import { useId } from 'react'
import { Sparkline } from './Charts'

export type KpiAccent = 'teal' | 'critical' | 'warning' | 'success' | 'neutral'

export type KpiTrend = {
  direction: 'up' | 'down' | 'flat'
  value: string
  /** Whether the direction is good news. Defaults to up = good. */
  good?: boolean
}

type KpiPanelProps = {
  label: string
  value: string | number
  sublabel?: string
  trend?: KpiTrend
  sparkline?: number[]
  onClick?: () => void
  accent?: KpiAccent
}

const ACCENT_BAR: Record<KpiAccent, string> = {
  teal: 'bg-null-teal',
  critical: 'bg-null-critical',
  warning: 'bg-null-warning',
  success: 'bg-null-success',
  neutral: 'bg-null-muted',
}

const ACCENT_SPARK: Record<KpiAccent, string> = {
  teal: '#17C3B2',
  critical: '#C64D4D',
  warning: '#D99536',
  success: '#218568',
  neutral: '#65748a',
}

export function KpiPanel({ label, value, sublabel, trend, sparkline, onClick, accent = 'teal' }: KpiPanelProps) {
  const labelId = useId()
  const arrow = trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '→'
  const trendGood = trend ? (trend.good ?? trend.direction !== 'down') : false
  const trendClass = trend
    ? trendGood
      ? 'text-null-success'
      : 'text-null-critical'
    : ''

  const inner = (
    <>
      <span className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${ACCENT_BAR[accent]}`} aria-hidden />
      <span id={labelId} className="block text-xs font-medium uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">{label}</span>
      <span className="mt-1 block text-2xl font-bold leading-tight text-null-ink dark:text-white">{value}</span>
      {sublabel && <span className="mt-0.5 block text-sm text-null-muted dark:text-[#8AA0B8]">{sublabel}</span>}
      {trend && (
        <span className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${trendClass}`}>
          <span aria-hidden>{arrow}</span>
          <span>{trend.value}</span>
        </span>
      )}
      {sparkline && sparkline.length > 1 && (
        <span className="mt-2 block h-8">
          <Sparkline series={sparkline} color={ACCENT_SPARK[accent]} ariaLabel={`${label} trend`} />
        </span>
      )}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-labelledby={labelId}
        className="null-card relative w-full overflow-hidden pl-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-null-teal"
      >
        {inner}
      </button>
    )
  }

  return (
    <div className="null-card relative overflow-hidden pl-4">
      {inner}
    </div>
  )
}
