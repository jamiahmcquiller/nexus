// NULL — Security Operations home: remediation tracking.
//
// Where every open item stands, tracked against the only time
// and status fields the records actually carry. Statuses are
// counted from the same rows the rest of the screen uses, so the
// pipelines reconcile with the totals.
//
// What is tracked, per record type:
//   Vulnerabilities — open / mitigated / remediated / accepted,
//     plus open items bucketed by age (<7d, 7–30d, >30d) from
//     detected_at.
//   Malware — detected / quarantined / remediated / false-positive.
//   DLP — open / encrypted / remediated / accepted.
//   Incidents — pending / in-progress / complete / failed.
//   Compliance — compliant / non-compliant assessments (the only
//     violation proxy the platform has).
// What is NOT tracked, stated on screen:
//   Overdue remediation — no security record has a deadline field.
//   Mean time to remediate — no record has a resolution timestamp.
//   Policy violations — none recorded while no compliance
//     assessments exist.
// Clicking a pipeline segment opens the drawer on those records.

import { NULL_COLORS } from '../../theme'
import { ageDays, normStatus, timeOf } from './types'
import type { DrawerView } from './DrawerViews'
import type { AlertRow, ComplianceRow, DlpRow, IncidentRow, MalwareRow, VulnRow } from './types'

export type RemediationTrackingProps = {
  vulns: VulnRow[]
  incidents: IncidentRow[]
  malware: MalwareRow[]
  dlp: DlpRow[]
  compliance: ComplianceRow[]
  alerts: AlertRow[]
  now: number
  onOpenView: (view: DrawerView) => void
}

type Segment = { key: string; label: string; value: number; color: string; rows: unknown[] }

