import { useEffect, useState } from 'react'
import { Plus, ShieldCheck, Download, Cpu, User } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate, ACTIVITY_LABELS } from '../lib/format'
import { Card, CardHeader, PageHeader, Stat, Badge, Loading, Table, Td, Button, Tabs, Modal, Field, inputClass, Bar, toCsv, downloadFile } from '../components/ui'

type Control = {
  key: string; title: string; category: string; cis: string | null; nist: string | null; mode: 'auto' | 'manual'; detail: string
  status: string; score: number; evidence: string | null; owner: string | null; notes?: string | null; failing_devices: string[]
}
type Summary = { passing: number; total: number; score: number; frameworks: { name: string; passing: number; total: number }[]; open_risks: number; high_risks: number }
type Risk = { id: string; title: string; description: string | null; likelihood: number; impact: number; score: number; level: string; owner: string | null; status: string; treatment: string | null; updated_at: string }
type AuditRow = { action: string; entity_type: string; actor: string; metadata: Record<string, unknown>; occurred_at: string }

const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'gray'> = { passing: 'green', failing: 'red', in_progress: 'amber', not_started: 'gray' }
const STATUS_LABEL: Record<string, string> = { passing: 'Passing', failing: 'Failing', in_progress: 'In progress', not_started: 'Not started' }
type Tab = 'controls' | 'risks' | 'audit'

