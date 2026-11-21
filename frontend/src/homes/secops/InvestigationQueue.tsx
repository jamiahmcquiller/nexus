// NULL — Security Operations home: threat investigation queue.
//
// The ranked, actionable worklist. Unlike the old "Needs
// attention" list (whose buttons navigated away to modules),
// every row here opens the drill-down drawer on the underlying
// record, so an analyst can triage without leaving the screen.
//
// Ranking rule — stated on screen, deterministic, from real
// fields only:
//   1. Severity first: critical → high → medium → low.
//      Incidents carry no severity of their own, so they rank as
//      high (stated, not hidden). DLP findings rank by
//      classification: Restricted → high, Confidential → medium,
//      Internal → low.
//   2. Then most recently detected first.
// Sources: all open vulnerabilities, unquarantined (status
// "detected") malware, active (pending / in-progress) incidents,
// open DLP findings.
//
// Per-category fairness: a pure global sort would let one
// category crowd the rest out (15 open critical vulnerabilities
// alone would fill the list), so at least one item from each
// non-empty category is always shown, and the remaining slots go
// to the highest-ranked items. Every category also has a "View
// all" link that opens the drawer on its full list, so no
// category is reachable only through the top 8.

import { SeverityBadge } from '../../components'
import { OriginBadge } from './DrawerViews'
import type { DrawerView } from './DrawerViews'
import { fmtAge, severityOf, severityRank, timeOf } from './types'
import type { DlpRow, IncidentRow, MalwareRow, Severity, VulnRow } from './types'

export type InvestigationQueueProps = {
  openVulns: VulnRow[]
  detectedMalware: MalwareRow[]
  activeIncidents: IncidentRow[]
  openDlp: DlpRow[]
  hostnameOf: (deviceId: string | null | undefined) => string
  onOpenView: (view: DrawerView) => void
  now: number
}

const PAGE = 8

type QueueRow = {
  id: string
  severity: Severity
  title: string
  asset: string
  evidence: string
  sample: boolean
  t: number
  view: DrawerView
}

function dlpSeverity(classification: string | null | undefined): Severity {
  const c = (classification || '').trim().toLowerCase()
  if (c === 'restricted') return 'high'
  if (c === 'confidential') return 'medium'
  if (c === 'internal') return 'low'
  return 'medium'
}

function byRank(a: QueueRow, b: QueueRow): number {
  return severityRank(a.severity) - severityRank(b.severity) || b.t - a.t
}

