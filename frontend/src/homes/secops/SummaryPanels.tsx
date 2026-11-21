// NULL — Security Operations home: contextual summary band.
//
// Replaces the old strip of eight identical KPI cards with four
// combined panels. Every number derives from the same records the
// charts and queues below use; every segment, row, and "View"
// affordance opens the drill-down drawer on the underlying
// records — nothing here is a dead click.
//
// Panels:
//   Exposure — open vulnerabilities with an embedded severity
//     stack (click a segment for that severity), a sparkline of
//     new detections in the selected range, and the range trend.
//   Incident response — active incidents with an outcome stack
//     (open / complete / failed, each clickable).
//   Detections & data risk — unquarantined malware plus the
//     quarantine rate, and open DLP findings plus the closure
//     rate, as two clickable rows.
//   Fleet & remediation — high-risk endpoints, reporting in the
//     last 24h, remediation progress, and the honest MTTR state
//     ("—", no resolution timestamps).

import type { ReactNode } from 'react'
import { Sparkline } from '../../components'
import type { KpiTrend } from '../../components'
import { NULL_COLORS } from '../../theme'
import type { Severity } from './types'

export type SummaryPanelsProps = {
  openCount: number
  totalCount: number
  severityCounts: { critical: number; high: number; medium: number; low: number }
  unclassifiedOpen: number
  remediatedCount: number
  trendSeries: number[]
  trend: KpiTrend | undefined
  days: number
  activeIncidents: number
  completeIncidents: number
  failedIncidents: number
  totalIncidents: number
  detectedMalware: number
  actionableMalware: number
  falsePositiveMalware: number
  quarantinedMalware: number
  critDetectedMalware: number
  openDlp: number
  totalDlp: number
  closedDlp: number
  highRiskCount: number
  deviceCount: number
  enrolledCount: number
  reporting24h: number
  onOpenVulns: (severity?: Severity) => void
  onOpenIncidents: (status?: 'active' | 'complete' | 'failed') => void
  onOpenMalware: () => void
  onOpenDlp: () => void
  onOpenHighRiskDevices: () => void
  onOpenReporting: () => void
}

const SEV_META: Array<{ key: 'critical' | 'high' | 'medium' | 'low'; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: NULL_COLORS.critical },
  { key: 'high', label: 'High', color: NULL_COLORS.warning },
  { key: 'medium', label: 'Medium', color: NULL_COLORS.info },
  { key: 'low', label: 'Low', color: NULL_COLORS.muted },
]

function PanelShell({
  label,
  children,
  onView,
  viewLabel,
}: {
  label: string
  children: ReactNode
  onView: () => void
  viewLabel: string
}) {
  return (
    <section className="null-card relative overflow-hidden pl-4" aria-label={label}>
      <span className="absolute left-0 top-0 h-full w-1 bg-null-teal" aria-hidden />
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">{label}</h3>
        <button type="button" onClick={onView} className="shrink-0 text-xs font-medium text-null-teal hover:underline">
          {viewLabel} →
        </button>
      </div>
      {children}
    </section>
  )
}

function StackBar({
  segments,
  onSegment,
  ariaLabel,
}: {
  segments: Array<{ key: string; label: string; value: number; color: string }>
  onSegment: (key: string) => void
  ariaLabel: string
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total === 0) return <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No records.</p>
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-null-cloud dark:bg-null-navy2" role="img" aria-label={ariaLabel}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSegment(s.key)}
              title={`${s.label}: ${s.value} — view records`}
              aria-label={`${s.label}: ${s.value} — view records`}
              className="h-full transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-null-teal"
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSegment(s.key)}
              className="flex items-center gap-1.5 text-xs text-null-ink hover:underline dark:text-white"
              title={`View ${s.label.toLowerCase()} records`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="font-medium">{s.label}</span>
              <span className="text-null-muted dark:text-[#8AA0B8]">{s.value}</span>
            </button>
          ))}
      </div>
    </div>
  )
}

function ProgressRow({
  label,
  done,
  total,
  onClick,
}: {
  label: string
  done: number
  total: number
  onClick: () => void
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <button type="button" onClick={onClick} className="block w-full text-left" title={`${label} — view records`}>
      <span className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-null-ink dark:text-white">{label}</span>
        <span className="font-semibold text-null-ink dark:text-white">
          {done} of {total} <span className="font-normal text-null-muted dark:text-[#8AA0B8]">({pct}%)</span>
        </span>
      </span>
      <span className="mt-1 block h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
        <span className="block h-full rounded bg-null-teal" style={{ width: `${pct}%` }} />
      </span>
    </button>
  )
}

