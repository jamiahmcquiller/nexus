// NULL design system — activity timeline.
// Chronological items with a tone dot on a vertical rail.

import { NULL_COLORS } from '../theme'

export type TimelineTone = 'success' | 'warning' | 'critical' | 'info' | 'neutral'

export type TimelineItem = {
  id: string
  time: string
  title: string
  detail?: string
  tone?: TimelineTone
  actor?: string
}

const TONE_HEX: Record<TimelineTone, string> = {
  success: NULL_COLORS.success,
  warning: NULL_COLORS.warning,
  critical: NULL_COLORS.critical,
  info: NULL_COLORS.info,
  neutral: NULL_COLORS.muted,
}

type ActivityTimelineProps = {
  items: TimelineItem[]
}

export function ActivityTimeline({ items }: ActivityTimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No activity yet.</p>
  }
  return (
    <ol className="relative space-y-4 border-l border-null-line pl-5 dark:border-white/10">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className="absolute -left-[26px] top-1 inline-block h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-null-obsidian"
            style={{ background: TONE_HEX[item.tone ?? 'neutral'] }}
            aria-hidden
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-null-ink dark:text-white">{item.title}</span>
            <time className="text-xs text-null-muted dark:text-[#8AA0B8]">{item.time}</time>
          </div>
          {item.detail && <p className="mt-0.5 text-sm text-null-muted dark:text-[#8AA0B8]">{item.detail}</p>}
          {item.actor && <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">by {item.actor}</p>}
        </li>
      ))}
    </ol>
  )
}
