import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Download, Monitor, ArrowUpDown, ChevronRight } from 'lucide-react'
import { api, type Device } from '../lib/api'
import { isOnline, timeAgo, parseUtc } from '../lib/format'
import { Card, PageHeader, Button, StatusBadge, Loading, EmptyState, Badge } from '../components/ui'
import { WARRANTY_TONE, warrantyLabel } from './Warranty'
import { parseDate } from '../lib/warranty'

export function EndpointTabs() {
  const tabs = [
    { to: '/endpoints', label: 'All devices' },
    { to: '/endpoints/groups', label: 'Groups' },
    { to: '/endpoints/warranty', label: 'Warranty' },
    { to: '/endpoints/enroll', label: 'Enroll a device' },
  ]
  const path = useLocation().pathname
  return (
    <div className="mb-6 flex gap-1 border-b border-slate-200">
      {tabs.map(t => {
        const active = path === t.to
        return (
          <Link key={t.to} to={t.to}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-teal font-medium text-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

type StatusFilter = 'all' | 'online' | 'offline'
type SortKey = 'hostname' | 'last_checkin' | 'manufacturer'

function toCsv(rows: Device[]) {
  const header = ['Hostname', 'Status', 'Department', 'Assigned user', 'Operating system', 'Manufacturer', 'Model', 'Serial number', 'IP address', 'Last check-in', 'Warranty ends']
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map(d => {
    const a = d.attributes ?? {}
    return [d.hostname, isOnline(d.last_checkin_at) ? 'Online' : 'Offline', a.department, a.assigned_user, a.os?.name,
      a.manufacturer, a.model, a.serial_number, a.network?.ip_address, parseUtc(d.last_checkin_at)?.toISOString(), a.warranty?.end_date].map(esc).join(',')
  })
  return [header.map(esc).join(','), ...lines].join('\n')
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Endpoints() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [os, setOs] = useState('all')
  const [dept, setDept] = useState('all')
  const [sort, setSort] = useState<SortKey>('hostname')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  useEffect(() => { api.get('/devices/').then(r => setDevices(r.data)) }, [])
  useEffect(() => { setQuery(params.get('q') ?? '') }, [params])

  const osOptions = useMemo(() => [...new Set((devices ?? []).map(d => d.attributes?.os?.name).filter(Boolean))] as string[], [devices])
  const deptOptions = useMemo(() => [...new Set((devices ?? []).map(d => d.attributes?.department).filter(Boolean))].sort() as string[], [devices])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (devices ?? []).filter(d => {
      const a = d.attributes ?? {}
      if (status === 'online' && !isOnline(d.last_checkin_at)) return false
      if (status === 'offline' && isOnline(d.last_checkin_at)) return false
      if (os !== 'all' && a.os?.name !== os) return false
      if (dept !== 'all' && a.department !== dept) return false
      if (q && ![d.hostname, a.serial_number, a.assigned_user, a.model, a.manufacturer, a.network?.ip_address]
        .some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
    return list.sort((x, y) => {
      if (sort === 'last_checkin') return (parseUtc(y.last_checkin_at)?.getTime() ?? 0) - (parseUtc(x.last_checkin_at)?.getTime() ?? 0)
      if (sort === 'manufacturer') return (x.attributes?.manufacturer ?? '').localeCompare(y.attributes?.manufacturer ?? '')
      return (x.hostname ?? '').localeCompare(y.hostname ?? '')
    })
  }, [devices, query, status, os, dept, sort])

  if (!devices) return <Loading />

  const counts = {
    all: devices.length,
    online: devices.filter(d => isOnline(d.last_checkin_at)).length,
    offline: devices.filter(d => !isOnline(d.last_checkin_at)).length,
  }
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))
  const toggle = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }
  const select = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal focus:outline-none'

  return (
    <>
      <PageHeader
        title="Endpoints"
        subtitle={`Manage and monitor organizational devices · ${devices.length.toLocaleString()} devices`}
        actions={
          <>
            <Button variant="secondary" onClick={() => download('nexus-endpoints.csv', toCsv(rows))} disabled={rows.length === 0}>
              <Download size={16} />Export
            </Button>
            <Link to="/endpoints/enroll"><Button><Plus size={16} />Enroll device</Button></Link>
          </>
        }
      />
      <EndpointTabs />

      {devices.length === 0 ? (
        <Card>
          <EmptyState icon={<Monitor size={20} />} title="No devices enrolled yet"
            body="Install the NEXUS agent on a Windows computer and it will appear here within a minute."
            action={<Link to="/endpoints/enroll"><Button><Plus size={16} />Enroll your first device</Button></Link>} />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[16rem] flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query}
                onChange={e => { setQuery(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }) }}
                placeholder="Search hostname, serial, user, IP…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/15" />
            </div>
            <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
              {(['all', 'online', 'offline'] as StatusFilter[]).map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`rounded-md px-3 py-1.5 capitalize ${status === s ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {s === 'all' ? 'All' : s} <span className={status === s ? 'text-navy-300' : 'text-slate-400'}>{counts[s]}</span>
                </button>
              ))}
            </div>
            <select value={os} onChange={e => setOs(e.target.value)} className={select}>
              <option value="all">All operating systems</option>
              {osOptions.map(o => <option key={o}>{o}</option>)}
            </select>
            <select value={dept} onChange={e => setDept(e.target.value)} className={select}>
              <option value="all">All departments</option>
              {deptOptions.map(o => <option key={o}>{o}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <ArrowUpDown size={14} />
              <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className={select}>
                <option value="hostname">Device name</option>
                <option value="last_checkin">Last check-in</option>
                <option value="manufacturer">Manufacturer</option>
              </select>
            </label>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 border-b border-slate-100 bg-teal-50 px-4 py-2.5 text-sm">
              <span className="font-medium text-teal-700">{selected.size} selected</span>
              <Button variant="secondary" className="py-1.5"
                onClick={() => download('nexus-selected-endpoints.csv', toCsv(devices.filter(d => selected.has(d.id))))}>
                <Download size={14} />Export selected
              </Button>
              <span className="text-xs text-slate-500">Remote actions arrive with patch management.</span>
              <button className="ml-auto text-slate-500 hover:text-slate-800" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="w-10 py-3 pl-4"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-teal" /></th>
                  <th className="py-3 pr-4">Device</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Department</th>
                  <th className="py-3 pr-4">Assigned user</th>
                  <th className="py-3 pr-4">Operating system</th>
                  <th className="py-3 pr-4">Last check-in</th>
                  <th className="py-3 pr-4">Warranty</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(d => {
                  const a = d.attributes ?? {}
                  return (
                    <tr key={d.id} onClick={() => navigate(`/endpoints/${d.id}`)}
                      className={`cursor-pointer hover:bg-slate-50 ${selected.has(d.id) ? 'bg-teal-50/40' : ''}`}>
                      <td className="py-3 pl-4" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="accent-teal" />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-navy"><Monitor size={15} /></span>
                          <div>
                            <p className="font-medium text-slate-900">{d.hostname ?? 'Unnamed device'}</p>
                            <p className="text-xs text-slate-500">{[a.manufacturer, a.model].filter(Boolean).join(' ') || d.device_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4"><StatusBadge lastCheckin={d.last_checkin_at} /></td>
                      <td className="py-3 pr-4 text-slate-600">{a.department ?? 'Unassigned'}</td>
                      <td className="py-3 pr-4 text-slate-600">{a.assigned_user ?? 'Not reported'}</td>
                      <td className="py-3 pr-4 text-slate-600">{a.os?.name ?? 'Not reported'}</td>
                      <td className="py-3 pr-4 text-slate-600">{timeAgo(d.last_checkin_at)}</td>
                      <td className="py-3 pr-4">{(() => { const w = parseDate(a.warranty); return <Badge tone={WARRANTY_TONE[w.status ?? 'unknown']}>{warrantyLabel(w)}</Badge> })()}</td>
                      <td className="pr-3 text-slate-300"><ChevronRight size={16} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && <EmptyState title="No devices match" body="Try a different search or clear the filters." />}
          </div>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Showing {rows.length} of {devices.length} devices
          </div>
        </Card>
      )}
    </>
  )
}
