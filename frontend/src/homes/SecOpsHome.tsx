// NULL — Security Operations home dashboard (SOC command center).
//
// Deliberately NOT the IT Ops home with different numbers: this screen
// leads with a risk-posture strip, then a severity-forward layout —
// vulnerability exposure + incident response on the left, risk
// distribution + protection coverage on the right, attention queue +
// activity timeline below.
//
// Every number is computed client-side from live API lists. Nothing
// is fabricated: a series with no underlying rows renders an
// EmptyState, not zeros dressed up as a chart.
//
// ── Data formulas (the contract — change these only deliberately) ──
//
// ENDPOINTS (all GET list, axios, props api/headers):
//   vulnerabilities  /api/v1/vulnerabilities/   (Vulnerability: severity,
//                    cvss_score STRING, status open/mitigated/remediated/
//                    accepted, device_id FK, is_demo, detected_at —
//                    NO created_at, NO updated_at, NO deadline)
//   incidents        /api/v1/edr/incidents/     (IncidentResponse: action,
//                    status pending/in-progress/complete/failed,
//                    is_demo, created_at — NO severity field)
//   malware          /api/v1/malware/detections/ (MalwareDetection:
//                    severity, quarantined bool, status detected/
//                    quarantined/remediated/false-positive, is_demo,
//                    created_at)
//   dlp              /api/v1/dlp/findings/      (SensitiveDataFinding:
//                    data_type, classification, status open/encrypted/
//                    remediated/accepted, is_demo, created_at)
//   alerts           /api/v1/alerts/            (SecurityAlert: severity,
//                    category, status new/investigating/contained/
//                    resolved, created_at — NO is_demo column)
//   compliance       /api/v1/compliance/        (ComplianceResult: benchmark,
//                    score, status compliant/non_compliant, findings,
//                    assessed_at — NO is_demo, NO created_at)
//   policies         /api/v1/policies/          (Policy: name, policy_type,
//                    status, definition, is_demo, created_at — a policy
//                    DEFINITION; there is no violation record type)
//   devices          /api/v1/devices/           (DeviceOut: hostname,
//                    device_id, enrollment_status, agent_version,
//                    last_checkin_at, attributes — NOT created_at and
//                    NOT is_demo, so devices cannot feed the sample
//                    pill; attributes.department / attributes.os exist
//                    only on demo-seeded rows — real agent devices do
//                    not carry them)
// All list responses serialize every column (_crud._serialize, or
// FastAPI jsonable_encoder for the raw-ORM lists), so is_demo IS
// present wherever the model has the column.
//
// RISK POSTURE (computed, rule stated on screen):
//   Elevated — any open critical vulnerability, any active incident
//              (pending/in-progress), or any unquarantined
//              critical-severity malware detection.
//   Guarded  — any open high vulnerability, any open DLP finding, any
//              detected (unquarantined) malware, or any non-compliant
//              assessment.
//   Stable   — none of the above.
//
// KPIs (all current state, NOT range-scoped; the range selector drives
// the trend chart, the timeline, and the "new in range" KPI trends):
//   Open vulnerabilities   = vulns with status "open"
//   Critical vulnerabilities = open vulns with severity "critical"
//   Active incidents       = IncidentResponse rows with status
//                            "pending" or "in-progress"
//   Malware detections     = MalwareDetection rows with status
//                            "detected" (not yet quarantined /
//                            remediated / false-positive)
//   DLP findings           = SensitiveDataFinding rows with status "open"
//   Policy violations      = ComplianceResult rows with status
//                            "non_compliant". There is NO violation record
//                            type in the platform, so this is the honest
//                            proxy: non-compliant benchmark assessments.
//                            (Demo policy rows carry a
//                            definition.sample_violation_count, but that
//                            is seed-only synthetic data and is NOT used.)
//   High-risk endpoints    = distinct device_ids linked to at least one
//                            OPEN critical- or high-severity vulnerability
//                            (Vulnerability.device_id FK — the linkage
//                            exists, so this is real)
//   Mean time to remediate = "—" with sublabel "no resolution
//                            timestamps". Neither Vulnerability (only
//                            detected_at) nor IncidentResponse (only
//                            created_at) has a resolution timestamp, so
//                            no MTTR can be computed honestly.
//
// SEVERITY: a row's severity is used as stored; when missing, it is
// derived from its own cvss_score (>=9 critical, >=7 high, >=4 medium,
// else low). Rows with neither are "unknown": counted in open totals
// but excluded from severity charts, and surfaced in a note.
// "important" maps to high, "moderate" to medium (Patch vocabulary).
//
// TREND BUCKETING: 7d range → daily buckets; 30d / 90d → weekly
// buckets, each labelled by its start date. Bucketed from
// detected_at for vulnerabilities (there is no created_at on that
// model) and created_at elsewhere.
//
// RISK BY DEPARTMENT / BY OS: open vulnerabilities grouped by the
// linked device's attributes.department / attributes.os. Department
// and OS exist only on demo-seeded device rows; a chart is rendered
// only when at least one open vulnerability links to a device that
// carries the attribute — otherwise the chart is omitted and the
// reason is stated on screen. OS follows the IT Ops convention:
// attributes.os.platform (darwin/windows/linux) when os is an
// object; when os is a string it is shown as-is, EXCEPT a broken
// "macOS <nil>" version string is never displayed (trimmed to "macOS").
//
// PROTECTION COVERAGE — labelled by what it actually measures:
//   "Endpoints reporting in last 24h" (last_checkin_at within 24h /
//   enrolled endpoints), malware quarantine rate, DLP closure rate.
//   There is NO agent-health / EDR-coverage field in the platform, so
//   EDR coverage is NOT claimed; the card says so explicitly.
//
// OVERDUE REMEDIATION: omitted. No security model has a deadline
// field. (Demo seed tucks a due_at into vulnerability attributes,
// but that is seed-only synthetic data, absent on real rows — using
// it would make the queue behave differently on demo vs real data.)
//
// SAMPLE-DATA PILL: shown when any fetched vulnerability, incident,
// malware, DLP, or policy row has is_demo === true. Devices,
// compliance, and alerts cannot contribute (no is_demo in their
// list responses).
//
// DATE RANGE: 7d / 30d / 90d filters the trend chart and the activity
// timeline. KPIs are always the current snapshot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  ActivityTimeline,
  AttentionQueue,
  BarChart,
  ChartContainer,
  DonutChart,
  EmptyState,
  Icon,
  KpiPanel,
  LineChart,
} from '../components'
import type { AttentionItem, AttentionSeverity, TimelineItem } from '../components'
import type { BarDatum, DonutSegment } from '../components'
import type { KpiTrend } from '../components'
import { NULL_COLORS } from '../theme'

