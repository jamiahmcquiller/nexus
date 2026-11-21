// NULL — IT Operations home dashboard (refinement, not a rebuild).
//
// Composition: a fleet-health command strip (health donut + patch
// posture) up top, then infrastructure (servers + endpoint groups),
// then the deployment pipeline + operational workload, then the
// needs-attention queue and recent activity. Every number is
// computed client-side from the same live API lists the drill-downs
// open — charts, KPIs and queue rows never disagree about a count.
//
// ── Data formulas (the contract — change these only deliberately) ──
//
// ENDPOINT HEALTH (from GET /api/v1/devices/; DeviceOut DOES carry
// is_demo and created_at — an earlier comment here claimed it did
// not; that was wrong. Enrollment trend still buckets on
// attributes.collected, because the demo seed stamps created_at
// ~30 days before the staggered first-seen dates):
//   online     = enrolled AND last_checkin_at within the last 1h
//                (same enrolled + 1h rule the backend's
//                /devices/stats "online" count uses)
//   attention  = enrolled AND last_checkin_at between 1h and 24h ago
//   offline    = enrolled AND last_checkin_at older than 24h, or never
//   degraded   = enrollment_status "suspended"
//   decommissioned devices are NOT in the fleet and are excluded
//   from the donut, the group breakdowns and the totals entirely.
//   Health is a CHECK-IN measure only: it says nothing about CPU,
//   disk, or patch state. Sample check-ins are a fixed snapshot
//   from seeding — nothing re-checks in — so the online count
//   falls as wall-clock time passes. That is expected, not a bug.
//
// LIVE vs SAMPLE: a device is live when is_demo === false (the
// seed only ever creates device_ids starting with "demo-"; the
// real Mac, darwin-ac913e0958751651, is the only live row). Live
// endpoints get a Live badge and a permanent spotlight row; they
// are never hidden inside a bucket, even when stale — the agent
// reports when it runs, it is not continuously online, so a
// check-in hours old is expected, not a fault.
//
// PATCH COMPLIANCE % (from GET /api/v1/patches/):
//   deployed / (deployed + available + testing + approved)
//   Declined patches are excluded (out of scope). The seed writes
//   no "failed" patches — the Patch model documents only
//   available / testing / approved / declined / deployed — so the
//   patch-status breakdown accounts for every row (including
//   "other" for any status outside the known five), and nothing
//   ever vanishes.
//
// DEPLOYMENT PIPELINE (from GET /api/v1/patch-deployments/):
//   all seven documented statuses (scheduled, testing, approved,
//   deploying, deployed, failed, declined) plus "other" — the
//   stage counts always sum to the deployment total. The previous
//   screen showed only deployed + failed and silently dropped 12
//   of the 30 deployments; that is fixed here.
//
// SERVERS (from GET /api/v1/servers/): all rows listed with role,
// OS and health_status. Health is the LAST RECORDED health_status
// — no live CPU/memory/disk telemetry is collected for servers,
// so this is a recorded state, not a live probe.
//
// MTTR: not shown as a number. Deployment records carry no
// resolved timestamp, so mean time to resolve cannot be measured
// from these records — the workload panel says so instead of
// inventing a value.
//
// TREND BUCKETING: 7d range → daily buckets; 30d / 90d → weekly
// buckets, each labelled by its start date. The compliance trend
// is a cumulative snapshot per bucket: patches with created_at on
// or before the bucket end, run through the compliance formula.
// Buckets with an empty denominator are dropped; fewer than two
// surviving points renders an EmptyState instead of a line.
//
// OS DISTRIBUTION: from device attributes.os.platform (the agent
// enrolls with runtime.GOOS: darwin / windows / linux), mapped to
// display names. attributes.os.name is NEVER displayed — the
// agent's macOS version detection is broken and it reads
// "macOS <nil>". Devices with no platform read as "Unknown".
//
// DRILL-DOWN: every chart segment, bar, queue row, server row and
// group row opens a DetailDrawer with the underlying records.
// Device drill-downs open the shared EndpointDetailDrawer
// (components/EndpointDetailDrawer.tsx) via openDeviceDetail.
// Drawer record lists always offer "Open in <module>" so a
// drill-down never strands the user.
//
// ── Reconciliation against nexus-backend/app/routers/demo.py ──
// (seed-time values; health buckets drift as check-ins age — the
// formulas above always reconcile with whatever rows exist):
//   devices: 60 demo + 1 live Mac = 61. At seed time: online 30,
//     attention 13 (12 demo + the Mac), offline 12, degraded 6.
//   departments 12 × 5 (+ Mac Unassigned); groups 15 × 4 (+ Mac
//     Unassigned); OS Windows 24 / macOS 25 (24 demo + Mac) /
//     Linux 12 — each breakdown sums to 61.
//   patches: deployed 57, approved 18, available 18, testing 9,
//     declined 18, failed 0 = 120. Compliance 57/102 = 56%.
//     Pending (available + testing + approved) = 45.
//   deployments: deployed 12, failed 6, scheduled 3, approved 3,
//     deploying 3, declined 3 = 30.
//   servers: healthy 5, degraded 2, down 1 = 8.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import axios from 'axios'
import {
  ActivityTimeline,
  AttentionQueue,
  ChartContainer,
  DetailDrawer,
  EndpointDetailDrawer,
  EmptyState,
  Sparkline,
  StatusBadge,
  Tabs,
} from '../components'
import type { AttentionItem, TimelineItem, TimelineTone } from '../components'
import { ClickableDonut } from './itops/ClickableDonut'
import { ClickableBarRows } from './itops/ClickableBars'
import type { ClickableBarRow } from './itops/ClickableBars'
import { NULL_COLORS } from '../theme'

type ItOpsHomeProps = {
  api: string
  headers: Record<string, string>
  userRole?: string
  onNavigate: (moduleId: string, subsectionId?: string) => void
}

