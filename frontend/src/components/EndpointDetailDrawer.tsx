// NULL design system — endpoint detail drawer.
// One device, drilled down from the Endpoints module (and importable by
// the dashboard homes for device drill-downs):
//   <EndpointDetailDrawer open device={record} api={API} headers={headers}
//     canRunCommands={isOwnerOrAdmin} onClose={...} />
//
// Built against Miah's real Mac first (device_id
// darwin-ac913e0958751651, hostname Jamiahs-MacBook-Air-2.local):
// its 78-item inventory snapshot (collected 2026-11-21T15:54:55 UTC),
// Apple M5 / 10 cores / 16 GB RAM, macOS 26.6.2 (build 25G83), and
// its honest gap — 4 disk entries for one SSD. Where the agent
// reports nothing, this view says so; it never invents a value.
//
// Endpoints used (all existing — no backend changes):
//   GET  /api/v1/devices/                              (deviceId fallback)
//   GET  /api/v1/devices/{device_id}/inventory/latest  (device_id string)
//   GET  /api/v1/vulnerabilities/        (no device filter — filtered
//        client-side on vulnerability.device_id === device.id)
//   GET  /api/v1/agent/commands          (filtered client-side on
//        command.device_id OR command.target_device_id === device.id,
//        so WoL history shows too)
//   GET  /api/v1/remediation-configurations/sends?device_id=… (send
//        history for this device, joined to the command records above
//        for exit code / output)
//   POST /api/v1/remediation-configurations/{id}/send (owner/admin
//        only; queues the configuration's script as one agent command
//        on the endpoint a linked vulnerability affects — see
//        SendConfigurationModal, which shows the exact script before
//        sending and the send history with results)
//   POST /api/v1/agent/commands          (owner/admin only, audit-logged)
//   POST /api/v1/agent/devices/{id}/wake (owner/admin only; {id} is the
//        device UUID, NOT the darwin-… string)
// Patches have NO device link in the data model (Patch has no
// device_id; PatchDeployment is scoped by group, not device), so the
// Patches section says that plainly instead of inventing links.

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Icon } from './Icon'
import { StatusBadge, SeverityBadge } from './StatusBadge'
import { EmptyState } from './EmptyState'
import { SendConfigurationModal } from './SendConfigurationModal'
import { parseBackendDate, formatLocalDateTime, relativeAge } from '../time'

export type EndpointDeviceRecord = {
  id: string
  device_id: string
  hostname?: string | null
  enrollment_status?: string | null
  agent_version?: string | null
  last_checkin_at?: string | null
  is_demo?: boolean
  attributes?: Record<string, any> | null
  created_at?: string | null
}

type EndpointDetailDrawerProps = {
  open?: boolean
  /** Full device record (from GET /api/v1/devices/). Preferred. */
  device?: EndpointDeviceRecord | null
  /** Fallback: the device UUID (id) or the darwin-… device_id string.
      Resolved by listing devices and matching either field. */
  deviceId?: string
  api: string
  headers: Record<string, string>
  /** Owner/admin only — the backend enforces it; this only hides the
      buttons a role could never use. Mirrors App.tsx role gating. */
  canRunCommands?: boolean
  userRole?: string
  onClose: () => void
}

// The online rule mirrors the backend exactly: device_stats counts an
// enrolled device online when last_checkin_at is within the last hour
// (GET /api/v1/devices/stats: recent = utcnow - 1h). The Stale /
// Offline split beyond that hour is a display convention only — the
// backend has no second threshold — and is labelled as such on screen.
const ONLINE_WINDOW_MS = 60 * 60 * 1000
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000

type Connectivity = 'online' | 'stale' | 'offline' | 'never'

function connectivityOf(lastCheckin: string | null | undefined): { state: Connectivity; at: Date | null } {
  if (!lastCheckin) return { state: 'never', at: null }
  // parseBackendDate: backend datetimes are naive UTC — parse them
  // as UTC, or a 10-minute-old check-in computes as 5h10m old here
  // (America/Detroit) and reads "Stale" instead of "Online".
  const at = parseBackendDate(lastCheckin)
  if (!at) return { state: 'never', at: null }
  const age = Date.now() - at.getTime()
  if (age < 0) return { state: 'online', at } // clock skew: treat as just checked in
  if (age <= ONLINE_WINDOW_MS) return { state: 'online', at }
  if (age <= STALE_WINDOW_MS) return { state: 'stale', at }
  return { state: 'offline', at }
}

