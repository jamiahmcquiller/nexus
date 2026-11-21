// NULL — IT Operations home dashboard.
//
// Every number on this screen is computed client-side from live API
// lists (devices, patches, patch deployments, servers). Nothing is
// fabricated: a series with no underlying rows renders an EmptyState,
// not zeros dressed up as a trend.
//
// ── Data formulas (the contract — change these only deliberately) ──
//
// ENDPOINT HEALTH (from GET /api/v1/devices/; DeviceOut rows carry
// enrollment_status, last_checkin_at and attributes — but NOT
// created_at and NOT is_demo, so devices cannot feed the enrollment
// trend by created_at nor the sample-data pill):
//   online     = enrollment_status "enrolled" AND last_checkin_at
//                within the last 1h (same 1h threshold the backend's
//                /api/v1/devices/stats "online" count uses)
//   attention  = enrolled AND last_checkin_at between 1h and 24h ago
//                (checking in, but stale)
//   offline    = enrolled AND last_checkin_at older than 24h, or never
//   degraded   = enrollment_status "suspended"
//   decommissioned devices are NOT in the fleet and are excluded from
//   the donut entirely.
//
// PATCH COMPLIANCE % (from GET /api/v1/patches/):
//   deployed / (deployed + available + testing + approved)
//   Declined patches are excluded from the denominator. There is no
//   "failed" patch status in the backend (patch statuses are
//   available / testing / approved / declined / deployed), so a
//   failed-patch term would always be zero; deployment failures are
//   counted separately from GET /api/v1/patch-deployments/.
//
// TREND BUCKETING: 7d range → daily buckets; 30d / 90d → weekly
// buckets, each labelled by its start date. The compliance trend is a
// cumulative snapshot per bucket: patches with created_at on or before
// the bucket end, run through the compliance formula above. Buckets
// with an empty denominator are dropped; fewer than two surviving
// points renders an EmptyState instead of a line.
//
// OS DISTRIBUTION: from device attributes.os.platform (the agent
// enrolls with runtime.GOOS: darwin / windows / linux), mapped to
// display names. attributes.os.name is NEVER displayed — the agent's
// macOS version detection is broken and it reads "macOS <nil>".
// Devices with no platform read as "Unknown".
//
// ENROLLMENT ACTIVITY: bucketed from device attributes.collected
// (the RFC3339 timestamp the agent sends at enrollment), because the
// devices list exposes no created_at.
//
// SAMPLE-DATA PILL: shown when any fetched patch, deployment, or
// server row has is_demo === true. Those list endpoints serialize
// every column (_crud._serialize), so is_demo is present. Devices
// cannot contribute: DeviceOut omits is_demo even though the Device
// model has the column.
//
// DATE RANGE: 7d / 30d / 90d filters the computed series and the
// activity timeline. The KPI row is always the current snapshot
// (health and compliance are point-in-time, not range-scoped).

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  ActivityTimeline,
  AttentionQueue,
  BarChart,
  ChartContainer,
  DonutChart,
  EmptyState,
  KpiPanel,
  LineChart,
} from '../components'
import type { AttentionItem, TimelineItem, TimelineTone } from '../components'
import { NULL_COLORS } from '../theme'

type ItOpsHomeProps = {
  api: string
  headers: Record<string, string>
  onNavigate: (moduleId: string, subsectionId?: string) => void
}

type DeviceRow = {
  id: string
  hostname?: string | null
  device_id: string
  enrollment_status: string
  agent_version?: string | null
  last_checkin_at?: string | null
  attributes?: Record<string, any> | null
}

