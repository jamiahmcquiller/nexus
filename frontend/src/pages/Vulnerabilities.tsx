import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search, ShieldAlert, Flame, Download } from 'lucide-react'
import { api, type DeviceBrief } from '../lib/api'
import { formatDay, timeAgo } from '../lib/format'
import { Card, CardHeader, PageHeader, Stat, SeverityBadge, Badge, Loading, EmptyState, Table, Td, Button, Bar, toCsv, downloadFile } from '../components/ui'

type Vuln = {
  id: string; cve_id: string; title: string; description: string; severity: string; cvss: number | null; epss: number | null
  known_exploited: boolean; product: string; fixed_version: string; published_at: string; affected_open: number
  affected_total: number; remediated: number; accepted: number; risk_score: number; first_detected: string | null
}
type Summary = {
  open_findings: number; by_severity: Record<string, number>; affected_devices: number; known_exploited_open: number
  remediated_30d: number; mean_days_to_remediate: number | null; unique_vulnerabilities: number
}

const SEV_COLORS: Record<string, string> = { critical: 'bg-red-500', high: 'bg-amber-500', medium: 'bg-navy-700', low: 'bg-slate-300' }

export default function Vulnerabilities() {
  const [vulns, setVulns] = useState<Vuln[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [q, setQ] = useState('')
  const [sev, setSev] = useState('all')
  const [openOnly, setOpenOnly] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/vulnerabilities').then(r => setVulns(r.data))
    api.get('/vulnerabilities/summary').then(r => setSummary(r.data))
  }, [])

  const rows = useMemo(() => (vulns ?? []).filter(v =>
    (!openOnly || v.affected_open > 0) && (sev === 'all' || v.severity === sev) &&
    (!q || [v.cve_id, v.title, v.product].some(x => x?.toLowerCase().includes(q.toLowerCase())))
  ), [vulns, q, sev, openOnly])

  if (!vulns || !summary) return <Loading />
  const total = Object.values(summary.by_severity).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader title="Vulnerability Management" subtitle="Find, prioritize, and fix security weaknesses across your devices"
        actions={<Button variant="secondary" onClick={() => downloadFile('nexus-vulnerabilities.csv', toCsv(rows.map(v => ({
          CVE: v.cve_id, Title: v.title, Severity: v.severity, CVSS: v.cvss, 'Exploited in the wild': v.known_exploited ? 'Yes' : 'No',
          Product: v.product, 'Fixed in': v.fixed_version, 'Open devices': v.affected_open, 'Risk score': v.risk_score,
        }))))}><Download size={16} />Export</Button>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Open findings" value={summary.open_findings} sub={`${summary.unique_vulnerabilities} unique vulnerabilities`} />
        <Stat label="Devices affected" value={summary.affected_devices} sub="With at least one open finding" />
        <Stat label="Exploited in the wild" value={summary.known_exploited_open} tone="text-red-600" sub="Open findings attackers are actively using" />
        <Stat label="Mean time to remediate" value={summary.mean_days_to_remediate !== null ? `${summary.mean_days_to_remediate} days` : 'n/a'}
          sub={`${summary.remediated_30d} fixed in the last 30 days`} />
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Severity distribution</p>
          <p className="text-xs text-slate-500">{total} open findings</p>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
          {['critical', 'high', 'medium', 'low'].map(s => total > 0 && summary.by_severity[s] > 0 && (
            <div key={s} className={SEV_COLORS[s]} style={{ width: `${(summary.by_severity[s] / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-sm">
          {['critical', 'high', 'medium', 'low'].map(s => (
            <button key={s} onClick={() => setSev(sev === s ? 'all' : s)} className={`flex items-center gap-2 ${sev === s ? 'font-semibold' : ''}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${SEV_COLORS[s]}`} /><span className="capitalize text-slate-600">{s}</span>
              <span className="text-slate-900">{summary.by_severity[s]}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search CVE, title, or product"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-teal focus:outline-none" />
          </div>
          <select value={sev} onChange={e => setSev(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="all">All severities</option>
            {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="accent-teal" />Open only
          </label>
        </div>
        {rows.length === 0 ? <EmptyState icon={<ShieldAlert size={20} />} title="No vulnerabilities match" body="Clear the filters to see everything." /> : (
          <Table head={['Vulnerability', 'Severity', 'CVSS', 'Exploit likelihood', 'Product', 'Open devices', 'Priority']}>
            {rows.map(v => (
              <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/vulnerabilities/${v.id}`)}>
                <Td first>
                  <p className="font-mono text-xs text-slate-500">{v.cve_id}</p>
                  <p className="font-medium text-slate-900">{v.title}</p>
                  {v.known_exploited && <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-600"><Flame size={12} />Exploited in the wild</span>}
                </Td>
                <Td><SeverityBadge value={v.severity} /></Td>
                <Td className="font-medium">{v.cvss ?? 'n/a'}</Td>
                <Td className="text-slate-600">{v.epss !== null ? `${Math.round(v.epss * 100)}%` : 'n/a'}</Td>
                <Td className="text-slate-600">{v.product}</Td>
                <Td><span className="font-medium">{v.affected_open}</span><span className="text-slate-400"> / {v.affected_total}</span></Td>
                <Td>
                  <div className="flex w-28 items-center gap-2">
                    <Bar value={v.risk_score} tone={v.risk_score >= 70 ? 'bg-red-500' : v.risk_score >= 50 ? 'bg-amber-500' : 'bg-teal'} />
                    <span className="w-7 text-xs text-slate-600">{Math.round(v.risk_score)}</span>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Priority combines severity (CVSS), the chance of exploitation, whether attackers are already using it, and how many devices are exposed.
        </p>
      </Card>
    </>
  )
}

type Detail = Vuln & { cvss_vector?: string; devices: (DeviceBrief & { status: string; first_detected: string; resolved_at: string | null; note: string | null })[] }

export function VulnerabilityDetail() {
  const { id } = useParams()
  const [v, setV] = useState<Detail | null>(null)
  const load = () => api.get(`/vulnerabilities/${id}`).then(r => setV(r.data))
  useEffect(() => { load() }, [id])

  const setStatus = async (deviceId: string, status: string) => {
    await api.post(`/vulnerabilities/${id}/devices/${deviceId}`, { status })
    load()
  }

  if (!v) return <Loading />
  const tone = (s: string) => s === 'open' ? 'red' : s === 'remediated' ? 'green' : 'gray'

  return (
    <>
      <Link to="/vulnerabilities" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} />All vulnerabilities</Link>
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-red-50 text-red-600"><ShieldAlert size={22} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-slate-500">{v.cve_id}</p>
            <h1 className="text-xl font-semibold text-slate-900">{v.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{v.description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SeverityBadge value={v.severity} />
            {v.known_exploited && <Badge tone="red"><Flame size={12} />Exploited in the wild</Badge>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[['CVSS score', v.cvss ?? 'n/a'], ['Exploit likelihood', v.epss !== null ? `${Math.round((v.epss ?? 0) * 100)}%` : 'n/a'],
            ['Affected product', v.product], ['Fixed in', v.fixed_version || 'Not reported'], ['Published', formatDay(v.published_at)]].map(([k, val]) => (
            <div key={k as string} className="rounded-lg bg-cloud px-4 py-3">
              <p className="text-xs text-slate-500">{k}</p><p className="mt-0.5 text-sm font-medium text-slate-900">{val}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Affected devices" subtitle={`${v.affected_open} open · ${v.remediated} fixed · ${v.accepted} risk accepted`} />
        <Table head={['Device', 'Department', 'Status', 'Detected', 'Actions']}>
          {v.devices.map(d => (
            <tr key={d.id}>
              <Td first><Link to={`/endpoints/${d.id}`} className="font-medium text-slate-900 hover:text-teal">{d.hostname}</Link><p className="text-xs text-slate-500">{d.assigned_user}</p></Td>
              <Td className="text-slate-600">{d.department}</Td>
              <Td><Badge tone={tone(d.status)}><span className="capitalize">{d.status === 'remediated' ? 'Fixed' : d.status === 'accepted' ? 'Risk accepted' : 'Open'}</span></Badge></Td>
              <Td className="text-slate-600">{timeAgo(d.first_detected)}</Td>
              <Td>
                <div className="flex gap-2">
                  {d.status !== 'remediated' && <Button variant="secondary" className="py-1 text-xs" onClick={() => setStatus(d.id, 'remediated')}>Mark fixed</Button>}
                  {d.status === 'open' && <Button variant="ghost" className="py-1 text-xs" onClick={() => setStatus(d.id, 'accepted')}>Accept risk</Button>}
                  {d.status !== 'open' && <Button variant="ghost" className="py-1 text-xs" onClick={() => setStatus(d.id, 'open')}>Reopen</Button>}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}