export function SummaryPanels(p: SummaryPanelsProps) {
  const trendArrow = p.trend?.direction === 'up' ? '↑' : p.trend?.direction === 'down' ? '↓' : '→'
  const trendGood = p.trend ? (p.trend.good ?? p.trend.direction !== 'down') : false
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <PanelShell label="Exposure — open vulnerabilities" onView={() => p.onOpenVulns()} viewLabel="View all">
        <span className="block text-2xl font-bold leading-tight text-null-ink dark:text-white">{p.openCount}</span>
        <div className="mt-2">
          <StackBar
            ariaLabel={`Open vulnerabilities by severity — Critical ${p.severityCounts.critical}, High ${p.severityCounts.high}, Medium ${p.severityCounts.medium}, Low ${p.severityCounts.low}`}
            segments={SEV_META.map((m) => ({ key: m.key, label: m.label, value: p.severityCounts[m.key], color: m.color }))}
            onSegment={(key) => p.onOpenVulns(key as Severity)}
          />
        </div>
        {p.unclassifiedOpen > 0 && (
          <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
            + {p.unclassifiedOpen} open without a recorded severity or CVSS — counted above, not in the stack.
          </p>
        )}
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="h-8 w-28 shrink-0">
            <Sparkline series={p.trendSeries} color={NULL_COLORS.teal} ariaLabel="New vulnerabilities in selected range" />
          </div>
          <p className="text-right text-xs leading-snug text-null-muted dark:text-[#8AA0B8]">
            {p.trend && (
              <span className={`font-medium ${trendGood ? 'text-null-success' : 'text-null-critical'}`}>
                {trendArrow} {p.trend.value}
              </span>
            )}
            <span className="block">
              {p.totalCount} total · {p.remediatedCount} remediated
            </span>
          </p>
        </div>
      </PanelShell>

      <PanelShell label="Incident response" onView={() => p.onOpenIncidents()} viewLabel="View all">
        <span className="block text-2xl font-bold leading-tight text-null-ink dark:text-white">{p.activeIncidents}</span>
        <p className="-mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">active incidents (pending / in-progress)</p>
        <div className="mt-2">
          <StackBar
            ariaLabel={`Incidents by outcome — Open ${p.activeIncidents}, Complete ${p.completeIncidents}, Failed ${p.failedIncidents}`}
            segments={[
              { key: 'active', label: 'Open', value: p.activeIncidents, color: NULL_COLORS.warning },
              { key: 'complete', label: 'Complete', value: p.completeIncidents, color: NULL_COLORS.success },
              { key: 'failed', label: 'Failed', value: p.failedIncidents, color: NULL_COLORS.critical },
            ]}
            onSegment={(key) => p.onOpenIncidents(key as 'active' | 'complete' | 'failed')}
          />
        </div>
        <p className="mt-3 text-xs leading-snug text-null-muted dark:text-[#8AA0B8]">
          {p.totalIncidents} containment actions total · {p.completeIncidents} complete · {p.failedIncidents} failed.
          Incidents carry no severity — that comes from their related alerts.
        </p>
      </PanelShell>

      <PanelShell label="Detections & data risk" onView={p.onOpenMalware} viewLabel="View detections">
        <span className="block text-2xl font-bold leading-tight text-null-ink dark:text-white">{p.detectedMalware}</span>
        <p className="-mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
          unquarantined malware detections
          {p.critDetectedMalware > 0 ? ` · ${p.critDetectedMalware} critical` : ''}
        </p>
        <div className="mt-3 space-y-3">
          <ProgressRow label="Malware quarantined" done={p.quarantinedMalware} total={p.actionableMalware} onClick={p.onOpenMalware} />
          <ProgressRow label="DLP findings closed" done={p.closedDlp} total={p.totalDlp} onClick={p.onOpenDlp} />
        </div>
        <p className="mt-3 text-xs leading-snug text-null-muted dark:text-[#8AA0B8]">
          {p.openDlp} open · {p.closedDlp} closed · {p.totalDlp - p.openDlp - p.closedDlp} accepted DLP{' '}
          {p.totalDlp - p.openDlp - p.closedDlp === 1 ? 'finding' : 'findings'} of {p.totalDlp} total — accepted
          is neither open nor closed.
          {p.falsePositiveMalware > 0 && (
            <>
              {' '}
              {p.falsePositiveMalware} false-positive {p.falsePositiveMalware === 1 ? 'detection is' : 'detections are'}{' '}
              excluded from the quarantine rate.
            </>
          )}
        </p>
      </PanelShell>

      <PanelShell label="Fleet & remediation" onView={p.onOpenHighRiskDevices} viewLabel="View endpoints">
        <span className="block text-2xl font-bold leading-tight text-null-ink dark:text-white">{p.highRiskCount}</span>
        <p className="-mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
          high-risk endpoints of {p.deviceCount} in the fleet
        </p>
        <div className="mt-3 space-y-3">
          <ProgressRow
            label="Endpoints reporting in last 24h"
            done={p.reporting24h}
            total={p.enrolledCount}
            onClick={p.onOpenReporting}
          />
          <ProgressRow label="Vulnerabilities remediated" done={p.remediatedCount} total={p.totalCount} onClick={() => p.onOpenVulns()} />
        </div>
        <p className="mt-3 text-xs leading-snug text-null-muted dark:text-[#8AA0B8]">
          Mean time to remediate: <span className="font-semibold text-null-ink dark:text-white">—</span> (no
          resolution timestamps on vulnerability or incident records).
        </p>
      </PanelShell>
    </div>
  )
}
