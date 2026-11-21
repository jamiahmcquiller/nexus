// NULL design system — chart container + pure-SVG charts.
// No charting dependency: Donut, Bar, Line and Sparkline are hand
// rolled SVG with role="img" + aria-label for accessibility.

import type { ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/* ChartContainer                                                      */
/* ------------------------------------------------------------------ */

type ChartContainerProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  height?: number
}

export function ChartContainer({ title, subtitle, actions, children, height }: ChartContainerProps) {
  return (
    <section className="null-card" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-null-ink dark:text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div style={height ? { height } : undefined}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function normalize(series: number[]): number[] {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  return series.map((v) => (v - min) / span)
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

type SparklineProps = {
  series: number[]
  color?: string
  ariaLabel?: string
}

export function Sparkline({ series, color = '#17C3B2', ariaLabel }: SparklineProps) {
  if (series.length < 2) return null
  const w = 120
  const h = 32
  const norm = normalize(series)
  const points = norm
    .map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - 3 - v * (h - 6)).toFixed(1)}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={ariaLabel ?? `Sparkline: ${series.join(', ')}`}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* DonutChart                                                          */
/* ------------------------------------------------------------------ */

export type DonutSegment = { value: number; color: string; label: string }

type DonutChartProps = {
  segments: DonutSegment[]
  centerLabel?: string
  size?: number
}

export function DonutChart({ segments, centerLabel, size = 160 }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const r = 60
  const circumference = 2 * Math.PI * r
  let offset = 0
  const label = centerLabel ?? (total > 0 ? String(total) : '—')
  const aria = segments.map((s) => `${s.label}: ${s.value}`).join(', ')

  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox="0 0 160 160"
        role="img"
        aria-label={total > 0 ? `Donut chart — ${aria}` : 'Donut chart — no data'}
        className="shrink-0"
      >
        <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="20" className="text-null-line dark:text-white/10" />
        {total > 0 &&
          segments.map((s) => {
            const frac = s.value / total
            const dash = frac * circumference
            const el = (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="20"
                strokeDasharray={`${Math.max(dash - 2, 0)} ${circumference - Math.max(dash - 2, 0)}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
              />
            )
            offset += dash
            return el
          })}
        <text x="80" y="80" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="700" fill="currentColor">
          {label}
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-null-ink dark:text-white">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="font-medium">{s.label}</span>
            <span className="text-null-muted dark:text-[#8AA0B8]">
              {s.value}
              {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
            </span>
          </li>
        ))}
        {segments.length === 0 && <li className="text-null-muted dark:text-[#8AA0B8]">No data</li>}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* BarChart                                                            */
/* ------------------------------------------------------------------ */

export type BarDatum = { label: string; value: number; color?: string }

type BarChartProps = {
  bars: BarDatum[]
  orientation?: 'vertical' | 'horizontal'
}

export function BarChart({ bars, orientation = 'vertical' }: BarChartProps) {
  const max = Math.max(...bars.map((b) => b.value), 1)
  const aria = bars.map((b) => `${b.label}: ${b.value}`).join(', ')

  if (orientation === 'horizontal') {
    return (
      <div className="space-y-2" role="img" aria-label={`Bar chart — ${aria}`}>
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-right text-null-muted dark:text-[#8AA0B8]">{b.label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
              <div
                className="h-full rounded"
                style={{ width: `${(b.value / max) * 100}%`, background: b.color ?? '#17C3B2' }}
              />
            </div>
            <span className="w-10 shrink-0 font-medium text-null-ink dark:text-white">{b.value}</span>
          </div>
        ))}
        {bars.length === 0 && <p className="text-xs text-null-muted dark:text-[#8AA0B8]">No data</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full items-end gap-3" role="img" aria-label={`Bar chart — ${aria}`}>
      {bars.map((b) => (
        <div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-xs font-medium text-null-ink dark:text-white">{b.value}</span>
          <div
            className="w-full max-w-10 rounded-t"
            style={{ height: `${Math.max((b.value / max) * 100, 2)}%`, background: b.color ?? '#17C3B2' }}
          />
          <span className="w-full truncate text-center text-[11px] text-null-muted dark:text-[#8AA0B8]">{b.label}</span>
        </div>
      ))}
      {bars.length === 0 && <p className="text-xs text-null-muted dark:text-[#8AA0B8]">No data</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* LineChart                                                           */
/* ------------------------------------------------------------------ */

type LineChartProps = {
  series: number[]
  targetLine?: number
  labels?: string[]
  color?: string
}

export function LineChart({ series, targetLine, labels, color = '#17C3B2' }: LineChartProps) {
  if (series.length < 2) {
    return <p className="text-xs text-null-muted dark:text-[#8AA0B8]">Not enough data for a line chart.</p>
  }
  const w = 320
  const h = 160
  const pad = 8
  const all = targetLine !== undefined ? [...series, targetLine] : series
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2)
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2)
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${pad},${h - pad} ${points} ${x(series.length - 1).toFixed(1)},${h - pad}`

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-full w-full"
      role="img"
      aria-label={`Line chart — values ${series.join(', ')}${targetLine !== undefined ? `, target ${targetLine}` : ''}`}
    >
      {targetLine !== undefined && (
        <line x1={pad} x2={w - pad} y1={y(targetLine)} y2={y(targetLine)} stroke="#D99536" strokeWidth="1.5" strokeDasharray="5 4" />
      )}
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {series.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--surface, #FFFFFF)" stroke={color} strokeWidth="2" />
      ))}
      {labels && labels.length === series.length && (
        <g fontSize="10" fill="currentColor" opacity="0.7">
          {labels.map((lab, i) => (
            <text key={i} x={x(i)} y={h - 1} textAnchor="middle">
              {lab}
            </text>
          ))}
        </g>
      )}
    </svg>
  )
}
