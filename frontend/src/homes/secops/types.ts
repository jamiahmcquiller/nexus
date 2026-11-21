// NULL — Security Operations home: shared row types + pure helpers.
//
// These used to live inside SecOpsHome.tsx; they moved here so the
// section components under ./secops can share them without a
// circular import. Nothing here fetches or renders — pure data
// shaping only, so every number on screen derives from the same
// API rows.
//
// ── Field notes (the contract — change only deliberately) ──
//   Vulnerability: severity, cvss_score STRING, status
//     open/mitigated/remediated/accepted, device_id FK, is_demo,
//     detected_at — NO created_at, NO updated_at, NO deadline.
//     attributes may carry owner + remediation guidance on seeded
//     rows; a seed-only due_at also exists in attributes and is
//     NEVER read here — it is synthetic, absent on real rows, and
//     using it would make the screen behave differently on demo
//     vs live data.
//   IncidentResponse: action, status pending/in-progress/complete/
//     failed, is_demo, created_at — NO severity field.
//   MalwareDetection: severity, quarantined bool, status detected/
//     quarantined/remediated/false-positive, mitre_ttp,
//     detection_layer, is_demo, created_at.
//   SensitiveDataFinding: data_type, classification, status
//     open/encrypted/remediated/accepted, is_demo, created_at.
//   SecurityAlert: severity, category, status
//     new/investigating/contained/resolved, created_at —
//     NO is_demo column. The demo seed creates NO alert rows.
//   ComplianceResult: benchmark, score, status
//     compliant/non_compliant, assessed_at — NO is_demo, NO
//     created_at. The demo seed creates NO compliance rows, so
//     policy-violation tracking has no underlying assessments
//     until real ones exist.
//   Policy: name, policy_type, status, definition, is_demo,
//     created_at — a policy DEFINITION; there is no violation
//     record type. definition.sample_violation_count is seed-only
//     synthetic data and is NEVER used as a count.
//   DeviceOut: hostname, device_id, enrollment_status,
//     agent_version, last_checkin_at, attributes, AND is_demo +
//     created_at (DeviceOut serializes both — an older comment in
//     SecOpsHome claimed otherwise; the router is the source of
//     truth). attributes.department / attributes.os exist only on
//     demo-seeded rows; real agent devices do not carry them.

export type RangeKey = '7d' | '30d' | '90d'
export const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '30d': 30, '90d': 90 }
export const DAY_MS = 24 * 60 * 60 * 1000

export type VulnRow = {
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

export type IncidentRow = {
  id: string
  device_id?: string | null
  title?: string | null
  action?: string | null
  status?: string | null
  performed_by?: string | null
  is_demo?: boolean
  created_at?: string | null
}

export type MalwareRow = {
  id: string
  device_id?: string | null
  title?: string | null
  name?: string | null
  detection_layer?: string | null
  mitre_ttp?: string | null
  severity?: string | null
  quarantined?: boolean | null
  status?: string | null
  is_demo?: boolean
  created_at?: string | null
}

export type DlpRow = {
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

export type AlertRow = {
  id: string
  device_id?: string | null
  title?: string | null
  severity?: string | null
  category?: string | null
  status?: string | null
  created_at?: string | null
}

export type ComplianceRow = {
  id: string
  device_id?: string | null
  benchmark?: string | null
  score?: string | null
  status?: string | null
  assessed_at?: string | null
}

export type PolicyRow = {
  id: string
  name?: string | null
  policy_type?: string | null
  status?: string | null
  definition?: Record<string, unknown> | null
  is_demo?: boolean
  created_at?: string | null
}

export type DeviceRow = {
  id: string
  hostname?: string | null
  device_id?: string | null
  enrollment_status?: string | null
  agent_version?: string | null
  last_checkin_at?: string | null
  is_demo?: boolean
  created_at?: string | null
  attributes?: Record<string, unknown> | null
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function normStatus(status: string | null | undefined): string {
  return (status || '').trim().toLowerCase()
}

export function cvssOf(row: { cvss_score?: string | number | null }): number | null {
  const raw = row.cvss_score
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function severityOf(row: { severity?: string | null; cvss_score?: string | number | null }): Severity {
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

/** 0 = most severe. Unknown sorts last. */
export function severityRank(s: Severity): number {
  switch (s) {
    case 'critical':
      return 0
    case 'high':
      return 1
    case 'medium':
      return 2
    case 'low':
      return 3
    default:
      return 4
  }
}

export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null
  // Backend datetimes are naive UTC (no zone designator). Treat them
  // as UTC so toLocaleString() renders them in the viewer's local
  // timezone instead of misreading them as already-local.
  const v = value.includes('T') && !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? `${value}Z` : value
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export function timeOf(row: {
  detected_at?: string | null
  created_at?: string | null
  assessed_at?: string | null
}): number | null {
  return parseDate(row.detected_at) ?? parseDate(row.created_at) ?? parseDate(row.assessed_at)
}

/** Whole days between `t` and `now` (0 = today). Null when undated. */
export function ageDays(t: number | null, now: number): number | null {
  if (t === null) return null
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtDay(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "3d ago" / "today" for a timestamp, or "—" when undated. */
export function fmtAge(t: number | null, now: number): string {
  const d = ageDays(t, now)
  if (d === null) return '—'
  if (d === 0) return 'today'
  return `${d}d ago`
}

export function departmentOf(device: DeviceRow | undefined): string | null {
  if (!device || !device.attributes) return null
  const dept = device.attributes.department
  return typeof dept === 'string' && dept.trim() !== '' ? dept.trim() : null
}

/** OS label for a device. Follows the IT Ops convention: an object
 *  attributes.os reads .platform (darwin/windows/linux); a string
 *  attributes.os is shown as-is — except a broken "macOS <nil>"
 *  version string is never displayed (trimmed to "macOS"). */
export function osLabelOf(device: DeviceRow | undefined): string | null {
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

/** A device is sample data when the API flags it is_demo. Anything
 *  else — including the real enrolled agent endpoint — is live.
 *  (DeviceOut serializes is_demo; demo rows are true, the real
 *  Mac is false.) */
export function isSampleDevice(device: DeviceRow | undefined): boolean {
  return device?.is_demo === true
}

export function deviceLabel(device: DeviceRow | undefined): string {
  if (!device) return ''
  return device.hostname || device.device_id || ''
}