type PatchRow = {
  id: string
  title?: string | null
  status?: string | null
  severity?: string | null
  product?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type DeploymentRow = {
  id: string
  name?: string | null
  title?: string | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type ServerRow = {
  id: string
  hostname?: string | null
  title?: string | null
  os?: string | null
  health_status?: string | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type RangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '30d': 30, '90d': 90 }

const SECTIONS = [
  { id: 'kpis', label: 'KPI row' },
  { id: 'health', label: 'Endpoint health' },
  { id: 'compliance', label: 'Patch compliance trend' },
  { id: 'os', label: 'OS distribution' },
  { id: 'deployments', label: 'Deployment outcomes' },
  { id: 'enrollment', label: 'Enrollment activity' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'activity', label: 'Recent activity' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const SECTIONS_STORAGE_KEY = 'null_itops_sections'

const STALE_MS = 24 * 60 * 60 * 1000 // 24h — offline threshold
const ONLINE_MS = 60 * 60 * 1000 // 1h — online threshold, matches backend device_stats

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString()
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function osDisplayName(platform: unknown): string {
  if (typeof platform !== 'string') return 'Unknown'
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

function loadSections(): Record<SectionId, boolean> {
  const all: Record<SectionId, boolean> = {
    kpis: true,
    health: true,
    compliance: true,
    os: true,
    deployments: true,
    enrollment: true,
    attention: true,
    activity: true,
  }
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY)
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

export function ItOpsHome({ api, headers, onNavigate }: ItOpsHomeProps) {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [patches, setPatches] = useState<PatchRow[]>([])
  const [deployments, setDeployments] = useState<DeploymentRow[]>([])
  const [servers, setServers] = useState<ServerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [range, setRange] = useState<RangeKey>('30d')
  const [sections, setSections] = useState<Record<SectionId, boolean>>(loadSections)
  const [customizing, setCustomizing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [d, p, dep, s] = await Promise.all([
        axios.get(`${api}/api/v1/devices/`, { headers }),
        axios.get(`${api}/api/v1/patches/`, { headers }),
        axios.get(`${api}/api/v1/patch-deployments/`, { headers }),
        axios.get(`${api}/api/v1/servers/`, { headers }),
      ])
      setDevices(Array.isArray(d.data) ? d.data : [])
      setPatches(Array.isArray(p.data) ? p.data : [])
      setDeployments(Array.isArray(dep.data) ? dep.data : [])
      setServers(Array.isArray(s.data) ? s.data : [])
      setLastRefresh(new Date())
    } catch {
      setError('Could not load IT Operations data from the backend.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const toggleSection = (id: SectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable — the toggle still applies for this visit.
      }
      return next
    })
  }

  const rangeDays = RANGE_DAYS[range]
  const rangeStart = useMemo(() => new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000), [rangeDays])
  const bucketDays = range === '7d' ? 1 : 7

  // Bucket boundaries: oldest → newest, each labelled by start date.
  const buckets = useMemo(() => {
    const count = Math.ceil(rangeDays / bucketDays)
    const out: { start: Date; end: Date; label: string }[] = []
    for (let i = count - 1; i >= 0; i--) {
      const end = new Date(Date.now() - i * bucketDays * 24 * 60 * 60 * 1000)
      const start = new Date(end.getTime() - bucketDays * 24 * 60 * 60 * 1000)
      out.push({ start, end, label: fmtDate(start) })
    }
    return out
  }, [rangeDays, bucketDays])

  const inRange = useCallback(
    (d: Date | null) => !!d && d >= rangeStart,
    [rangeStart],
  )

  /* ------------------------------ health ------------------------------ */

  const health = useMemo(() => {
    const now = Date.now()
    let online = 0
    let attention = 0
    let offline = 0
    let degraded = 0
    for (const dev of devices) {
      const status = (dev.enrollment_status || '').toLowerCase()
      if (status === 'suspended') {
        degraded++
        continue
      }
      if (status === 'decommissioned') continue // not in the fleet
      if (status !== 'enrolled') continue
      const last = parseDate(dev.last_checkin_at)
      if (!last) {
        offline++
      } else if (now - last.getTime() <= ONLINE_MS) {
        online++
      } else if (now - last.getTime() <= STALE_MS) {
        attention++
      } else {
        offline++
      }
    }
    return { online, attention, offline, degraded }
  }, [devices])

  const totalEndpoints = devices.filter((d) => (d.enrollment_status || '').toLowerCase() !== 'decommissioned').length

  /* ----------------------------- patches ------------------------------ */

  const patchCounts = useMemo(() => {
    let deployed = 0
    let available = 0
    let testing = 0
    let approved = 0
    let declined = 0
    for (const p of patches) {
      switch ((p.status || '').toLowerCase()) {
        case 'deployed':
          deployed++
          break
        case 'available':
          available++
          break
        case 'testing':
          testing++
          break
        case 'approved':
          approved++
          break
        case 'declined':
          declined++
          break
      }
    }
    return { deployed, available, testing, approved, declined }
  }, [patches])

  // Patch compliance = deployed / (deployed + available + testing +
  // approved); declined excluded. Null when the denominator is zero —
  // no patches to measure, not "0% compliant".
  const compliancePct = useMemo(() => {
    const denom = patchCounts.deployed + patchCounts.available + patchCounts.testing + patchCounts.approved
    return denom === 0 ? null : Math.round((patchCounts.deployed / denom) * 100)
  }, [patchCounts])

  const pendingPatches = patchCounts.available + patchCounts.testing + patchCounts.approved

  const complianceSeries = useMemo(() => {
    const points: { label: string; value: number }[] = []
    for (const b of buckets) {
      let deployed = 0
      let denom = 0
      for (const p of patches) {
        const created = parseDate(p.created_at)
        if (!created || created > b.end) continue
        const status = (p.status || '').toLowerCase()
        if (status === 'deployed') {
          deployed++
          denom++
        } else if (status === 'available' || status === 'testing' || status === 'approved') {
          denom++
        }
      }
      if (denom > 0) points.push({ label: b.label, value: Math.round((deployed / denom) * 100) })
    }
    return points
  }, [buckets, patches])

  const countSeries = useCallback(
    (dates: (Date | null)[]) => {
      // Counts of events per bucket (events dated by `dates`, in range).
      return buckets.map((b) => dates.filter((d) => d && d >= b.start && d < b.end).length)
    },
    [buckets],
  )

  const enrollmentSeries = useMemo(() => {
    const dates = devices.map((d) => parseDate(d.attributes?.collected))
    return countSeries(dates)
  }, [devices, countSeries])

  const pendingPatchSeries = useMemo(() => {
    const dates = patches
      .filter((p) => ['available', 'testing', 'approved'].includes((p.status || '').toLowerCase()))
      .map((p) => parseDate(p.created_at))
    return countSeries(dates)
  }, [patches, countSeries])

  const failedDeploymentSeries = useMemo(() => {
    const dates = deployments
      .filter((d) => (d.status || '').toLowerCase() === 'failed')
      .map((d) => parseDate(d.created_at))
    return countSeries(dates)
  }, [deployments, countSeries])

  const complianceTrend = useMemo(() => {
    if (complianceSeries.length < 2 || compliancePct === null) return undefined
    const first = complianceSeries[0].value
    const last = complianceSeries[complianceSeries.length - 1].value
    const diff = last - first
    return {
      direction: (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
      value: `${diff > 0 ? '+' : ''}${diff} pts vs ${range}`,
      good: diff >= 0,
    }
  }, [complianceSeries, compliancePct, range])

  /* --------------------------- deployments ---------------------------- */

  const deploymentCounts = useMemo(() => {
    let deployed = 0
    let failed = 0
    for (const d of deployments) {
      const s = (d.status || '').toLowerCase()
      if (s === 'deployed') deployed++
      else if (s === 'failed') failed++
    }
    return { deployed, failed }
  }, [deployments])

  const failedDeployments = deployments.filter((d) => (d.status || '').toLowerCase() === 'failed')

  /* ------------------------------ OS mix ------------------------------ */

  const osDistribution = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of devices) {
      const label = osDisplayName(d.attributes?.os?.platform)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [devices])

  /* --------------------------- attention queue ------------------------ */

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const now = Date.now()
    for (const dev of devices) {
      if ((dev.enrollment_status || '').toLowerCase() !== 'enrolled') continue
      const last = parseDate(dev.last_checkin_at)
      const ageMs = last ? now - last.getTime() : Infinity
      if (ageMs <= STALE_MS) continue
      const staleDays = Number.isFinite(ageMs) ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : null
      items.push({
        id: `stale-${dev.id}`,
        severity: !last || (staleDays !== null && staleDays >= 7) ? 'critical' : 'high',
        title: `${dev.hostname || dev.device_id} — stale check-in`,
        asset: dev.device_id,
        status: last ? `last check-in ${timeAgo(last)}` : 'never checked in',
        time: last ? fmtDateTime(last) : undefined,
        actionLabel: 'View',
        onAction: () => onNavigate('devices'),
      })
    }
    for (const d of failedDeployments) {
      items.push({
        id: `failed-dep-${d.id}`,
        severity: 'critical',
        title: `Failed deployment: ${d.name || d.title || 'Untitled'}`,
        status: d.status || 'failed',
        time: parseDate(d.created_at) ? fmtDateTime(parseDate(d.created_at)!) : undefined,
        actionLabel: 'Review',
        onAction: () => onNavigate('patches', 'deployments'),
      })
    }
    for (const p of patches) {
      if ((p.status || '').toLowerCase() === 'testing') {
        items.push({
          id: `awaiting-${p.id}`,
          severity: 'medium',
          title: `Patch awaiting approval: ${p.title || 'Untitled patch'}`,
          asset: p.product || undefined,
          status: 'testing',
          time: parseDate(p.created_at) ? fmtDateTime(parseDate(p.created_at)!) : undefined,
          actionLabel: 'Review',
          onAction: () => onNavigate('patches'),
        })
      }
    }
    for (const s of servers) {
      const hs = (s.health_status || '').toLowerCase()
      if (hs === 'degraded' || hs === 'down') {
        items.push({
          id: `server-${s.id}`,
          severity: hs === 'down' ? 'critical' : 'high',
          title: `Server ${hs}: ${s.hostname || s.title || 'Unnamed server'}`,
          asset: s.os || undefined,
          status: s.health_status || '',
          actionLabel: 'View',
          onAction: () => onNavigate('servers'),
        })
      }
    }
    return items.slice(0, 12)
  }, [devices, failedDeployments, patches, servers, onNavigate])

  /* --------------------------- recent activity ------------------------ */

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []
    for (const d of deployments) {
      const when = parseDate(d.created_at)
      if (!when || !inRange(when)) continue
      const status = (d.status || '').toLowerCase()
      const tone: TimelineTone = status === 'deployed' ? 'success' : status === 'failed' ? 'critical' : 'info'
      items.push({
        id: `dep-${d.id}`,
        time: fmtDateTime(when),
        title: `Deployment ${d.name || d.title || 'Untitled'} — ${status || '—'}`,
        tone,
      })
    }
    for (const dev of devices) {
      const when = parseDate(dev.attributes?.collected)
      if (!when || !inRange(when)) continue
      items.push({
        id: `enroll-${dev.id}`,
        time: fmtDateTime(when),
        title: `${dev.hostname || dev.device_id} enrolled`,
        detail: dev.agent_version ? `Agent ${dev.agent_version}` : undefined,
        tone: 'success',
      })
    }
    for (const p of patches) {
      const when = parseDate(p.created_at)
      if (!when || !inRange(when)) continue
      items.push({
        id: `patch-${p.id}`,
        time: fmtDateTime(when),
        title: `Patch ${p.title || 'Untitled'} — ${p.status || '—'}`,
        detail: p.product || undefined,
        tone: 'info',
      })
    }
    for (const s of servers) {
      const when = parseDate(s.created_at)
      if (!when || !inRange(when)) continue
      items.push({
        id: `server-${s.id}`,
        time: fmtDateTime(when),
        title: `Server ${s.hostname || s.title || 'Unnamed'} added`,
        detail: s.os || undefined,
        tone: 'neutral',
      })
    }
    return items
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 15)
  }, [deployments, devices, patches, servers, inRange])

  /* --------------------------- sample data ---------------------------- */

  // Devices are deliberately excluded: DeviceOut does not expose
  // is_demo, so a device row can never truthfully say it is sample
  // data. Patches, deployments and servers serialize every column.
  const hasSampleData =
    patches.some((p) => p.is_demo === true) ||
    deployments.some((d) => d.is_demo === true) ||
    servers.some((s) => s.is_demo === true)

  const hasAnyRows = devices.length > 0 || patches.length > 0 || deployments.length > 0 || servers.length > 0

  /* --------------------------- CSV report ----------------------------- */

  const downloadReport = () => {
    const rows: [string, string | number][] = [
      ['IT Operations report', `generated ${new Date().toISOString()}`],
      ['Date range', range],
      ['Total endpoints', totalEndpoints],
      ['Online endpoints', health.online],
      ['Endpoints needing attention', health.attention],
      ['Offline endpoints', health.offline],
      ['Degraded endpoints', health.degraded],
      ['Patch compliance %', compliancePct === null ? 'n/a (no patches to measure)' : compliancePct],
      ['Patches deployed', patchCounts.deployed],
      ['Patches available', patchCounts.available],
      ['Patches testing', patchCounts.testing],
      ['Patches approved', patchCounts.approved],
      ['Patches declined (excluded from compliance)', patchCounts.declined],
      ['Pending patches', pendingPatches],
      ['Deployments deployed', deploymentCounts.deployed],
      ['Deployments failed', deploymentCounts.failed],
      ['Servers', servers.length],
      ['Servers degraded', servers.filter((s) => (s.health_status || '').toLowerCase() === 'degraded').length],
      ['Servers down', servers.filter((s) => (s.health_status || '').toLowerCase() === 'down').length],
      ['Attention items', attentionItems.length],
    ]
    for (const { label, value } of osDistribution) rows.push([`OS — ${label}`, value])
    const csv = rows.map(([a, b]) => `"${String(a).replace(/"/g, '""')}","${String(b).replace(/"/g, '""')}"`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `null-itops-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <p className="text-sm text-null-muted dark:text-[#8AA0B8]">Loading IT Operations…</p>
  }

  if (error) {
    return (
      <EmptyState
        icon="alert-triangle"
        title="Could not load IT Operations data"
        description={error}
        action={
          <button type="button" onClick={load} className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark">
            Retry
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-null-ink dark:text-white">IT Operations</h2>
            {hasSampleData && (
              <span className="rounded-full bg-null-tealSoft px-2 py-0.5 text-xs font-medium text-null-tealDark" title="One or more rows in this dashboard are flagged is_demo by the backend">
                Sample data
              </span>
            )}
          </div>
          <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
            Demo Organization
            {lastRefresh && <> · Last refresh {fmtDateTime(lastRefresh)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-null-muted dark:text-[#8AA0B8]">
            Range
            <select
              className="null-input !w-auto px-2 py-1.5 text-xs"
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              aria-label="Date range"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </label>
          <button type="button" onClick={load} className="rounded border border-null-line bg-white px-3 py-1.5 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-white">
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCustomizing((v) => !v)}
            aria-expanded={customizing}
            className="rounded border border-null-line bg-white px-3 py-1.5 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-white"
          >
            Customize
          </button>
          <button type="button" onClick={downloadReport} className="rounded bg-null-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-null-tealDark">
            Create report
          </button>
        </div>
      </div>

      {customizing && (
        <div className="null-card" role="group" aria-label="Choose dashboard sections">
          <p className="mb-2 text-sm font-medium text-null-ink dark:text-white">Sections</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTIONS.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm text-null-ink dark:text-white">
                <input type="checkbox" checked={sections[s.id]} onChange={() => toggleSection(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">Saved in this browser (null_itops_sections).</p>
        </div>
      )}

      {!hasAnyRows && (
        <EmptyState
          icon="server"
          title="No fleet data yet"
          description="Enroll an endpoint agent or add a patch, deployment, or server — the dashboard fills in from live records."
          action={
            <button type="button" onClick={() => onNavigate('devices')} className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark">
              Go to Endpoints
            </button>
          }
        />
      )}

      {hasAnyRows && sections.kpis && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <KpiPanel
            label="Total endpoints"
            value={totalEndpoints}
            sublabel="Enrolled, excluding decommissioned"
            sparkline={enrollmentSeries.some((v) => v > 0) ? enrollmentSeries : undefined}
            onClick={() => onNavigate('devices')}
          />
          <KpiPanel
            label="Online endpoints"
            value={health.online}
            sublabel="Check-in within 1h"
            accent="success"
            onClick={() => onNavigate('devices')}
          />
          <KpiPanel
            label="Offline endpoints"
            value={health.offline}
            sublabel="Enrolled, no check-in for 24h+"
            accent={health.offline > 0 ? 'critical' : 'neutral'}
            onClick={() => onNavigate('devices')}
          />
          <KpiPanel
            label="Patch compliance"
            value={compliancePct === null ? '—' : `${compliancePct}%`}
            sublabel={compliancePct === null ? 'No patches to measure' : 'Deployed ÷ non-declined patches'}
            trend={complianceTrend}
            sparkline={complianceSeries.length > 1 ? complianceSeries.map((p) => p.value) : undefined}
            accent={compliancePct === null ? 'neutral' : compliancePct >= 95 ? 'success' : 'warning'}
            onClick={() => onNavigate('patches')}
          />
          <KpiPanel
            label="Pending patches"
            value={pendingPatches}
            sublabel="Available, testing, approved"
            sparkline={pendingPatchSeries.some((v) => v > 0) ? pendingPatchSeries : undefined}
            accent={pendingPatches > 0 ? 'warning' : 'neutral'}
            onClick={() => onNavigate('patches')}
          />
          <KpiPanel
            label="Failed deployments"
            value={deploymentCounts.failed}
            sublabel="All time"
            sparkline={failedDeploymentSeries.some((v) => v > 0) ? failedDeploymentSeries : undefined}
            accent={deploymentCounts.failed > 0 ? 'critical' : 'neutral'}
            onClick={() => onNavigate('patches', 'deployments')}
          />
        </div>
      )}

      {hasAnyRows && (sections.health || sections.compliance) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {sections.health && (
            <ChartContainer title="Endpoint health" subtitle="Online within 1h · attention 1–24h · offline 24h+ · suspended is degraded">
              {totalEndpoints === 0 ? (
                <EmptyState icon="server" title="No endpoints enrolled" description="Enroll an endpoint agent to see fleet health." />
              ) : (
                <DonutChart
                  centerLabel={String(totalEndpoints)}
                  segments={[
                    { value: health.online, color: NULL_COLORS.success, label: 'Online' },
                    { value: health.attention, color: NULL_COLORS.warning, label: 'Attention' },
                    { value: health.offline, color: NULL_COLORS.critical, label: 'Offline' },
                    { value: health.degraded, color: NULL_COLORS.info, label: 'Degraded' },
                  ]}
                />
              )}
            </ChartContainer>
          )}
          {sections.compliance && (
            <ChartContainer title="Patch compliance trend" subtitle={`${range === '7d' ? 'Daily' : 'Weekly'} cumulative compliance · dashed line is the 95% target`}>
              {complianceSeries.length < 2 ? (
                <EmptyState
                  icon="check-circle"
                  title="Not enough history for a trend"
                  description="Compliance needs patches created across at least two buckets in the selected range."
                />
              ) : (
                <div className="h-44">
                  <LineChart
                    series={complianceSeries.map((p) => p.value)}
                    labels={complianceSeries.map((p) => p.label)}
                    targetLine={95}
                  />
                </div>
              )}
            </ChartContainer>
          )}
        </div>
      )}

      {hasAnyRows && (sections.os || sections.deployments || sections.enrollment) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {sections.os && (
            <ChartContainer title="OS distribution" subtitle="From device platform — version is not shown (see note in code)">
              {osDistribution.length === 0 ? (
                <EmptyState icon="server" title="No devices" description="No enrolled devices to distribute." />
              ) : (
                <div className="h-44">
                  <BarChart bars={osDistribution.map((d) => ({ label: d.label, value: d.value }))} />
                </div>
              )}
            </ChartContainer>
          )}
          {sections.deployments && (
            <ChartContainer title="Deployment outcomes" subtitle="All deployments, by final status">
              {deployments.length === 0 ? (
                <EmptyState icon="download" title="No deployments" description="No patch deployments recorded yet." />
              ) : (
                <div className="h-44">
                  <BarChart
                    bars={[
                      { label: 'Deployed', value: deploymentCounts.deployed, color: NULL_COLORS.success },
                      { label: 'Failed', value: deploymentCounts.failed, color: NULL_COLORS.critical },
                    ]}
                  />
                </div>
              )}
            </ChartContainer>
          )}
          {sections.enrollment && (
            <ChartContainer title="Enrollment activity" subtitle={`${range === '7d' ? 'Daily' : 'Weekly'} enrollments in range`}>
              {enrollmentSeries.every((v) => v === 0) ? (
                <EmptyState icon="plus" title="No enrollments in range" description="No devices enrolled in the selected range." />
              ) : (
                <div className="h-44">
                  <BarChart bars={buckets.map((b, i) => ({ label: b.label, value: enrollmentSeries[i] }))} />
                </div>
              )}
            </ChartContainer>
          )}
        </div>
      )}

      {hasAnyRows && sections.attention && (
        <section className="null-card" aria-label="Needs attention">
          <h3 className="mb-3 text-sm font-semibold text-null-ink dark:text-white">Needs attention</h3>
          <AttentionQueue items={attentionItems} />
        </section>
      )}

      {hasAnyRows && sections.activity && (
        <section className="null-card" aria-label="Recent activity">
          <h3 className="mb-3 text-sm font-semibold text-null-ink dark:text-white">Recent activity</h3>
          {timelineItems.length === 0 ? (
            <EmptyState icon="clock" title="No activity in range" description="Nothing was enrolled, deployed, or added in the selected range." />
          ) : (
            <ActivityTimeline items={timelineItems} />
          )}
        </section>
      )}
    </div>
  )
}