type DeviceRow = {
  id: string
  hostname?: string | null
  device_id: string
  enrollment_status: string
  agent_version?: string | null
  last_checkin_at?: string | null
  is_demo?: boolean
  created_at?: string | null
  attributes?: Record<string, any> | null
}

type PatchRow = {
  id: string
  title?: string | null
  kb_id?: string | null
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
  scope?: string | null
  schedule?: string | null
  test_result?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type ServerRow = {
  id: string
  hostname?: string | null
  title?: string | null
  os?: string | null
  role?: string | null
  health_status?: string | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

type RangeKey = '7d' | '30d' | '90d'

const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '30d': 30, '90d': 90 }

const SECTIONS = [
  { id: 'fleet', label: 'Fleet health' },
  { id: 'patch', label: 'Patch posture' },
  { id: 'servers', label: 'Servers' },
  { id: 'groups', label: 'Endpoint groups' },
  { id: 'pipeline', label: 'Deployment pipeline' },
  { id: 'workload', label: 'Operational workload' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'activity', label: 'Recent activity' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const SECTIONS_STORAGE_KEY = 'null_itops_sections_v2'

const STALE_MS = 24 * 60 * 60 * 1000 // 24h — offline threshold
const ONLINE_MS = 60 * 60 * 1000 // 1h — online threshold, matches backend device_stats

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  // Backend datetimes are naive UTC (no zone designator). Treat them
  // as UTC so toLocaleString() renders them in the viewer's local
  // timezone instead of misreading them as already-local.
  const v = value.includes('T') && !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? `${value}Z` : value
  const d = new Date(v)
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

/** A device is live when the backend says it is not demo data. The
 * device_id prefix is a fallback for rows where is_demo is absent. */
function isLiveDevice(d: DeviceRow): boolean {
  if (typeof d.is_demo === 'boolean') return !d.is_demo
  return !String(d.device_id || '').startsWith('demo-')
}

type HealthBucket = 'online' | 'attention' | 'offline' | 'degraded'

function healthOf(dev: DeviceRow, now: number): HealthBucket | null {
  const status = (dev.enrollment_status || '').toLowerCase()
  if (status === 'suspended') return 'degraded'
  if (status === 'decommissioned') return null // not in the fleet
  if (status !== 'enrolled') return null
  const last = parseDate(dev.last_checkin_at)
  if (!last) return 'offline'
  const age = now - last.getTime()
  if (age <= ONLINE_MS) return 'online'
  if (age <= STALE_MS) return 'attention'
  return 'offline'
}

const HEALTH_LABEL: Record<HealthBucket, string> = {
  online: 'Online',
  attention: 'Attention',
  offline: 'Offline',
  degraded: 'Degraded',
}

const HEALTH_COLOR: Record<HealthBucket, string> = {
  online: NULL_COLORS.success,
  attention: NULL_COLORS.warning,
  offline: NULL_COLORS.critical,
  degraded: NULL_COLORS.info,
}

function attrString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : 'Unassigned'
}

function loadSections(): Record<SectionId, boolean> {
  const all = Object.fromEntries(SECTIONS.map((s) => [s.id, true])) as Record<SectionId, boolean>
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

export function ItOpsHome({ api, headers, onNavigate, userRole }: ItOpsHomeProps) {
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
  const [groupTab, setGroupTab] = useState<'departments' | 'groups' | 'os'>('departments')
  const [drawer, setDrawer] = useState<{ title: string; body: ReactNode } | null>(null)
  const [detailDevice, setDetailDevice] = useState<DeviceRow | null>(null)

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

  const closeDrawer = () => setDrawer(null)

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

  /* ------------------------- fleet (devices) -------------------------- */

  // The fleet excludes decommissioned devices everywhere on this
  // screen, so the donut, the group breakdowns and the totals all
  // reconcile to the same number.
  const fleetDevices = useMemo(
    () => devices.filter((d) => (d.enrollment_status || '').toLowerCase() !== 'decommissioned'),
    [devices],
  )

  const totalEndpoints = fleetDevices.length

  const healthBuckets = useMemo(() => {
    const now = Date.now()
    const out: Record<HealthBucket, DeviceRow[]> = { online: [], attention: [], offline: [], degraded: [] }
    for (const dev of fleetDevices) {
      const bucket = healthOf(dev, now)
      if (bucket) out[bucket].push(dev)
    }
    return out
  }, [fleetDevices])

  const health = {
    online: healthBuckets.online.length,
    attention: healthBuckets.attention.length,
    offline: healthBuckets.offline.length,
    degraded: healthBuckets.degraded.length,
  }

  const liveDevices = useMemo(() => fleetDevices.filter(isLiveDevice), [fleetDevices])

  const countSeries = useCallback(
    (dates: (Date | null)[]) => {
      // Counts of events per bucket (events dated by `dates`, in range).
      return buckets.map((b) => dates.filter((d) => d && d >= b.start && d < b.end).length)
    },
    [buckets],
  )

  const enrollmentSeries = useMemo(() => {
    const dates = fleetDevices.map((d) => parseDate(d.attributes?.collected))
    return countSeries(dates)
  }, [fleetDevices, countSeries])

  /* ----------------------------- patches ------------------------------ */

  const PATCH_STATUSES = ['deployed', 'available', 'testing', 'approved', 'declined', 'failed'] as const

  const patchCounts = useMemo(() => {
    const counts: Record<string, number> = { deployed: 0, available: 0, testing: 0, approved: 0, declined: 0, failed: 0, other: 0 }
    for (const p of patches) {
      const s = (p.status || '').toLowerCase()
      if (s in counts) counts[s]++
      else counts.other++
    }
    return counts
  }, [patches])

  // Patch compliance = deployed / (deployed + available + testing +
  // approved); declined and failed excluded (see file header). Null
  // when the denominator is zero — no patches to measure, not "0%".
  const compliancePct = useMemo(() => {
    const denom = patchCounts.deployed + patchCounts.available + patchCounts.testing + patchCounts.approved
    return denom === 0 ? null : Math.round((patchCounts.deployed / denom) * 100)
  }, [patchCounts])

  const complianceDenom =
    patchCounts.deployed + patchCounts.available + patchCounts.testing + patchCounts.approved

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

  const DEPLOYMENT_STATUSES = ['scheduled', 'testing', 'approved', 'deploying', 'deployed', 'failed', 'declined'] as const

  const deploymentCounts = useMemo(() => {
    const counts: Record<string, number> = {
      scheduled: 0, testing: 0, approved: 0, deploying: 0, deployed: 0, failed: 0, declined: 0, other: 0,
    }
    for (const d of deployments) {
      const s = (d.status || '').toLowerCase()
      if (s in counts) counts[s]++
      else counts.other++
    }
    return counts
  }, [deployments])

  const failedDeployments = deployments.filter((d) => (d.status || '').toLowerCase() === 'failed')

  /* ------------------------------ servers ----------------------------- */

  const serverCounts = useMemo(() => {
    const counts: Record<string, number> = { healthy: 0, degraded: 0, down: 0, other: 0 }
    for (const s of servers) {
      const h = (s.health_status || '').toLowerCase()
      if (h in counts) counts[h]++
      else counts.other++
    }
    return counts
  }, [servers])

  /* ------------------------- group breakdowns ------------------------- */

  type GroupSlice = { label: string; rows: DeviceRow[]; online: number; stale: number; suspended: number }

  const groupBreakdowns = useMemo(() => {
    const onlineIds = new Set(healthBuckets.online.map((d) => d.id))
    const degradedIds = new Set(healthBuckets.degraded.map((d) => d.id))
    const build = (pick: (d: DeviceRow) => string): GroupSlice[] => {
      const map = new Map<string, DeviceRow[]>()
      for (const d of fleetDevices) {
        const key = pick(d)
        const arr = map.get(key)
        if (arr) arr.push(d)
        else map.set(key, [d])
      }
      return [...map.entries()]
        .map(([label, rows]) => ({
          label,
          rows,
          online: rows.filter((d) => onlineIds.has(d.id)).length,
          suspended: rows.filter((d) => degradedIds.has(d.id)).length,
          stale: rows.filter((d) => !onlineIds.has(d.id) && !degradedIds.has(d.id)).length,
        }))
        .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label))
    }
    return {
      departments: build((d) => attrString(d.attributes?.department)),
      groups: build((d) => attrString(d.attributes?.device_group)),
      os: build((d) => osDisplayName(d.attributes?.os?.platform)),
    }
  }, [fleetDevices, healthBuckets])

  const activeGroups = groupBreakdowns[groupTab]

  const groupRows: ClickableBarRow[] = activeGroups.map((g) => {
    const parts = [`${g.online} online`, `${g.stale} stale or offline`]
    if (g.suspended > 0) parts.push(`${g.suspended} suspended`)
    return {
      label: g.label,
      value: g.rows.length,
      detail: parts.join(' · '),
      onSelect: () => openDeviceList(`${g.label} — ${g.rows.length} endpoints`, g.rows),
    }
  })

  /* --------------------------- drill-downs ---------------------------- */

  const liveBadge = (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E7F3EE] px-2 py-0.5 text-[11px] font-semibold text-null-success"
      title="Live endpoint — enrolled by the real agent, not sample data."
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-null-success" aria-hidden />
      Live
    </span>
  )

  const sampleBadge = (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-null-tealSoft px-2 py-0.5 text-[11px] font-medium text-null-tealDark"
      title="Sample data — demonstration record, not live telemetry."
    >
      Sample
    </span>
  )

  const lastCheckinText = (d: DeviceRow): string => {
    const last = parseDate(d.last_checkin_at)
    return last ? `${timeAgo(last)} (${fmtDateTime(last)})` : 'never checked in'
  }

  const deviceHealthText = (d: DeviceRow): string => {
    const bucket = healthOf(d, Date.now())
    return bucket ? HEALTH_LABEL[bucket] : (d.enrollment_status || '—')
  }

  const openDeviceList = (title: string, rows: DeviceRow[]) => {
    setDrawer({
      title,
      body:
        rows.length === 0 ? (
          <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No endpoints in this group.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openDeviceDetail(d)}
                  className="flex w-full items-center gap-3 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                      {d.hostname || d.device_id}
                    </span>
                    <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                      {deviceHealthText(d)} · last check-in {lastCheckinText(d)}
                    </span>
                  </span>
                  {isLiveDevice(d) ? liveBadge : sampleBadge}
                </button>
              </li>
            ))}
          </ul>
        ),
    })
  }

  const openDeviceDetail = (d: DeviceRow) => {
    // Device drill-downs open the shared endpoint detail view:
    // live connectivity, hardware/OS, applications from the latest
    // inventory snapshot, linked vulns/patches, command history +
    // execution, and WoL.
    setDetailDevice(d)
  }

  const openPatchList = (title: string, rows: PatchRow[]) => {
    setDrawer({
      title,
      body:
        rows.length === 0 ? (
          <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No patches in this group.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => openPatchDetail(p)}
                  className="flex w-full items-center gap-3 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                      {p.title || 'Untitled patch'}
                    </span>
                    <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                      {[p.product, p.severity].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <StatusBadge value={p.status} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ),
    })
  }

  const openPatchDetail = (p: PatchRow) => {
    const created = parseDate(p.created_at)
    setDrawer({
      title: p.title || 'Untitled patch',
      body: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {p.is_demo ? sampleBadge : null}
            <StatusBadge value={p.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Product</dt>
              <dd>{p.product || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Severity</dt>
              <dd>{p.severity || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">KB / reference</dt>
              <dd className="font-mono text-xs">{p.kb_id || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Recorded</dt>
              <dd>{created ? fmtDateTime(created) : '—'}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              closeDrawer()
              onNavigate('patches')
            }}
            className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark"
          >
            Open in Patches
          </button>
        </div>
      ),
    })
  }

  const openDeploymentList = (title: string, rows: DeploymentRow[]) => {
    setDrawer({
      title,
      body:
        rows.length === 0 ? (
          <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No deployments in this group.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openDeploymentDetail(d)}
                  className="flex w-full items-center gap-3 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                      {d.name || d.title || 'Untitled deployment'}
                    </span>
                    <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                      {[d.scope, d.schedule].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <StatusBadge value={d.status} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ),
    })
  }

  const openDeploymentDetail = (d: DeploymentRow) => {
    const created = parseDate(d.created_at)
    setDrawer({
      title: d.name || d.title || 'Untitled deployment',
      body: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {d.is_demo ? sampleBadge : null}
            <StatusBadge value={d.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Scope</dt>
              <dd>{d.scope || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Schedule</dt>
              <dd>{d.schedule || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Test result</dt>
              <dd>{d.test_result || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Recorded</dt>
              <dd>{created ? fmtDateTime(created) : '—'}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              closeDrawer()
              onNavigate('patches', 'deployments')
            }}
            className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark"
          >
            Open in Deployments
          </button>
        </div>
      ),
    })
  }

  const openServerList = (title: string, rows: ServerRow[]) => {
    setDrawer({
      title,
      body:
        rows.length === 0 ? (
          <p className="text-sm text-null-muted dark:text-[#8AA0B8]">No servers in this group.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openServerDetail(s)}
                  className="flex w-full items-center gap-3 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                      {s.hostname || s.title || 'Unnamed server'}
                    </span>
                    <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                      {[s.role, s.os].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <StatusBadge value={s.health_status} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ),
    })
  }

  const openServerDetail = (s: ServerRow) => {
    const created = parseDate(s.created_at)
    setDrawer({
      title: s.hostname || s.title || 'Unnamed server',
      body: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {s.is_demo ? sampleBadge : null}
            <StatusBadge value={s.health_status} />
            <StatusBadge value={s.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Role</dt>
              <dd>{s.role || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Operating system</dt>
              <dd>{s.os || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-null-muted dark:text-[#8AA0B8]">Added</dt>
              <dd>{created ? fmtDateTime(created) : '—'}</dd>
            </div>
          </dl>
          <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
            Health is the last recorded health_status. No live CPU, memory, or disk telemetry is collected
            for servers, so this is a recorded state, not a live probe.
          </p>
          <button
            type="button"
            onClick={() => {
              closeDrawer()
              onNavigate('servers')
            }}
            className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark"
          >
            Open in Servers
          </button>
        </div>
      ),
    })
  }

  /* --------------------------- attention queue ------------------------ */

  const attentionItems = useMemo<AttentionItem[]>(() => {
    // Ranked BEFORE slicing: severity first (critical → high →
    // medium), then most recent first. Slicing the push order
    // instead hid whole categories — the 12 stale demo devices
    // filled all 12 slots, so failed deployments, testing patches
    // and degraded/down servers never appeared.
    const rankOf = (s: string) => (s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3)
    const entries: { rank: number; ts: number; item: AttentionItem }[] = []
    const now = Date.now()
    for (const dev of fleetDevices) {
      if ((dev.enrollment_status || '').toLowerCase() !== 'enrolled') continue
      const last = parseDate(dev.last_checkin_at)
      const ageMs = last ? now - last.getTime() : Infinity
      if (ageMs <= STALE_MS) continue
      const staleDays = Number.isFinite(ageMs) ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : null
      const severity: 'critical' | 'high' = !last || (staleDays !== null && staleDays >= 7) ? 'critical' : 'high'
      entries.push({
        rank: rankOf(severity),
        ts: last ? last.getTime() : 0,
        item: {
          id: `stale-${dev.id}`,
          severity,
          title: `${dev.hostname || dev.device_id} — stale check-in`,
          asset: dev.device_id,
          status: last ? `last check-in ${timeAgo(last)}` : 'never checked in',
          time: last ? fmtDateTime(last) : undefined,
          actionLabel: 'View',
          onAction: () => openDeviceDetail(dev),
        },
      })
    }
    for (const d of failedDeployments) {
      const when = parseDate(d.created_at)
      entries.push({
        rank: 0,
        ts: when ? when.getTime() : 0,
        item: {
          id: `failed-dep-${d.id}`,
          severity: 'critical',
          title: `Failed deployment: ${d.name || d.title || 'Untitled'}`,
          status: d.status || 'failed',
          time: when ? fmtDateTime(when) : undefined,
          actionLabel: 'Review',
          onAction: () => openDeploymentDetail(d),
        },
      })
    }
    for (const p of patches) {
      if ((p.status || '').toLowerCase() === 'testing') {
        const when = parseDate(p.created_at)
        entries.push({
          rank: 2,
          ts: when ? when.getTime() : 0,
          item: {
            id: `awaiting-${p.id}`,
            severity: 'medium',
            title: `Patch awaiting approval: ${p.title || 'Untitled patch'}`,
            asset: p.product || undefined,
            status: 'testing',
            time: when ? fmtDateTime(when) : undefined,
            actionLabel: 'Review',
            onAction: () => openPatchDetail(p),
          },
        })
      }
    }
    for (const s of servers) {
      const hs = (s.health_status || '').toLowerCase()
      if (hs === 'degraded' || hs === 'down') {
        const when = parseDate(s.created_at)
        entries.push({
          rank: hs === 'down' ? 0 : 1,
          ts: when ? when.getTime() : 0,
          item: {
            id: `server-${s.id}`,
            severity: hs === 'down' ? 'critical' : 'high',
            title: `Server ${hs}: ${s.hostname || s.title || 'Unnamed server'}`,
            asset: s.os || undefined,
            status: s.health_status || '',
            actionLabel: 'View',
            onAction: () => openServerDetail(s),
          },
        })
      }
    }
    entries.sort((a, b) => a.rank - b.rank || b.ts - a.ts)
    return entries.slice(0, 12).map((e) => e.item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetDevices, failedDeployments, patches, servers])

  /* --------------------------- recent activity ------------------------ */

  const timelineItems = useMemo<TimelineItem[]>(() => {
    // Sorted by the numeric timestamp, not the formatted string:
    // sorting fmtDateTime() output parses back to NaN outside
    // en-US locales and silently mis-orders the timeline.
    const entries: { when: Date; item: TimelineItem }[] = []
    for (const d of deployments) {
      const when = parseDate(d.created_at)
      if (!when || !inRange(when)) continue
      const status = (d.status || '').toLowerCase()
      const tone: TimelineTone = status === 'deployed' ? 'success' : status === 'failed' ? 'critical' : 'info'
      entries.push({
        when,
        item: {
          id: `dep-${d.id}`,
          time: fmtDateTime(when),
          title: `Deployment ${d.name || d.title || 'Untitled'} — ${status || '—'}`,
          tone,
        },
      })
    }
    for (const dev of fleetDevices) {
      const when = parseDate(dev.attributes?.collected)
      if (!when || !inRange(when)) continue
      entries.push({
        when,
        item: {
          id: `enroll-${dev.id}`,
          time: fmtDateTime(when),
          title: `${dev.hostname || dev.device_id} enrolled`,
          detail: dev.agent_version ? `Agent ${dev.agent_version}` : undefined,
          tone: 'success',
        },
      })
    }
    for (const p of patches) {
      const when = parseDate(p.created_at)
      if (!when || !inRange(when)) continue
      entries.push({
        when,
        item: {
          id: `patch-${p.id}`,
          time: fmtDateTime(when),
          title: `Patch ${p.title || 'Untitled'} — ${p.status || '—'}`,
          detail: p.product || undefined,
          tone: 'info',
        },
      })
    }
    for (const s of servers) {
      const when = parseDate(s.created_at)
      if (!when || !inRange(when)) continue
      entries.push({
        when,
        item: {
          id: `server-${s.id}`,
          time: fmtDateTime(when),
          title: `Server ${s.hostname || s.title || 'Unnamed'} added`,
          detail: s.os || undefined,
          tone: 'neutral',
        },
      })
    }
    return entries
      .sort((a, b) => b.when.getTime() - a.when.getTime())
      .slice(0, 15)
      .map((e) => e.item)
  }, [deployments, fleetDevices, patches, servers, inRange])

  /* --------------------------- sample data ---------------------------- */

  // Devices CAN contribute now: DeviceOut exposes is_demo (the old
  // comment claiming otherwise was wrong — verified against
  // nexus-backend/app/routers/devices.py, response_model=list[DeviceOut]).
  const hasSampleData =
    devices.some((d) => d.is_demo === true) ||
    patches.some((p) => p.is_demo === true) ||
    deployments.some((d) => d.is_demo === true) ||
    servers.some((s) => s.is_demo === true)

  const hasAnyRows = devices.length > 0 || patches.length > 0 || deployments.length > 0 || servers.length > 0

  /* --------------------------- derived panels ------------------------- */

  const patchBarRows: ClickableBarRow[] = [
    { label: 'Deployed', value: patchCounts.deployed, color: NULL_COLORS.success, onSelect: () => openPatchList('Deployed patches', patches.filter((p) => (p.status || '').toLowerCase() === 'deployed')) },
    { label: 'Approved', value: patchCounts.approved, color: NULL_COLORS.teal, onSelect: () => openPatchList('Approved patches', patches.filter((p) => (p.status || '').toLowerCase() === 'approved')) },
    { label: 'Available', value: patchCounts.available, color: NULL_COLORS.info, onSelect: () => openPatchList('Available patches', patches.filter((p) => (p.status || '').toLowerCase() === 'available')) },
    { label: 'Testing', value: patchCounts.testing, color: NULL_COLORS.info, onSelect: () => openPatchList('Patches in testing', patches.filter((p) => (p.status || '').toLowerCase() === 'testing')) },
    { label: 'Declined', value: patchCounts.declined, color: NULL_COLORS.muted, onSelect: () => openPatchList('Declined patches', patches.filter((p) => (p.status || '').toLowerCase() === 'declined')) },
    { label: 'Failed', value: patchCounts.failed, color: NULL_COLORS.critical, onSelect: () => openPatchList('Failed patches', patches.filter((p) => (p.status || '').toLowerCase() === 'failed')) },
    ...(patchCounts.other > 0
      ? [{ label: 'Other', value: patchCounts.other, color: NULL_COLORS.muted, onSelect: () => openPatchList('Patches with other statuses', patches.filter((p) => !PATCH_STATUSES.includes((p.status || '').toLowerCase() as (typeof PATCH_STATUSES)[number]))) } as ClickableBarRow]
      : []),
  ]

  const inFlightDeployments = deploymentCounts.scheduled + deploymentCounts.approved + deploymentCounts.deploying

  const pipelineRows: ClickableBarRow[] = [
    { label: 'Scheduled', value: deploymentCounts.scheduled, color: NULL_COLORS.info, onSelect: () => openDeploymentList('Scheduled deployments', deployments.filter((d) => (d.status || '').toLowerCase() === 'scheduled')) },
    { label: 'Approved', value: deploymentCounts.approved, color: NULL_COLORS.teal, onSelect: () => openDeploymentList('Approved deployments', deployments.filter((d) => (d.status || '').toLowerCase() === 'approved')) },
    { label: 'Deploying', value: deploymentCounts.deploying, color: NULL_COLORS.info, onSelect: () => openDeploymentList('Deployments in progress', deployments.filter((d) => (d.status || '').toLowerCase() === 'deploying')) },
    { label: 'Deployed', value: deploymentCounts.deployed, color: NULL_COLORS.success, onSelect: () => openDeploymentList('Deployed deployments', deployments.filter((d) => (d.status || '').toLowerCase() === 'deployed')) },
    { label: 'Failed', value: deploymentCounts.failed, color: NULL_COLORS.critical, onSelect: () => openDeploymentList('Failed deployments', failedDeployments) },
    { label: 'Declined', value: deploymentCounts.declined, color: NULL_COLORS.muted, onSelect: () => openDeploymentList('Declined deployments', deployments.filter((d) => (d.status || '').toLowerCase() === 'declined')) },
    ...(deploymentCounts.testing > 0
      ? [{ label: 'Testing', value: deploymentCounts.testing, color: NULL_COLORS.info, onSelect: () => openDeploymentList('Deployments in testing', deployments.filter((d) => (d.status || '').toLowerCase() === 'testing')) } as ClickableBarRow]
      : []),
    ...(deploymentCounts.other > 0
      ? [{ label: 'Other', value: deploymentCounts.other, color: NULL_COLORS.muted, onSelect: () => openDeploymentList('Deployments with other statuses', deployments.filter((d) => !DEPLOYMENT_STATUSES.includes((d.status || '').toLowerCase() as (typeof DEPLOYMENT_STATUSES)[number]))) } as ClickableBarRow]
      : []),
  ]

  const workloadRows: ClickableBarRow[] = [
    {
      label: 'Pending patches',
      value: pendingPatches,
      color: NULL_COLORS.warning,
      detail: `${patchCounts.available} available · ${patchCounts.testing} testing · ${patchCounts.approved} approved`,
      onSelect: () =>
        openPatchList(
          'Pending patches',
          patches.filter((p) => ['available', 'testing', 'approved'].includes((p.status || '').toLowerCase())),
        ),
    },
    {
      label: 'Endpoints offline',
      value: health.offline,
      color: NULL_COLORS.critical,
      detail: 'no check-in for 24h+',
      onSelect: () => openDeviceList('Offline endpoints', healthBuckets.offline),
    },
    {
      label: 'Failed deployments',
      value: deploymentCounts.failed,
      color: NULL_COLORS.critical,
      detail: 'need retry or review',
      onSelect: () => openDeploymentList('Failed deployments', failedDeployments),
    },
    {
      label: 'Patches awaiting approval',
      value: patchCounts.testing,
      color: NULL_COLORS.info,
      detail: 'in testing',
      onSelect: () => openPatchList('Patches in testing', patches.filter((p) => (p.status || '').toLowerCase() === 'testing')),
    },
    {
      label: 'Suspended endpoints',
      value: health.degraded,
      color: NULL_COLORS.info,
      detail: 'enrollment suspended',
      onSelect: () => openDeviceList('Suspended endpoints', healthBuckets.degraded),
    },
    {
      label: 'Degraded servers',
      value: serverCounts.degraded,
      color: NULL_COLORS.warning,
      detail: 'recorded health degraded',
      onSelect: () => openServerList('Degraded servers', servers.filter((s) => (s.health_status || '').toLowerCase() === 'degraded')),
    },
    {
      label: 'Failed patches',
      value: patchCounts.failed,
      color: NULL_COLORS.critical,
      detail: 'need retry or review',
      onSelect: () => openPatchList('Failed patches', patches.filter((p) => (p.status || '').toLowerCase() === 'failed')),
    },
  ]

  /* --------------------------- CSV report ----------------------------- */

  const downloadReport = () => {
    const rows: [string, string | number][] = [
      ['IT Operations report', `generated ${new Date().toISOString()}`],
      ['Date range', range],
      ['Total endpoints (fleet, excl. decommissioned)', totalEndpoints],
      ['Live endpoints', liveDevices.length],
      ['Online endpoints', health.online],
      ['Endpoints needing attention (1–24h)', health.attention],
      ['Offline endpoints (24h+ or never)', health.offline],
      ['Degraded endpoints (suspended)', health.degraded],
      ['Patch compliance %', compliancePct === null ? 'n/a (no patches to measure)' : compliancePct],
      ['Patches deployed', patchCounts.deployed],
      ['Patches available', patchCounts.available],
      ['Patches testing', patchCounts.testing],
      ['Patches approved', patchCounts.approved],
      ['Patches declined (excluded from compliance)', patchCounts.declined],
      ['Patches failed (excluded from compliance)', patchCounts.failed],
      ['Patches other status', patchCounts.other],
      ['Pending patches', pendingPatches],
      ['Deployments scheduled', deploymentCounts.scheduled],
      ['Deployments testing', deploymentCounts.testing],
      ['Deployments approved', deploymentCounts.approved],
      ['Deployments deploying', deploymentCounts.deploying],
      ['Deployments deployed', deploymentCounts.deployed],
      ['Deployments failed', deploymentCounts.failed],
      ['Deployments declined', deploymentCounts.declined],
      ['Deployments other status', deploymentCounts.other],
      ['Servers', servers.length],
      ['Servers healthy', serverCounts.healthy],
      ['Servers degraded', serverCounts.degraded],
      ['Servers down', serverCounts.down],
      ['Attention items', attentionItems.length],
      ['Mean time to resolve', 'n/a (no resolved timestamps in deployment records)'],
    ]
    for (const g of groupBreakdowns.departments) rows.push([`Department — ${g.label}`, g.rows.length])
    for (const g of groupBreakdowns.groups) rows.push([`Device group — ${g.label}`, g.rows.length])
    for (const g of groupBreakdowns.os) rows.push([`OS — ${g.label}`, g.rows.length])
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
              <span className="rounded-full bg-null-tealSoft px-2 py-0.5 text-xs font-medium text-null-tealDark" title="Sample data — one or more rows in this view are demonstration records, not live data.">
                Sample data
              </span>
            )}
            {liveDevices.length > 0 && (
              <button
                type="button"
                onClick={() => openDeviceList('Live endpoints', liveDevices)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F3EE] px-2 py-0.5 text-xs font-semibold text-null-success hover:bg-[#D8EEE4]"
                title="Endpoints enrolled by the real agent — not sample data. Select to view."
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-null-success" aria-hidden />
                Live · {liveDevices.length}
              </button>
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
          <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">Saved in this browser (null_itops_sections_v2).</p>
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

      {/* Row 1 — command strip: fleet health + patch posture */}
      {hasAnyRows && (sections.fleet || sections.patch) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {sections.fleet && (
            <ChartContainer
              title="Fleet health"
              subtitle="Check-in health across the fleet — select any segment to see its endpoints"
            >
                {totalEndpoints === 0 ? (
                  <EmptyState icon="server" title="No endpoints enrolled" description="Enroll an endpoint agent to see fleet health." />
                ) : (
                  <div className="flex flex-wrap items-start gap-6">
                    <ClickableDonut
                      centerLabel={String(totalEndpoints)}
                      segments={[
                        { value: health.online, color: HEALTH_COLOR.online, label: 'Online', onSelect: () => openDeviceList('Online endpoints', healthBuckets.online) },
                        { value: health.attention, color: HEALTH_COLOR.attention, label: 'Attention', onSelect: () => openDeviceList('Endpoints needing attention', healthBuckets.attention) },
                        { value: health.offline, color: HEALTH_COLOR.offline, label: 'Offline', onSelect: () => openDeviceList('Offline endpoints', healthBuckets.offline) },
                        { value: health.degraded, color: HEALTH_COLOR.degraded, label: 'Degraded', onSelect: () => openDeviceList('Suspended endpoints', healthBuckets.degraded) },
                      ]}
                    />
                    <div className="min-w-52 flex-1 space-y-3">
                      <div>
                        <p className="text-2xl font-bold leading-tight text-null-ink dark:text-white">
                          {totalEndpoints} endpoints
                        </p>
                        <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
                          {health.online} online now · {health.attention + health.offline} need attention
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">
                          Enrollments per {range === '7d' ? 'day' : 'week'} · {range}
                        </p>
                        {enrollmentSeries.some((v) => v > 0) ? (
                          <div className="mt-1 h-8">
                            <Sparkline series={enrollmentSeries} ariaLabel={`Enrollment trend: ${enrollmentSeries.join(', ')}`} />
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-null-muted dark:text-[#8AA0B8]">No enrollments in range.</p>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                        Health is check-in only: online = check-in within 1h, attention = 1–24h, offline =
                        24h+ or never, degraded = suspended. Sample check-ins are a fixed snapshot from
                        seeding — nothing re-checks in — so the online count falls as time passes.
                      </p>
                    </div>
                  </div>
                )}
                {/* Live endpoint spotlight — always visible, never buried in a bucket */}
                <div className="mt-4 border-t border-null-line pt-3 dark:border-white/10">
                  <p className="text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
                    Live endpoint — not sample data
                  </p>
                  {liveDevices.length === 0 ? (
                    <p className="mt-2 text-sm text-null-muted dark:text-[#8AA0B8]">
                      No live endpoints enrolled — every device on this screen is sample data.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {liveDevices.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => openDeviceDetail(d)}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-null-line px-3 py-2 text-left hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                          >
                            {liveBadge}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-null-ink dark:text-white">
                                {d.hostname || d.device_id}
                              </span>
                              <span className="block truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                                {deviceHealthText(d)} · last check-in {lastCheckinText(d)}
                              </span>
                            </span>
                            <span className="text-xs text-null-muted dark:text-[#8AA0B8]">
                              Agent reports when it runs — a stale check-in is expected, not a fault.
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
            </ChartContainer>
          )}
          {sections.patch && (
            <ChartContainer
              title="Patch posture"
              subtitle="Compliance and the full patch inventory — select any bar to see its patches"
            >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-3xl font-bold leading-tight text-null-ink dark:text-white">
                      {compliancePct === null ? '—' : `${compliancePct}%`}
                      <span className="ml-2 text-sm font-medium text-null-muted dark:text-[#8AA0B8]">compliant</span>
                    </p>
                    <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">
                      {compliancePct === null
                        ? 'No patches to measure'
                        : `${patchCounts.deployed} of ${complianceDenom} non-declined patches deployed · target 95%`}
                    </p>
                  </div>
                  {complianceTrend && (
                    <span className={`text-xs font-medium ${complianceTrend.good ? 'text-null-success' : 'text-null-critical'}`}>
                      {complianceTrend.direction === 'up' ? '↑' : complianceTrend.direction === 'down' ? '↓' : '→'}{' '}
                      {complianceTrend.value}
                    </span>
                  )}
                </div>
                {complianceSeries.length > 1 ? (
                  <div className="mt-2 h-10">
                    <Sparkline series={complianceSeries.map((p) => p.value)} color="#17C3B2" ariaLabel={`Compliance trend: ${complianceSeries.map((p) => p.value).join(', ')}`} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                    Not enough history for a compliance trend yet.
                  </p>
                )}
                <div className="mt-4">
                  <ClickableBarRows rows={patchBarRows} max={patches.length || 1} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                  {patches.length} patches accounted for. Compliance = deployed ÷ (deployed + available +
                  testing + approved). Declined patches are out of scope; failed patches are deployment
                  failures, counted on the pipeline panel — not a compliance judgment.
                </p>
            </ChartContainer>
          )}
        </div>
      )}

      {/* Row 2 — infrastructure: servers + endpoint groups */}
      {hasAnyRows && (sections.servers || sections.groups) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {sections.servers && (
            <ChartContainer
              title="Servers"
              subtitle="Every server, with its recorded health — select a row or a count to inspect it"
            >
                <div className="mb-3 flex flex-wrap gap-2">
                  {(
                    [
                      ['healthy', serverCounts.healthy, NULL_COLORS.success],
                      ['degraded', serverCounts.degraded, NULL_COLORS.warning],
                      ['down', serverCounts.down, NULL_COLORS.critical],
                    ] as const
                  ).map(([label, count, color]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        openServerList(
                          `${label[0].toUpperCase()}${label.slice(1)} servers`,
                          servers.filter((s) => (s.health_status || '').toLowerCase() === label),
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-null-line px-2.5 py-1 text-xs font-medium text-null-ink hover:bg-null-cloud dark:border-white/10 dark:text-white dark:hover:bg-null-navy2"
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />
                      {label} · {count}
                    </button>
                  ))}
                  <span className="inline-flex items-center rounded-full bg-null-cloud px-2.5 py-1 text-xs text-null-muted dark:bg-null-navy2 dark:text-[#8AA0B8]">
                    {servers.length} total
                  </span>
                </div>
                {servers.length === 0 ? (
                  <EmptyState icon="server" title="No servers" description="No servers recorded yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-null-line text-left text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
                          <th className="py-2 pr-2 font-semibold">Server</th>
                          <th className="py-2 pr-2 font-semibold">Role</th>
                          <th className="py-2 pr-2 font-semibold">OS</th>
                          <th className="py-2 pr-2 font-semibold">Health</th>
                        </tr>
                      </thead>
                      <tbody>
                        {servers.map((s) => (
                          <tr
                            key={s.id}
                            onClick={() => openServerDetail(s)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                openServerDetail(s)
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`${s.hostname || s.title || 'Unnamed server'} — ${s.health_status || 'unknown health'} — show details`}
                            className="null-table-row cursor-pointer border-b border-null-line last:border-0 hover:bg-null-cloud dark:border-white/10 dark:hover:bg-null-navy2"
                          >
                            <td className="py-2 pr-2 font-medium text-null-ink dark:text-white">
                              {s.hostname || s.title || 'Unnamed'}
                            </td>
                            <td className="py-2 pr-2 text-null-muted dark:text-[#8AA0B8]">{s.role || '—'}</td>
                            <td className="py-2 pr-2 text-null-muted dark:text-[#8AA0B8]">{s.os || '—'}</td>
                            <td className="py-2 pr-2">
                              <StatusBadge value={s.health_status} size="sm" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                  Health is the last recorded health_status. No live CPU, memory, or disk telemetry is
                  collected for servers, so this is a recorded state, not a live probe.
                </p>
            </ChartContainer>
          )}
          {sections.groups && (
            <ChartContainer
              title="Endpoint groups"
              subtitle="Department, device-group and OS performance — select a row to see its endpoints"
            >
                <Tabs
                  items={[
                    { id: 'departments', label: 'Departments' },
                    { id: 'groups', label: 'Device groups' },
                    { id: 'os', label: 'Operating systems' },
                  ]}
                  active={groupTab}
                  onChange={(id) => setGroupTab(id as 'departments' | 'groups' | 'os')}
                />
                <div className="mt-3">
                  {activeGroups.length === 0 ? (
                    <EmptyState icon="users" title="No endpoints" description="No enrolled endpoints to group." />
                  ) : (
                    <ClickableBarRows rows={groupRows} labelWidthClass="w-32" />
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                  Groups come from the attributes the agent or the seed recorded. Counts sum to{' '}
                  {totalEndpoints} endpoints. The live endpoint carries no department or group, so it
                  appears under Unassigned.
                </p>
            </ChartContainer>
          )}
        </div>
      )}

      {/* Row 3 — deployment pipeline + operational workload */}
      {hasAnyRows && (sections.pipeline || sections.workload) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {sections.pipeline && (
            <ChartContainer
              title="Deployment pipeline"
              subtitle="All deployments by stage — every deployment is accounted for"
            >
                {deployments.length === 0 ? (
                  <EmptyState icon="download" title="No deployments" description="No patch deployments recorded yet." />
                ) : (
                  <>
                    <ClickableBarRows rows={pipelineRows} max={deployments.length} />
                    <p className="mt-3 text-sm text-null-ink dark:text-white">
                      {deploymentCounts.deployed} deployed · {deploymentCounts.failed} failed ·{' '}
                      {inFlightDeployments} in flight ({deploymentCounts.scheduled} scheduled,{' '}
                      {deploymentCounts.approved} approved, {deploymentCounts.deploying} deploying) ·{' '}
                      {deploymentCounts.declined} declined
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                      Failed deployments are the retry queue; declined deployments were rejected before
                      rollout. Select any stage to see the deployments in it.
                    </p>
                  </>
                )}
            </ChartContainer>
          )}
          {sections.workload && (
            <ChartContainer
              title="Operational workload"
              subtitle="Open work, grounded in the records on this screen — select a row to work it"
            >
                <ClickableBarRows rows={workloadRows} />
                <div className="mt-3 border-t border-null-line pt-3 dark:border-white/10">
                  <p className="text-xs leading-relaxed text-null-muted dark:text-[#8AA0B8]">
                    <span className="font-semibold text-null-ink dark:text-white">Mean time to resolve: —</span>{' '}
                    Deployment records carry no resolved timestamp, so MTTR cannot be measured from these
                    records.
                  </p>
                </div>
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

      <DetailDrawer open={drawer !== null} onClose={closeDrawer} title={drawer?.title ?? ''}>
        {drawer?.body}
      </DetailDrawer>
      <EndpointDetailDrawer
        open={detailDevice !== null}
        device={detailDevice}
        api={api}
        headers={headers}
        canRunCommands={userRole === 'owner' || userRole === 'admin'}
        userRole={userRole}
        onClose={() => setDetailDevice(null)}
      />
    </div>
  )
}
