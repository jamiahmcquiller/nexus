// NULL — Security Operations home: clickable security activity feed.
//
// The same chronological feed the old ActivityTimeline rendered
// (detections, containment, findings in the selected range,
// newest first), but every entry is a button that opens the
// drill-down drawer on the underlying record — the shared
// timeline component has no click affordance, so this keeps its
// visual language (tone dot on a rail) and adds the drill-down.

import { NULL_COLORS } from '../../theme'
import type { DrawerView } from './DrawerViews'
import type { TimelineTone } from '../../components'

export type ActivityFeedItem = {
  id: string
  time: string
  title: string
  detail?: string
  tone?: TimelineTone
  actor?: string
  view: DrawerView
}

const TONE_HEX: Record<TimelineTone, string> = {
  success: NULL_COLORS.success,
  warning: NULL_COLORS.warning,
  critical: NULL_COLORS.critical,
  info: NULL_COLORS.info,
  neutral: NULL_COLORS.muted,
}

export function ActivityFeed({
  items,
  onOpenView,
}: {
  items: ActivityFeedItem[]
  onOpenView: (view: DrawerView) => void
}) {
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
            <button
              type="button"
              onClick={() => onOpenView(item.view)}
              className="text-left text-sm font-medium text-null-ink hover:text-null-teal dark:text-white"
              title="Open underlying record"
            >
              {item.title}
            </button>
            <time className="text-xs text-null-muted dark:text-[#8AA0B8]">{item.time}</time>
          </div>
          {item.detail && <p className="mt-0.5 text-sm text-null-muted dark:text-[#8AA0B8]">{item.detail}</p>}
          {item.actor && <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">by {item.actor}</p>}
        </li>
      ))}
    </ol>
  )
}
