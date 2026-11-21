import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, Search, ArrowLeft, LifeBuoy, Bot, Globe, Lock, Send, CheckCircle2 } from 'lucide-react'
import { api, type Device, type DeviceBrief } from '../lib/api'
import { formatDate, timeAgo, timeUntil } from '../lib/format'
import { Card, CardHeader, PageHeader, Stat, SeverityBadge, Badge, Loading, EmptyState, Table, Td, Button, Tabs, Modal, Field, inputClass } from '../components/ui'

type Ticket = {
  id: string; number: string; type: 'incident' | 'request' | 'change'; title: string; description: string | null
  priority: string; status: string; category: string | null; requester: string | null; assignee: string | null
  approval: string | null; source: string; device: DeviceBrief | null; sla_due_at: string; sla: string
  created_at: string; updated_at: string; resolved_at: string | null
  comments?: { author: string; body: string; internal: boolean; created_at: string }[]
}
type Summary = { open: number; unassigned: number; breached: number; awaiting_approval: number; sla_met_pct: number | null; avg_resolution_hours: number | null }

const STATUS_LABEL: Record<string, string> = { new: 'New', in_progress: 'In progress', waiting: 'Waiting on user', resolved: 'Resolved', closed: 'Closed' }
const STATUS_TONE: Record<string, 'teal' | 'navy' | 'amber' | 'green' | 'gray'> = { new: 'teal', in_progress: 'navy', waiting: 'amber', resolved: 'green', closed: 'gray' }
const SLA_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { on_track: 'green', at_risk: 'amber', breached: 'red', met: 'green', none: 'gray' }
const SLA_LABEL: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', breached: 'Breached', met: 'Met', none: 'No SLA' }
const SOURCE_ICON = { automation: Bot, portal: Globe, console: LifeBuoy }

type View = 'open' | 'mine' | 'unassigned' | 'approvals' | 'resolved' | 'all'

