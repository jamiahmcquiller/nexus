import { useEffect, useState } from 'react'
import { Plus, Play, Zap, ArrowRight, History } from 'lucide-react'
import { api } from '../lib/api'
import { timeAgo, formatDate } from '../lib/format'
import { Card, PageHeader, Stat, Badge, Loading, EmptyState, Button, Modal, Field, inputClass, Table, Td } from '../components/ui'

type Wf = {
  id: string; name: string; description: string | null; trigger: Record<string, string | number>; action: Record<string, string>
  enabled: boolean; schedule: string | null; last_run_at: string | null; run_count: number
  last_run: { status: string; matched: number; actions_taken: number } | null
}
type Run = { status: string; matched: number; actions_taken: number; detail: { items: { device: string; result: string }[] }; started_at?: string }
type Group = { id: string; name: string }

function triggerText(t: Wf['trigger']) {
  switch (t.type) {
    case 'device_offline': return `A device has not checked in for ${t.hours} hours`
    case 'critical_vulnerability': return 'A device has an open critical vulnerability'
    case 'low_disk': return `A device has less than ${t.percent}% free disk space`
    case 'warranty_expiring': return `A warranty ends within ${t.days} days`
    case 'unapproved_software': return 'Unapproved software is installed'
    default: return String(t.type)
  }
}
function actionText(a: Wf['action'], groups: Group[]) {
  if (a.type === 'create_ticket') return `Open a ${a.priority ?? 'medium'} priority ticket`
  if (a.type === 'add_to_group') return `Add the device to ${groups.find(g => g.id === a.group_id)?.name ?? 'a group'}`
  return 'Record an alert in the activity log'
}

