// NULL — IT Ops home: clickable horizontal bar rows.
//
// Label + proportional bar + value (+ optional detail text). A row
// with an onSelect is a real button that opens the underlying
// records; a row without one renders as static text, so nothing
// looks clickable when it is not.

export type ClickableBarRow = {
  label: string
  value: number
  color?: string
  /** Secondary text after the value, e.g. "18 available · 9 testing". */
  detail?: string
  onSelect?: () => void
}

type ClickableBarRowsProps = {
  rows: ClickableBarRow[]
  /** Scale maximum; defaults to the largest row value. */
  max?: number
  /** Width of the label column. */
  labelWidthClass?: string
}

export function ClickableBarRows({ rows, max, labelWidthClass = 'w-28' }: ClickableBarRowsProps) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1)
  if (rows.length === 0) {
    return <p className="text-xs text-null-muted dark:text-[#8AA0B8]">No data</p>
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const inner = (
          <>
            <span className={`${labelWidthClass} shrink-0 truncate text-right text-null-muted dark:text-[#8AA0B8]`}>
              {row.label}
            </span>
            <span className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
              <span
                className="block h-full rounded"
                style={{ width: `${(row.value / top) * 100}%`, background: row.color ?? '#17C3B2' }}
              />
            </span>
            <span className="w-8 shrink-0 text-right font-medium text-null-ink dark:text-white">{row.value}</span>
            {row.detail && (
              <span className="hidden shrink-0 text-null-muted sm:inline dark:text-[#8AA0B8]">{row.detail}</span>
            )}
          </>
        )
        return (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            {row.onSelect ? (
              <button
                type="button"
                onClick={row.onSelect}
                aria-label={`${row.label}: ${row.value}${row.detail ? ` — ${row.detail}` : ''} — show records`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-null-cloud dark:hover:bg-null-navy2"
              >
                {inner}
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5">{inner}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
