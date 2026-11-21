import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Download, Pencil, ShieldCheck } from 'lucide-react'
import { api, type DeviceBrief, type Warranty } from '../lib/api'
import { formatDay } from '../lib/format'
import { Card, PageHeader, Badge, Loading, EmptyState, Table, Td, Button, Modal, Field, inputClass, Tabs, toCsv, downloadFile } from '../components/ui'
import { EndpointTabs } from './Endpoints'

type Row = DeviceBrief & { manufacturer?: string; model?: string; serial_number?: string; warranty: Warranty }
type Data = { summary: Record<string, number>; devices: Row[]; coverage_options: string[] }
type Filter = 'all' | 'active' | 'expiring' | 'expired' | 'unknown'

export const WARRANTY_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { active: 'green', expiring: 'amber', expired: 'red', unknown: 'gray' }
export function warrantyLabel(w?: Warranty) {
  if (!w || w.status === 'unknown' || w.days_left == null) return 'No record'
  if (w.status === 'expired') return `Expired ${Math.abs(w.days_left)} days ago`
  if (w.status === 'expiring') return `Ends in ${w.days_left} days`
  return w.days_left > 365 ? `${(w.days_left / 365).toFixed(1)} years left` : `${w.days_left} days left`
}

// Minimal CSV parser: handles quoted fields and commas inside quotes
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim()))
  if (!head) return []
  const keys = head.map(h => h.trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''))
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

