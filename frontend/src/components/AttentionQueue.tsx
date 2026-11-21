// NULL design system — attention queue.
// Severity-ordered actionable rows: most severe first, each row
// carries its own action.

import { SeverityBadge } from './StatusBadge'

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low'

export type AttentionItem = {
  id: string
  severity: AttentionSeverity
  title: string
  asset?: string
  time?: string
  status?: string
  actionLabel?: string
  onAction?: () => void
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

type AttentionQueueProps = {
  items: AttentionItem[]
}

export function AttentionQueue({ items }: AttentionQueueProps) {
  const ordered = [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  if (ordered.length === 0) {
    return <p className="text-sm text-null-muted dark:text-[#8AA0B8]">Nothing needs attention right now.</p>
  }

  return (
    <ul className="space-y-2">
      {ordered.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-null-line px-3 py-2.5 dark:border-white/10"
        >
          <SeverityBadge value={item.severity} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-null-ink dark:text-white">{item.title}</span>
            <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
              {[item.asset, item.status, item.time].filter(Boolean).join(' · ')}
            </span>
          </span>
          {item.actionLabel && (
            <button
              type="button"
              onClick={item.onAction}
              disabled={!item.onAction}
              className="shrink-0 rounded bg-null-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-null-tealDark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {item.actionLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