function PipelineCard({
  title,
  subtitle,
  segments,
  total,
  onOpenView,
  drawerTitle,
}: {
  title: string
  subtitle: string
  segments: Segment[]
  total: number
  onOpenView: (view: DrawerView) => void
  drawerTitle: (segment: Segment) => DrawerView
}) {
  return (
    <div className="rounded-lg border border-null-line p-3 dark:border-white/10">
      <h4 className="text-sm font-semibold text-null-ink dark:text-white">{title}</h4>
      <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">{subtitle}</p>
      {total === 0 ? (
        <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">No records.</p>
      ) : (
        <>
          <div
            className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-null-cloud dark:bg-null-navy2"
            role="img"
            aria-label={`${title} — ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
          >
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onOpenView(drawerTitle(s))}
                  title={`${s.label}: ${s.value} — view records`}
                  aria-label={`${s.label}: ${s.value} — view records`}
                  className="h-full transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-null-teal"
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                />
              ))}
          </div>
          <ul className="mt-2.5 space-y-1">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onOpenView(drawerTitle(s))}
                  className="flex items-center gap-1.5 text-null-ink hover:underline dark:text-white"
                  title={`View ${s.label.toLowerCase()} records`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </button>
                <span className="font-medium text-null-ink dark:text-white">
                  {s.value}
                  <span className="font-normal text-null-muted dark:text-[#8AA0B8]">
                    {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export function RemediationTracking(p: RemediationTrackingProps) {
  const byStatus = <T extends { status?: string | null }>(rows: T[], status: string): T[] =>
    rows.filter((r) => normStatus(r.status) === status)

  const openVulns = byStatus(p.vulns, 'open')
  const vulnSegments: Segment[] = [
    { key: 'open', label: 'Open', value: openVulns.length, color: NULL_COLORS.critical, rows: openVulns },
    { key: 'mitigated', label: 'Mitigated', value: byStatus(p.vulns, 'mitigated').length, color: NULL_COLORS.info, rows: byStatus(p.vulns, 'mitigated') },
    { key: 'remediated', label: 'Remediated', value: byStatus(p.vulns, 'remediated').length, color: NULL_COLORS.success, rows: byStatus(p.vulns, 'remediated') },
    { key: 'accepted', label: 'Accepted', value: byStatus(p.vulns, 'accepted').length, color: NULL_COLORS.muted, rows: byStatus(p.vulns, 'accepted') },
  ]

  const detected = byStatus(p.malware, 'detected')
  const malwareSegments: Segment[] = [
    { key: 'detected', label: 'Detected', value: detected.length, color: NULL_COLORS.critical, rows: detected },
    { key: 'quarantined', label: 'Quarantined', value: byStatus(p.malware, 'quarantined').length, color: NULL_COLORS.info, rows: byStatus(p.malware, 'quarantined') },
    { key: 'remediated', label: 'Remediated', value: byStatus(p.malware, 'remediated').length, color: NULL_COLORS.success, rows: byStatus(p.malware, 'remediated') },
    { key: 'false-positive', label: 'False positive', value: byStatus(p.malware, 'false-positive').length, color: NULL_COLORS.muted, rows: byStatus(p.malware, 'false-positive') },
  ]

  const openDlp = byStatus(p.dlp, 'open')
  const dlpSegments: Segment[] = [
    { key: 'open', label: 'Open', value: openDlp.length, color: NULL_COLORS.critical, rows: openDlp },
    { key: 'encrypted', label: 'Encrypted', value: byStatus(p.dlp, 'encrypted').length, color: NULL_COLORS.info, rows: byStatus(p.dlp, 'encrypted') },
    { key: 'remediated', label: 'Remediated', value: byStatus(p.dlp, 'remediated').length, color: NULL_COLORS.success, rows: byStatus(p.dlp, 'remediated') },
    { key: 'accepted', label: 'Accepted', value: byStatus(p.dlp, 'accepted').length, color: NULL_COLORS.muted, rows: byStatus(p.dlp, 'accepted') },
  ]

  const pending = byStatus(p.incidents, 'pending')
  const inProgress = byStatus(p.incidents, 'in-progress')
  const incidentSegments: Segment[] = [
    { key: 'pending', label: 'Pending', value: pending.length, color: NULL_COLORS.info, rows: pending },
    { key: 'in-progress', label: 'In progress', value: inProgress.length, color: NULL_COLORS.warning, rows: inProgress },
    { key: 'complete', label: 'Complete', value: byStatus(p.incidents, 'complete').length, color: NULL_COLORS.success, rows: byStatus(p.incidents, 'complete') },
    { key: 'failed', label: 'Failed', value: byStatus(p.incidents, 'failed').length, color: NULL_COLORS.critical, rows: byStatus(p.incidents, 'failed') },
  ]

  const ageBuckets = { under7: 0, sevenTo30: 0, over30: 0, undated: 0 }
  for (const v of openVulns) {
    const d = ageDays(timeOf(v), p.now)
    if (d === null) ageBuckets.undated += 1
    else if (d < 7) ageBuckets.under7 += 1
    else if (d <= 30) ageBuckets.sevenTo30 += 1
    else ageBuckets.over30 += 1
  }

  const nonCompliant = byStatus(p.compliance, 'non_compliant')
  const compliant = byStatus(p.compliance, 'compliant')

  const vulnDrawer = (s: Segment): DrawerView => ({ kind: 'vulns', title: `Vulnerabilities — ${s.label}`, rows: s.rows as VulnRow[] })
  const malwareDrawer = (s: Segment): DrawerView => ({ kind: 'malware', title: `Malware detections — ${s.label}`, rows: s.rows as MalwareRow[] })
  const dlpDrawer = (s: Segment): DrawerView => ({ kind: 'dlp', title: `DLP findings — ${s.label}`, rows: s.rows as DlpRow[] })
  const incidentDrawer = (s: Segment): DrawerView => ({ kind: 'incidents', title: `Incidents — ${s.label}`, rows: s.rows as IncidentRow[] })

  const gaps: string[] = [
    'Overdue remediation cannot be computed — no vulnerability, incident, malware, or DLP record has a deadline field. Age since detection is shown instead.',
    'Mean time to remediate cannot be computed — no record has a resolution timestamp.',
  ]
  if (p.compliance.length === 0) {
    gaps.push(
      'Policy violations cannot be tracked — no compliance assessments are recorded, and non-compliant assessments are the only violation proxy the platform has.',
    )
  }
  if (p.alerts.length === 0) {
    gaps.push(
      'Incident severity cannot be shown — no alerts are recorded, and incidents carry no severity of their own.',
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PipelineCard
          title="Vulnerabilities"
          subtitle={`${p.vulns.length} total · open items by age below`}
          segments={vulnSegments}
          total={p.vulns.length}
          onOpenView={p.onOpenView}
          drawerTitle={vulnDrawer}
        />
        <PipelineCard
          title="Malware detections"
          subtitle={`${p.malware.length} total · quarantined means flag set or status quarantined / remediated`}
          segments={malwareSegments}
          total={p.malware.length}
          onOpenView={p.onOpenView}
          drawerTitle={malwareDrawer}
        />
        <PipelineCard
          title="DLP findings"
          subtitle={`${p.dlp.length} total · closed means remediated or encrypted`}
          segments={dlpSegments}
          total={p.dlp.length}
          onOpenView={p.onOpenView}
          drawerTitle={dlpDrawer}
        />
        <PipelineCard
          title="Incidents"
          subtitle={`${p.incidents.length} containment actions total`}
          segments={incidentSegments}
          total={p.incidents.length}
          onOpenView={p.onOpenView}
          drawerTitle={incidentDrawer}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-null-line p-3 dark:border-white/10">
          <h4 className="text-sm font-semibold text-null-ink dark:text-white">Open vulnerabilities by age</h4>
          <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
            {openVulns.length} open · age from detected_at. Click a bucket to see those records.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { key: 'under7', label: '< 7 days', value: ageBuckets.under7, rows: openVulns.filter((v) => { const d = ageDays(timeOf(v), p.now); return d !== null && d < 7 }) },
                { key: 'sevenTo30', label: '7–30 days', value: ageBuckets.sevenTo30, rows: openVulns.filter((v) => { const d = ageDays(timeOf(v), p.now); return d !== null && d >= 7 && d <= 30 }) },
                { key: 'over30', label: '> 30 days', value: ageBuckets.over30, rows: openVulns.filter((v) => { const d = ageDays(timeOf(v), p.now); return d !== null && d > 30 }) },
                { key: 'undated', label: 'No detection date', value: ageBuckets.undated, rows: openVulns.filter((v) => ageDays(timeOf(v), p.now) === null) },
              ] as Array<{ key: string; label: string; value: number; rows: VulnRow[] }>
            ).map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => p.onOpenView({ kind: 'vulns', title: `Open vulnerabilities — ${b.label}`, rows: b.rows })}
                className="rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                title={`View ${b.value} open vulnerabilities`}
              >
                <span className="block text-lg font-bold leading-tight text-null-ink dark:text-white">{b.value}</span>
                <span className="block text-xs text-null-muted dark:text-[#8AA0B8]">{b.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
            {p.compliance.length === 0 ? (
              <>
                Policy violations: <span className="font-semibold text-null-ink dark:text-white">—</span> · no
                assessments recorded. A 0 here would read as “clean”, so no number is shown — non-compliant
                assessments are the only violation proxy the platform has, and none exist yet.
              </>
            ) : (
              <>
                Compliance: {p.compliance.length} {p.compliance.length === 1 ? 'assessment' : 'assessments'}{' '}
                recorded · {compliant.length} compliant · {nonCompliant.length} non-compliant.{' '}
                <button
                  type="button"
                  onClick={() =>
                    p.onOpenView({ kind: 'compliance', title: 'Non-compliant assessments', rows: nonCompliant })
                  }
                  className="font-medium text-null-teal hover:underline"
                >
                  View non-compliant →
                </button>
              </>
            )}
          </p>
        </div>

        <div className="rounded-lg border border-null-line bg-null-cloud p-3 dark:border-white/10 dark:bg-null-navy2">
          <h4 className="text-sm font-semibold text-null-ink dark:text-white">What cannot be tracked here</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