export function InvestigationQueue(p: InvestigationQueueProps) {
  const vulnRows: QueueRow[] = p.openVulns.map((v) => {
    const sev = severityOf(v)
    const cvss =
      v.cvss_score !== null && v.cvss_score !== undefined && String(v.cvss_score).trim() !== ''
        ? `CVSS ${v.cvss_score}`
        : 'no CVSS recorded'
    return {
      id: `vuln-${v.id}`,
      severity: sev,
      title: v.cve_id ? `${v.cve_id} — ${v.title || 'Vulnerability'}` : v.title || 'Untitled vulnerability',
      asset: p.hostnameOf(v.device_id),
      evidence: `${cvss} · ${v.status || 'open'}`,
      sample: v.is_demo === true,
      t: timeOf(v) ?? 0,
      view: { kind: 'vuln', row: v } as DrawerView,
    }
  })
  const malwareRows: QueueRow[] = p.detectedMalware.map((m) => ({
    id: `malware-${m.id}`,
    severity: severityOf(m),
    title: m.name ? `${m.name} detected` : m.title || 'Malware detection',
    asset: p.hostnameOf(m.device_id),
    evidence: `${m.detection_layer || 'detection'}${m.mitre_ttp ? ` · ${m.mitre_ttp}` : ''} · not quarantined`,
    sample: m.is_demo === true,
    t: timeOf(m) ?? 0,
    view: { kind: 'malware-detection', row: m } as DrawerView,
  }))
  const incidentRows: QueueRow[] = p.activeIncidents.map((i) => ({
    id: `incident-${i.id}`,
    severity: 'high' as Severity,
    title: i.title || 'Untitled incident',
    asset: p.hostnameOf(i.device_id),
    evidence: `${i.action || 'Response'} · ${i.status || 'active'}${i.performed_by ? ` · ${i.performed_by}` : ''}`,
    sample: i.is_demo === true,
    t: timeOf(i) ?? 0,
    view: { kind: 'incident', row: i } as DrawerView,
  }))
  const dlpRows: QueueRow[] = p.openDlp.map((d) => ({
    id: `dlp-${d.id}`,
    severity: dlpSeverity(d.classification),
    title: d.title || 'Sensitive data finding',
    asset: p.hostnameOf(d.device_id) || d.location || '',
    evidence: `${d.data_type || 'data'} · ${d.classification || 'unclassified'} · open`,
    sample: d.is_demo === true,
    t: timeOf(d) ?? 0,
    view: { kind: 'dlp-finding', row: d } as DrawerView,
  }))

  const categories: Array<{ key: string; label: string; rows: QueueRow[]; listView: DrawerView }> = [
    {
      key: 'vuln',
      label: 'Vulnerabilities',
      rows: vulnRows.sort(byRank),
      listView: { kind: 'vulns', title: 'Open vulnerabilities — investigation queue', rows: p.openVulns },
    },
    {
      key: 'malware',
      label: 'Detections',
      rows: malwareRows.sort(byRank),
      listView: { kind: 'malware', title: 'Malware detections — unquarantined', rows: p.detectedMalware },
    },
    {
      key: 'incident',
      label: 'Incidents',
      rows: incidentRows.sort(byRank),
      listView: { kind: 'incidents', title: 'Active incidents', rows: p.activeIncidents },
    },
    {
      key: 'dlp',
      label: 'DLP',
      rows: dlpRows.sort(byRank),
      listView: { kind: 'dlp', title: 'Open DLP findings', rows: p.openDlp },
    },
  ]

  const total = categories.reduce((a, c) => a + c.rows.length, 0)

  // One item from each non-empty category first, then fill the
  // remaining slots by global rank — so no category is crowded out.
  const picked: QueueRow[] = []
  for (const c of categories) {
    if (c.rows.length > 0) picked.push(c.rows[0])
  }
  const pickedIds = new Set(picked.map((r) => r.id))
  const rest = categories
    .flatMap((c) => c.rows)
    .filter((r) => !pickedIds.has(r.id))
    .sort(byRank)
  picked.push(...rest.slice(0, Math.max(0, PAGE - picked.length)))
  picked.sort(byRank)
  const shown = picked.slice(0, PAGE)

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
        Ranked by severity, then most recent first. Incidents carry no severity, so they rank as high. DLP
        findings rank by classification: Restricted high, Confidential medium, Internal low. At least one item
        from each category is always shown; the remaining slots go to the highest-ranked items.
      </p>
      {total === 0 ? (
        <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
          Nothing needs investigation — no open vulnerabilities, unquarantined detections, active incidents,
          or open DLP findings.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {shown.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-null-line px-3 py-2.5 dark:border-white/10"
              >
                <SeverityBadge value={row.severity} size="sm" />
                <button
                  type="button"
                  onClick={() => p.onOpenView(row.view)}
                  className="min-w-0 flex-1 text-left"
                  title="Open record detail"
                >
                  <span className="block truncate text-sm font-medium text-null-ink hover:text-null-teal dark:text-white">
                    {row.title}
                  </span>
                  <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                    {[row.asset, row.evidence].filter(Boolean).join(' · ')}
                    {row.t > 0 ? ` · ${fmtAge(row.t, p.now)}` : ''}
                  </span>
                </button>
                <OriginBadge sample={row.sample} />
                <button
                  type="button"
                  onClick={() => p.onOpenView(row.view)}
                  className="shrink-0 rounded bg-null-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-null-tealDark"
                >
                  Investigate
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
            Showing {shown.length} of {total} {total === 1 ? 'item' : 'items'} needing investigation ·{' '}
            {categories.map((c) => `${c.label} ${c.rows.length}`).join(' · ')}.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {categories
              .filter((c) => c.rows.length > 0)
              .map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => p.onOpenView(c.listView)}
                  className="text-xs font-medium text-null-teal hover:underline"
                >
                  All {c.label.toLowerCase()} ({c.rows.length}) →
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
