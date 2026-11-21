// NULL — IT Ops home: clickable donut.
//
// Same pure-SVG geometry as the shared DonutChart, but every segment
// and legend row is a button that opens the underlying records.
// Zero-value segments render no arc but stay in the legend —
// clicking one shows an explained empty state, never a dead click.

export type ClickableDonutSegment = {
  value: number
  color: string
  label: string
  onSelect?: () => void
}

type ClickableDonutProps = {
  segments: ClickableDonutSegment[]
  centerLabel?: string
  size?: number
}

export function ClickableDonut({ segments, centerLabel, size = 160 }: ClickableDonutProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const r = 60
  const circumference = 2 * Math.PI * r
  let offset = 0
  const label = centerLabel ?? (total > 0 ? String(total) : '—')
  const aria = segments.map((s) => `${s.label}: ${s.value}`).join(', ')

  const activate = (s: ClickableDonutSegment) => (e: React.KeyboardEvent | React.MouseEvent) => {
    if (!s.onSelect) return
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    s.onSelect()
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
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
            if (s.value <= 0) return null
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
                onClick={s.onSelect ? () => s.onSelect?.() : undefined}
                onKeyDown={s.onSelect ? activate(s) : undefined}
                tabIndex={s.onSelect ? 0 : undefined}
                role={s.onSelect ? 'button' : undefined}
                aria-label={s.onSelect ? `${s.label}: ${s.value} endpoints — show records` : undefined}
                style={s.onSelect ? { cursor: 'pointer' } : undefined}
              >
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            )
            offset += dash
            return el
          })}
        <text x="80" y="80" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="700" fill="currentColor">
          {label}
        </text>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={s.onSelect}
              disabled={!s.onSelect}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-null-ink hover:bg-null-cloud disabled:cursor-default disabled:hover:bg-transparent dark:text-white dark:hover:bg-null-navy2 dark:disabled:hover:bg-transparent"
            >
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="font-medium">{s.label}</span>
              <span className="text-null-muted dark:text-[#8AA0B8]">
                {s.value}
                {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
              </span>
            </button>
          </li>
        ))}
        {segments.length === 0 && <li className="text-null-muted dark:text-[#8AA0B8]">No data</li>}
      </ul>
    </div>
  )
}
