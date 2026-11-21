import { useEffect, useState } from 'react'
import { Plus, Play, CalendarClock, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import { formatDay, formatDate } from '../lib/format'
import { Card, CardHeader, PageHeader, Stat, SeverityBadge, Badge, Loading, EmptyState, Table, Td, Button, Tabs, Modal, Field, inputClass, Bar } from '../components/ui'

type Patch = {
  id: string; kb_id: string; title: string; product: string; classification: string; severity: string; release_date: string
  size_mb: string; approval: string; approved_by: string | null; missing: number; installed: number; failed: number
}
type Summary = { compliance: number | null; pending_approval: number; approved: number; failed_installs: number; missing_installs: number; devices_fully_patched: number; devices_total: number; scheduled_deployments: number }
type Deployment = { id: string; name: string; status: string; scheduled_for: string; patch_count: number; target: { type: string; group_id?: string }; results: Record<string, number>; created_by: string; completed_at: string | null }
type Policy = { id: string; name: string; description: string; rules: Record<string, unknown>; enabled: boolean }
type Group = { id: string; name: string }

type Tab = 'catalog' | 'approvals' | 'deployments' | 'policies'

export default function Patches() {
  const [tab, setTab] = useState<Tab>('catalog')
  const [patches, setPatches] = useState<Patch[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [deps, setDeps] = useState<Deployment[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [newDep, setNewDep] = useState(false)
  const [newPolicy, setNewPolicy] = useState(false)

  const load = () => {
    api.get('/patches').then(r => setPatches(r.data))
    api.get('/patches/summary').then(r => setSummary(r.data))
    api.get('/patches/deployments').then(r => setDeps(r.data))
    api.get('/patches/policies').then(r => setPolicies(r.data))
  }
  useEffect(() => { load(); api.get('/groups').then(r => setGroups(r.data)) }, [])

  const approve = async (id: string, approval: string) => { await api.post(`/patches/${id}/approval`, { approval }); load() }
  const run = async (id: string) => { await api.post(`/patches/deployments/${id}/run`); load() }
  const toggle = async (id: string) => { await api.post(`/patches/policies/${id}/toggle`); load() }

  if (!patches || !summary) return <Loading />
  const pending = patches.filter(p => p.approval === 'pending')
  const approvalTone = (a: string) => a === 'approved' ? 'green' : a === 'declined' ? 'gray' : 'amber'

  const patchRow = (p: Patch, actions: boolean) => {
    const total = p.installed + p.missing + p.failed
    return (
      <tr key={p.id}>
        <Td first><p className="font-medium text-slate-900">{p.title}</p><p className="font-mono text-xs text-slate-500">{p.kb_id} · {p.size_mb} MB</p></Td>
        <Td><SeverityBadge value={p.severity} /></Td>
        <Td className="capitalize text-slate-600">{p.classification}</Td>
        <Td className="text-slate-600">{formatDay(p.release_date)}</Td>
        <Td>
          <div className="w-36">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{p.installed}/{total} installed</span>{p.failed > 0 && <span className="text-red-600">{p.failed} failed</span>}</div>
            <Bar value={p.installed} max={total || 1} />
          </div>
        </Td>
        <Td>
          {actions ? (
            <div className="flex gap-2">
              <Button className="py-1 text-xs" onClick={() => approve(p.id, 'approved')}><CheckCircle2 size={14} />Approve</Button>
              <Button variant="secondary" className="py-1 text-xs" onClick={() => approve(p.id, 'declined')}><XCircle size={14} />Decline</Button>
            </div>
          ) : <Badge tone={approvalTone(p.approval)}><span className="capitalize">{p.approval}</span></Badge>}
        </Td>
      </tr>
    )
  }

  return (
    <>
      <PageHeader title="Patch Management" subtitle="Approve, schedule, and track updates across every device"
        actions={<Button onClick={() => setNewDep(true)}><Plus size={16} />New deployment</Button>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Patch compliance" value={summary.compliance !== null ? `${summary.compliance}%` : 'n/a'} sub="Approved patches installed"
          tone={summary.compliance !== null && summary.compliance >= 95 ? 'text-emerald-600' : 'text-amber-600'} />
        <Stat label="Awaiting approval" value={summary.pending_approval} sub="New patches to review" />
        <Stat label="Fully patched devices" value={`${summary.devices_fully_patched} / ${summary.devices_total}`} sub={`${summary.missing_installs} approved installs still missing`} />
        <Stat label="Failed installs" value={summary.failed_installs} tone={summary.failed_installs ? 'text-red-600' : 'text-slate-900'} sub={`${summary.scheduled_deployments} deployment scheduled`} />
      </div>
      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'catalog', label: 'Patch catalog', count: patches.length },
          { id: 'approvals', label: 'Approval queue', count: pending.length },
          { id: 'deployments', label: 'Deployments', count: deps.length },
          { id: 'policies', label: 'Deployment policies', count: policies.length },
        ]} />
      </div>

      {tab === 'catalog' && <Card><Table head={['Patch', 'Severity', 'Type', 'Released', 'Progress', 'Approval']}>{patches.map(p => patchRow(p, false))}</Table></Card>}

      {tab === 'approvals' && (
        <Card>
          <CardHeader title="Approval queue" subtitle="Approved patches are installed by the next deployment that includes them" />
          {pending.length === 0 ? <EmptyState icon={<CheckCircle2 size={20} />} title="Nothing waiting" body="Every patch has been reviewed." />
            : <Table head={['Patch', 'Severity', 'Type', 'Released', 'Progress', 'Decision']}>{pending.map(p => patchRow(p, true))}</Table>}
        </Card>
      )}

      {tab === 'deployments' && (
        <Card>
          {deps.length === 0 ? <EmptyState icon={<CalendarClock size={20} />} title="No deployments yet" body="Schedule approved patches to install on your devices." /> : (
            <Table head={['Deployment', 'Status', 'Scheduled', 'Patches', 'Results', '']}>
              {deps.map(d => (
                <tr key={d.id}>
                  <Td first><p className="font-medium text-slate-900">{d.name}</p><p className="text-xs text-slate-500">{d.target?.type === 'group' ? `Group: ${groups.find(g => g.id === d.target.group_id)?.name ?? 'Group'}` : 'All devices'}</p></Td>
                  <Td><Badge tone={d.status === 'completed' ? 'green' : d.status === 'failed' ? 'red' : d.status === 'scheduled' ? 'teal' : 'gray'}><span className="capitalize">{d.status}</span></Badge></Td>
                  <Td className="text-slate-600">{formatDate(d.scheduled_for)}</Td>
                  <Td className="text-slate-600">{d.patch_count}</Td>
                  <Td className="text-xs text-slate-600">
                    {d.results?.succeeded !== undefined ? <>
                      <span className="text-emerald-700">{d.results.succeeded} installed</span> · <span className={d.results.failed ? 'text-red-600' : ''}>{d.results.failed} failed</span> · {d.results.pending} waiting for device
                    </> : 'Not run yet'}
                  </Td>
                  <Td>{d.status === 'scheduled' && <Button variant="secondary" className="py-1 text-xs" onClick={() => run(d.id)}><Play size={13} />Run now</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Devices that are offline install their patches the next time they check in.</p>
        </Card>
      )}

      {tab === 'policies' && (
        <>
          <div className="mb-4 flex justify-end"><Button variant="secondary" onClick={() => setNewPolicy(true)}><Plus size={16} />New policy</Button></div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {policies.map(p => (
              <Card key={p.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-slate-900">{p.name}</p><p className="mt-1 text-sm text-slate-500">{p.description}</p></div>
                  <button onClick={() => toggle(p.id)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${p.enabled ? 'bg-teal' : 'bg-slate-300'}`} title={p.enabled ? 'Turn off' : 'Turn on'}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${p.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  {Object.entries(p.rules).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="capitalize text-slate-500">{k.replace(/_/g, ' ')}</dt>
                      <dd className="text-right text-slate-800">{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        </>
      )}

      <NewDeployment open={newDep} onClose={() => setNewDep(false)} patches={patches.filter(p => p.approval === 'approved')} groups={groups}
        onDone={() => { setNewDep(false); setTab('deployments'); load() }} />
      <NewPolicy open={newPolicy} onClose={() => setNewPolicy(false)} onDone={() => { setNewPolicy(false); load() }} />
    </>
  )
}

function NewDeployment({ open, onClose, patches, groups, onDone }: { open: boolean; onClose: () => void; patches: Patch[]; groups: Group[]; onDone: () => void }) {
  const [name, setName] = useState('Patch deployment')
  const [selected, setSelected] = useState<string[]>([])
  const [target, setTarget] = useState('all')
  const [when, setWhen] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    setError('')
    try {
      await api.post('/patches/deployments', {
        name, patch_ids: selected, target: target === 'all' ? { type: 'all' } : { type: 'group', group_id: target },
        scheduled_for: when ? new Date(when).toISOString() : null,
      })
      setSelected([]); onDone()
    } catch { setError('Choose at least one patch.') }
  }
  return (
    <Modal open={open} onClose={onClose} title="New patch deployment">
      <div className="space-y-4">
        <Field label="Name"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Approved patches to include">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {patches.map(p => (
              <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="accent-teal" checked={selected.includes(p.id)}
                  onChange={() => setSelected(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])} />
                <span className="flex-1">{p.title}</span><SeverityBadge value={p.severity} />
              </label>
            ))}
          </div>
        </Field>
        <Field label="Devices">
          <select className={inputClass} value={target} onChange={e => setTarget(e.target.value)}>
            <option value="all">All devices</option>
            {groups.map(g => <option key={g.id} value={g.id}>Group: {g.name}</option>)}
          </select>
        </Field>
        <Field label="Schedule" hint="Leave blank to schedule it for now, then use Run now."><input type="datetime-local" className={inputClass} value={when} onChange={e => setWhen(e.target.value)} /></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit}>Schedule deployment</Button></div>
      </div>
    </Modal>
  )
}

function NewPolicy({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', window: 'Sundays 2:00 to 5:00 AM', auto: 'critical', reboot: 'Prompt user', target: 'All devices' })
  const set = (k: string) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const submit = async () => {
    if (!form.name.trim()) return
    await api.post('/patches/policies', { name: form.name, description: form.description, rules: {
      auto_approve: form.auto === 'none' ? [] : form.auto === 'critical' ? ['critical'] : ['critical', 'important'],
      window: form.window, reboot: form.reboot, target: form.target } })
    onDone()
  }
  return (
    <Modal open={open} onClose={onClose} title="New deployment policy">
      <div className="space-y-4">
        <Field label="Name"><input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Monthly Windows updates" /></Field>
        <Field label="Description"><input className={inputClass} value={form.description} onChange={set('description')} /></Field>
        <Field label="Automatically approve">
          <select className={inputClass} value={form.auto} onChange={set('auto')}>
            <option value="none">Nothing, approve manually</option><option value="critical">Critical updates</option><option value="important">Critical and important updates</option>
          </select>
        </Field>
        <Field label="Maintenance window"><input className={inputClass} value={form.window} onChange={set('window')} /></Field>
        <Field label="Restarts">
          <select className={inputClass} value={form.reboot} onChange={set('reboot')}>
            <option>Prompt user</option><option>Prompt user, force after 24 hours</option><option>Restart automatically</option><option>Not required</option>
          </select>
        </Field>
        <Field label="Applies to"><input className={inputClass} value={form.target} onChange={set('target')} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit}>Create policy</Button></div>
      </div>
    </Modal>
  )
}