const CONNECTIVITY_META: Record<Connectivity, { label: string; color: string; background: string; blurb: string }> = {
  online: { label: 'Online', color: '#0F766E', background: '#E6F7F5', blurb: 'Checked in within the last hour.' },
  stale: { label: 'Stale', color: '#92600A', background: '#FDF3E0', blurb: 'Last check-in was 1–24 hours ago.' },
  offline: { label: 'Offline', color: '#C64D4D', background: '#FBECEC', blurb: 'No check-in for over 24 hours.' },
  never: { label: 'Never checked in', color: '#65748A', background: '#F4F7FA', blurb: 'No check-in recorded for this device.' },
}

// formatLocalDateTime / relativeAge live in ../time.ts (shared with
// the other device/inventory views) — backend datetimes are naive
// UTC and must be parsed as UTC before rendering in local time.

function formatBytesGb(totalMb: number | null | undefined): string {
  if (totalMb == null || Number.isNaN(Number(totalMb))) return 'Not reported'
  return `${(Number(totalMb) / 1024).toFixed(0)} GB`
}

/** First non-empty MAC in the snapshot's network list — the same pick
    the backend wake endpoint makes (agent.py: first iface with a mac). */
function firstMac(hardware: any): string | null {
  const list = hardware?.network
  if (!Array.isArray(list)) return null
  for (const iface of list) {
    if (iface && typeof iface.mac === 'string' && iface.mac.trim()) return iface.mac.trim()
  }
  return null
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-null-line rounded-lg p-4 dark:border-white/10">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-null-ink dark:text-white">
        {icon}
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-null-line py-2 last:border-b-0 dark:border-white/10">
      <span className="shrink-0 text-sm text-null-muted dark:text-[#8AA0B8]">{label}</span>
      <span className="text-right text-sm font-medium text-null-ink dark:text-white">
        {value}
        {note && <span className="block text-xs font-normal text-null-muted dark:text-[#8AA0B8]">{note}</span>}
      </span>
    </div>
  )
}

function Unavailable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-null-line bg-null-cloud/60 p-3 dark:border-white/10 dark:bg-white/5">
      <p className="flex items-center gap-2 text-sm font-semibold text-null-ink dark:text-white">
        <Icon name="x-circle" size={16} className="shrink-0 text-null-muted dark:text-[#8AA0B8]" />
        {title} — not available
      </p>
      <div className="mt-1.5 text-sm text-null-muted dark:text-[#8AA0B8]">{children}</div>
    </div>
  )
}

