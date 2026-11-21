// NULL — Security Operations home dashboard (SOC command center).
//
// Deliberately NOT the IT Ops home with different numbers: this screen
// leads with a risk-posture strip, then a severity-forward layout —
// exposure summary, investigation queue, vulnerability
// prioritization, incident response, attack surface, remediation
// tracking, activity feed.
//
// Every number is computed client-side from live API lists. Nothing
// is fabricated: a series with no underlying rows renders an
// EmptyState, not zeros dressed up as a chart. Clicking a number,
// chart segment, queue row, vuln row, or timeline entry opens the
// drill-down drawer on the underlying records — there are no dead
// clicks. Device drill-downs open the shared EndpointDetailDrawer
// (components/EndpointDetailDrawer.tsx); every other record type
// opens the generic DetailDrawer with the secops/DrawerViews
// content.
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
//                    quarantined/remediated/false-positive, mitre_ttp,
//                    detection_layer, is_demo, created_at)
//   dlp              /api/v1/dlp/findings/      (SensitiveDataFinding:
//                    data_type, classification, status open/encrypted/
//                    remediated/accepted, is_demo, created_at)
//   alerts           /api/v1/alerts/            (SecurityAlert: severity,
//                    category, status new/investigating/contained/
//                    resolved, created_at — NO is_demo column; the
//                    demo seed creates NO alert rows)
//   compliance       /api/v1/compliance/        (ComplianceResult: benchmark,
//                    score, status compliant/non_compliant, findings,
//                    assessed_at — NO is_demo, NO created_at; the demo
//                    seed creates NO compliance rows)
//   policies         /api/v1/policies/          (Policy: name, policy_type,
//                    status, definition, is_demo, created_at — a policy
//                    DEFINITION; there is no violation record type)
//   devices          /api/v1/devices/           (DeviceOut: hostname,
//                    device_id, enrollment_status, agent_version,
//                    last_checkin_at, attributes, is_demo, created_at.
//                    DeviceOut DOES serialize is_demo — an older
//                    comment claimed otherwise; the router is the
//                    source of truth, so devices feed the sample pill
//                    and the Live/Sample split. attributes.department /
//                    attributes.os exist only on demo-seeded rows —
//                    real agent devices do not carry them.)
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
// SUMMARY BAND (four combined panels, not eight identical cards):
//   Exposure — open vulns with severity stack + new-detection
//     sparkline + range trend. Incident response — active incidents
//     with outcome stack. Detections & data risk — unquarantined
//     malware + quarantine rate, open DLP + closure rate. Fleet &
//     remediation — high-risk endpoints, 24h reporting, remediation
//     progress, MTTR "—".
//
// KPIs (all current state, NOT range-scoped; the range selector drives
// the trend chart, the timeline, and the "new in range" trends):
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
// OVERDUE REMEDIATION: omitted as a computed value. No security model
// has a deadline field. (Demo seed tucks a due_at into vulnerability
// attributes, but that is seed-only synthetic data, absent on real
// rows — using it would make the queue behave differently on demo vs
// real data.) Remediation tracking shows status pipelines and age
// buckets instead, and states plainly what cannot be tracked.
//
// SAMPLE-DATA PILL: shown when any fetched vulnerability, incident,
// malware, DLP, policy, or device row has is_demo === true.
// Devices, compliance, and alerts cannot contribute (no is_demo in
// their list responses) — devices DO carry is_demo in DeviceOut,
// so they contribute; compliance and alerts have no is_demo column.
//
// DATE RANGE: 7d / 30d / 90d filters the trend chart and the activity
// timeline. KPIs are always the current snapshot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  BarChart,
  ChartContainer,
  DetailDrawer,
  DonutChart,
  EmptyState,
  Icon,
  LineChart,
  StatusBadge,
} from '../components'
import type { BarDatum, DonutSegment, KpiTrend } from '../components'
import { EndpointDetailDrawer } from '../components/EndpointDetailDrawer'
import type { EndpointDeviceRecord } from '../components/EndpointDetailDrawer'
import { NULL_COLORS } from '../theme'
import { ActivityFeed } from './secops/ActivityFeed'
import type { ActivityFeedItem } from './secops/ActivityFeed'
import { AttackSurface } from './secops/AttackSurface'
import { DrawerContent, drawerTitle } from './secops/DrawerViews'
import type { DrawerView } from './secops/DrawerViews'
import { IncidentTimeline } from './secops/IncidentTimeline'
import { InvestigationQueue } from './secops/InvestigationQueue'
import { PrioritizedVulns } from './secops/PrioritizedVulns'
import { RemediationTracking } from './secops/RemediationTracking'
import { SummaryPanels } from './secops/SummaryPanels'
import {
  DAY_MS,
  RANGE_DAYS,
  ageDays,
  cvssOf,
  departmentOf,
  fmtDate,
  fmtDay,
  isSampleDevice,
  normStatus,
  osLabelOf,
  parseDate,
  severityOf,
  timeOf,
} from './secops/types'
import type {
  AlertRow,
  ComplianceRow,
  DeviceRow,
  DlpRow,
  IncidentRow,
  MalwareRow,
  PolicyRow,
  RangeKey,
  Severity,
  VulnRow,
} from './secops/types'

