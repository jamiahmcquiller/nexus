import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Monitor, Wifi, ShieldAlert, PackageCheck, Plus, FolderPlus, ChevronRight, AlertTriangle, Activity, LifeBuoy, CalendarClock } from 'lucide-react'
import { api } from '../lib/api'
import { ACTIVITY_LABELS, timeAgo } from '../lib/format'
import { Card, CardHeader, PageHeader, Button, Loading, EmptyState, Badge } from '../components/ui'
import type { Org } from '../components/Layout'

type OverviewData = {
  devices: { total: number; online: number; stale: number }
  by_os: { name: string; count: number }[]
  by_department: { name: string; count: number }[]
  recent_activity: { action: string; occurred_at: string; metadata: Record<string, string> }[]
  attention: { id: string; hostname: string; last_checkin_at: string | null }[]
  vulnerabilities: number | null
  patch_compliance: number | null
  open_tickets?: number
  warranty_attention?: number
}

function Kpi({ icon: Icon, label, value, sub, accent, pending }: {
  icon: typeof Monitor; label: string; value: string; sub: string; accent: string; pending?: boolean
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${accent}`}><Icon size={18} /></span>
      </div>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${pending ? 'text-slate-300' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </Card>
  )
}

function HealthRing({ online, total }: { online: number; total: number }) {
  const pct = total ? online / total : 0
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 128 128" className="h-36 w-36 -rotate-90">
      <circle cx="64" cy="64" r={r} fill="none" stroke="#E2E8F0" strokeWidth="12" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="#167C80" strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} />
    </svg>
  )
}

export default function Overview() {
  const org = useOutletContext<Org | null>()
  const [data, setData] = useState<OverviewData | null>(null)

  useEffect(() => {
    api.get('/overview').then(r => setData(r.data))
  }, [])

  if (!data) return <Loading />
  const { total, online, stale } = data.devices
  const pct = total ? Math.round((online / total) * 1000) / 10 : 0

  return (
    <>
      <PageHeader
        title={`Welcome back${org?.user.username ? `, ${org.user.username}` : ''}`}
        subtitle={org?.name}
        actions={
          <>
            <Link to="/endpoints/groups"><Button variant="secondary"><FolderPlus size={16} />Add group</Button></Link>
            <Link to="/endpoints/enroll"><Button><Plus size={16} />Enroll device</Button></Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Monitor} label="Managed devices" value={total.toLocaleString()} sub="Total enrolled" accent="bg-slate-100 text-navy" />
        <Kpi icon={Wifi} label="Online devices" value={online.toLocaleString()} sub={total ? `${pct}% online` : 'No devices yet'} accent="bg-emerald-50 text-emerald-600" />
        <Link to="/vulnerabilities"><Kpi icon={ShieldAlert} label="Vulnerabilities" value={data.vulnerabilities?.toLocaleString() ?? 'n/a'}
          sub="Open findings" accent="bg-red-50 text-red-500" /></Link>
        <Link to="/patches"><Kpi icon={PackageCheck} label="Patch compliance" value={data.patch_compliance === null ? 'n/a' : `${data.patch_compliance}%`}
          sub={data.patch_compliance === null ? 'No approved patches yet' : 'Approved patches installed'} accent="bg-teal-50 text-teal" pending={data.patch_compliance === null} /></Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link to="/service-desk"><Card className="flex items-center gap-4 p-4 hover:border-teal">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-navy"><LifeBuoy size={18} /></span>
          <div className="flex-1"><p className="text-sm text-slate-500">Open service desk tickets</p><p className="text-lg font-semibold text-slate-900">{data.open_tickets ?? 0}</p></div>
          <ChevronRight size={16} className="text-slate-300" />
        </Card></Link>
        <Link to="/endpoints/warranty"><Card className="flex items-center gap-4 p-4 hover:border-teal">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600"><CalendarClock size={18} /></span>
          <div className="flex-1"><p className="text-sm text-slate-500">Warranties expired or ending within 90 days</p><p className="text-lg font-semibold text-slate-900">{data.warranty_attention ?? 0}</p></div>
          <ChevronRight size={16} className="text-slate-300" />
        </Card></Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Endpoint health" subtitle="Devices that checked in within the last hour" />
          {total === 0 ? (
            <EmptyState icon={<Monitor size={20} />} title="No devices yet" body="Enroll your first device to start monitoring health."
              action={<Link to="/endpoints/enroll"><Button><Plus size={16} />Enroll device</Button></Link>} />
          ) : (
            <div className="flex items-center gap-6 p-5">
              <div className="relative">
                <HealthRing online={online} total={total} />
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-2xl font-semibold text-slate-900">{pct}%</p>
                    <p className="text-[11px] text-slate-500">online</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-teal" />Online</span>
                  <span className="font-medium text-slate-900">{online}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />Offline / stale</span>
                  <span className="font-medium text-slate-900">{stale}</span>
                </div>
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  {data.by_os.map(o => (
                    <div key={o.name} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{o.name}</span><span className="text-slate-700">{o.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Needs attention" subtitle="Devices that have stopped checking in"
            action={stale > 0 ? <Badge tone="amber">{stale}</Badge> : undefined} />
          {data.attention.length === 0 ? (
            <EmptyState title="All clear" body="Every enrolled device has checked in within the last hour." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.attention.map(d => (
                <li key={d.id}>
                  <Link to={`/endpoints/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600"><AlertTriangle size={15} /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{d.hostname}</p>
                      <p className="text-xs text-slate-500">Last seen {timeAgo(d.last_checkin_at)}</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Latest events in your organization" />
          {data.recent_activity.length === 0 ? (
            <EmptyState title="No activity yet" body="Enrollments and changes will show up here." />
          ) : (
            <ul className="px-5 py-2">
              {data.recent_activity.map((a, i) => (
                <li key={i} className="flex gap-3 py-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-50 text-teal"><Activity size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">{ACTIVITY_LABELS[a.action] ?? a.action}</p>
                    <p className="text-xs text-slate-500 truncate">{String(a.metadata.hostname ?? a.metadata.name ?? a.metadata.number ?? '')}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.by_department.length > 0 && total > 0 && (
        <Card className="mt-6">
          <CardHeader title="Devices by department" />
          <div className="space-y-3 p-5">
            {data.by_department.map(d => (
              <div key={d.name} className="flex items-center gap-4 text-sm">
                <span className="w-36 shrink-0 text-slate-600">{d.name}</span>
                <div className="h-2 flex-1 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-navy" style={{ width: `${(d.count / total) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-medium text-slate-900">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
