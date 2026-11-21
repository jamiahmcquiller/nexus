// NULL — Security Operations home: attack surface visibility.
//
// What is actually exposed, grounded in device + vulnerability
// records only:
//   Fleet composition — every endpoint in scope, split live vs
//     sample from the device rows' own is_demo flag. The real
//     enrolled endpoint is listed by name with a Live badge; it
//     is never silently dropped from a count.
//   Exposed endpoints — devices linked to at least one open
//     vulnerability, broken down by the linked endpoint's OS and
//     department (attributes that exist only on sample rows).
//   Most exposed hosts — endpoints with open critical
//     vulnerabilities, ranked by count.
//   Unexposed — endpoints with no open vulnerabilities at all.
// Coverage note, stated on screen: department and OS are
// recorded only on sample endpoints, so live endpoints are
// counted in fleet totals but cannot appear in those breakdowns.
// Every row and bar opens the drawer on the underlying devices.

import { NULL_COLORS } from '../../theme'
import { departmentOf, isSampleDevice, osLabelOf, severityOf } from './types'
import type { DrawerView } from './DrawerViews'
import { OriginBadge } from './DrawerViews'
import type { DeviceRow, VulnRow } from './types'

export type AttackSurfaceProps = {
  devices: DeviceRow[]
  openVulns: VulnRow[]
  hostnameOf: (deviceId: string | null | undefined) => string
  deviceOf: (deviceId: string | null | undefined) => DeviceRow | undefined
  onOpenView: (view: DrawerView) => void
  onOpenDevice: (device: DeviceRow) => void
}

type Exposure = { device: DeviceRow; crit: number; high: number; total: number }

