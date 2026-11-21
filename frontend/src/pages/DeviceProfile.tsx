import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Monitor, Cpu, MemoryStick, HardDrive, Network, ShieldCheck, ShieldX, Search, Activity } from 'lucide-react'
import { api, type Device } from '../lib/api'
import { ACTIVITY_LABELS, formatDate, timeAgo, isOnline } from '../lib/format'
import { Card, CardHeader, StatusBadge, Loading, EmptyState, Badge } from '../components/ui'

const TABS = ['Overview', 'Hardware', 'Software', 'Security', 'Activity'] as const
type Tab = typeof TABS[number]

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
          <dt className="text-slate-500">{k}</dt>
          <dd className="col-span-2 text-slate-900">{v ?? <span className="text-slate-400">Not reported</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function Spec({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-cloud text-navy"><Icon size={17} /></span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  )
}

export default function DeviceProfile() {
  const { id } = useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [missing, setMissing] = useState(false)
  const [tab, setTab] = useState<Tab>('Overview')
  const [activity, setActivity] = useState<{ action: string; occurred_at: string; metadata: Record<string, string> }[] | null>(null)
  const [swQuery, setSwQuery] = useState('')

  useEffect(() => {
    api.get(`/devices/${id}`).then(r => setDevice(r.data)).catch(() => setMissing(true))
    api.get(`/devices/${id}/activity`).then(r => setActivity(r.data)).catch(() => setActivity([]))
  }, [id])

  const software = useMemo(() => {
    const q = swQuery.toLowerCase()
    return (device?.attributes?.software ?? [])
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.publisher?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [device, swQuery])

  if (missing) return <Card><EmptyState title="Device not found" body="It may have been removed, or it belongs to a different organization." /></Card>
  if (!device) return <Loading />

  const a = device.attributes ?? {}
  const hw = a.hardware ?? {}
  const sec = a.security
  const diskUsedPct = hw.disk_total_gb && hw.disk_free_gb !== undefined
    ? Math.round(((hw.disk_total_gb - hw.disk_free_gb) / hw.disk_total_gb) * 100) : null
  const secItem = (label: string, ok: boolean | undefined, detail: string) => (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className={`grid h-9 w-9 place-items-center rounded-lg ${ok ? 'bg-emerald-50 text-emerald-600' : ok === false ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-400'}`}>
        {ok === false ? <ShieldX size={17} /> : <ShieldCheck size={17} />}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{detail}</p>
      </div>
      {ok === undefined ? <Badge>Not reported</Badge> : ok ? <Badge tone="green">Enabled</Badge> : <Badge tone="red">Off</Badge>}
    </div>
  )

  return (
    <>
      <Link to="/endpoints" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} />All devices
      </Link>

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-xl bg-navy text-white"><Monitor size={26} /></span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-900 truncate">{device.hostname ?? 'Unnamed device'}</h1>
              <StatusBadge lastCheckin={device.last_checkin_at} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {[a.manufacturer && `${a.manufacturer} ${a.model ?? ''}`.trim(), a.os?.name].filter(Boolean).join(' · ') || device.device_id}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-500">Last check-in</p>
            <p className={`font-medium ${isOnline(device.last_checkin_at) ? 'text-slate-900' : 'text-amber-600'}`}>{timeAgo(device.last_checkin_at)}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Spec icon={MemoryStick} label="RAM" value={hw.ram_gb ? `${hw.ram_gb} GB` : 'Not reported'} />
          <Spec icon={Cpu} label="Processor" value={hw.cpu ?? 'Not reported'} />
          <Spec icon={HardDrive} label="Storage" value={hw.disk_total_gb ? `${hw.disk_free_gb} GB free of ${hw.disk_total_gb} GB` : 'Not reported'} />
          <Spec icon={Network} label="IP address" value={a.network?.ip_address ?? 'Not reported'} />
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-teal font-medium text-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t}{t === 'Software' && a.software ? <span className="ml-1.5 text-xs text-slate-400">{a.software.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Device information" />
            <Rows rows={[
              ['Department', a.department],
              ['Assigned user', a.assigned_user],
              ['Manufacturer', a.manufacturer],
              ['Model', a.model],
              ['Serial number', a.serial_number],
              ['Groups', device.groups?.length ? <div className="flex flex-wrap gap-1.5">{device.groups.map(g => <Badge key={g} tone="navy">{g}</Badge>)}</div> : undefined],
            ]} />
          </Card>
          <Card>
            <CardHeader title="Agent & enrollment" />
            <Rows rows={[
              ['Operating system', a.os?.name && `${a.os.name}${a.os.version ? ` (${a.os.version})` : ''}`],
              ['OS build', a.os?.build],
              ['Agent version', device.agent_version],
              ['Last check-in', formatDate(device.last_checkin_at)],
              ['Enrolled', formatDate(device.created_at)],
              ['Enrollment', <Badge tone="teal">{device.enrollment_status === 'enrolled' ? 'Active' : device.enrollment_status}</Badge>],
            ]} />
          </Card>
        </div>
      )}

      {tab === 'Hardware' && (
        <Card>
          <CardHeader title="Hardware" />
          <Rows rows={[
            ['Processor', hw.cpu],
            ['Memory', hw.ram_gb && `${hw.ram_gb} GB`],
            ['Storage', hw.disk_total_gb && (
              <div className="max-w-xs">
                <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{diskUsedPct}% used</span><span>{hw.disk_free_gb} GB free</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${diskUsedPct! > 80 ? 'bg-amber-500' : 'bg-teal'}`} style={{ width: `${diskUsedPct}%` }} /></div>
              </div>
            )],
            ['Manufacturer', a.manufacturer],
            ['Model', a.model],
            ['Serial number', a.serial_number],
            ['MAC address', a.network?.mac_address],
            ['IP address', a.network?.ip_address],
          ]} />
        </Card>
      )}

      {tab === 'Software' && (
        <Card>
          <CardHeader title="Installed software" subtitle={`${a.software?.length ?? 0} applications reported by the agent`}
            action={
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={swQuery} onChange={e => setSwQuery(e.target.value)} placeholder="Filter applications"
                  className="w-52 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-teal focus:outline-none" />
              </div>
            } />
          {software.length === 0 ? (
            <EmptyState title="No software reported" body="The agent sends installed applications on its next full inventory." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Application</th><th className="py-2.5 pr-5">Publisher</th><th className="py-2.5 pr-5">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {software.map(s => (
                  <tr key={s.name}>
                    <td className="px-5 py-2.5 font-medium text-slate-900">{s.name}</td>
                    <td className="py-2.5 pr-5 text-slate-600">{s.publisher ?? 'Not reported'}</td>
                    <td className="py-2.5 pr-5 font-mono text-xs text-slate-600">{s.version ?? 'Not reported'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'Security' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Security posture" subtitle="Reported by the agent at last check-in" />
            <div className="divide-y divide-slate-100">
              {secItem('Disk encryption (BitLocker)', sec?.bitlocker, 'Protects data if the device is lost or stolen')}
              {secItem('Windows Firewall', sec?.firewall, 'Blocks unwanted network connections')}
              {secItem('Microsoft Defender', sec?.defender, 'Real-time antivirus protection')}
            </div>
          </Card>
          <Card>
            <CardHeader title="Vulnerabilities & patches" />
            <EmptyState icon={<ShieldCheck size={20} />} title="Coming in Phase 2"
              body="Vulnerability findings, missing patches, and policy status for this device will appear here." />
          </Card>
        </div>
      )}

      {tab === 'Activity' && (
        <Card>
          <CardHeader title="Activity" subtitle="Every recorded event for this device" />
          {!activity ? <Loading /> : activity.length === 0 ? (
            <EmptyState title="No activity recorded" body="Enrollment and status changes will show up here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((e, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-50 text-teal"><Activity size={14} /></span>
                  <p className="flex-1 text-sm text-slate-800">{ACTIVITY_LABELS[e.action] ?? e.action}</p>
                  <span className="text-xs text-slate-500">{formatDate(e.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  )
}