export default function SecOpsHome(props: {
  api: string
  headers: Record<string, string>
  onNavigate: (moduleId: string, subsectionId?: string) => void
}): JSX.Element {
  const { onNavigate } = props
  const apiRef = useRef(props.api)
  apiRef.current = props.api
  const headersRef = useRef(props.headers)
  headersRef.current = props.headers

  const [vulns, setVulns] = useState<VulnRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [malware, setMalware] = useState<MalwareRow[]>([])
  const [dlp, setDlp] = useState<DlpRow[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [compliance, setCompliance] = useState<ComplianceRow[]>([])
  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [allFailed, setAllFailed] = useState(false)
  const [failedCount, setFailedCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [range, setRange] = useState<RangeKey>('30d')
  const [customizing, setCustomizing] = useState(false)
  const [sections, setSections] = useState<Record<SectionId, boolean>>(loadSections)

  const load = useCallback(async () => {
    setLoading(true)
    const api = apiRef.current
    const headers = headersRef.current
    const jobs: Array<[string, (rows: unknown[]) => void]> = [
      ['/api/v1/vulnerabilities/', (rows) => setVulns(rows as VulnRow[])],
      ['/api/v1/edr/incidents/', (rows) => setIncidents(rows as IncidentRow[])],
      ['/api/v1/malware/detections/', (rows) => setMalware(rows as MalwareRow[])],
      ['/api/v1/dlp/findings/', (rows) => setDlp(rows as DlpRow[])],
      ['/api/v1/alerts/', (rows) => setAlerts(rows as AlertRow[])],
      ['/api/v1/compliance/', (rows) => setCompliance(rows as ComplianceRow[])],
      ['/api/v1/policies/', (rows) => setPolicies(rows as PolicyRow[])],
      ['/api/v1/devices/', (rows) => setDevices(rows as DeviceRow[])],
    ]
    const results = await Promise.allSettled(
      jobs.map(async ([endpoint, setter]) => {
        const res = await axios.get(`${api}${endpoint}`, { headers })
        setter(Array.isArray(res.data) ? res.data : [])
      }),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    setFailedCount(failed)
    setAllFailed(failed === jobs.length)
    setLastUpdated(Date.now())
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggleSection = (id: SectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable — the toggle still applies for this visit.
      }
      return next
    })
  }

  const resetSections = () => {
    const all = Object.fromEntries(SECTIONS.map((s) => [s.id, true])) as Record<SectionId, boolean>
    setSections(all)
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(all))
    } catch {
      // Ignore storage failures.
    }
  }

  /* ------------------------------------------------------------ derived */
  const days = RANGE_DAYS[range]
  const now = lastUpdated ?? Date.now()
  const rangeStart = now - days * DAY_MS

  const deviceById = useMemo(() => {
    const m = new Map<string, DeviceRow>()
    for (const d of devices) m.set(d.id, d)
    return m
  }, [devices])

  const hostnameOf = useCallback(
    (deviceId: string | null | undefined): string => {
      if (!deviceId) return ''
      const d = deviceById.get(deviceId)
      return d ? d.hostname || d.device_id || '' : ''
    },
    [deviceById],
  )

  const openVulns = useMemo(() => vulns.filter((v) => normStatus(v.status) === 'open'), [vulns])
  const critOpen = useMemo(
    () => openVulns.filter((v) => severityOf(v) === 'critical'),
    [openVulns],
  )
  const highOpen = useMemo(
    () => openVulns.filter((v) => severityOf(v) === 'high'),
    [openVulns],
  )
  const totalCrit = useMemo(() => vulns.filter((v) => severityOf(v) === 'critical').length, [vulns])
  const remediatedVulns = useMemo(
    () => vulns.filter((v) => normStatus(v.status) === 'remediated').length,
    [vulns],
  )
  const unclassifiedOpen = useMemo(
    () => openVulns.filter((v) => severityOf(v) === 'unknown').length,
    [openVulns],
  )

  const severityCounts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const v of openVulns) {
      const s = severityOf(v)
      if (s !== 'unknown') c[s] += 1
    }
    return c
  }, [openVulns])

  const activeIncidents = useMemo(
    () =>
      incidents.filter((i) => {
        const s = normStatus(i.status)
        return s === 'pending' || s === 'in-progress'
      }),
    [incidents],
  )
  const completeIncidents = useMemo(
    () => incidents.filter((i) => normStatus(i.status) === 'complete').length,
    [incidents],
  )
  const failedIncidents = useMemo(
    () => incidents.filter((i) => normStatus(i.status) === 'failed').length,
    [incidents],
  )

  const detectedMalware = useMemo(
    () => malware.filter((m) => normStatus(m.status) === 'detected'),
    [malware],
  )
  const quarantinedMalware = useMemo(
    () =>
      malware.filter((m) => m.quarantined === true || ['quarantined', 'remediated'].includes(normStatus(m.status)))
        .length,
    [malware],
  )
  const critDetectedMalware = useMemo(
    () => detectedMalware.filter((m) => severityOf(m) === 'critical'),
    [detectedMalware],
  )

  const openDlp = useMemo(() => dlp.filter((d) => normStatus(d.status) === 'open'), [dlp])
  const closedDlp = useMemo(
    () => dlp.filter((d) => ['remediated', 'encrypted'].includes(normStatus(d.status))).length,
    [dlp],
  )

  const nonCompliant = useMemo(
    () => compliance.filter((c) => normStatus(c.status) === 'non_compliant'),
    [compliance],
  )
  const benchmarkCount = useMemo(
    () => new Set(compliance.map((c) => (c.benchmark || '').trim()).filter(Boolean)).size,
    [compliance],
  )

  // Distinct devices linked to an open critical/high vulnerability.
  const highRiskDevices = useMemo(() => {
    const m = new Map<string, 'critical' | 'high'>()
    for (const v of openVulns) {
      const s = severityOf(v)
      if ((s === 'critical' || s === 'high') && v.device_id) {
        const prev = m.get(v.device_id)
        if (!prev || (prev === 'high' && s === 'critical')) m.set(v.device_id, s)
      }
    }
    return m
  }, [openVulns])

  const enrolledDevices = useMemo(
    () => devices.filter((d) => normStatus(d.enrollment_status) === 'enrolled'),
    [devices],
  )
  const reporting24h = useMemo(() => {
    const cutoff = now - 24 * 60 * 60 * 1000
    return enrolledDevices.filter((d) => {
      const t = parseDate(d.last_checkin_at)
      return t !== null && t >= cutoff
    }).length
  }, [enrolledDevices, now])

  const deptBars = useMemo<BarDatum[]>(() => {
    const counts = new Map<string, number>()
    for (const v of openVulns) {
      const dept = departmentOf(v.device_id ? deviceById.get(v.device_id) : undefined)
      if (dept) counts.set(dept, (counts.get(dept) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value, color: NULL_COLORS.teal }))
      .sort((a, b) => b.value - a.value)
  }, [openVulns, deviceById])

  const osBars = useMemo<BarDatum[]>(() => {
    const counts = new Map<string, number>()
    for (const v of openVulns) {
      const os = osLabelOf(v.device_id ? deviceById.get(v.device_id) : undefined)
      if (os) counts.set(os, (counts.get(os) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value, color: NULL_COLORS.tealSecondary }))
      .sort((a, b) => b.value - a.value)
  }, [openVulns, deviceById])

  const hasDemo = useMemo(
    () =>
      [...vulns, ...incidents, ...malware, ...dlp, ...policies].some((r) => r.is_demo === true),
    [vulns, incidents, malware, dlp, policies],
  )

  /* ------------------------------------------------------------ posture */
  const posture = useMemo<Posture>(() => {
    if (critOpen.length > 0 || activeIncidents.length > 0 || critDetectedMalware.length > 0) return 'Elevated'
    if (
      highOpen.length > 0 ||
      openDlp.length > 0 ||
      detectedMalware.length > 0 ||
      nonCompliant.length > 0
    )
      return 'Guarded'
    return 'Stable'
  }, [critOpen, activeIncidents, critDetectedMalware, highOpen, openDlp, detectedMalware, nonCompliant])

  const postureReasons = useMemo(() => {
    const parts: string[] = []
    if (critOpen.length > 0)
      parts.push(`${critOpen.length} open critical ${critOpen.length === 1 ? 'vulnerability' : 'vulnerabilities'}`)
    if (activeIncidents.length > 0)
      parts.push(`${activeIncidents.length} active ${activeIncidents.length === 1 ? 'incident' : 'incidents'}`)
    if (critDetectedMalware.length > 0)
      parts.push(`${critDetectedMalware.length} unquarantined critical detection${critDetectedMalware.length === 1 ? '' : 's'}`)
    if (highOpen.length > 0)
      parts.push(`${highOpen.length} open high ${highOpen.length === 1 ? 'vulnerability' : 'vulnerabilities'}`)
    if (openDlp.length > 0) parts.push(`${openDlp.length} open DLP ${openDlp.length === 1 ? 'finding' : 'findings'}`)
    if (detectedMalware.length > 0)
      parts.push(`${detectedMalware.length} unquarantined malware ${detectedMalware.length === 1 ? 'detection' : 'detections'}`)
    if (nonCompliant.length > 0)
      parts.push(`${nonCompliant.length} non-compliant ${nonCompliant.length === 1 ? 'assessment' : 'assessments'}`)
    return parts
  }, [critOpen, activeIncidents, critDetectedMalware, highOpen, openDlp, detectedMalware, nonCompliant])

  const postureColor =
    posture === 'Elevated' ? NULL_COLORS.critical : posture === 'Guarded' ? NULL_COLORS.warning : NULL_COLORS.success

  /* ------------------------------------------------------------ trends */
  const trend = useMemo(() => bucketTrend(vulns, days, now), [vulns, days, now])
  const vulnTrend = useMemo<KpiTrend | undefined>(() => {
    const inRange = vulns.filter((v) => {
      const t = timeOf(v)
      return t !== null && t >= rangeStart && t <= now
    }).length
    const priorStart = rangeStart - days * DAY_MS
    const inPrior = vulns.filter((v) => {
      const t = timeOf(v)
      return t !== null && t >= priorStart && t < rangeStart
    }).length
    const direction: 'up' | 'down' | 'flat' = inRange > inPrior ? 'up' : inRange < inPrior ? 'down' : 'flat'
    return { direction, value: `${inRange} new in last ${days}d`, good: direction !== 'up' }
  }, [vulns, rangeStart, days, now])
  const critTrend = useMemo<KpiTrend | undefined>(() => {
    const inRange = vulns.filter((v) => {
      const t = timeOf(v)
      return severityOf(v) === 'critical' && t !== null && t >= rangeStart && t <= now
    }).length
    const priorStart = rangeStart - days * DAY_MS
    const inPrior = vulns.filter((v) => {
      const t = timeOf(v)
      return severityOf(v) === 'critical' && t !== null && t >= priorStart && t < rangeStart
    }).length
    const direction: 'up' | 'down' | 'flat' = inRange > inPrior ? 'up' : inRange < inPrior ? 'down' : 'flat'
    return { direction, value: `${inRange} new critical in last ${days}d`, good: direction !== 'up' }
  }, [vulns, rangeStart, days, now])

  /* ------------------------------------------------------------ attention */
  const attentionItems = useMemo<AttentionItem[]>(() => {
    type Scored = { item: AttentionItem; rank: number; t: number }
    const scored: Scored[] = []
    const push = (item: AttentionItem, rank: number, t: number | null) =>
      scored.push({ item, rank, t: t ?? 0 })
    for (const v of openVulns) {
      const sev = severityOf(v)
      push(
        {
          id: `vuln-${v.id}`,
          severity: sev === 'unknown' ? 'medium' : sev,
          title: v.title || v.cve_id || 'Untitled vulnerability',
          asset: [v.cve_id, hostnameOf(v.device_id)].filter(Boolean).join(' · ') || undefined,
          status: `Open · CVSS ${cvssOf(v) ?? '—'}`,
          time: timeOf(v) ? fmtDay(timeOf(v) as number) : undefined,
          actionLabel: 'Review',
          onAction: () => onNavigate('vulnerabilities', 'vulns'),
        },
        sev === 'critical' ? 0 : sev === 'high' ? 1 : sev === 'medium' ? 2 : 3,
        timeOf(v),
      )
    }
    for (const i of activeIncidents) {
      push(
        {
          id: `incident-${i.id}`,
          severity: 'high',
          title: i.title || 'Untitled incident',
          asset: hostnameOf(i.device_id) || undefined,
          status: `${i.action || 'Response'} · ${i.status || 'active'}`,
          time: timeOf(i) ? fmtDay(timeOf(i) as number) : undefined,
          actionLabel: 'Respond',
          onAction: () => onNavigate('edr', 'incidents'),
        },
        1,
        timeOf(i),
      )
    }
    for (const m of detectedMalware) {
      const sev = severityOf(m)
      push(
        {
          id: `malware-${m.id}`,
          severity: sev === 'unknown' ? 'medium' : sev,
          title: m.name ? `${m.name} detected` : m.title || 'Malware detection',
          asset: hostnameOf(m.device_id) || undefined,
          status: `${m.detection_layer || 'Detection'} · ${m.status || 'detected'}`,
          time: timeOf(m) ? fmtDay(timeOf(m) as number) : undefined,
          actionLabel: 'Quarantine',
          onAction: () => onNavigate('malware'),
        },
        sev === 'critical' ? 0 : sev === 'high' ? 1 : sev === 'medium' ? 2 : 3,
        timeOf(m),
      )
    }
    for (const d of openDlp) {
      const cls = (d.classification || '').toLowerCase()
      const sev: AttentionSeverity = cls === 'restricted' ? 'high' : cls === 'internal' ? 'low' : 'medium'
      push(
        {
          id: `dlp-${d.id}`,
          severity: sev,
          title: d.title || 'Sensitive data finding',
          asset: hostnameOf(d.device_id) || d.location || undefined,
          status: `${d.data_type || 'Data'} · ${d.classification || 'Unclassified'}`,
          time: timeOf(d) ? fmtDay(timeOf(d) as number) : undefined,
          actionLabel: 'Review',
          onAction: () => onNavigate('dlp', 'findings'),
        },
        sev === 'high' ? 1 : sev === 'medium' ? 2 : 3,
        timeOf(d),
      )
    }
    for (const c of nonCompliant) {
      push(
        {
          id: `compliance-${c.id}`,
          severity: 'medium',
          title: `${c.benchmark || 'Benchmark'} — ${hostnameOf(c.device_id) || 'endpoint'}`,
          asset: undefined,
          status: `Non-compliant · score ${c.score ?? '—'}`,
          time: timeOf(c) ? fmtDay(timeOf(c) as number) : undefined,
          actionLabel: 'View',
          onAction: () => onNavigate('compliance'),
        },
        2,
        timeOf(c),
      )
    }
    return scored
      .sort((a, b) => a.rank - b.rank || b.t - a.t)
      .slice(0, 12)
      .map((s) => s.item)
  }, [openVulns, activeIncidents, detectedMalware, openDlp, nonCompliant, hostnameOf, onNavigate])

  /* ------------------------------------------------------------ timeline */
  const timelineItems = useMemo<TimelineItem[]>(() => {
    type Ev = { item: TimelineItem; t: number }
    const events: Ev[] = []
    for (const v of vulns) {
      const t = timeOf(v)
      if (t === null || t < rangeStart || t > now) continue
      const sev = severityOf(v)
      events.push({
        t,
        item: {
          id: `vuln-${v.id}`,
          time: fmtDate(t),
          title: v.cve_id ? `${v.cve_id} — ${v.title || 'Vulnerability'}` : v.title || 'Vulnerability discovered',
          detail: `Vulnerability · ${sev} · CVSS ${cvssOf(v) ?? '—'}${hostnameOf(v.device_id) ? ` · ${hostnameOf(v.device_id)}` : ''}`,
          tone: sev === 'critical' ? 'critical' : sev === 'high' ? 'warning' : sev === 'medium' ? 'info' : 'neutral',
        },
      })
    }
    for (const i of incidents) {
      const t = timeOf(i)
      if (t === null || t < rangeStart || t > now) continue
      const s = normStatus(i.status)
      events.push({
        t,
        item: {
          id: `incident-${i.id}`,
          time: fmtDate(t),
          title: i.title || 'Incident response',
          detail: `Incident · ${i.action || 'response'} · ${i.status || ''}${hostnameOf(i.device_id) ? ` · ${hostnameOf(i.device_id)}` : ''}`,
          tone: s === 'failed' ? 'critical' : s === 'complete' ? 'success' : 'warning',
          actor: i.performed_by || undefined,
        },
      })
    }
    for (const m of malware) {
      const t = timeOf(m)
      if (t === null || t < rangeStart || t > now) continue
      const sev = severityOf(m)
      const s = normStatus(m.status)
      events.push({
        t,
        item: {
          id: `malware-${m.id}`,
          time: fmtDate(t),
          title: m.name ? `${m.name} detected` : m.title || 'Malware detection',
          detail: `Malware · ${sev} · ${m.detection_layer || 'detection'} · ${m.status || ''}${hostnameOf(m.device_id) ? ` · ${hostnameOf(m.device_id)}` : ''}`,
          tone:
            s === 'remediated' || s === 'quarantined'
              ? 'success'
              : s === 'false-positive'
                ? 'neutral'
                : sev === 'critical'
                  ? 'critical'
                  : 'warning',
        },
      })
    }
    for (const d of dlp) {
      const t = timeOf(d)
      if (t === null || t < rangeStart || t > now) continue
      const s = normStatus(d.status)
      events.push({
        t,
        item: {
          id: `dlp-${d.id}`,
          time: fmtDate(t),
          title: d.title || 'Sensitive data finding',
          detail: `DLP · ${d.data_type || 'data'} · ${d.classification || 'unclassified'} · ${d.status || ''}${hostnameOf(d.device_id) ? ` · ${hostnameOf(d.device_id)}` : ''}`,
          tone: s === 'remediated' || s === 'encrypted' ? 'success' : s === 'accepted' ? 'neutral' : 'warning',
        },
      })
    }
    return events
      .sort((a, b) => b.t - a.t)
      .slice(0, 15)
      .map((e) => e.item)
  }, [vulns, incidents, malware, dlp, rangeStart, now, hostnameOf])

  /* ------------------------------------------------------------ charts */
  const donutSegments = useMemo<DonutSegment[]>(
    () => [
      { label: 'Critical', value: severityCounts.critical, color: NULL_COLORS.critical },
      { label: 'High', value: severityCounts.high, color: NULL_COLORS.warning },
      { label: 'Medium', value: severityCounts.medium, color: NULL_COLORS.info },
      { label: 'Low', value: severityCounts.low, color: NULL_COLORS.muted },
    ],
    [severityCounts],
  )

  const incidentBars = useMemo<BarDatum[]>(
    () => [
      { label: 'Open', value: activeIncidents.length, color: NULL_COLORS.warning },
      { label: 'Resolved', value: completeIncidents, color: NULL_COLORS.success },
      { label: 'Failed', value: failedIncidents, color: NULL_COLORS.critical },
    ],
    [activeIncidents, completeIncidents, failedIncidents],
  )

  const alertDonut = useMemo<DonutSegment[]>(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const a of alerts) {
      const s = severityOf(a)
      if (s !== 'unknown') c[s] += 1
    }
    return [
      { label: 'Critical', value: c.critical, color: NULL_COLORS.critical },
      { label: 'High', value: c.high, color: NULL_COLORS.warning },
      { label: 'Medium', value: c.medium, color: NULL_COLORS.info },
      { label: 'Low', value: c.low, color: NULL_COLORS.muted },
    ]
  }, [alerts])

  /* ------------------------------------------------------------ report */
  const downloadReport = () => {
    const rows: Array<[string, string | number]> = [
      ['NULL Security Operations report', ''],
      ['Generated', new Date().toISOString()],
      ['Date range', `Last ${days} days`],
      ['Risk posture', posture],
      [
        'Posture rule',
        'Elevated = any open critical vulnerability, active incident, or unquarantined critical detection. Guarded = any open high vulnerability, open DLP finding, unquarantined detection, or non-compliant assessment. Stable = none of the above.',
      ],
      ['', ''],
      ['Metric', 'Value'],
      ['Open vulnerabilities', openVulns.length],
      ['Critical vulnerabilities (open)', critOpen.length],
      ['Critical vulnerabilities (total)', totalCrit],
      ['High vulnerabilities (open)', highOpen.length],
      ['Remediated vulnerabilities', remediatedVulns],
      ['Open vulnerabilities without a recorded severity', unclassifiedOpen],
      ['Active incidents (pending / in-progress)', activeIncidents.length],
      ['Incidents complete', completeIncidents],
      ['Incidents failed', failedIncidents],
      ['Malware detections (status detected)', detectedMalware.length],
      ['Malware detections (total)', malware.length],
      ['Malware quarantined', quarantinedMalware],
      ['DLP findings (open)', openDlp.length],
      ['DLP findings (total)', dlp.length],
      ['DLP findings closed (remediated / encrypted)', closedDlp],
      ['Policy violations (non-compliant assessments)', nonCompliant.length],
      ['Compliance assessments (total)', compliance.length],
      ['High-risk endpoints (open critical/high vulns)', highRiskDevices.size],
      ['Endpoints enrolled', enrolledDevices.length],
      ['Endpoints reporting in last 24h', reporting24h],
      ['Mean time to remediate', 'Not computable — no resolution timestamps on vulnerability or incident records'],
      ['', ''],
      ['Open vulnerabilities by severity', ''],
      ['Critical', severityCounts.critical],
      ['High', severityCounts.high],
      ['Medium', severityCounts.medium],
      ['Low', severityCounts.low],
      ['', ''],
      ['Open vulnerabilities by department', ''],
      ...deptBars.map((b): [string, string | number] => [b.label, b.value]),
      ['', ''],
      ['Open vulnerabilities by OS', ''],
      ...osBars.map((b): [string, string | number] => [b.label, b.value]),
      ['', ''],
      ['New vulnerabilities in selected range', trend.series.reduce((a, b) => a + b, 0)],
    ]
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `null-secops-report-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  /* ------------------------------------------------------------ render */
  if (loading && lastUpdated === null) {
    return (
      <div className="null-card">
        <p className="text-sm text-null-muted dark:text-[#8AA0B8]">Loading security data…</p>
      </div>
    )
  }

  if (allFailed) {
    return (
      <div>
        <EmptyState
          icon="alert-triangle"
          title="Security data unavailable"
          description="None of the security endpoints answered. Check the backend connection and try again."
          action={
            <button
              type="button"
              onClick={() => void load()}
              className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark"
            >
              Retry
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="shield" size={22} className="text-null-teal" label="Security Operations" />
            <h2 className="text-lg font-semibold text-null-ink dark:text-white">Security Operations</h2>
            {hasDemo && (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ color: NULL_COLORS.info, background: '#EAF1F7' }}
                title="Sample data — one or more records in this view are demonstration records, not live data."
              >
                Sample data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-null-muted dark:text-[#8AA0B8]">
            Demo Organization · SOC command center — exposure, incidents, and data risk.
          </p>
          <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
            Last updated {lastUpdated ? fmtDate(lastUpdated) : '—'} · KPIs are current state; charts and activity
            follow the selected range.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex overflow-hidden rounded border border-null-line dark:border-white/10"
            role="group"
            aria-label="Date range"
          >
            {(['7d', '30d', '90d'] as RangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`px-3 py-1.5 text-xs font-medium ${
                  range === r ? 'bg-null-teal text-white' : 'bg-white text-null-muted hover:bg-null-cloud dark:bg-transparent dark:text-[#8AA0B8]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-null-line bg-white px-3 py-1.5 text-xs font-medium text-null-ink hover:bg-null-cloud disabled:opacity-50 dark:border-white/10 dark:bg-transparent dark:text-white"
          >
            <Icon name="clock" size={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => setCustomizing((c) => !c)}
            aria-expanded={customizing}
            className="flex items-center gap-1.5 rounded border border-null-line bg-white px-3 py-1.5 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-white"
          >
            <Icon name="settings" size={14} />
            Customize
          </button>
          <button
            type="button"
            onClick={downloadReport}
            className="flex items-center gap-1.5 rounded bg-null-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-null-tealDark"
          >
            <Icon name="download" size={14} />
            Create report
          </button>
        </div>
      </div>

      {failedCount > 0 && (
        <p className="text-xs text-null-warning">
          {failedCount} of 8 security endpoints did not answer — the affected sections show what could be loaded.
        </p>
      )}

      {/* Customize panel */}
      {customizing && (
        <div className="null-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-null-ink dark:text-white">Choose sections</h3>
            <button
              type="button"
              onClick={resetSections}
              className="text-xs font-medium text-null-teal hover:underline"
            >
              Show all
            </button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTIONS.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-null-ink dark:text-white"
              >
                <input type="checkbox" checked={sections[s.id]} onChange={() => toggleSection(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
            Saved in this browser (localStorage key “null_secops_sections”).
          </p>
        </div>
      )}

      {/* Risk-posture strip */}
      <section
        className="rounded-lg border border-white/10 bg-null-obsidian px-5 py-4 text-white"
        aria-label={`Current risk posture: ${posture}`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: postureColor }}
              aria-hidden
            />
            <div>
              <span className="block text-[11px] font-medium uppercase tracking-wide text-white/60">
                Current risk posture
              </span>
              <span className="block text-2xl font-bold leading-tight" style={{ color: postureColor }}>
                {posture}
              </span>
            </div>
          </div>
          <p className="min-w-0 flex-1 text-sm text-white/85">
            {postureReasons.length > 0
              ? postureReasons.join(' · ')
              : 'No open critical or high vulnerabilities, no active incidents, no unquarantined detections, no open DLP findings, and no non-compliant assessments.'}
          </p>
          <p className="max-w-md text-[11px] leading-relaxed text-white/55">
            Rule — Elevated: any open critical vulnerability, active incident, or unquarantined critical detection.
            Guarded: any open high vulnerability, open DLP finding, unquarantined detection, or non-compliant
            assessment. Stable: none of the above.
          </p>
        </div>
      </section>

      {/* KPI strip — severity first */}
      {sections.kpis && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiPanel
            label="Critical vulnerabilities"
            value={critOpen.length}
            sublabel={`${totalCrit} critical total`}
            trend={critTrend}
            accent={critOpen.length > 0 ? 'critical' : 'success'}
            onClick={() => onNavigate('vulnerabilities', 'vulns')}
          />
          <KpiPanel
            label="Open vulnerabilities"
            value={openVulns.length}
            sublabel={`${vulns.length} total · ${remediatedVulns} remediated`}
            trend={vulnTrend}
            accent={openVulns.length > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('vulnerabilities', 'vulns')}
          />
          <KpiPanel
            label="Active incidents"
            value={activeIncidents.length}
            sublabel={`${completeIncidents} complete · ${failedIncidents} failed`}
            accent={activeIncidents.length > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('edr', 'incidents')}
          />
          <KpiPanel
            label="Malware detections"
            value={detectedMalware.length}
            sublabel={`${malware.length} total · ${quarantinedMalware} quarantined`}
            accent={detectedMalware.length > 0 ? 'critical' : 'success'}
            onClick={() => onNavigate('malware')}
          />
          <KpiPanel
            label="DLP findings"
            value={openDlp.length}
            sublabel={`${dlp.length} total · ${closedDlp} closed`}
            accent={openDlp.length > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('dlp', 'findings')}
          />
          <KpiPanel
            label="Policy violations"
            value={nonCompliant.length}
            sublabel={`${compliance.length} assessments · ${benchmarkCount} benchmarks`}
            accent={nonCompliant.length > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('compliance')}
          />
          <KpiPanel
            label="High-risk endpoints"
            value={highRiskDevices.size}
            sublabel={`of ${devices.length} endpoints · open critical/high vulns`}
            accent={highRiskDevices.size > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('devices')}
          />
          <KpiPanel
            label="Mean time to remediate"
            value="—"
            sublabel="no resolution timestamps"
            accent="neutral"
          />
        </div>
      )}

      {/* Severity-forward body: exposure + incidents left, risk + coverage right */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {sections.exposure && (
            <>
              <ChartContainer
                title="Vulnerability exposure"
                subtitle="Open vulnerabilities by severity — semantic color only on the severity indicators"
              >
                {openVulns.length === 0 ? (
                  <EmptyState
                    icon="shield"
                    title="No open vulnerabilities"
                    description="Nothing is currently exposed. New findings will appear here by severity as they are detected."
                  />
                ) : (
                  <>
                    <DonutChart segments={donutSegments} centerLabel={String(openVulns.length)} />
                    {unclassifiedOpen > 0 && (
                      <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
                        {unclassifiedOpen} open {unclassifiedOpen === 1 ? 'vulnerability has' : 'vulnerabilities have'}{' '}
                        no recorded severity or CVSS score, so {unclassifiedOpen === 1 ? 'it is' : 'they are'} counted
                        above but not in the severity breakdown.
                      </p>
                    )}
                  </>
                )}
              </ChartContainer>
              <ChartContainer
                title={`New vulnerabilities — last ${days} days`}
                subtitle={
                  days <= 7
                    ? 'New detections per day, from detected_at'
                    : 'New detections per week, from detected_at'
                }
              >
                {trend.series.length < 2 || trend.series.every((v) => v === 0) ? (
                  <EmptyState
                    icon="search"
                    title="No new vulnerabilities in this range"
                    description={`No vulnerabilities were detected in the last ${days} days. Widen the range or check back after the next scan.`}
                  />
                ) : (
                  <div className="h-44">
                    <LineChart series={trend.series} labels={trend.labels} color={NULL_COLORS.teal} />
                  </div>
                )}
              </ChartContainer>
            </>
          )}

          {sections.incidents && (
            <ChartContainer
              title="Incident response"
              subtitle="Containment actions by outcome — pending / in-progress counts as open"
            >
              {incidents.length === 0 ? (
                <EmptyState
                  icon="alert-triangle"
                  title="No incidents recorded"
                  description="No incident-response actions exist yet. Containment work will appear here by outcome."
                />
              ) : (
                <>
                  <div className="h-40">
                    <BarChart bars={incidentBars} />
                  </div>
                  <div className="mt-4 border-t border-null-line pt-4 dark:border-white/10">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                      Alert severity (all categories)
                    </h4>
                    {alerts.length === 0 ? (
                      <EmptyState
                        icon="search"
                        title="No alerts recorded"
                        description="The alert record — the detection behind an incident — is empty, so there is no severity breakdown to show."
                      />
                    ) : (
                      <DonutChart segments={alertDonut} centerLabel={String(alerts.length)} size={140} />
                    )}
                    <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                      Incidents don&apos;t carry a severity of their own — this breakdown comes from their
                      related alerts.
                    </p>
                  </div>
                </>
              )}
            </ChartContainer>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          {sections.risk && (
            <ChartContainer
              title="Risk distribution"
              subtitle="Open vulnerabilities grouped by the linked endpoint's department and OS"
            >
              {deptBars.length === 0 && osBars.length === 0 ? (
                <EmptyState
                  icon="search"
                  title="No department or OS data on devices"
                  description="No department or operating-system data on these endpoints, so risk can't be broken down this way."
                />
              ) : (
                <div className="space-y-5">
                  {deptBars.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                        By department
                      </h4>
                      <BarChart bars={deptBars} orientation="horizontal" />
                    </div>
                  ) : (
                    <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
                      No department data on devices — department breakdown omitted.
                    </p>
                  )}
                  {osBars.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                        By OS
                      </h4>
                      <BarChart bars={osBars} orientation="horizontal" />
                    </div>
                  ) : (
                    <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
                      No operating-system data on these endpoints — the OS breakdown is omitted. OS versions
                      aren&apos;t shown.
                    </p>
                  )}
                </div>
              )}
            </ChartContainer>
          )}

          {sections.coverage && (
            <div className="null-card" aria-label="Protection coverage">
              <h3 className="text-sm font-semibold text-null-ink dark:text-white">Protection coverage</h3>
              <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
                What the platform can actually measure — check-in and outcome rates, not agent coverage.
              </p>
              {devices.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    icon="server"
                    title="No endpoints enrolled"
                    description="Coverage is measured against enrolled endpoints. Enroll a device to see reporting rates here."
                  />
                </div>
              ) : (
                <ul className="mt-4 space-y-4 text-sm">
                  <li>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-null-ink dark:text-white">
                        Endpoints reporting in last 24h
                      </span>
                      <span className="font-semibold text-null-ink dark:text-white">
                        {reporting24h} of {enrolledDevices.length} enrolled
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                      <div
                        className="h-full rounded bg-null-teal"
                        style={{
                          width: `${enrolledDevices.length > 0 ? Math.round((reporting24h / enrolledDevices.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                  <li>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-null-ink dark:text-white">Malware quarantined</span>
                      <span className="font-semibold text-null-ink dark:text-white">
                        {quarantinedMalware} of {malware.length}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                      <div
                        className="h-full rounded bg-null-teal"
                        style={{
                          width: `${malware.length > 0 ? Math.round((quarantinedMalware / malware.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                  <li>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-null-ink dark:text-white">DLP findings closed</span>
                      <span className="font-semibold text-null-ink dark:text-white">
                        {closedDlp} of {dlp.length}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                      <div
                        className="h-full rounded bg-null-teal"
                        style={{
                          width: `${dlp.length > 0 ? Math.round((closedDlp / dlp.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                </ul>
              )}
              <p className="mt-4 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                These measure check-in recency and closure outcomes. They don&apos;t show whether every endpoint
                is protected — protection coverage isn&apos;t tracked here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Attention queue + activity timeline */}
      <div className="grid gap-6 lg:grid-cols-12">
        {sections.attention && (
          <div className="null-card lg:col-span-7" aria-label="Needs attention">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-null-ink dark:text-white">Needs attention</h3>
              <span className="text-xs text-null-muted dark:text-[#8AA0B8]">
                {attentionItems.length > 0 ? `${attentionItems.length} most severe first` : ''}
              </span>
            </div>
            {attentionItems.length === 0 ? (
              <EmptyState
                icon="check-circle"
                title="Nothing needs attention"
                description="No open critical or high vulnerabilities, active incidents, unquarantined detections, open DLP findings, or non-compliant assessments."
              />
            ) : (
              <AttentionQueue items={attentionItems} />
            )}
          </div>
        )}
        {sections.activity && (
          <div className="null-card lg:col-span-5" aria-label="Security activity">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-null-ink dark:text-white">Security activity</h3>
              <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
                Latest 15 · last {days} days · newest first
              </p>
            </div>
            {timelineItems.length === 0 ? (
              <EmptyState
                icon="clock"
                title="No security activity in this range"
                description={`Nothing was detected, contained, or found in the last ${days} days. Widen the range to see older activity.`}
              />
            ) : (
              <ActivityTimeline items={timelineItems} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ types */

type RangeKey = '7d' | '30d' | '90d'
const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '30d': 30, '90d': 90 }
const DAY_MS = 24 * 60 * 60 * 1000

type VulnRow = {
  id: string
  cve_id?: string | null
  title?: string | null
  severity?: string | null
  cvss_score?: string | number | null
  status?: string | null
  device_id?: string | null
  is_demo?: boolean
  attributes?: Record<string, unknown> | null
  detected_at?: string | null
  created_at?: string | null
}

type IncidentRow = {
  id: string
  device_id?: string | null
  title?: string | null
  action?: string | null
  status?: string | null
  performed_by?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type MalwareRow = {
  id: string
  device_id?: string | null
  title?: string | null
  name?: string | null
  detection_layer?: string | null
  severity?: string | null
  quarantined?: boolean | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type DlpRow = {
  id: string
  device_id?: string | null
  title?: string | null
  location?: string | null
  data_type?: string | null
  classification?: string | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type AlertRow = {
  id: string
  device_id?: string | null
  title?: string | null
  severity?: string | null
  category?: string | null
  status?: string | null
  created_at?: string | null
}

type ComplianceRow = {
  id: string
  device_id?: string | null
  benchmark?: string | null
  score?: string | null
  status?: string | null
  assessed_at?: string | null
}

type PolicyRow = {
  id: string
  name?: string | null
  policy_type?: string | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type DeviceRow = {
  id: string
  hostname?: string | null
  device_id?: string | null
  enrollment_status?: string | null
  agent_version?: string | null
  last_checkin_at?: string | null
  attributes?: Record<string, unknown> | null
}

type Posture = 'Elevated' | 'Guarded' | 'Stable'

const SECTIONS = [
  { id: 'kpis', label: 'KPI strip' },
  { id: 'exposure', label: 'Vulnerability exposure' },
  { id: 'risk', label: 'Risk distribution' },
  { id: 'coverage', label: 'Protection coverage' },
  { id: 'incidents', label: 'Incident response' },
  { id: 'attention', label: 'Attention queue' },
  { id: 'activity', label: 'Security activity' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']
const SECTION_STORAGE_KEY = 'null_secops_sections'

function loadSections(): Record<SectionId, boolean> {
  const all = Object.fromEntries(SECTIONS.map((s) => [s.id, true])) as Record<SectionId, boolean>
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY)
    if (!raw) return all
    const parsed = JSON.parse(raw) as Partial<Record<SectionId, boolean>>
    for (const s of SECTIONS) {
      const v = parsed[s.id]
      if (typeof v === 'boolean') all[s.id] = v
    }
  } catch {
    // Corrupt stored prefs — fall back to all sections visible.
  }
  return all
}

/* ------------------------------------------------------------------ helpers */

function normStatus(status: string | null | undefined): string {
  return (status || '').trim().toLowerCase()
}

function cvssOf(row: { cvss_score?: string | number | null }): number | null {
  const raw = row.cvss_score
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

function severityOf(row: { severity?: string | null; cvss_score?: string | number | null }): Severity {
  const s = (row.severity || '').trim().toLowerCase()
  if (s === 'critical' || s === 'p1') return 'critical'
  if (s === 'high' || s === 'important' || s === 'p2') return 'high'
  if (s === 'medium' || s === 'moderate' || s === 'p3') return 'medium'
  if (s === 'low' || s === 'p4') return 'low'
  const cvss = cvssOf(row)
  if (cvss !== null) {
    if (cvss >= 9) return 'critical'
    if (cvss >= 7) return 'high'
    if (cvss >= 4) return 'medium'
    return 'low'
  }
  return 'unknown'
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null
  // Backend datetimes are naive UTC (no zone designator). Treat them
  // as UTC so toLocaleString() renders them in the viewer's local
  // timezone instead of misreading them as already-local.
  const v = value.includes('T') && !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? `${value}Z` : value
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function timeOf(row: {
  detected_at?: string | null
  created_at?: string | null
  assessed_at?: string | null
}): number | null {
  return parseDate(row.detected_at) ?? parseDate(row.created_at) ?? parseDate(row.assessed_at)
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtDay(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function departmentOf(device: DeviceRow | undefined): string | null {
  if (!device || !device.attributes) return null
  const dept = device.attributes.department
  return typeof dept === 'string' && dept.trim() !== '' ? dept.trim() : null
}

/** OS label for a device. Follows the IT Ops convention: an object
 *  attributes.os reads .platform (darwin/windows/linux); a string
 *  attributes.os is shown as-is — except a broken "macOS <nil>"
 *  version string is never displayed (trimmed to "macOS"). */
function osLabelOf(device: DeviceRow | undefined): string | null {
  if (!device || !device.attributes) return null
  const os = device.attributes.os
  if (os && typeof os === 'object') {
    const platform = (os as Record<string, unknown>).platform
    if (typeof platform !== 'string' || platform.trim() === '') return null
    switch (platform.toLowerCase()) {
      case 'darwin':
        return 'macOS'
      case 'windows':
        return 'Windows'
      case 'linux':
        return 'Linux'
      default:
        return platform
    }
  }
  if (typeof os === 'string' && os.trim() !== '') {
    const cleaned = os.replace(/\s*<nil>.*$/, '').trim()
    return cleaned === '' ? null : cleaned
  }
  return null
}

function bucketTrend(rows: VulnRow[], days: number, now: number): { series: number[]; labels: string[] } {
  const start = now - days * DAY_MS
  if (days <= 7) {
    const series = Array.from({ length: days }, () => 0)
    const labels: string[] = []
    for (let i = 0; i < days; i++) labels.push(fmtDay(start + i * DAY_MS))
    for (const r of rows) {
      const t = timeOf(r)
      if (t === null || t < start || t > now) continue
      const idx = Math.floor((t - start) / DAY_MS)
      if (idx >= 0 && idx < days) series[idx] += 1
    }
    return { series, labels }
  }
  const buckets = Math.ceil(days / 7)
  const series = Array.from({ length: buckets }, () => 0)
  const labels: string[] = []
  for (let i = 0; i < buckets; i++) labels.push(fmtDay(start + i * 7 * DAY_MS))
  for (const r of rows) {
    const t = timeOf(r)
    if (t === null || t < start || t > now) continue
    const idx = Math.min(Math.floor((t - start) / (7 * DAY_MS)), buckets - 1)
    series[idx] += 1
  }
  return { series, labels }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