export function EndpointDetailDrawer({
  open = true,
  device: deviceProp,
  deviceId,
  api,
  headers,
  canRunCommands = false,
  userRole,
  onClose,
}: EndpointDetailDrawerProps) {
  const [device, setDevice] = useState<EndpointDeviceRecord | null>(deviceProp ?? null)
  const [inventory, setInventory] = useState<any | null>(null)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [vulns, setVulns] = useState<any[]>([])
  const [commands, setCommands] = useState<any[]>([])
  const [sends, setSends] = useState<any[]>([])
  const [sendVuln, setSendVuln] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cmdKind, setCmdKind] = useState<'shell' | 'powershell'>('shell')
  const [cmdText, setCmdText] = useState('')
  const [cmdBusy, setCmdBusy] = useState(false)
  const [cmdMsg, setCmdMsg] = useState('')
  const [wakeBusy, setWakeBusy] = useState(false)
  const [wakeMsg, setWakeMsg] = useState('')

  useEffect(() => {
    setDevice(deviceProp ?? null)
  }, [deviceProp])

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError('')
    setInventoryError(null)
    try {
      let rec: EndpointDeviceRecord | null = deviceProp ?? null
      if (!rec && deviceId) {
        const list = await axios.get(`${api}/api/v1/devices/`, { headers })
        const rows = Array.isArray(list.data) ? list.data : []
        rec = rows.find((r: any) => r.id === deviceId || r.device_id === deviceId) ?? null
        if (!rec) throw new Error(`No device found for “${deviceId}”.`)
      }
      if (!rec) throw new Error('No device selected.')
      setDevice(rec)

      // Inventory: latest snapshot, keyed by the darwin-… device_id
      // string (the route looks the device up by device_id, not UUID).
      try {
        const inv = await axios.get(`${api}/api/v1/devices/${encodeURIComponent(rec.device_id)}/inventory/latest`, { headers })
        setInventory(inv.data)
      } catch (e: any) {
        setInventory(null)
        setInventoryError(e?.response?.status === 404
          ? 'No inventory collected for this device yet — the agent has not uploaded a snapshot.'
          : (e?.response?.data?.detail || 'Inventory could not be loaded.'))
      }

      // Vulnerabilities: the list endpoint takes no device filter, so
      // filter client-side on vulnerability.device_id === device UUID.
      try {
        const v = await axios.get(`${api}/api/v1/vulnerabilities/`, { headers })
        const rows = Array.isArray(v.data) ? v.data : []
        setVulns(rows.filter((row: any) => row.device_id === rec!.id))
      } catch {
        setVulns([])
      }

      // Commands: list is tenant-wide (limit 200, newest first);
      // keep rows addressed to this device OR targeting it (WoL).
      try {
        const c = await axios.get(`${api}/api/v1/agent/commands`, { headers })
        const rows = Array.isArray(c.data) ? c.data : []
        setCommands(rows.filter((row: any) => row.device_id === rec!.id || row.target_device_id === rec!.id))
      } catch {
        setCommands([])
      }

      // Remediation-configuration sends for this device, so each
      // linked vulnerability can show what was sent for it and what
      // the agent returned. The result itself lives on the linked
      // AgentCommand (joined on send.command_id in the render).
      try {
        const s = await axios.get(`${api}/api/v1/remediation-configurations/sends`, {
          params: { device_id: rec!.id }, headers,
        })
        setSends(Array.isArray(s.data) ? s.data : [])
      } catch {
        setSends([])
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Could not load this device.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceProp, deviceId, api])

  useEffect(() => { load() }, [load])

  // ESC closes, like DetailDrawer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const conn = useMemo(() => connectivityOf(device?.last_checkin_at), [device?.last_checkin_at])
  const connMeta = CONNECTIVITY_META[conn.state]

  const hardware = inventory?.hardware ?? {}
  const os = inventory?.os ?? device?.attributes?.os ?? {}
  const software: any[] = Array.isArray(inventory?.software) ? inventory.software : []
  const disks: any[] = Array.isArray(hardware?.disks) ? hardware.disks : []
  const cpu = hardware?.cpu ?? device?.attributes?.cpu ?? {}
  const memoryMb = hardware?.memory?.total_mb ?? device?.attributes?.memory?.total_mb
  const mac = firstMac(hardware)
  // MDM device information — the fields a mobile-device-management
  // server collects with its DeviceInformation query (Apple MDM
  // protocol): model name/number, serial, modem firmware, carrier,
  // radio MACs, IMEI/ICCID, supervision, battery, installed-app
  // count. iOS exposes none of these to Shortcuts, so an iPhone
  // reports them as values copied from Settings → General → About
  // into the scan's hardware.mdm dictionary; the drawer renders them
  // only when the snapshot carries them, so devices without an mdm
  // block (the Mac) are unaffected. Songs/videos/photos are
  // deliberately NOT part of this block — they are media counts,
  // not MDM device information. OS version and storage capacity are
  // already shown in Hardware & OS / Disks, so they are not repeated
  // here even when the mdm block carries them.
  const mdm: Record<string, any> =
    hardware?.mdm && typeof hardware.mdm === 'object' ? hardware.mdm : {}
  const mdmAppCount = typeof mdm?.installed_applications_count === 'number' ? mdm.installed_applications_count : null
  const appCount = software.length > 0 ? software.length : (mdmAppCount ?? 0)
  const mdmRows: Array<{ label: string; value: string }> = []
  if (typeof mdm?.model_name === 'string' && mdm.model_name) mdmRows.push({ label: 'Model name', value: mdm.model_name })
  if (typeof mdm?.model === 'string' && mdm.model) mdmRows.push({ label: 'Model number', value: mdm.model })
  if (typeof mdm?.serial_number === 'string' && mdm.serial_number) mdmRows.push({ label: 'Serial number', value: mdm.serial_number })
  if (typeof mdm?.modem_firmware_version === 'string' && mdm.modem_firmware_version) mdmRows.push({ label: 'Modem firmware', value: mdm.modem_firmware_version })
  if (typeof mdm?.carrier === 'string' && mdm.carrier) mdmRows.push({ label: 'Carrier', value: mdm.carrier })
  if (typeof mdm?.carrier_settings_version === 'string' && mdm.carrier_settings_version) mdmRows.push({ label: 'Carrier settings', value: mdm.carrier_settings_version })
  if (typeof mdm?.wifi_mac === 'string' && mdm.wifi_mac) mdmRows.push({ label: 'Wi-Fi MAC', value: mdm.wifi_mac })
  if (typeof mdm?.bluetooth_mac === 'string' && mdm.bluetooth_mac) mdmRows.push({ label: 'Bluetooth MAC', value: mdm.bluetooth_mac })
  if (typeof mdm?.imei === 'string' && mdm.imei) mdmRows.push({ label: 'IMEI', value: mdm.imei })
  if (typeof mdm?.iccid === 'string' && mdm.iccid) mdmRows.push({ label: 'ICCID', value: mdm.iccid })
  if (typeof mdm?.is_supervised === 'boolean') mdmRows.push({ label: 'Supervised', value: mdm.is_supervised ? 'Yes' : 'No' })
  if (typeof mdm?.battery_level === 'number') {
    // Shortcuts' Get Battery Level and MDM's BatteryLevel are both a
    // 0–1 ratio; tolerate a 0–100 percent value if one is ever sent.
    const pct = mdm.battery_level > 1 ? mdm.battery_level : mdm.battery_level * 100
    mdmRows.push({ label: 'Battery level', value: `${Math.round(pct)}%` })
  }
  const isDemo = device?.is_demo === true
  const versionsMissing = software.length > 0 && software.every((s: any) => !String(s?.version ?? '').trim())
  // The Mac's snapshot reports 4 disk entries for a single SSD
  // (APFS volumes share one physical disk). Say so when the
  // entries all share the same size signature.
  const diskSizes = new Set(disks.map((d: any) => `${d?.total_gb ?? '?'}`))
  const disksInflated = disks.length > 1 && diskSizes.size <= 2

  const runCommand = async () => {
    if (!device || !cmdText.trim()) return
    setCmdBusy(true)
    setCmdMsg('')
    try {
      // device.id is the UUID the queue expects — NOT the darwin-… string.
      await axios.post(`${api}/api/v1/agent/commands`, {
        device_id: device.id,
        kind: cmdKind,
        command: cmdText.trim(),
      }, { headers })
      setCmdText('')
      setCmdMsg('Command queued. The agent picks it up on its next poll; creation is audit-logged.')
      load()
    } catch (e: any) {
      setCmdMsg(e?.response?.data?.detail || 'Command could not be queued — owner/admin only.')
    } finally {
      setCmdBusy(false)
    }
  }

  const wakeDevice = async () => {
    if (!device) return
    setWakeBusy(true)
    setWakeMsg('')
    try {
      // {id} here is the device UUID — the backend parses it as a UUID.
      await axios.post(`${api}/api/v1/agent/devices/${device.id}/wake`, {}, { headers })
      setWakeMsg('Wake-on-LAN queued. An online agent on the same LAN will send the magic packet — this only works if another agent in the organization is awake on that network.')
      load()
    } catch (e: any) {
      setWakeMsg(e?.response?.data?.detail || 'Wake could not be queued — owner/admin only.')
    } finally {
      setWakeBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Endpoint details — ${device?.hostname || device?.device_id || 'device'}`}>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-null-navy2">
        <header className="flex items-start justify-between gap-3 border-b border-null-line px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-null-ink dark:text-white">
                {device?.hostname || device?.device_id || 'Endpoint'}
              </h2>
              {device && (isDemo ? (
                <span
                  className="rounded-full bg-null-tealSoft px-2 py-0.5 text-xs font-medium text-null-tealDark"
                  title="Sample data — this is a demonstration record, not a live device."
                >
                  Sample data
                </span>
              ) : (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ background: '#17C3B2' }}
                  title="Live device — a real enrolled endpoint, not a demonstration record."
                >
                  Live
                </span>
              ))}
              {device && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ color: connMeta.color, background: connMeta.background }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: connMeta.color }} aria-hidden />
                  {connMeta.label}
                </span>
              )}
            </div>
            {device && (
              <p className="mt-1 truncate text-xs text-null-muted dark:text-[#8AA0B8]">
                {device.device_id} · Agent {device.agent_version || 'version not reported'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close panel"
            className="shrink-0 rounded p-1 text-null-muted hover:bg-null-cloud hover:text-null-ink dark:text-[#8AA0B8] dark:hover:bg-null-deepSlate dark:hover:text-white"
          >
            <Icon name="x-circle" size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-null-ink dark:text-white">
          {loading && !device && <p className="text-null-muted dark:text-[#8AA0B8]">Loading endpoint…</p>}
          {error && (
            <div className="rounded border p-3 text-sm" style={{ background: '#FBECEC', borderColor: '#E5AFB0', color: '#C64D4D' }}>
              {error}
            </div>
          )}
          {device && (
            <>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={load}
                  className="rounded border border-null-line px-2.5 py-1 text-xs hover:bg-null-cloud dark:hover:bg-white/5"
                >
                  Refresh
                </button>
              </div>

              {/* 1 — Live connectivity. Never enrollment_status alone. */}
              <Section title="Connectivity" icon={<Icon name="server" size={16} />}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{ color: connMeta.color, background: connMeta.background }}
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: connMeta.color }} aria-hidden />
                    {connMeta.label}
                  </span>
                  <span className="text-sm text-null-muted dark:text-[#8AA0B8]">{connMeta.blurb}</span>
                </div>
                <div className="mt-2">
                  <Row
                    label="Last check-in"
                    value={conn.at ? formatLocalDateTime(device.last_checkin_at) : 'Never'}
                    note={conn.at ? relativeAge(device.last_checkin_at) : undefined}
                  />
                  <Row
                    label="Enrollment"
                    value={device.enrollment_status || '—'}
                    note="Enrollment is not connectivity — an enrolled device can still be offline."
                  />
                </div>
                <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                  Online means checked in within the last hour — the same 1-hour rule the backend
                  device stats use (GET /api/v1/devices/stats). Stale / Offline beyond that hour
                  is a display split (1–24h / over 24h); the backend itself only reports
                  online vs not-online. With the agent checking in every 30 minutes, a healthy
                  device should normally read Online here.
                </p>
              </Section>

              {/* 2 — Hardware + OS. */}
              <Section title="Hardware & OS" icon={<Icon name="settings" size={16} />}>
                {inventory ? (
                  <>
                    <Row label="CPU" value={cpu?.model ? `${cpu.model} · ${cpu.count ?? '?'} cores` : 'Not reported'} />
                    <Row label="Memory" value={formatBytesGb(memoryMb)} />
                    <Row
                      label="Operating system"
                      value={os?.name || 'Not reported'}
                      note={
                        os?.version
                          ? `Version ${os.version}${os?.arch ? ` · ${os.arch}` : ''}`
                          : 'Version not reported — the agent did not populate the OS version in this snapshot, so none is shown rather than guessed.'
                      }
                    />
                    {os?.platform && <Row label="Platform" value={`${os.platform}${os?.arch ? ` · ${os.arch}` : ''}`} />}
                    <Row
                      label="Disks"
                      value={`${disks.length} volume entr${disks.length === 1 ? 'y' : 'ies'} reported`}
                      note={
                        disksInflated
                          ? 'Inflated count — the agent lists APFS volumes/snapshots separately, so one physical SSD appears as many entries. Disk totals below are per volume, not per physical disk.'
                          : undefined
                      }
                    />
                    {disks.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-null-tealDark">
                          Show volume entries ({disks.length})
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {disks.map((d: any, i: number) => (
                            <li key={i} className="flex justify-between gap-2 border-b border-null-line pb-1 text-xs last:border-b-0 dark:border-white/10">
                              <span className="font-mono">{d?.device || d?.filesystem || `volume ${i + 1}`}</span>
                              <span className="text-null-muted dark:text-[#8AA0B8]">
                                {d?.total_gb != null ? `${d.total_gb} GB total` : 'size not reported'}
                                {d?.free_gb != null ? ` · ${d.free_gb} GB free` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                      Snapshot collected {formatLocalDateTime(inventory.collected_at)}
                      {inventory?.hostname ? ` · ${inventory.hostname}` : ''}
                      {hardware?.current_user ? ` · signed in as ${hardware.current_user}` : ''}.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    icon="server"
                    title="No inventory yet"
                    description={inventoryError || 'The agent has not uploaded an inventory snapshot for this device, so hardware, OS, and applications cannot be shown.'}
                  />
                )}
              </Section>

              {/* 2b — MDM device information. Only when the snapshot carries it. */}
              {mdmRows.length > 0 && (
                <Section title="Device information (MDM)" icon={<Icon name="shield" size={16} />}>
                  {mdmRows.map((r) => (
                    <Row key={r.label} label={r.label} value={<span className="font-mono">{r.value}</span>} />
                  ))}
                  <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                    The fields a mobile-device-management server collects with its DeviceInformation query.
                    iOS does not expose these to Shortcuts, so they are reported as values copied from
                    Settings → General → About — they do not update on their own. Only MDM device
                    information is collected here; media counts (songs, videos, photos) are not MDM fields.
                  </p>
                </Section>
              )}

              {/* 3 — Applications from the latest snapshot. */}
              <Section title={`Applications (${appCount})`} icon={<Icon name="download" size={16} />}>
                {inventory ? (
                  software.length === 0 ? (
                    mdmAppCount != null ? (
                      <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
                        {mdmAppCount} installed applications reported by the device (count only). iOS does not
                        expose the installed-app list to Shortcuts, so names cannot be shown.
                      </p>
                    ) : (
                      <EmptyState icon="download" title="No applications reported" description="The latest inventory snapshot contains no software entries." />
                    )
                  ) : (
                    <>
                      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {software.map((app: any, i: number) => (
                          <li key={i} className="flex items-center justify-between gap-2 rounded border border-null-line px-2.5 py-1.5 dark:border-white/10">
                            <span className="truncate font-medium">{app?.name || `Application ${i + 1}`}</span>
                            <span className="shrink-0 text-xs text-null-muted dark:text-[#8AA0B8]">
                              {String(app?.version ?? '').trim() ? `v${app.version}` : 'version not reported'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {versionsMissing && (
                        <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                          The agent records every application with vendor “Apple” and a blank version,
                          so vendor and version are not shown per app — the agent does not read the
                          real vendor/version. Names above are exactly what the snapshot reports.
                        </p>
                      )}
                      <p className="mt-1 text-xs text-null-muted dark:text-[#8AA0B8]">
                        From the latest inventory snapshot ({formatLocalDateTime(inventory.collected_at)}).
                      </p>
                    </>
                  )
                ) : (
                  <EmptyState icon="download" title="No inventory yet" description={inventoryError || 'Applications come from the latest inventory snapshot, and none has been collected for this device.'} />
                )}
              </Section>

              {/* 4 — Vulnerabilities + patches linked to this device. */}
              <Section title="Vulnerabilities & patches" icon={<Icon name="alert-triangle" size={16} />}>
                {vulns.length === 0 ? (
                  <>
                    <EmptyState
                      icon="shield"
                      title="No vulnerabilities linked to this device"
                      description="No vulnerability record in the platform has this device's id (device_id). That means none has been linked here — not that the device is proven clean; there is no on-device vulnerability scan yet (see below)."
                    />
                    <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
                      With no linked vulnerability there is nothing to target: a remediation
                      configuration is only sent to remediate a specific linked vulnerability,
                      so no send is offered here. Once a scan links a finding to this device,
                      its row will offer “Send config”.
                    </p>
                  </>
                ) : (
                  <ul className="space-y-2">
                    {vulns.map((v: any) => {
                      const vulnSends = sends.filter((s: any) => s.vulnerability_id === v.id)
                      return (
                      <li key={v.id} className="rounded border border-null-line p-2.5 dark:border-white/10">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{v.cve_id || v.title || 'Vulnerability'}</span>
                          {v.severity && <SeverityBadge value={v.severity} size="sm" />}
                          {v.status && <StatusBadge value={v.status} size="sm" />}
                        </span>
                        {v.title && v.cve_id && <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">{v.title}</span>}
                        {v.cvss_score && <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">CVSS {v.cvss_score}</span>}
                        {canRunCommands && (
                          <button
                            type="button"
                            className="mt-2 rounded border border-null-line px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-white/5"
                            title="Queue a remediation configuration's script as an agent command on this endpoint"
                            onClick={() => setSendVuln(v)}
                          >
                            Send config
                          </button>
                        )}
                        {vulnSends.length > 0 && (
                          <div className="mt-2 border-t border-null-line pt-2 dark:border-white/10">
                            <p className="text-xs font-medium">Configuration sends ({vulnSends.length})</p>
                            <ul className="mt-1 space-y-1">
                              {vulnSends.map((s: any) => {
                                const cmd = s.command_id ? commands.find((c: any) => c.id === s.command_id) : null
                                return (
                                  <li key={s.id} className="text-xs text-null-muted dark:text-[#8AA0B8]">
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span>Sent {formatLocalDateTime(s.created_at)}</span>
                                      {cmd ? (
                                        <>
                                          <StatusBadge value={cmd.status} size="sm" />
                                          {cmd.exit_code != null && <span>exit {cmd.exit_code}</span>}
                                        </>
                                      ) : (
                                        <StatusBadge value={s.status} size="sm" />
                                      )}
                                    </span>
                                    {cmd?.result ? (
                                      <details className="mt-1">
                                        <summary className="cursor-pointer text-xs font-medium text-null-tealDark">Agent result</summary>
                                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-2 font-mono text-xs dark:bg-white/5">{cmd.result}</pre>
                                      </details>
                                    ) : cmd ? (
                                      <span className="mt-0.5 block">Awaiting agent result.</span>
                                    ) : null}
                                  </li>
                                )
                              })}
                            </ul>
                            <p className="mt-1 text-xs text-null-muted dark:text-[#8AA0B8]">
                              A succeeded command means the script ran and returned exit 0 — it does
                              not by itself prove the vulnerability is fixed.
                            </p>
                          </div>
                        )}
                      </li>
                      )
                    })}
                  </ul>
                )}
                <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
                  Sending a configuration is command-based remediation, not a native
                  configuration-management engine: it queues one script as an agent command, with
                  no config profiles, drift detection, or compliance enforcement. Sending never
                  marks a vulnerability remediated on its own.
                </p>
                <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
                  Patches: no patch record is linked to a specific device in the platform — the
                  Patch model has no device_id, and deployments are scoped by device group, not
                  by device — so no per-device patch list exists to show. Patch status lives at
                  the catalogue level (available / testing / approved / declined / deployed) in
                  Patch Management.
                </p>
              </Section>

              {/* 5 — Remote commands through the agent queue. */}
              <Section title="Remote commands" icon={<Icon name="command" size={16} />}>
                <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
                  Commands are queued here and run by the endpoint agent as its own user on its
                  next poll — the backend never executes anything itself. Every command creation
                  is audit-logged with who created it.
                </p>
                {canRunCommands ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <select
                        className="null-input !w-auto px-2 py-2 text-sm"
                        value={cmdKind}
                        onChange={(e) => setCmdKind(e.target.value as 'shell' | 'powershell')}
                        aria-label="Command kind"
                      >
                        <option value="shell">shell</option>
                        <option value="powershell">powershell</option>
                      </select>
                      <input
                        className="null-input flex-1 p-2 text-sm"
                        placeholder={cmdKind === 'powershell' ? 'e.g. Get-ComputerInfo' : 'e.g. sw_vers'}
                        value={cmdText}
                        onChange={(e) => setCmdText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') runCommand() }}
                        aria-label="Command to run on this device"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded bg-null-teal px-3 py-2 text-sm font-medium text-white hover:bg-null-tealDark disabled:opacity-50"
                        onClick={runCommand}
                        disabled={cmdBusy || !cmdText.trim()}
                      >
                        {cmdBusy ? 'Queueing…' : 'Run'}
                      </button>
                    </div>
                    {cmdMsg && <p className="text-xs text-null-muted dark:text-[#8AA0B8]">{cmdMsg}</p>}
                  </div>
                ) : (
                  <p className="mt-2 rounded border border-null-line bg-null-cloud/60 p-2.5 text-xs text-null-muted dark:border-white/10 dark:bg-white/5 dark:text-[#8AA0B8]">
                    Remote commands are owner/admin only{userRole ? ` — your role is ${userRole}` : ''}.
                    The history below is still visible to any signed-in role.
                  </p>
                )}
                <div className="mt-3">
                  {commands.length === 0 ? (
                    <EmptyState icon="command" title="No commands yet" description="No command in the queue has been addressed to — or targeted at — this device." />
                  ) : (
                    <ul className="space-y-2">
                      {commands.map((c: any) => (
                        <li key={c.id} className="rounded border border-null-line p-2.5 dark:border-white/10">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-null-cloud px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">{c.kind || 'shell'}</span>
                            {c.target_device_id === device.id && c.device_id !== device.id && (
                              <span className="rounded bg-null-tealSoft px-1.5 py-0.5 text-xs font-medium text-null-tealDark">Wake-on-LAN</span>
                            )}
                            {c.attributes?.remediation_configuration_id && (
                              <span
                                className="rounded bg-null-tealSoft px-1.5 py-0.5 text-xs font-medium text-null-tealDark"
                                title={`Sent as a remediation configuration${c.attributes?.cve_id ? ` for ${c.attributes.cve_id}` : ''} — the script is the command below, run once by the agent.`}
                              >
                                Remediation{c.attributes?.cve_id ? ` · ${c.attributes.cve_id}` : ''}
                              </span>
                            )}
                            <StatusBadge value={c.status} size="sm" />
                            {c.exit_code != null && <span className="text-xs text-null-muted dark:text-[#8AA0B8]">exit {c.exit_code}</span>}
                          </span>
                          <span className="mt-1 block break-all font-mono text-xs">{c.command}</span>
                          <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">
                            {formatLocalDateTime(c.created_at)}
                            {c.completed_at ? ` · completed ${formatLocalDateTime(c.completed_at)}` : ''}
                          </span>
                          {c.result ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs font-medium text-null-tealDark">Result</summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-2 font-mono text-xs dark:bg-white/5">{c.result}</pre>
                            </details>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Section>

              {/* 6 — Wake-on-LAN. */}
              <Section title="Wake-on-LAN" icon={<Icon name="bell" size={16} />}>
                <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
                  The backend cannot reach this device&apos;s network, so waking queues a magic-packet
                  command that another online agent in the organization sends on the target&apos;s LAN.
                  It needs a known MAC address and an online agent on the same LAN — it cannot wake
                  a device on a network where no agent is awake, and it cannot wake a device whose
                  firmware/OS is not configured to accept wake packets.
                </p>
                <div className="mt-2">
                  <Row
                    label="MAC address"
                    value={mac ? <span className="font-mono">{mac}</span> : 'Not known'}
                    note={mac ? 'From the latest inventory snapshot (first network interface with a MAC).' : 'No MAC in the latest inventory — run the agent on the device once while it is awake so its inventory is collected.'}
                  />
                </div>
                {canRunCommands ? (
                  <button
                    type="button"
                    className="mt-3 rounded bg-null-teal px-3 py-2 text-sm font-medium text-white hover:bg-null-tealDark disabled:opacity-50"
                    onClick={wakeDevice}
                    disabled={wakeBusy || !mac || conn.state === 'online'}
                    title={!mac ? 'No MAC address known for this device' : conn.state === 'online' ? 'Device is already online' : 'Queue a wake command'}
                  >
                    {wakeBusy ? 'Queueing wake…' : 'Wake this device'}
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
                    Waking a device is owner/admin only{userRole ? ` — your role is ${userRole}` : ''}.
                  </p>
                )}
                {conn.state === 'online' && <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">This device is currently online, so waking it is unnecessary.</p>}
                {wakeMsg && <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">{wakeMsg}</p>}
              </Section>

              {/* 7 — Explicitly unavailable. Never faked as working. */}
              <Section title="Not yet available" icon={<Icon name="x-circle" size={16} />}>
                <div className="space-y-3">
                  <Unavailable title="Interactive remote desktop / screen sharing">
                    Not built. The agent command channel runs non-interactive commands only, and
                    live screen sharing needs a relay — which does not exist yet. Remote sessions
                    are recorded separately (see the Remote Access module), but there is no working
                    remote-desktop button here on purpose.
                  </Unavailable>
                  <Unavailable title="On-device patch scan">
                    Not built. The agent cannot scan this device for missing patches yet, and there
                    is no backend endpoint that triggers one. What it would need: agent-side patch
                    scanning plus a scan endpoint that reports results back per device.
                  </Unavailable>
                  <Unavailable title="On-device vulnerability scan">
                    Not built. The agent cannot scan this device for vulnerabilities yet, and no
                    scan endpoint exists. What it would need: agent-side vulnerability scanning
                    (or a scanner that reports per-device findings) plus records linked to the
                    device by device_id, the way the Vulnerabilities list already links some
                    records today.
                  </Unavailable>
                  <Unavailable title="Per-device patch list">
                    Not built in the data model. Patches are catalogue records with no device_id,
                    and deployments are scoped by device group — so even a perfect scan result
                    could not be shown per device until patch records gain a device link.
                  </Unavailable>
                </div>
              </Section>

              {/* Identity / audit footer. */}
              <div className="rounded border border-null-line p-3 text-xs text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
                <p>Device UUID: <span className="font-mono">{device.id}</span></p>
                <p className="mt-1">Stable device id: <span className="font-mono">{device.device_id}</span></p>
                {device.created_at && <p className="mt-1">First seen: {formatLocalDateTime(device.created_at)}</p>}
                <p className="mt-1">Record type: {isDemo ? 'Sample (demo) record' : 'Live record — real enrolled device'}.</p>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Send a remediation configuration for one of this device's
          linked vulnerabilities. The modal shows the exact script
          before sending and the send history with agent results. */}
      <SendConfigurationModal
        open={!!sendVuln}
        vulnerability={sendVuln}
        api={api}
        headers={headers}
        onSent={load}
        onClose={() => setSendVuln(null)}
      />
    </div>
  )
}