function GroupBars({
  title,
  groups,
  onOpenDevices,
}: {
  title: string
  groups: Array<{ label: string; devices: DeviceRow[] }>
  onOpenDevices: (label: string, devices: DeviceRow[]) => void
}) {
  const max = Math.max(...groups.map((g) => g.devices.length), 1)
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">{title}</h4>
      {groups.length === 0 ? (
        <p className="text-xs text-null-muted dark:text-[#8AA0B8]">No data.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <button
              key={g.label}
              type="button"
              onClick={() => onOpenDevices(g.label, g.devices)}
              className="flex w-full items-center gap-2 text-left text-xs"
              title={`View ${g.devices.length} exposed endpoints — ${g.label}`}
            >
              <span className="w-24 shrink-0 truncate text-right text-null-muted dark:text-[#8AA0B8]">{g.label}</span>
              <span className="h-5 flex-1 overflow-hidden rounded bg-null-cloud dark:bg-null-navy2">
                <span
                  className="block h-full rounded"
                  style={{ width: `${(g.devices.length / max) * 100}%`, background: NULL_COLORS.teal }}
                />
              </span>
              <span className="w-10 shrink-0 font-medium text-null-ink dark:text-white">{g.devices.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AttackSurface(p: AttackSurfaceProps) {
  const liveDevices = p.devices.filter((d) => !isSampleDevice(d))
  const sampleCount = p.devices.length - liveDevices.length

  const exposure = new Map<string, Exposure>()
  for (const v of p.openVulns) {
    if (!v.device_id) continue
    const device = p.deviceOf(v.device_id)
    if (!device) continue
    const e = exposure.get(device.id) ?? { device, crit: 0, high: 0, total: 0 }
    const sev = severityOf(v)
    if (sev === 'critical') e.crit += 1
    if (sev === 'high') e.high += 1
    e.total += 1
    exposure.set(device.id, e)
  }
  const exposed = [...exposure.values()].sort((a, b) => b.crit - a.crit || b.total - a.total)
  const unexposedCount = p.devices.length - exposure.size

  const byOs = new Map<string, DeviceRow[]>()
  const byDept = new Map<string, DeviceRow[]>()
  let unattributed = 0
  for (const e of exposed) {
    const os = osLabelOf(e.device)
    const dept = departmentOf(e.device)
    if (os) {
      const list = byOs.get(os) ?? []
      list.push(e.device)
      byOs.set(os, list)
    }
    if (dept) {
      const list = byDept.get(dept) ?? []
      list.push(e.device)
      byDept.set(dept, list)
    }
    if (!os && !dept) unattributed += 1
  }
  const osGroups = [...byOs.entries()]
    .map(([label, devices]) => ({ label, devices }))
    .sort((a, b) => b.devices.length - a.devices.length)
  const deptGroups = [...byDept.entries()]
    .map(([label, devices]) => ({ label, devices }))
    .sort((a, b) => b.devices.length - a.devices.length)

  const critHosts = exposed.filter((e) => e.crit > 0)
  const shownHosts = critHosts.slice(0, 6)

  const openDevices = (title: string, devices: DeviceRow[]) =>
    p.onOpenView({ kind: 'devices', title, rows: devices })

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-null-ink dark:text-white">
          <span className="text-2xl font-bold">{p.devices.length}</span>{' '}
          <span className="text-null-muted dark:text-[#8AA0B8]">
            endpoints in scope · {sampleCount} sample · {liveDevices.length} live
          </span>
        </p>
        {liveDevices.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {liveDevices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => p.onOpenDevice(d)}
                  className="font-medium text-null-teal hover:underline"
                  title="Open endpoint detail"
                >
                  {d.hostname || d.device_id}
                </button>
                <OriginBadge sample={false} />
                <span className="text-xs text-null-muted dark:text-[#8AA0B8]">
                  {exposure.has(d.id) ? `${exposure.get(d.id)?.total} open vulnerabilities` : 'no open vulnerabilities'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-null-ink dark:text-white">
          Exposed endpoints — {exposure.size} with at least one open vulnerability
        </h4>
        <button
          type="button"
          onClick={() => openDevices('Exposed endpoints — open vulnerabilities', exposed.map((e) => e.device))}
          className="text-xs font-medium text-null-teal hover:underline"
        >
          View all {exposure.size} →
        </button>
      </div>

      <GroupBars title="Exposed by OS" groups={osGroups} onOpenDevices={(label, devices) => openDevices(`Exposed endpoints — ${label}`, devices)} />
      <GroupBars
        title="Exposed by department"
        groups={deptGroups}
        onOpenDevices={(label, devices) => openDevices(`Exposed endpoints — ${label}`, devices)}
      />
      {unattributed > 0 && (
        <p className="text-xs text-null-muted dark:text-[#8AA0B8]">
          {unattributed} exposed {unattributed === 1 ? 'endpoint carries' : 'endpoints carry'} no OS or department
          data, so {unattributed === 1 ? 'it is' : 'they are'} counted above but not in these breakdowns.
        </p>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:text-[#8AA0B8]">
          Most exposed hosts — open critical vulnerabilities
        </h4>
        {shownHosts.length === 0 ? (
          <p className="text-xs text-null-muted dark:text-[#8AA0B8]">No endpoint has an open critical vulnerability.</p>
        ) : (
          <ul className="space-y-1.5">
            {shownHosts.map((e) => (
              <li key={e.device.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => p.onOpenDevice(e.device)}
                  className="min-w-0 flex-1 truncate text-left font-medium text-null-teal hover:underline"
                  title="Open endpoint detail"
                >
                  {p.hostnameOf(e.device.id)}
                </button>
                <OriginBadge sample={isSampleDevice(e.device)} />
                <span className="shrink-0 text-xs text-null-muted dark:text-[#8AA0B8]">
                  {e.crit} critical{e.high > 0 ? ` · ${e.high} high` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {critHosts.length > shownHosts.length && (
          <button
            type="button"
            onClick={() => openDevices('Endpoints with open critical vulnerabilities', critHosts.map((e) => e.device))}
            className="mt-2 text-xs font-medium text-null-teal hover:underline"
          >
            View all {critHosts.length} →
          </button>
        )}
      </div>

      <p className="border-t border-null-line pt-3 text-xs leading-relaxed text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">
        {unexposedCount} {unexposedCount === 1 ? 'endpoint has' : 'endpoints have'} no open vulnerabilities.
        Department and OS are recorded only on sample endpoints — live endpoints are counted in fleet totals
        but cannot appear in the OS / department breakdowns.
      </p>
    </div>
  )
}