export default function SecOpsHome(props: {
  api: string
  headers: Record<string, string>
  userRole?: string
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
  // Drill-down drawer stack (generic DetailDrawer) + the device
  // drill-down (shared EndpointDetailDrawer). Device clicks never
  // open the generic drawer — see openDevice below.
  const [drawerStack, setDrawerStack] = useState<DrawerView[]>([])
  const [endpointDevice, setEndpointDevice] = useState<DeviceRow | null>(null)

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

  /* ------------------------------------------------------------ drawers */
  const openDrawer = useCallback((view: DrawerView) => setDrawerStack([view]), [])
  const pushDrawer = useCallback((view: DrawerView) => setDrawerStack((s) => [...s, view]), [])
  const closeDrawer = useCallback(() => setDrawerStack([]), [])
  const backDrawer = useCallback(() => setDrawerStack((s) => s.slice(0, -1)), [])
  // DEVICE DRILL-DOWN — every device click on this screen funnels
  // through here into the shared EndpointDetailDrawer (live
  // connectivity, hardware/OS, applications, linked vulns, command
  // history + execution, WoL). The generic DetailDrawer never
  // shows a device record.
  // NOTE: SecOpsHome receives no user role, so canRunCommands is
  // left false here — the drawer shows its owner/admin-only note.
  // Passing the session role through from App.tsx would enable
  // the command buttons for owner/admin.
  const openDevice = useCallback((device: DeviceRow) => setEndpointDevice(device), [])
  const closeEndpoint = useCallback(() => setEndpointDevice(null), [])
  const endpointRecord: EndpointDeviceRecord | null = endpointDevice
    ? { ...endpointDevice, device_id: endpointDevice.device_id ?? '' }
    : null

  /* ------------------------------------------------------------ derived */
  const days = RANGE_DAYS[range]
  const now = lastUpdated ?? Date.now()
  const rangeStart = now - days * DAY_MS

  const deviceById = useMemo(() => {
    const m = new Map<string, DeviceRow>()
    for (const d of devices) m.set(d.id, d)
    return m
  }, [devices])

  const deviceOf = useCallback(
    (deviceId: string | null | undefined): DeviceRow | undefined => {
      if (!deviceId) return undefined
      return deviceById.get(deviceId)
    },
    [deviceById],
  )

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
  // False positives are not real detections: they are excluded from
  // the quarantine-rate denominator (see SummaryPanels + coverage
  // card) and footnoted wherever the rate is shown.
  const falsePositiveMalware = useMemo(
    () => malware.filter((m) => normStatus(m.status) === 'false-positive').length,
    [malware],
  )
  const actionableMalware = malware.length - falsePositiveMalware
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

  const highRiskDeviceRows = useMemo(
    () =>
      [...highRiskDevices.keys()]
        .map((id) => deviceById.get(id))
        .filter((d): d is DeviceRow => d !== undefined),
    [highRiskDevices, deviceById],
  )

  // Distinct devices linked to ANY open vulnerability (attack surface).
  const exposedDeviceRows = useMemo(() => {
    const ids = new Set<string>()
    for (const v of openVulns) if (v.device_id) ids.add(v.device_id)
    return [...ids].map((id) => deviceById.get(id)).filter((d): d is DeviceRow => d !== undefined)
  }, [openVulns, deviceById])

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
  const reportingDeviceRows = useMemo(() => {
    const cutoff = now - 24 * 60 * 60 * 1000
    return enrolledDevices.filter((d) => {
      const t = parseDate(d.last_checkin_at)
      return t !== null && t >= cutoff
    })
  }, [enrolledDevices, now])

  const liveDevices = useMemo(() => devices.filter((d) => !isSampleDevice(d)), [devices])

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

  // Devices carrying a department or OS attribute — the denominator
  // for the "covers N of M endpoints" note under risk distribution.
  const attributedDeviceCount = useMemo(
    () => devices.filter((d) => departmentOf(d) !== null || osLabelOf(d) !== null).length,
    [devices],
  )

  const hasDemo = useMemo(
    () =>
      [...vulns, ...incidents, ...malware, ...dlp, ...policies, ...devices].some((r) => r.is_demo === true),
    [vulns, incidents, malware, dlp, policies, devices],
  )

  const policyTypeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of policies) {
      const t = (p.policy_type || 'unspecified').trim()
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [policies])
  const activePolicies = useMemo(
    () => policies.filter((p) => normStatus(p.status) === 'active').length,
    [policies],
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
    // Detected malware is listed ONCE: the critical subset is folded
    // into the same line (it used to appear twice — once as
    // "unquarantined critical detections" and once inside
    // "unquarantined malware detections").
    if (detectedMalware.length > 0)
      parts.push(
        critDetectedMalware.length > 0
          ? `${detectedMalware.length} unquarantined malware ${detectedMalware.length === 1 ? 'detection' : 'detections'} (${critDetectedMalware.length} critical)`
          : `${detectedMalware.length} unquarantined malware ${detectedMalware.length === 1 ? 'detection' : 'detections'}`,
      )
    if (highOpen.length > 0)
      parts.push(`${highOpen.length} open high ${highOpen.length === 1 ? 'vulnerability' : 'vulnerabilities'}`)
    if (openDlp.length > 0) parts.push(`${openDlp.length} open DLP ${openDlp.length === 1 ? 'finding' : 'findings'}`)
    if (nonCompliant.length > 0)
      parts.push(`${nonCompliant.length} non-compliant ${nonCompliant.length === 1 ? 'assessment' : 'assessments'}`)
    return parts
  }, [critOpen, activeIncidents, critDetectedMalware, highOpen, openDlp, detectedMalware, nonCompliant])

  const postureColor =
    posture === 'Elevated' ? NULL_COLORS.critical : posture === 'Guarded' ? NULL_COLORS.warning : NULL_COLORS.success

  /* ------------------------------------------------------------ trends */
  const trend = useMemo(() => bucketTrend(vulns, days, now), [vulns, days, now])
  // Days covered by the oldest (remainder) weekly bucket — 30d → 2,
  // 90d → 6, 7d → n/a (daily buckets). Shown in the trend subtitle.
  const weeklyRemainder = days - 7 * (Math.ceil(days / 7) - 1)
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

  /* ------------------------------------------------------------ drawer openers */
  const openVulnDrawer = useCallback(
    (severity?: Severity) => {
      const rows = severity ? openVulns.filter((v) => severityOf(v) === severity) : openVulns
      openDrawer({
        kind: 'vulns',
        title: severity ? `Open vulnerabilities — ${severity}` : 'Open vulnerabilities',
        rows,
      })
    },
    [openVulns, openDrawer],
  )

  const openIncidentDrawer = useCallback(
    (status?: 'active' | 'complete' | 'failed') => {
      if (status === 'active')
        return openDrawer({ kind: 'incidents', title: 'Active incidents', rows: activeIncidents })
      if (status === 'complete')
        return openDrawer({
          kind: 'incidents',
          title: 'Incidents — complete',
          rows: incidents.filter((i) => normStatus(i.status) === 'complete'),
        })
      if (status === 'failed')
        return openDrawer({
          kind: 'incidents',
          title: 'Incidents — failed',
          rows: incidents.filter((i) => normStatus(i.status) === 'failed'),
        })
      return openDrawer({ kind: 'incidents', title: 'Incident response — all actions', rows: incidents })
    },
    [activeIncidents, incidents, openDrawer],
  )

  const openMalwareDrawer = useCallback(
    () => openDrawer({ kind: 'malware', title: 'Malware detections', rows: malware }),
    [malware, openDrawer],
  )
  const openDlpDrawer = useCallback(
    () => openDrawer({ kind: 'dlp', title: 'DLP findings', rows: dlp }),
    [dlp, openDrawer],
  )
  const openHighRiskDrawer = useCallback(
    () =>
      openDrawer({
        kind: 'devices',
        title: 'High-risk endpoints — open critical/high vulnerabilities',
        rows: highRiskDeviceRows,
      }),
    [highRiskDeviceRows, openDrawer],
  )
  const openReportingDrawer = useCallback(
    () =>
      openDrawer({
        kind: 'devices',
        title: 'Endpoints reporting in last 24h',
        rows: reportingDeviceRows,
      }),
    [reportingDeviceRows, openDrawer],
  )
  const openNewInRangeDrawer = useCallback(() => {
    const rows = vulns.filter((v) => {
      const t = timeOf(v)
      return t !== null && t >= rangeStart && t <= now
    })
    openDrawer({ kind: 'vulns', title: `New vulnerabilities — last ${days} days`, rows })
  }, [vulns, rangeStart, now, days, openDrawer])

  /* ------------------------------------------------------------ timeline */
  const timelineItems = useMemo<ActivityFeedItem[]>(() => {
    type Ev = { item: ActivityFeedItem; t: number }
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
          view: { kind: 'vuln', row: v },
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
          view: { kind: 'incident', row: i },
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
          view: { kind: 'malware-detection', row: m },
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
          view: { kind: 'dlp-finding', row: d },
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
    const openAgeBuckets = { under7: 0, sevenTo30: 0, over30: 0, undated: 0 }
    for (const v of openVulns) {
      const d = ageDays(timeOf(v), now)
      if (d === null) openAgeBuckets.undated += 1
      else if (d < 7) openAgeBuckets.under7 += 1
      else if (d <= 30) openAgeBuckets.sevenTo30 += 1
      else openAgeBuckets.over30 += 1
    }
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
      ['Open vulnerabilities under 7 days old', openAgeBuckets.under7],
      ['Open vulnerabilities 7–30 days old', openAgeBuckets.sevenTo30],
      ['Open vulnerabilities over 30 days old', openAgeBuckets.over30],
      ['Open vulnerabilities with no detection date', openAgeBuckets.undated],
      ['Active incidents (pending / in-progress)', activeIncidents.length],
      ['Incidents complete', completeIncidents],
      ['Incidents failed', failedIncidents],
      ['Malware detections (status detected)', detectedMalware.length],
      ['Malware detections (total)', malware.length],
      ['Malware detections (false positives, excluded from quarantine rate)', falsePositiveMalware],
      ['Malware detections (actionable)', actionableMalware],
      ['Malware quarantined', quarantinedMalware],
      ['DLP findings (open)', openDlp.length],
      ['DLP findings (total)', dlp.length],
      ['DLP findings closed (remediated / encrypted)', closedDlp],
      ['DLP findings accepted (neither open nor closed)', dlp.length - openDlp.length - closedDlp],
      [
        'Policy violations (non-compliant assessments)',
        compliance.length === 0 ? '— (no assessments recorded)' : nonCompliant.length,
      ],
      ['Compliance assessments (total)', compliance.length],
      ['Policies (total)', policies.length],
      ['Policies active', activePolicies],
      ['High-risk endpoints (open critical/high vulns)', highRiskDevices.size],
      ['Endpoints exposed (any open vulnerability)', exposedDeviceRows.length],
      ['Endpoints in scope (total)', devices.length],
      ['Endpoints live (not sample)', liveDevices.length],
      ['Endpoints enrolled', enrolledDevices.length],
      ['Endpoints reporting in last 24h', reporting24h],
      ['Mean time to remediate', 'Not computable — no resolution timestamps on vulnerability or incident records'],
      ['Overdue remediation', 'Not computable — no deadline field on any security record'],
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

  const activeDrawer = drawerStack.length > 0 ? drawerStack[drawerStack.length - 1] : null

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
            follow the selected range. Click any number, chart segment, queue row, or timeline entry to see the
            underlying records.
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

      {/* Summary band — four combined panels (replaces the old 8-card strip) */}
      {sections.kpis && (
        <SummaryPanels
          openCount={openVulns.length}
          totalCount={vulns.length}
          severityCounts={severityCounts}
          unclassifiedOpen={unclassifiedOpen}
          remediatedCount={remediatedVulns}
          trendSeries={trend.series}
          trend={vulnTrend}
          days={days}
          activeIncidents={activeIncidents.length}
          completeIncidents={completeIncidents}
          failedIncidents={failedIncidents}
          totalIncidents={incidents.length}
          detectedMalware={detectedMalware.length}
          actionableMalware={actionableMalware}
          falsePositiveMalware={falsePositiveMalware}
          quarantinedMalware={quarantinedMalware}
          critDetectedMalware={critDetectedMalware.length}
          openDlp={openDlp.length}
          totalDlp={dlp.length}
          closedDlp={closedDlp}
          highRiskCount={highRiskDevices.size}
          deviceCount={devices.length}
          enrolledCount={enrolledDevices.length}
          reporting24h={reporting24h}
          onOpenVulns={openVulnDrawer}
          onOpenIncidents={openIncidentDrawer}
          onOpenMalware={openMalwareDrawer}
          onOpenDlp={openDlpDrawer}
          onOpenHighRiskDevices={openHighRiskDrawer}
          onOpenReporting={openReportingDrawer}
        />
      )}

      {/* Row A — exposure left, investigation queue right */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {sections.exposure && (
            <>
              <ChartContainer
                title="Vulnerability exposure"
                subtitle="Open vulnerabilities by severity — click a severity to see those records"
                actions={
                  <button
                    type="button"
                    onClick={() => openVulnDrawer()}
                    className="text-xs font-medium text-null-teal hover:underline"
                  >
                    View all {openVulns.length} →
                  </button>
                }
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => openVulnDrawer(sev)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-null-line px-2.5 py-1 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:text-white dark:hover:bg-null-navy2"
                          title={`View open ${sev} vulnerabilities`}
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{
                              background:
                                sev === 'critical'
                                  ? NULL_COLORS.critical
                                  : sev === 'high'
                                    ? NULL_COLORS.warning
                                    : sev === 'medium'
                                      ? NULL_COLORS.info
                                      : NULL_COLORS.muted,
                            }}
                            aria-hidden
                          />
                          <span className="capitalize">{sev}</span>
                          <span className="text-null-muted dark:text-[#8AA0B8]">{severityCounts[sev]}</span>
                        </button>
                      ))}
                    </div>
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
                    : weeklyRemainder === 7
                      ? 'New detections per week, from detected_at'
                      : `New detections per week, from detected_at — first bucket covers ${weeklyRemainder} days`
                }
                actions={
                  <button
                    type="button"
                    onClick={openNewInRangeDrawer}
                    className="text-xs font-medium text-null-teal hover:underline"
                  >
                    View new in range →
                  </button>
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
        </div>

        <div className="space-y-6 lg:col-span-5">
          {sections.attention && (
            <div className="null-card" aria-label="Threat investigation">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-null-ink dark:text-white">Threat investigation</h3>
                <span className="text-xs text-null-muted dark:text-[#8AA0B8]">ranked · click a row to investigate</span>
              </div>
              <InvestigationQueue
                openVulns={openVulns}
                detectedMalware={detectedMalware}
                activeIncidents={activeIncidents}
                openDlp={openDlp}
                hostnameOf={hostnameOf}
                onOpenView={openDrawer}
                now={now}
              />
            </div>
          )}
        </div>
      </div>

      {/* Row B — prioritization left, risk + coverage right */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {sections.prioritization && (
            <ChartContainer
              title="Vulnerability prioritization"
              subtitle="Ranked fix list — severity, then CVSS, then oldest first"
              actions={
                <button
                  type="button"
                  onClick={() => openVulnDrawer()}
                  className="text-xs font-medium text-null-teal hover:underline"
                >
                  View all open →
                </button>
              }
            >
              <PrioritizedVulns
                openVulns={openVulns}
                hostnameOf={hostnameOf}
                deviceOf={deviceOf}
                onOpenView={openDrawer}
                onOpenDevice={openDevice}
                now={now}
              />
            </ChartContainer>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          {sections.risk && (
            <ChartContainer
              title="Risk distribution"
              subtitle="Open vulnerabilities grouped by the linked endpoint's department and OS"
              actions={
                <button
                  type="button"
                  onClick={() =>
                    openDrawer({
                      kind: 'devices',
                      title: 'Exposed endpoints — open vulnerabilities',
                      rows: exposedDeviceRows,
                    })
                  }
                  className="text-xs font-medium text-null-teal hover:underline"
                >
                  View exposed endpoints →
                </button>
              }
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
                  <p className="border-t border-null-line pt-3 text-xs leading-relaxed text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
                    Covers {attributedDeviceCount} of {devices.length} endpoints — department and OS are recorded
                    only on sample endpoints. Live endpoints are counted in fleet totals but cannot appear here.
                  </p>
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
                    <button type="button" onClick={openReportingDrawer} className="block w-full text-left" title="View reporting endpoints">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-null-ink dark:text-white">
                          Endpoints reporting in last 24h
                        </span>
                        <span className="font-semibold text-null-ink dark:text-white">
                          {reporting24h} of {enrolledDevices.length} enrolled
                        </span>
                      </span>
                      <span className="mt-1.5 block h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                        <span
                          className="block h-full rounded bg-null-teal"
                          style={{
                            width: `${enrolledDevices.length > 0 ? Math.round((reporting24h / enrolledDevices.length) * 100) : 0}%`,
                          }}
                        />
                      </span>
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={openMalwareDrawer} className="block w-full text-left" title="View malware detections">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-null-ink dark:text-white">Malware quarantined</span>
                        <span className="font-semibold text-null-ink dark:text-white">
                          {quarantinedMalware} of {actionableMalware}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                        <span
                          className="block h-full rounded bg-null-teal"
                          style={{
                            width: `${actionableMalware > 0 ? Math.round((quarantinedMalware / actionableMalware) * 100) : 0}%`,
                          }}
                        />
                      </span>
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={openDlpDrawer} className="block w-full text-left" title="View DLP findings">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-null-ink dark:text-white">DLP findings closed</span>
                        <span className="font-semibold text-null-ink dark:text-white">
                          {closedDlp} of {dlp.length}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-2 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                        <span
                          className="block h-full rounded bg-null-teal"
                          style={{
                            width: `${dlp.length > 0 ? Math.round((closedDlp / dlp.length) * 100) : 0}%`,
                          }}
                        />
                      </span>
                    </button>
                  </li>
                </ul>
              )}
              <p className="mt-4 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                These measure check-in recency and closure outcomes. They don&apos;t show whether every endpoint
                is protected — protection coverage isn&apos;t tracked here. {enrolledDevices.length} enrolled of{' '}
                {devices.length} endpoints in scope — {devices.length - enrolledDevices.length} suspended
                excluded. {falsePositiveMalware} false-positive {falsePositiveMalware === 1 ? 'detection is' : 'detections are'}{' '}
                excluded from the quarantine rate. {dlp.length - openDlp.length - closedDlp} DLP{' '}
                {dlp.length - openDlp.length - closedDlp === 1 ? 'finding is' : 'findings are'} accepted —
                neither open nor closed.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Row C — incidents + timeline left, attack surface right */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {sections.incidents && (
            <ChartContainer
              title="Incident response"
              subtitle="Containment actions by outcome — pending / in-progress counts as open"
              actions={
                <button
                  type="button"
                  onClick={() => openIncidentDrawer()}
                  className="text-xs font-medium text-null-teal hover:underline"
                >
                  View all {incidents.length} →
                </button>
              }
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openIncidentDrawer('active')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-null-line px-2.5 py-1 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:text-white dark:hover:bg-null-navy2"
                      title="View open incidents"
                    >
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: NULL_COLORS.warning }} aria-hidden />
                      Open {activeIncidents.length}
                    </button>
                    <button
                      type="button"
                      onClick={() => openIncidentDrawer('complete')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-null-line px-2.5 py-1 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:text-white dark:hover:bg-null-navy2"
                      title="View complete incidents"
                    >
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: NULL_COLORS.success }} aria-hidden />
                      Resolved {completeIncidents}
                    </button>
                    <button
                      type="button"
                      onClick={() => openIncidentDrawer('failed')}
                      className="inline-flex items-center gap-1.5 rounded-full border border-null-line px-2.5 py-1 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:text-white dark:hover:bg-null-navy2"
                      title="View failed incidents"
                    >
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: NULL_COLORS.critical }} aria-hidden />
                      Failed {failedIncidents}
                    </button>
                  </div>
                  <div className="mt-4 border-t border-null-line pt-4 dark:border-white/10">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                        Alert severity (all categories)
                      </h4>
                      {alerts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openDrawer({ kind: 'alerts', title: 'Security alerts', rows: alerts })}
                          className="text-xs font-medium text-null-teal hover:underline"
                        >
                          View {alerts.length} alerts →
                        </button>
                      )}
                    </div>
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

          {sections.incidentTimeline && (
            <ChartContainer
              title="Incident response timeline"
              subtitle="Containment actions, newest first — click an entry for its record"
            >
              <IncidentTimeline
                incidents={incidents}
                hostnameOf={hostnameOf}
                deviceOf={deviceOf}
                onOpenView={openDrawer}
                onOpenDevice={openDevice}
                alertsRecorded={alerts.length > 0}
                now={now}
              />
            </ChartContainer>
          )}
        </div>

        <div className="space-y-6 lg:col-span-5">
          {sections.attack && (
            <ChartContainer
              title="Attack surface"
              subtitle="What is exposed, from device and vulnerability records"
            >
              <AttackSurface
                devices={devices}
                openVulns={openVulns}
                hostnameOf={hostnameOf}
                deviceOf={deviceOf}
                onOpenView={openDrawer}
                onOpenDevice={openDevice}
              />
            </ChartContainer>
          )}
        </div>
      </div>

      {/* Row D — remediation tracking, full width */}
      {sections.remediation && (
        <ChartContainer
          title="Remediation tracking"
          subtitle="Where every open item stands — status pipelines and age. Click a segment to see those records."
        >
          <RemediationTracking
            vulns={vulns}
            incidents={incidents}
            malware={malware}
            dlp={dlp}
            compliance={compliance}
            alerts={alerts}
            now={now}
            onOpenView={openDrawer}
          />
        </ChartContainer>
      )}

      {/* Row E — security activity + policies */}
      <div className="grid gap-6 lg:grid-cols-12">
        {sections.activity && (
          <div className="null-card lg:col-span-7" aria-label="Security activity">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-null-ink dark:text-white">Security activity</h3>
              <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
                Latest 15 · last {days} days · newest first · click an entry to open its record
              </p>
            </div>
            {timelineItems.length === 0 ? (
              <EmptyState
                icon="clock"
                title="No security activity in this range"
                description={`Nothing was detected, contained, or found in the last ${days} days. Widen the range to see older activity.`}
              />
            ) : (
              <ActivityFeed items={timelineItems} onOpenView={openDrawer} />
            )}
          </div>
        )}
        {sections.policies && (
          <div className="null-card lg:col-span-5" aria-label="Policies and compliance">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-null-ink dark:text-white">Policies & compliance</h3>
              <span className="text-xs text-null-muted dark:text-[#8AA0B8]">
                {policies.length} policies · {activePolicies} active
              </span>
            </div>
            {policies.length === 0 ? (
              <EmptyState
                icon="file-text"
                title="No policies defined"
                description="No policy definitions exist yet. Policies define the rules; violations are tracked through compliance assessments."
              />
            ) : (
              <ul className="space-y-1.5">
                {[...policies]
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => openDrawer({ kind: 'policy', row: p })}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                        title="Open policy detail"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                            {p.name || 'Unnamed policy'}
                          </span>
                          <span className="block text-xs text-null-muted dark:text-[#8AA0B8]">
                            {p.policy_type || 'unspecified'}
                          </span>
                        </span>
                        <StatusBadge value={p.status} size="sm" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="mt-4 border-t border-null-line pt-3 dark:border-white/10">
              <p className="text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                {compliance.length === 0 ? (
                  <>
                    No compliance assessments recorded — policy violations (non-compliant assessments) cannot be
                    tracked until assessments exist. There is no violation record type.
                  </>
                ) : (
                  <>
                    {compliance.length} {compliance.length === 1 ? 'assessment' : 'assessments'} ·{' '}
                    {nonCompliant.length} non-compliant · {benchmarkCount}{' '}
                    {benchmarkCount === 1 ? 'benchmark' : 'benchmarks'}.{' '}
                    <button
                      type="button"
                      onClick={() =>
                        openDrawer({ kind: 'compliance', title: 'Non-compliant assessments', rows: nonCompliant })
                      }
                      className="font-medium text-null-teal hover:underline"
                    >
                      View non-compliant →
                    </button>
                  </>
                )}
              </p>
              {policyTypeCounts.length > 0 && (
                <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                  By type: {policyTypeCounts.map(([t, n]) => `${t} ${n}`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Drill-down drawers */}
      {activeDrawer && (
        <DetailDrawer open onClose={closeDrawer} title={drawerTitle(activeDrawer)}>
          <DrawerContent
            view={activeDrawer}
            onOpenView={pushDrawer}
            onBack={drawerStack.length > 1 ? backDrawer : null}
            onOpenDevice={openDevice}
            onNavigate={onNavigate}
            hostnameOf={hostnameOf}
            deviceOf={deviceOf}
            now={now}
          />
        </DetailDrawer>
      )}
      <EndpointDetailDrawer
        open={endpointDevice !== null}
        device={endpointRecord}
        api={props.api}
        headers={props.headers}
        canRunCommands={props.userRole === 'owner' || props.userRole === 'admin'}
        userRole={props.userRole}
        onClose={closeEndpoint}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ types */

type Posture = 'Elevated' | 'Guarded' | 'Stable'

const SECTIONS = [
  { id: 'kpis', label: 'Summary band' },
  { id: 'exposure', label: 'Vulnerability exposure' },
  { id: 'prioritization', label: 'Vulnerability prioritization' },
  { id: 'incidents', label: 'Incident response' },
  { id: 'incidentTimeline', label: 'Incident timeline' },
  { id: 'attention', label: 'Threat investigation' },
  { id: 'risk', label: 'Risk distribution' },
  { id: 'coverage', label: 'Protection coverage' },
  { id: 'attack', label: 'Attack surface' },
  { id: 'remediation', label: 'Remediation tracking' },
  { id: 'activity', label: 'Security activity' },
  { id: 'policies', label: 'Policies & compliance' },
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
  // Weekly buckets, aligned exactly to the range: the OLDEST bucket
  // takes the remainder (30d → 2 days, 90d → 6 days), so no bucket
  // reaches outside the labelled range.
  const buckets = Math.ceil(days / 7)
  const widths = [days - 7 * (buckets - 1), ...Array.from({ length: buckets - 1 }, () => 7)]
  const series = Array.from({ length: buckets }, () => 0)
  const labels: string[] = []
  let cursor = start
  for (let i = 0; i < buckets; i++) {
    labels.push(fmtDay(cursor))
    cursor += widths[i] * DAY_MS
  }
  for (const r of rows) {
    const t = timeOf(r)
    if (t === null || t < start || t > now) continue
    let offset = t - start
    let idx = 0
    while (idx < buckets - 1 && offset >= widths[idx] * DAY_MS) {
      offset -= widths[idx] * DAY_MS
      idx += 1
    }
    series[idx] += 1
  }
  return { series, labels }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
