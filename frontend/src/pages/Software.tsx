import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, AppWindow, Download } from 'lucide-react'
import { api, type DeviceBrief } from '../lib/api'
import { Card, PageHeader, Stat, Badge, Loading, EmptyState, Table, Td, Button, Tabs, Modal, toCsv, downloadFile } from '../components/ui'

type App = {
  name: string; publisher: string | null; installs: number; versions: { version: string; count: number }[]
  status: 'approved' | 'unapproved' | 'unreviewed'; note: string | null; devices: (DeviceBrief & { version: string })[]
}
type Filter = 'all' | 'approved' | 'unapproved' | 'unreviewed'

export default function Software() {
  const [apps, setApps] = useState<App[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<App | null>(null)
  const load = () => api.get('/software').then(r => { setApps(r.data); setOpen(o => o ? r.data.find((a: App) => a.name === o.name) ?? null : null) })
  useEffect(() => { load() }, [])

  const setRule = async (name: string, status: string) => { await api.post('/software/rules', { name, status }); load() }

  const rows = useMemo(() => (apps ?? []).filter(a => (filter === 'all' || a.status === filter) &&
    (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.publisher?.toLowerCase().includes(q.toLowerCase()))), [apps, filter, q])

  if (!apps) return <Loading />
  const count = (s: Filter) => apps.filter(a => s === 'all' || a.status === s).length
  const unapprovedInstalls = apps.filter(a => a.status === 'unapproved').reduce((n, a) => n + a.installs, 0)
  const tone = (s: string) => s === 'approved' ? 'green' : s === 'unapproved' ? 'red' : 'gray'

  return (
    <>
      <PageHeader title="Software Management" subtitle="Every application installed across your devices"
        actions={<Button variant="secondary" onClick={() => downloadFile('nexus-software.csv', toCsv(rows.map(a => ({
          Application: a.name, Publisher: a.publisher, Installs: a.installs, Versions: a.versions.map(v => `${v.version} (${v.count})`).join('; '), Status: a.status,
        }))))}><Download size={16} />Export</Button>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Applications" value={apps.length} sub="Unique titles found" />
        <Stat label="Total installs" value={apps.reduce((n, a) => n + a.installs, 0)} sub="Across all devices" />
        <Stat label="Unapproved installs" value={unapprovedInstalls} tone={unapprovedInstalls ? 'text-red-600' : 'text-slate-900'} sub="Software that breaks policy" />
        <Stat label="Not yet reviewed" value={count('unreviewed')} sub="Titles with no decision" />
      </div>
      <div className="mt-6">
        <Tabs value={filter} onChange={setFilter} tabs={(['all', 'approved', 'unapproved', 'unreviewed'] as Filter[]).map(f => ({ id: f, label: f === 'all' ? 'All software' : f[0].toUpperCase() + f.slice(1), count: count(f) }))} />
      </div>
      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search applications or publishers"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-teal focus:outline-none" />
          </div>
        </div>
        {rows.length === 0 ? <EmptyState icon={<AppWindow size={20} />} title="No software here" body="Try a different filter." /> : (
          <Table head={['Application', 'Installs', 'Versions', 'Status', '']}>
            {rows.map(a => (
              <tr key={a.name} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(a)}>
                <Td first><p className="font-medium text-slate-900">{a.name}</p><p className="text-xs text-slate-500">{a.publisher ?? 'Unknown publisher'}</p></Td>
                <Td className="font-medium">{a.installs}</Td>
                <Td className="text-xs text-slate-600">{a.versions.slice(0, 3).map(v => `${v.version} (${v.count})`).join(', ')}{a.versions.length > 3 ? ` +${a.versions.length - 3} more` : ''}</Td>
                <Td><Badge tone={tone(a.status)}><span className="capitalize">{a.status}</span></Badge></Td>
                <Td>
                  <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                    {a.status !== 'approved' && <Button variant="secondary" className="py-1 text-xs" onClick={() => setRule(a.name, 'approved')}>Approve</Button>}
                    {a.status !== 'unapproved' && <Button variant="ghost" className="py-1 text-xs text-red-600" onClick={() => setRule(a.name, 'unapproved')}>Mark unapproved</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} width="max-w-2xl">
        {open && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Badge tone={tone(open.status)}><span className="capitalize">{open.status}</span></Badge>
              {open.note && <p className="text-sm text-slate-500">{open.note}</p>}
              {open.status !== 'unreviewed' && <button className="ml-auto text-xs text-slate-500 hover:text-slate-800" onClick={() => setRule(open.name, 'unreviewed')}>Clear decision</button>}
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
              <Table head={['Device', 'User', 'Version']}>
                {open.devices.map(d => (
                  <tr key={d.id}>
                    <Td first><Link to={`/endpoints/${d.id}`} className="font-medium text-slate-900 hover:text-teal">{d.hostname}</Link></Td>
                    <Td className="text-slate-600">{d.assigned_user}</Td>
                    <Td className="font-mono text-xs">{d.version}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <p className="mt-4 text-xs text-slate-500">Installing and removing software remotely arrives when the agent can run actions.</p>
          </>
        )}
      </Modal>
    </>
  )
}