export default function ServiceDesk() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [me, setMe] = useState('')
  const [view, setView] = useState<View>('open')
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const load = () => {
    api.get('/tickets').then(r => setTickets(r.data))
    api.get('/tickets/summary').then(r => setSummary(r.data))
  }
  useEffect(() => { load(); api.get('/organization').then(r => setMe(r.data.user.username)) }, [])

  const isOpen = (t: Ticket) => ['new', 'in_progress', 'waiting'].includes(t.status)
  const views: Record<View, (t: Ticket) => boolean> = {
    open: isOpen, mine: t => isOpen(t) && t.assignee === me, unassigned: t => isOpen(t) && !t.assignee,
    approvals: t => isOpen(t) && t.approval === 'pending', resolved: t => !isOpen(t), all: () => true,
  }
  const rows = useMemo(() => (tickets ?? []).filter(t => views[view](t) && (type === 'all' || t.type === type) &&
    (!q || [t.number, t.title, t.requester, t.device?.hostname].some(x => x?.toLowerCase().includes(q.toLowerCase())))), [tickets, view, type, q, me])

  if (!tickets || !summary) return <Loading />

  return (
    <>
      <PageHeader title="Service Desk" subtitle="Incidents, requests, and changes in one queue"
        actions={<>
          <Link to="/service-desk/portal"><Button variant="secondary"><Globe size={16} />Employee portal</Button></Link>
          <Button onClick={() => setCreating(true)}><Plus size={16} />New ticket</Button>
        </>} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Open tickets" value={summary.open} sub={`${summary.unassigned} unassigned`} />
        <Stat label="SLA breached" value={summary.breached} tone={summary.breached ? 'text-red-600' : 'text-slate-900'} sub="Open tickets past their due time" />
        <Stat label="Awaiting approval" value={summary.awaiting_approval} sub="Requests and changes" />
        <Stat label="SLA met" value={summary.sla_met_pct !== null ? `${summary.sla_met_pct}%` : 'n/a'}
          sub={summary.avg_resolution_hours !== null ? `Average resolution ${summary.avg_resolution_hours} hr` : 'No resolved tickets yet'} />
      </div>
      <div className="mt-6">
        <Tabs value={view} onChange={setView} tabs={([['open', 'Open'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'], ['approvals', 'Needs approval'], ['resolved', 'Resolved'], ['all', 'All']] as [View, string][])
          .map(([id, label]) => ({ id, label, count: tickets.filter(views[id]).length }))} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, title, requester, or device"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-teal focus:outline-none" />
          </div>
          <select value={type} onChange={e => setType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="all">All types</option><option value="incident">Incidents</option><option value="request">Requests</option><option value="change">Changes</option>
          </select>
        </div>
        {rows.length === 0 ? <EmptyState icon={<LifeBuoy size={20} />} title="Nothing in this view" body="Tickets that match will show up here." /> : (
          <Table head={['Ticket', 'Priority', 'Status', 'Requester', 'Assignee', 'SLA', 'Updated']}>
            {rows.map(t => {
              const Icon = SOURCE_ICON[t.source as keyof typeof SOURCE_ICON] ?? LifeBuoy
              return (
                <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/service-desk/${t.id}`)}>
                  <Td first>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-navy" title={`Source: ${t.source}`}><Icon size={14} /></span>
                      <div><p className="font-mono text-xs text-slate-500">{t.number}{t.device ? ` · ${t.device.hostname}` : ''}</p><p className="font-medium text-slate-900">{t.title}</p></div>
                    </div>
                  </Td>
                  <Td><SeverityBadge value={t.priority} /></Td>
                  <Td><Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>{t.approval === 'pending' && <p className="mt-1 text-xs text-amber-600">Needs approval</p>}</Td>
                  <Td className="text-slate-600">{t.requester}</Td>
                  <Td className={t.assignee ? 'text-slate-600' : 'text-slate-400'}>{t.assignee ?? 'Unassigned'}</Td>
                  <Td><Badge tone={SLA_TONE[t.sla]}>{SLA_LABEL[t.sla]}</Badge>{isOpen(t) && <p className="mt-1 text-xs text-slate-500">{timeUntil(t.sla_due_at)}</p>}</Td>
                  <Td className="text-slate-500">{timeAgo(t.updated_at)}</Td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
      <NewTicket open={creating} onClose={() => setCreating(false)} onDone={id => { setCreating(false); navigate(`/service-desk/${id}`) }} />
    </>
  )
}

export function NewTicket({ open, onClose, onDone, portal, deviceId }: { open: boolean; onClose: () => void; onDone: (id: string) => void; portal?: boolean; deviceId?: string }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [form, setForm] = useState({ type: 'incident', title: '', description: '', priority: 'medium', category: '', device_id: '', requester: '' })
  const [error, setError] = useState('')
  useEffect(() => { if (open) { api.get('/devices/').then(r => setDevices(r.data)); if (deviceId) setForm(f => ({ ...f, device_id: deviceId })) } }, [open, deviceId])
  const set = (k: string) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const submit = async () => {
    setError('')
    if (!form.title.trim()) return setError('Add a short title.')
    const r = await api.post('/tickets', { ...form, device_id: form.device_id || null, requester: form.requester || null, source: portal ? 'portal' : 'console' })
    setForm({ type: 'incident', title: '', description: '', priority: 'medium', category: '', device_id: '', requester: '' })
    onDone(r.data.id)
  }
  return (
    <Modal open={open} onClose={onClose} title="New ticket">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputClass} value={form.type} onChange={set('type')}>
              <option value="incident">Incident (something is broken)</option><option value="request">Service request</option><option value="change">Change</option>
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputClass} value={form.priority} onChange={set('priority')}>
              <option value="critical">Critical (4 hr SLA)</option><option value="high">High (8 hr)</option><option value="medium">Medium (24 hr)</option><option value="low">Low (72 hr)</option>
            </select>
          </Field>
        </div>
        <Field label="Title"><input className={inputClass} value={form.title} onChange={set('title')} placeholder="e.g. Laptop will not connect to Wi-Fi" /></Field>
        <Field label="Details"><textarea className={inputClass} rows={3} value={form.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><input className={inputClass} value={form.category} onChange={set('category')} placeholder="e.g. Network" /></Field>
          <Field label="Requester"><input className={inputClass} value={form.requester} onChange={set('requester')} placeholder="Defaults to you" /></Field>
        </div>
        <Field label="Related device">
          <select className={inputClass} value={form.device_id} onChange={set('device_id')}>
            <option value="">None</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.hostname} ({d.attributes?.assigned_user ?? 'unassigned'})</option>)}
          </select>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit}>Create ticket</Button></div>
      </div>
    </Modal>
  )
}

export function TicketDetail() {
  const { id } = useParams()
  const [t, setT] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [me, setMe] = useState('')
  const load = () => api.get(`/tickets/${id}`).then(r => setT(r.data))
  useEffect(() => { load(); api.get('/organization').then(r => setMe(r.data.user.username)) }, [id])

  const update = async (patch: Record<string, string>) => { await api.patch(`/tickets/${id}`, patch); load() }
  const send = async () => { if (!reply.trim()) return; await api.post(`/tickets/${id}/comments`, { body: reply, internal }); setReply(''); load() }

  if (!t) return <Loading />
  const open = ['new', 'in_progress', 'waiting'].includes(t.status)
  const sel = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm w-full'

  return (
    <>
      <Link to="/service-desk" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} />Service desk</Link>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <p className="font-mono text-sm text-slate-500">{t.number} · <span className="capitalize">{t.type}</span>{t.category ? ` · ${t.category}` : ''}</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">{t.title}</h1>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{t.description || 'No details provided.'}</p>
            <p className="mt-4 text-xs text-slate-500">Opened by {t.requester} {timeAgo(t.created_at)} via {t.source}</p>
          </Card>
          <Card>
            <CardHeader title="Conversation" />
            <ul className="divide-y divide-slate-100">
              {(t.comments ?? []).map((c, i) => (
                <li key={i} className={`px-5 py-4 ${c.internal ? 'bg-amber-50/40' : ''}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900">{c.author}</span>
                    {c.internal && <span className="inline-flex items-center gap-1 text-xs text-amber-700"><Lock size={11} />Internal note</span>}
                    <span className="ml-auto text-xs text-slate-400">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-100 p-4">
              <textarea className={inputClass} rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder={internal ? 'Add an internal note (not visible to the requester)' : 'Reply to the requester'} />
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="accent-teal" checked={internal} onChange={e => setInternal(e.target.checked)} />Internal note</label>
                <Button onClick={send}><Send size={14} />Send</Button>
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-slate-500">SLA</span><Badge tone={SLA_TONE[t.sla]}>{SLA_LABEL[t.sla]}</Badge></div>
            {open && <p className="-mt-2 text-right text-xs text-slate-500">Due {formatDate(t.sla_due_at)} ({timeUntil(t.sla_due_at)})</p>}
            <Field label="Status">
              <select className={sel} value={t.status} onChange={e => update({ status: e.target.value })}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={sel} value={t.priority} onChange={e => update({ priority: e.target.value })}>
                {['critical', 'high', 'medium', 'low'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <div className="flex gap-2">
                <input className={inputClass} defaultValue={t.assignee ?? ''} key={t.assignee} onBlur={e => e.target.value !== (t.assignee ?? '') && update({ assignee: e.target.value })} placeholder="Unassigned" />
                {t.assignee !== me && <Button variant="secondary" onClick={() => update({ assignee: me })}>Take it</Button>}
              </div>
            </Field>
            {t.approval && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Approval</span>
                  <Badge tone={t.approval === 'approved' ? 'green' : t.approval === 'rejected' ? 'red' : 'amber'}><span className="capitalize">{t.approval}</span></Badge></div>
                {t.approval === 'pending' && <div className="mt-3 flex gap-2">
                  <Button className="flex-1 py-1.5 text-xs" onClick={() => update({ approval: 'approved' })}>Approve</Button>
                  <Button variant="secondary" className="flex-1 py-1.5 text-xs" onClick={() => update({ approval: 'rejected' })}>Reject</Button>
                </div>}
              </div>
            )}
          </Card>
          {t.device && (
            <Card className="p-5">
              <p className="text-sm font-semibold text-slate-900">Related device</p>
              <Link to={`/endpoints/${t.device.id}`} className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                <div><p className="font-medium text-slate-900">{t.device.hostname}</p><p className="text-xs text-slate-500">{t.device.os} · {t.device.department}</p></div>
                <Badge tone={t.device.online ? 'green' : 'gray'}>{t.device.online ? 'Online' : 'Offline'}</Badge>
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

export function EmployeePortal() {
  const [done, setDone] = useState<string | null>(null)
  const [form, setForm] = useState({ type: 'incident', title: '', description: '', priority: 'medium', requester: '' })
  const set = (k: string) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const submit = async () => {
    if (!form.title.trim() || !form.requester.trim()) return
    const r = await api.post('/tickets', { ...form, source: 'portal', category: form.type === 'request' ? 'Request' : 'Help' })
    setDone(r.data.number)
    setForm({ type: 'incident', title: '', description: '', priority: 'medium', requester: form.requester })
  }
  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/service-desk" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} />Service desk</Link>
      <Card className="overflow-hidden">
        <div className="bg-navy px-6 py-8 text-white">
          <p className="text-xs uppercase tracking-[0.14em] text-navy-300">IT Help Center</p>
          <h1 className="mt-2 text-2xl font-semibold">How can we help?</h1>
          <p className="mt-1 text-sm text-slate-300">This is what employees see. Anything submitted here lands in the service desk queue.</p>
        </div>
        <div className="space-y-4 p-6">
          {done && <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 size={16} />Submitted as {done}. IT will follow up soon.</div>}
          <div className="grid grid-cols-2 gap-3">
            {[['incident', 'Report a problem', 'Something is broken or not working'], ['request', 'Request something', 'Software, access, or equipment']].map(([v, title, sub]) => (
              <button key={v} onClick={() => setForm(f => ({ ...f, type: v }))}
                className={`rounded-lg border p-4 text-left ${form.type === v ? 'border-teal bg-teal-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <p className="font-medium text-slate-900">{title}</p><p className="text-xs text-slate-500">{sub}</p>
              </button>
            ))}
          </div>
          <Field label="Your name or username"><input className={inputClass} value={form.requester} onChange={set('requester')} /></Field>
          <Field label="What do you need?"><input className={inputClass} value={form.title} onChange={set('title')} /></Field>
          <Field label="Details"><textarea className={inputClass} rows={4} value={form.description} onChange={set('description')} /></Field>
          <Field label="How urgent is it?">
            <select className={inputClass} value={form.priority} onChange={set('priority')}>
              <option value="low">Whenever you can</option><option value="medium">Soon, it is slowing me down</option><option value="high">I cannot work</option><option value="critical">Many people cannot work</option>
            </select>
          </Field>
          <Button className="w-full py-2.5" onClick={submit}>Submit</Button>
        </div>
      </Card>
    </div>
  )
}
