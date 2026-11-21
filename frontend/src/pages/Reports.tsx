import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardHeader, PageHeader, Loading, Button, Bar } from '../components/ui'

type Pair = [string, number]
type Data = {
  inventory: { total: number; online: number; by_department: Pair[]; by_os: Pair[]; by_manufacturer: Pair[] }
  vulnerabilities: { by_department: { name: string; critical: number; high: number; medium: number; low: number }[]; top_devices: { id: string; hostname: string; department: string; open: number }[] }
  patches: { name: string; compliance: number | null }[]
  service_desk: { by_status: Pair[]; by_type: Pair[]; by_category: Pair[]; sla_met_pct: number | null }
  warranty: { by_status: Record<string, number>; by_provider: Pair[] }
}

const SEV = [['critical', 'bg-red-500'], ['high', 'bg-amber-500'], ['medium', 'bg-navy-700'], ['low', 'bg-slate-300']] as const
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

function Bars({ rows, tone = 'bg-navy' }: { rows: Pair[]; tone?: string }) {
  const max = Math.max(1, ...rows.map(r => r[1]))
  return (
    <div className="space-y-3 p-5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-slate-600">{label(k)}</span>
          <Bar value={v} max={max} tone={tone} /><span className="w-8 text-right font-medium text-slate-900">{v}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="break-inside-avoid"><h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>{children}</section>
}

export default function Reports() {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => { api.get('/reports').then(r => setD(r.data)) }, [])
  if (!d) return <Loading />
  const vmax = Math.max(1, ...d.vulnerabilities.by_department.map(r => r.critical + r.high + r.medium + r.low))
  const w = d.warranty.by_status

  return (
    <>
      <PageHeader title="Reports" subtitle={`Operational and security analytics · generated ${new Date().toLocaleString()}`}
        actions={<Button variant="secondary" onClick={() => window.print()}><Printer size={16} />Print or save as PDF</Button>} />

      <Section title="Inventory">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card><CardHeader title="Devices by department" subtitle={`${d.inventory.total} devices · ${d.inventory.online} online`} /><Bars rows={d.inventory.by_department} /></Card>
          <Card><CardHeader title="Operating systems" /><Bars rows={d.inventory.by_os} tone="bg-teal" /></Card>
          <Card><CardHeader title="Manufacturers" /><Bars rows={d.inventory.by_manufacturer} tone="bg-slate-500" /></Card>
        </div>
      </Section>

      <Section title="Security exposure">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Open vulnerabilities by department" />
            <div className="space-y-3 p-5">
              {d.vulnerabilities.by_department.map(r => (
                <div key={r.name} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-600">{r.name}</span>
                  <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    {SEV.map(([k, c]) => r[k] > 0 && <div key={k} className={c} style={{ width: `${(r[k] / vmax) * 100}%` }} title={`${r[k]} ${k}`} />)}
                  </div>
                  <span className="w-8 text-right font-medium">{r.critical + r.high + r.medium + r.low}</span>
                </div>
              ))}
              <div className="flex gap-4 pt-2 text-xs text-slate-500">{SEV.map(([k, c]) => <span key={k} className="flex items-center gap-1.5 capitalize"><span className={`h-2 w-2 rounded-full ${c}`} />{k}</span>)}</div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Most exposed devices" />
            <ul className="divide-y divide-slate-100">
              {d.vulnerabilities.top_devices.map(t => (
                <li key={t.id}><Link to={`/endpoints/${t.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50">
                  <span><span className="font-medium text-slate-900">{t.hostname}</span> <span className="text-xs text-slate-500">{t.department}</span></span>
                  <span className="font-semibold text-red-600">{t.open}</span>
                </Link></li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section title="Patching">
        <Card>
          <CardHeader title="Patch compliance by department" subtitle="Share of approved patches installed. Target is 95%." />
          <div className="space-y-3 p-5">
            {d.patches.map(p => (
              <div key={p.name} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 text-slate-600">{p.name}</span>
                <Bar value={p.compliance ?? 0} tone={(p.compliance ?? 0) >= 95 ? 'bg-emerald-500' : (p.compliance ?? 0) >= 80 ? 'bg-amber-500' : 'bg-red-500'} />
                <span className="w-14 text-right font-medium">{p.compliance !== null ? `${p.compliance}%` : 'n/a'}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Service desk">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card><CardHeader title="Tickets by status" subtitle={d.service_desk.sla_met_pct !== null ? `${d.service_desk.sla_met_pct}% of resolved tickets met SLA` : undefined} /><Bars rows={d.service_desk.by_status} tone="bg-teal" /></Card>
          <Card><CardHeader title="Tickets by type" /><Bars rows={d.service_desk.by_type} /></Card>
          <Card><CardHeader title="Top categories" /><Bars rows={d.service_desk.by_category} tone="bg-slate-500" /></Card>
        </div>
      </Section>

      <Section title="Hardware warranty">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Warranty coverage" subtitle={<Link to="/endpoints/warranty" className="text-teal">Open warranty tracker</Link>} />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              {[['active', 'Active', 'text-emerald-600'], ['expiring', 'Ending within 90 days', 'text-amber-600'], ['expired', 'Expired', 'text-red-600'], ['unknown', 'No record', 'text-slate-500']].map(([k, l, c]) => (
                <div key={k} className="rounded-lg bg-cloud p-4"><p className={`text-2xl font-semibold ${c}`}>{w[k] ?? 0}</p><p className="text-xs text-slate-500">{l}</p></div>
              ))}
            </div>
          </Card>
          <Card><CardHeader title="By provider" /><Bars rows={d.warranty.by_provider} tone="bg-navy" /></Card>
        </div>
      </Section>
    </>
  )
}