export default function Compliance() {
  const [tab, setTab] = useState<Tab>('controls')
  const [controls, setControls] = useState<Control[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [risks, setRisks] = useState<Risk[]>([])
  const [log, setLog] = useState<AuditRow[]>([])
  const [editing, setEditing] = useState<Control | null>(null)
  const [riskEdit, setRiskEdit] = useState<Partial<Risk> | null>(null)

  const load = () => {
    api.get('/compliance/controls').then(r => setControls(r.data))
    api.get('/compliance/summary').then(r => setSummary(r.data))
    api.get('/compliance/risks').then(r => setRisks(r.data))
    api.get('/compliance/audit-log').then(r => setLog(r.data))
  }
  useEffect(() => { load() }, [])

  if (!controls || !summary) return <Loading />
  const categories = [...new Set(controls.map(c => c.category))]

  return (
    <>
      <PageHeader title="Security & Compliance" subtitle="Prove your controls are working, track risks, and keep an audit trail"
        actions={tab === 'risks' ? <Button onClick={() => setRiskEdit({ likelihood: 3, impact: 3, status: 'open' })}><Plus size={16} />Add risk</Button>
          : <Button variant="secondary" onClick={() => downloadFile('nexus-compliance-report.csv', toCsv(controls.map(c => ({
            Control: c.title, 'CIS v8': c.cis ?? '', 'NIST CSF': c.nist ?? '', Category: c.category, Checked: c.mode === 'auto' ? 'Automatically' : 'Manually',
            Status: STATUS_LABEL[c.status], Evidence: c.evidence ?? '', Owner: c.owner ?? '',
          }))))}><Download size={16} />Export report</Button>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Controls passing" value={`${summary.passing} / ${summary.total}`} sub={`${summary.score}% overall`}
          tone={summary.score >= 80 ? 'text-emerald-600' : summary.score >= 50 ? 'text-amber-600' : 'text-red-600'} />
        {summary.frameworks.map(f => (
          <Card key={f.name} className="p-5">
            <p className="text-sm text-slate-500">{f.name}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{f.passing} <span className="text-base font-normal text-slate-400">/ {f.total}</span></p>
            <div className="mt-2"><Bar value={f.passing} max={f.total} /></div>
          </Card>
        ))}
        <Stat label="Open risks" value={summary.open_risks} sub={`${summary.high_risks} rated high`} tone={summary.high_risks ? 'text-red-600' : 'text-slate-900'} />
      </div>
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'controls', label: 'Security controls', count: controls.length },
          { id: 'risks', label: 'Risk register', count: risks.length },
          { id: 'audit', label: 'Audit log', count: log.length },
        ]} />
      </div>

      {tab === 'controls' && (
        <div className="space-y-6">
          {categories.map(cat => (
            <Card key={cat}>
              <CardHeader title={cat} />
              <Table head={['Control', 'Framework', 'Checked', 'Status', 'Evidence']}>
                {controls.filter(c => c.category === cat).map(c => (
                  <tr key={c.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(c)}>
                    <Td first><p className="font-medium text-slate-900">{c.title}</p><p className="text-xs text-slate-500">{c.detail}</p></Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">{c.cis ? <p>CIS {c.cis}</p> : null}{c.nist ? <p>NIST {c.nist}</p> : null}{!c.cis && !c.nist && 'Internal policy'}</Td>
                    <Td>{c.mode === 'auto'
                      ? <span className="inline-flex items-center gap-1 text-xs text-teal-700"><Cpu size={12} />Automatically</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-slate-600"><User size={12} />{c.owner ?? 'No owner'}</span>}</Td>
                    <Td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></Td>
                    <Td className="max-w-xs text-xs text-slate-600">{c.evidence ?? 'No evidence yet'}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
          <p className="text-xs text-slate-500">Automatic controls are checked live against device data. Manual controls are updated by their owner with evidence notes.</p>
        </div>
      )}

      {tab === 'risks' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="p-5">
            <p className="text-sm font-semibold text-slate-900">Risk heat map</p>
            <p className="text-xs text-slate-500">Open and mitigating risks by likelihood and impact</p>
            <div className="mt-4 flex gap-2">
              <div className="flex flex-col justify-between py-1 text-[10px] text-slate-400"><span>High</span><span className="-rotate-90">Impact</span><span>Low</span></div>
              <div className="grid flex-1 grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].flatMap(imp => [1, 2, 3, 4, 5].map(lik => {
                  const n = risks.filter(r => r.impact === imp && r.likelihood === lik && ['open', 'mitigating'].includes(r.status)).length
                  const s = imp * lik
                  return <div key={`${imp}-${lik}`} className={`grid aspect-square place-items-center rounded text-xs font-semibold ${s >= 15 ? 'bg-red-100 text-red-700' : s >= 8 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{n || ''}</div>
                }))}
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">Likelihood, low to high</p>
          </Card>
          <Card className="xl:col-span-2">
            <Table head={['Risk', 'Score', 'Owner', 'Status']}>
              {risks.map(r => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setRiskEdit(r)}>
                  <Td first><p className="font-medium text-slate-900">{r.title}</p><p className="text-xs text-slate-500">{r.treatment}</p></Td>
                  <Td><Badge tone={r.level === 'high' ? 'red' : r.level === 'medium' ? 'amber' : 'green'}>{r.score} {r.level}</Badge></Td>
                  <Td className="text-slate-600">{r.owner ?? 'Unassigned'}</Td>
                  <Td className="capitalize text-slate-600">{r.status}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      {tab === 'audit' && (
        <Card>
          <CardHeader title="Audit log" subtitle="Every administrative action, newest first"
            action={<Button variant="secondary" className="py-1.5 text-xs" onClick={() => downloadFile('nexus-audit-log.csv', toCsv(log.map(e => ({
              Time: e.occurred_at, Actor: e.actor, Action: ACTIVITY_LABELS[e.action] ?? e.action, Details: JSON.stringify(e.metadata),
            }))))}><Download size={14} />Export</Button>} />
          <Table head={['When', 'Who', 'What', 'Details']}>
            {log.map((e, i) => (
              <tr key={i}>
                <Td first className="whitespace-nowrap text-slate-600">{formatDate(e.occurred_at)}</Td>
                <Td className="text-slate-700">{e.actor}</Td>
                <Td className="text-slate-900">{ACTIVITY_LABELS[e.action] ?? e.action}</Td>
                <Td className="text-xs text-slate-500">{String(e.metadata.hostname ?? e.metadata.name ?? e.metadata.number ?? '')}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <ControlModal control={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
      <RiskModal risk={riskEdit} onClose={() => setRiskEdit(null)} onDone={() => { setRiskEdit(null); load() }} />
    </>
  )
}

function ControlModal({ control, onClose, onDone }: { control: Control | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ status: '', owner: '', evidence: '' })
  useEffect(() => { if (control) setForm({ status: control.status, owner: control.owner ?? '', evidence: (control.mode === 'auto' ? control.notes : control.evidence) ?? '' }) }, [control])
  if (!control) return null
  const save = async () => {
    await api.patch(`/compliance/controls/${control.key}`, control.mode === 'manual' ? form : { owner: form.owner, evidence: form.evidence })
    onDone()
  }
  return (
    <Modal open onClose={onClose} title={control.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {control.cis && <Badge tone="navy">CIS Controls v8: {control.cis}</Badge>}
          {control.nist && <Badge tone="navy">NIST CSF: {control.nist}</Badge>}
          <Badge tone={STATUS_TONE[control.status]}>{STATUS_LABEL[control.status]}</Badge>
        </div>
        <p className="text-sm text-slate-600">{control.detail}</p>
        {control.mode === 'auto' ? (
          <div className="rounded-lg bg-cloud p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-slate-900"><ShieldCheck size={15} className="text-teal" />Checked automatically: {control.evidence}</p>
            {control.failing_devices.length > 0 && <p className="mt-2 text-slate-600">Needs attention: {control.failing_devices.join(', ')}</p>}
          </div>
        ) : (
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        <Field label="Owner"><input className={inputClass} value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} /></Field>
        <Field label={control.mode === 'auto' ? 'Notes' : 'Evidence'} hint="Where the proof lives and what it shows.">
          <textarea className={inputClass} rows={3} value={form.evidence} onChange={e => setForm(f => ({ ...f, evidence: e.target.value }))} />
        </Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></div>
      </div>
    </Modal>
  )
}

function RiskModal({ risk, onClose, onDone }: { risk: Partial<Risk> | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Partial<Risk>>({})
  useEffect(() => { if (risk) setF(risk) }, [risk])
  if (!risk) return null
  const set = (k: keyof Risk) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: ['likelihood', 'impact'].includes(k) ? Number(e.target.value) : e.target.value }))
  const save = async () => {
    if (!f.title?.trim()) return
    const body = { title: f.title, description: f.description, likelihood: f.likelihood, impact: f.impact, owner: f.owner, status: f.status, treatment: f.treatment }
    if (risk.id) await api.patch(`/compliance/risks/${risk.id}`, body); else await api.post('/compliance/risks', body)
    onDone()
  }
  const scale = [1, 2, 3, 4, 5]
  return (
    <Modal open onClose={onClose} title={risk.id ? 'Edit risk' : 'Add risk'}>
      <div className="space-y-4">
        <Field label="Risk"><input className={inputClass} value={f.title ?? ''} onChange={set('title')} placeholder="What could go wrong?" /></Field>
        <Field label="Description"><textarea className={inputClass} rows={2} value={f.description ?? ''} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Likelihood (1 to 5)"><select className={inputClass} value={f.likelihood} onChange={set('likelihood')}>{scale.map(n => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Impact (1 to 5)"><select className={inputClass} value={f.impact} onChange={set('impact')}>{scale.map(n => <option key={n}>{n}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner"><input className={inputClass} value={f.owner ?? ''} onChange={set('owner')} /></Field>
          <Field label="Status"><select className={inputClass} value={f.status} onChange={set('status')}>{['open', 'mitigating', 'accepted', 'closed'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}</select></Field>
        </div>
        <Field label="Treatment plan"><textarea className={inputClass} rows={2} value={f.treatment ?? ''} onChange={set('treatment')} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save risk</Button></div>
      </div>
    </Modal>
  )
}
