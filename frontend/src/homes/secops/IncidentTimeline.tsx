// NULL — Security Operations home: incident response timeline.
//
// The containment story, from incident records only — ordered
// newest first, every entry opening its record detail. Incidents
// carry no severity of their own, so none is shown; severity
// comes from their related alerts, and this data has none
// recorded (stated on screen, not papered over). Status drives
// the tone dot: failed → critical, complete → success, anything
// still open → warning.

import { NULL_COLORS } from '../../theme'
import { fmtAge, fmtDate, normStatus, timeOf } from './types'
import type { DrawerView } from './DrawerViews'
import { OriginBadge } from './DrawerViews'
import type { DeviceRow, IncidentRow } from './types'

export type IncidentTimelineProps = {
  incidents: IncidentRow[]
  hostnameOf: (deviceId: string | null | undefined) => string
  deviceOf: (deviceId: string | null | undefined) => DeviceRow | undefined
  onOpenView: (view: DrawerView) => void
  onOpenDevice: (device: DeviceRow) => void
  alertsRecorded: boolean
  now: number
}

const TONE_HEX: Record<'success' | 'warning' | 'critical' | 'neutral', string> = {
  success: NULL_COLORS.success,
  warning: NULL_COLORS.warning,
  critical: NULL_COLORS.critical,
  neutral: NULL_COLORS.muted,
}

const PAGE = 8

export function IncidentTimeline(p: IncidentTimelineProps) {
  const ordered = [...p.incidents].sort((a, b) => (timeOf(b) ?? 0) - (timeOf(a) ?? 0))
  const shown = ordered.slice(0, PAGE)

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
        Containment actions, newest first. Incidents carry no severity — that comes from related alerts, and{' '}
        {p.alertsRecorded ? 'alerts are recorded for this data.' : 'no alerts are recorded in this data.'}
      </p>
      {ordered.length === 0 ? (
        <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
          No incident-response actions exist yet. Containment work will appear here by outcome.
        </p>
      ) : (
        <>
          <ol className="relative space-y-4 border-l border-null-line pl-5 dark:border-white/10">
            {shown.map((i) => {
              const t = timeOf(i)
              const s = normStatus(i.status)
              const tone = s === 'failed' ? 'critical' : s === 'complete' ? 'success' : 'warning'
              const device = p.deviceOf(i.device_id)
              return (
                <li key={i.id} className="relative">
                  <span
                    className="absolute -left-[26px] top-1 inline-block h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-null-obsidian"
                    style={{ background: TONE_HEX[tone] }}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <button
                      type="button"
                      onClick={() => p.onOpenView({ kind: 'incident', row: i })}
                      className="text-left text-sm font-medium text-null-ink hover:text-null-teal dark:text-white"
                      title="Open incident detail"
                    >
                      {i.title || 'Incident response'}
                    </button>
                    <time className="text-xs text-null-muted dark:text-[#8AA0B8]">
                      {t !== null ? `${fmtDate(t)} (${fmtAge(t, p.now)})` : '—'}
                    </time>
                    <OriginBadge sample={i.is_demo === true} />
                  </div>
                  <p className="mt-0.5 text-sm text-null-muted dark:text-[#8AA0B8]">
                    {i.action || 'response'} · {i.status || '—'}
                    {device ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => p.onOpenDevice(device)}
                          className="text-null-teal hover:underline"
                          title="Open endpoint detail"
                        >
                          {p.hostnameOf(i.device_id)}
                        </button>
                      </>
                    ) : (
                      ''
                    )}
                    {i.performed_by ? ` · by ${i.performed_by}` : ''}
                  </p>
                </li>
              )
            })}
          </ol>
          <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            Showing {shown.length} of {ordered.length} containment {ordered.length === 1 ? 'action' : 'actions'}.
            {ordered.length > PAGE && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => p.onOpenView({ kind: 'incidents', title: 'Incident response — all actions', rows: ordered })}
                  className="font-medium text-null-teal hover:underline"
                >
                  View all →
                </button>
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