export default function Automation() {
  const [wfs, setWfs] = useState<Wf[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{ name: string; run: Run } | null>(null)
  const [history, setHistory] = useState<{ name: string; runs: Run[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => api.get('/workflows').then(r => setWfs(r.data))
  useEffect(() => { load(); api.get('/groups').then(r => setGroups(r.data)) }, [])

  const run = async (w: Wf) => {
    setBusy(w.id)
    try { const r = await api.post(`/workflows/${w.id}/run`); setResult({ name: w.name, run: r.data }); load() } finally { setBusy(null) }
  }
  const toggle = async (w: Wf) => { await api.post(`/workflows/${w.id}/toggle`); load() }
  const showHistory = async (w: Wf) => { const r = await api.get(`/workflows/${w.id}/runs`); setHistory({ name: w.name, runs: r.data }) }

  if (!wfs) return <Loading />
  const totalActions = wfs.reduce((n, w) => n + (w.last_run?.actions_taken ?? 0), 0)

  return (
    <>
      <PageHeader title="Automation" subtitle="Let routine follow-up run itself" actions={<Button onClick={() => setCreating(true)}><Plus size={16} />New workflow</Button>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Workflows" value={wfs.length} sub={`${wfs.filter(w => w.enabled).length} turned on`} />
        <Stat label="Total runs" value={wfs.reduce((n, w) => n + w.run_count, 0)} sub="Since they were created" />
        <Stat label="Actions on last run" value={totalActions} sub="Tickets opened, devices grouped, alerts" />
        <Stat label="Last activity" value={wfs.some(w => w.last_run_at) ? timeAgo(wfs.map(w => w.last_run_at).filter(Boolean).sort().reverse()[0]) : 'Never'} />
      </div>
      {wfs.length === 0 ? <Card className="mt-6"><EmptyState icon={<Zap size={20} />} title="No workflows yet" body="Create one to start automating follow-up." /></Card> : (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {wfs.map(w => (
            <Card key={w.id} className={`p-5 ${w.enabled ? '' : 'opacity-70'}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal"><Zap size={17} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{w.name}</p>
                  {w.description && <p className="text-sm text-slate-500">{w.description}</p>}
                </div>
                <button onClick={() => toggle(w)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${w.enabled ? 'bg-teal' : 'bg-slate-300'}`} title={w.enabled ? 'Turn off' : 'Turn on'}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${w.enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-lg bg-cloud px-3 py-1.5 text-slate-700"><span className="text-xs font-semibold uppercase text-slate-400">When </span>{triggerText(w.trigger)}</span>
                <ArrowRight size={14} className="text-slate-400" />
                <span className="rounded-lg bg-teal-50 px-3 py-1.5 text-teal-700"><span className="text-xs font-semibold uppercase text-teal/60">Then </span>{actionText(w.action, groups)}</span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>{w.schedule ?? 'Manual'} · {w.last_run_at ? `last ran ${timeAgo(w.last_run_at)}` : 'never run'}
                  {w.last_run && ` · ${w.last_run.matched} matched, ${w.last_run.actions_taken} actions`}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" className="py-1 text-xs" onClick={() => showHistory(w)}><History size={13} />History</Button>
                  <Button variant="secondary" className="py-1 text-xs" onClick={() => run(w)} disabled={busy === w.id}><Play size={13} />{busy === w.id ? 'Running…' : 'Run now'}</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title={`${result?.name ?? ''}: results`} width="max-w-xl">
        {result && <RunDetail run={result.run} />}
      </Modal>
      <Modal open={!!history} onClose={() => setHistory(null)} title={`${history?.name ?? ''}: run history`} width="max-w-xl">
        {history && (history.runs.length === 0 ? <p className="text-sm text-slate-500">No runs yet.</p> : (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
            <Table head={['When', 'Result', 'Matched', 'Actions']}>
              {history.runs.map((r, i) => (
                <tr key={i}>
                  <Td first className="text-slate-600">{formatDate(r.started_at)}</Td>
                  <Td><Badge tone={r.status === 'succeeded' ? 'green' : 'gray'}>{r.status === 'no_matches' ? 'Nothing matched' : 'Succeeded'}</Badge></Td>
                  <Td>{r.matched}</Td><Td>{r.actions_taken}</Td>
                </tr>
              ))}
            </Table>
          </div>
        ))}
      </Modal>
      <NewWorkflow open={creating} groups={groups} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />
    </>
  )
}

function RunDetail({ run }: { run: Run }) {
  return (
    <>
      <p className="text-sm text-slate-600">{run.matched} devices matched · {run.actions_taken} actions taken</p>
      {run.detail.items.length > 0 && (
        <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
          {run.detail.items.map((it, i) => <li key={i} className="flex justify-between gap-4 px-4 py-2"><span className="font-medium text-slate-900">{it.device}</span><span className="text-slate-600">{it.result}</span></li>)}
        </ul>
      )}
    </>
  )
}

function NewWorkflow({ open, groups, onClose, onDone }: { open: boolean; groups: Group[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('device_offline')
  const [param, setParam] = useState('24')
  const [action, setAction] = useState('create_ticket')
  const [priority, setPriority] = useState('medium')
  const [groupId, setGroupId] = useState('')
  const [schedule, setSchedule] = useState('Every hour')
  const [error, setError] = useState('')
  const paramFor: Record<string, { key: string; label: string; def: string } | null> = {
    device_offline: { key: 'hours', label: 'Hours without a check-in', def: '24' },
    low_disk: { key: 'percent', label: 'Free disk space below (%)', def: '15' },
    warranty_expiring: { key: 'days', label: 'Days before warranty ends', def: '60' },
    critical_vulnerability: null, unapproved_software: null,
  }
  const p = paramFor[trigger]
  const submit = async () => {
    setError('')
    if (!name.trim()) return setError('Give the workflow a name.')
    const t: Record<string, string | number> = { type: trigger }
    if (p) t[p.key] = Number(param) || Number(p.def)
    const a: Record<string, string> = { type: action }
    if (action === 'create_ticket') a.priority = priority
    if (action === 'add_to_group') { if (!groupId) return setError('Choose a group.'); a.group_id = groupId }
    try { await api.post('/workflows', { name, trigger: t, action: a, schedule }); setName(''); onDone() } catch { setError('Could not save the workflow.') }
  }
  return (
    <Modal open={open} onClose={onClose} title="New workflow">
      <div className="space-y-4">
        <Field label="Name"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Flag old laptops" /></Field>
        <Field label="When">
          <select className={inputClass} value={trigger} onChange={e => { setTrigger(e.target.value); setParam(paramFor[e.target.value]?.def ?? '') }}>
            <option value="device_offline">A device stops checking in</option><option value="critical_vulnerability">A critical vulnerability is open</option>
            <option value="low_disk">Disk space is low</option><option value="warranty_expiring">A warranty is ending</option><option value="unapproved_software">Unapproved software is found</option>
          </select>
        </Field>
        {p && <Field label={p.label}><input type="number" className={inputClass} value={param} onChange={e => setParam(e.target.value)} /></Field>}
        <Field label="Then">
          <select className={inputClass} value={action} onChange={e => setAction(e.target.value)}>
            <option value="create_ticket">Open a service desk ticket</option><option value="add_to_group">Add the device to a group</option><option value="notify">Record an alert</option>
          </select>
        </Field>
        {action === 'create_ticket' && <Field label="Ticket priority"><select className={inputClass} value={priority} onChange={e => setPriority(e.target.value)}>
          {['critical', 'high', 'medium', 'low'].map(x => <option key={x} value={x} className="capitalize">{x}</option>)}</select></Field>}
        {action === 'add_to_group' && <Field label="Group"><select className={inputClass} value={groupId} onChange={e => setGroupId(e.target.value)}>
          <option value="">Choose a group</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
        <Field label="How often"><select className={inputClass} value={schedule} onChange={e => setSchedule(e.target.value)}>
          {['Every hour', 'Daily at 6:00 AM', 'Weekly on Monday', 'Manual only'].map(x => <option key={x}>{x}</option>)}</select></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" className="text-slate-600" onClick={onClose}>Cancel</Button><Button onClick={submit}>Create workflow</Button></div>
      </div>
    </Modal>
  )
}