export default function WarrantyPage() {
  const [data, setData] = useState<Data | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Row | null>(null)
  const [importResult, setImportResult] = useState<{ updated: number; unmatched: string[]; invalid: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => api.get('/warranty').then(r => setData(r.data))
  useEffect(() => { load() }, [])

  const rows = useMemo(() => (data?.devices ?? []).filter(r => filter === 'all' || r.warranty.status === filter), [data, filter])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const parsed = parseCsv(await f.text()).map(r => ({
      serial_number: r.serial_number || r.serial || undefined, hostname: r.hostname || r.device || undefined,
      provider: r.provider || r.vendor || undefined, coverage: r.coverage || undefined,
      start_date: r.start_date || r.start || undefined, end_date: r.end_date || r.end || r.expires || undefined,
    }))
    const res = await api.post('/warranty/import', { rows: parsed })
    setImportResult(res.data)
    if (fileRef.current) fileRef.current.value = ''
    load()
  }

  if (!data) return <Loading />
  const s = data.summary

  return (
    <>
      <PageHeader title="Endpoints" subtitle="Hardware warranty coverage for every device"
        actions={<>
          <Button variant="secondary" onClick={() => downloadFile('nexus-warranty.csv', toCsv(data.devices.map(r => ({
            hostname: r.hostname, serial_number: r.serial_number, manufacturer: r.manufacturer, model: r.model,
            provider: r.warranty.provider ?? '', coverage: r.warranty.coverage ?? '', start_date: r.warranty.start_date ?? '', end_date: r.warranty.end_date ?? '',
          }))))}><Download size={16} />Export</Button>
          <Button onClick={() => fileRef.current?.click()}><Upload size={16} />Import spreadsheet</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        </>} />
      <EndpointTabs />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {([['active', 'Active coverage', 'text-emerald-600'], ['expiring', 'Ending within 90 days', 'text-amber-600'], ['expired', 'Expired', 'text-red-600'], ['unknown', 'No warranty record', 'text-slate-500']] as const).map(([k, l, c]) => (
          <button key={k} onClick={() => setFilter(filter === k ? 'all' : k)} className="text-left">
            <Card className={`p-5 ${filter === k ? 'ring-2 ring-teal' : ''}`}><p className="text-sm text-slate-500">{l}</p><p className={`mt-2 text-2xl font-semibold ${c}`}>{s[k] ?? 0}</p></Card>
          </button>
        ))}
      </div>
      <div className="mt-6">
        <Tabs value={filter} onChange={setFilter} tabs={(['all', 'expiring', 'expired', 'unknown', 'active'] as Filter[]).map(f => ({
          id: f, label: f === 'all' ? 'All devices' : f === 'unknown' ? 'No record' : f[0].toUpperCase() + f.slice(1), count: f === 'all' ? data.devices.length : s[f] ?? 0 }))} />
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState icon={<ShieldCheck size={20} />} title="Nothing here" body="No devices match this filter." /> : (
          <Table head={['Device', 'Serial number', 'Provider and coverage', 'Ends', 'Status', '']}>
            {rows.map(r => (
              <tr key={r.id}>
                <Td first><Link to={`/endpoints/${r.id}`} className="font-medium text-slate-900 hover:text-teal">{r.hostname}</Link><p className="text-xs text-slate-500">{r.manufacturer} {r.model}</p></Td>
                <Td className="font-mono text-xs text-slate-600">{r.serial_number}</Td>
                <Td><p className="text-slate-800">{r.warranty.provider ?? 'Not set'}</p><p className="text-xs text-slate-500">{r.warranty.coverage}</p></Td>
                <Td className="text-slate-600">{formatDay(r.warranty.end_date)}</Td>
                <Td><Badge tone={WARRANTY_TONE[r.warranty.status ?? 'unknown']}>{warrantyLabel(r.warranty)}</Badge></Td>
                <Td><Button variant="ghost" className="py-1 text-xs" onClick={() => setEditing(r)}><Pencil size={13} />Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Import a spreadsheet saved as CSV with columns serial_number (or hostname), provider, coverage, start_date, end_date. Dates as YYYY-MM-DD.
          Automatic lookup from Dell, Lenovo, and HP comes once vendor API keys are added.
        </p>
      </Card>

      <WarrantyModal row={editing} coverage={data.coverage_options} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
      <Modal open={!!importResult} onClose={() => setImportResult(null)} title="Import finished">
        {importResult && (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-emerald-700">{importResult.updated} devices updated</p>
            {importResult.unmatched.length > 0 && <p className="text-slate-600">Not matched to a device: {importResult.unmatched.join(', ')}</p>}
            {importResult.invalid.length > 0 && <p className="text-red-600">Unreadable end date for: {importResult.invalid.join(', ')}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}

export function WarrantyModal({ row, coverage, onClose, onDone }: { row: { id: string; hostname: string | null; warranty?: Warranty } | null; coverage?: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Warranty>({})
  const [error, setError] = useState('')
  useEffect(() => { if (row) { setF(row.warranty ?? {}); setError('') } }, [row])
  if (!row) return null
  const set = (k: keyof Warranty) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    try {
      await api.put(`/warranty/${row.id}`, {
        provider: f.provider || null, coverage: f.coverage || null, start_date: f.start_date || null, end_date: f.end_date || null,
        purchase_date: f.purchase_date || null, order_number: f.order_number || null, notes: f.notes || null,
      })
      onDone()
    } catch { setError('Check the dates: the end date must be after the start date.') }
  }
  const options = coverage ?? ['Basic hardware', 'Next business day onsite', 'Premium support', 'Accidental damage', 'Extended']
  return (
    <Modal open onClose={onClose} title={`Warranty for ${row.hostname}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider"><input className={inputClass} value={f.provider ?? ''} onChange={set('provider')} placeholder="e.g. Dell" /></Field>
          <Field label="Coverage">
            <input className={inputClass} list="coverage-options" value={f.coverage ?? ''} onChange={set('coverage')} />
            <datalist id="coverage-options">{options.map(o => <option key={o} value={o} />)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><input type="date" className={inputClass} value={f.start_date?.slice(0, 10) ?? ''} onChange={set('start_date')} /></Field>
          <Field label="End date"><input type="date" className={inputClass} value={f.end_date?.slice(0, 10) ?? ''} onChange={set('end_date')} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase date"><input type="date" className={inputClass} value={f.purchase_date?.slice(0, 10) ?? ''} onChange={set('purchase_date')} /></Field>
          <Field label="Order number"><input className={inputClass} value={f.order_number ?? ''} onChange={set('order_number')} /></Field>
        </div>
        <Field label="Notes"><textarea className={inputClass} rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" className="text-slate-600" onClick={onClose}>Cancel</Button><Button onClick={save}>Save warranty</Button></div>
      </div>
    </Modal>
  )
}
