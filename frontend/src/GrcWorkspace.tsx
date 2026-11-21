// GRC workspace — Governance, Risk & Compliance (v0.5.0).
//
// Enterprise module, restrained aesthetic: midnight navy headings, teal
// primary actions, cloud gray background (inherited), slate secondary
// text, subtle borders, compact tables. No gradients, decorative cards,
// or illustrations. All data comes from the real /api/v1/grc/*
// endpoints; demo rows are always flagged with a "Demo" pill and are
// never presented as the organization's own compliance data.
//
// The parent (App.tsx) renders this component and passes the API base
// and auth headers; this file owns its own category state.
import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { NEXUS_COLORS, statusBadgeClasses } from './theme'

type Row = Record<string, any>
type Headers = Record<string, string>

const STANDARDS = ['CIS v8', 'NIST CSF 2.0', 'ISO 27001', 'SOC 2', 'HIPAA', 'GDPR', 'PCI DSS', 'Cyber Essentials']
const SEVERITIES = ['critical', 'high', 'medium', 'low']

function displayName(r: Row): string {
  return r.name || r.title || r.key || r.control_ref || r.id || '—'
}

function fmtDate(v: any): string {
  if (!v) return '—'
  return String(v).slice(0, 10)
}

function fmtDateTime(v: any): string {
  if (!v) return '—'
  return String(v).replace('T', ' ').slice(0, 16)
}

function Badge({ value }: { value: string }) {
  const b = statusBadgeClasses(value)
  return (
    <span style={{ color: b.color, background: b.background, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {String(value).replace(/_/g, ' ')}
    </span>
  )
}

function DemoPill({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) return null
  const b = statusBadgeClasses('pending')
  return (
    <span style={{ color: b.color, background: b.background, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600, marginLeft: 6, whiteSpace: 'nowrap' }}>
      Demo
    </span>
  )
}

function Btn({ label, onClick, primary, disabled }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: primary ? NEXUS_COLORS.teal : NEXUS_COLORS.white,
        color: primary ? NEXUS_COLORS.white : NEXUS_COLORS.slateDark,
        border: `1px solid ${primary ? NEXUS_COLORS.teal : NEXUS_COLORS.border}`,
        borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}

// ------------------------------------------------------------------ fields
type Field = {
  name: string
  label: string
  type: 'text' | 'select' | 'date' | 'number' | 'textarea'
  options?: string[]
  optionsFrom?: 'frameworks' | 'controls' | 'findings'
  placeholder?: string
}

type Workflow = { label: string; path: string }

type ResourceConfig = {
  key: string
  label: string
  description: string
  endpoint: string
  columns: { key: string; label: string }[]
  statusOptions: string[]
  extraFilter?: { key: string; label: string; options: string[] }
  fields: Field[]
  workflows: Workflow[]
  showScore?: boolean
}

type Lookups = { frameworks: Row[]; controls: Row[]; findings: Row[] }

const FRAMEWORK_FIELDS: Field[] = [
  { name: 'name', label: 'Framework name', type: 'text', placeholder: 'e.g. CIS Controls v8' },
  { name: 'standard', label: 'Standard', type: 'select', options: STANDARDS },
  { name: 'version', label: 'Version', type: 'text', placeholder: 'e.g. 8.0' },
  { name: 'owner', label: 'Owner', type: 'text', placeholder: 'e.g. GRC Team' },
  { name: 'status', label: 'Status', type: 'select', options: ['draft', 'active', 'retired'] },
]

const CONFIGS: Record<string, ResourceConfig> = {
  frameworks: {
    key: 'frameworks', label: 'Frameworks & Standards',
    description: 'Compliance frameworks and standards the organization is assessed against.',
    endpoint: '/api/v1/grc/frameworks/',
    columns: [{ key: 'name', label: 'Framework' }, { key: 'standard', label: 'Standard' }, { key: 'version', label: 'Version' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }],
    statusOptions: ['active', 'draft', 'retired'],
    fields: FRAMEWORK_FIELDS,
    workflows: [
      { label: 'Activate', path: 'activate' },
      { label: 'Retire', path: 'retire' },
    ],
  },
  controls: {
    key: 'controls', label: 'Control Library',
    description: 'Individual controls inside each framework, with implementation status.',
    endpoint: '/api/v1/grc/controls/',
    columns: [{ key: 'control_ref', label: 'Ref' }, { key: 'name', label: 'Control' }, { key: 'category', label: 'Category' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }],
    statusOptions: ['implemented', 'partial', 'not_implemented', 'not_applicable'],
    fields: [
      { name: 'framework_id', label: 'Framework', type: 'select', optionsFrom: 'frameworks' },
      { name: 'control_ref', label: 'Control ref', type: 'text', placeholder: 'e.g. CIS 1.1' },
      { name: 'name', label: 'Control name', type: 'text', placeholder: 'e.g. Inventory of enterprise assets' },
      { name: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Asset Management' },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['implemented', 'partial', 'not_implemented', 'not_applicable'] },
    ],
    workflows: [],
  },
  assessments: {
    key: 'assessments', label: 'Assessments',
    description: 'Assessments of a framework over a defined scope, from planning to completion.',
    endpoint: '/api/v1/grc/assessments/',
    columns: [{ key: 'name', label: 'Assessment' }, { key: 'scope', label: 'Scope' }, { key: 'assessor', label: 'Assessor' }, { key: 'due_at', label: 'Due' }, { key: 'status', label: 'Status' }],
    statusOptions: ['planned', 'in_progress', 'complete', 'draft'],
    fields: [
      { name: 'framework_id', label: 'Framework', type: 'select', optionsFrom: 'frameworks' },
      { name: 'name', label: 'Assessment name', type: 'text', placeholder: 'e.g. CIS v8 Q4 Assessment' },
      { name: 'scope', label: 'Scope', type: 'text', placeholder: 'e.g. All endpoints' },
      { name: 'assessor', label: 'Assessor', type: 'text' },
      { name: 'due_at', label: 'Due date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['planned', 'in_progress', 'complete', 'draft'] },
    ],
    workflows: [
      { label: 'Start', path: 'start' },
      { label: 'Complete', path: 'complete' },
    ],
  },
  evidence: {
    key: 'evidence', label: 'Evidence Management',
    description: 'Evidence supporting controls. Only a file reference and file name are stored — never file content.',
    endpoint: '/api/v1/grc/evidence/',
    columns: [{ key: 'name', label: 'Evidence' }, { key: 'evidence_type', label: 'Type' }, { key: 'uploaded_by', label: 'Uploaded by' }, { key: 'status', label: 'Status' }],
    statusOptions: ['pending_review', 'approved', 'rejected', 'expired'],
    fields: [
      { name: 'control_id', label: 'Control', type: 'select', optionsFrom: 'controls' },
      { name: 'framework_id', label: 'Framework', type: 'select', optionsFrom: 'frameworks' },
      { name: 'name', label: 'Evidence name', type: 'text', placeholder: 'e.g. Firewall configuration export' },
      { name: 'evidence_type', label: 'Type', type: 'select', options: ['document', 'screenshot', 'log', 'attestation'] },
      { name: 'uploaded_by', label: 'Uploaded by', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['pending_review', 'approved', 'rejected', 'expired'] },
    ],
    workflows: [
      { label: 'Approve', path: 'approve' },
      { label: 'Reject', path: 'reject' },
    ],
  },
  findings: {
    key: 'findings', label: 'Findings & Exceptions',
    description: 'Findings against controls, including accepted exceptions (flagged in the record attributes).',
    endpoint: '/api/v1/grc/findings/',
    columns: [{ key: 'name', label: 'Finding' }, { key: 'severity', label: 'Severity' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }],
    statusOptions: ['open', 'in_progress', 'remediated', 'accepted', 'closed'],
    extraFilter: { key: 'severity', label: 'Severity', options: SEVERITIES },
    fields: [
      { name: 'control_id', label: 'Control', type: 'select', optionsFrom: 'controls' },
      { name: 'framework_id', label: 'Framework', type: 'select', optionsFrom: 'frameworks' },
      { name: 'name', label: 'Finding', type: 'text', placeholder: 'e.g. Dedicated admin accounts not enforced' },
      { name: 'severity', label: 'Severity', type: 'select', options: SEVERITIES },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'remediated', 'accepted', 'closed'] },
    ],
    workflows: [
      { label: 'Mark remediated', path: 'remediate' },
      { label: 'Accept', path: 'accept' },
    ],
  },
  risks: {
    key: 'risks', label: 'Risk Register',
    description: 'Risks scored as likelihood x impact (1–25). Scores of 15+ are high priority.',
    endpoint: '/api/v1/grc/risks/',
    columns: [{ key: 'name', label: 'Risk' }, { key: 'category', label: 'Category' }, { key: 'likelihood', label: 'Likelihood' }, { key: 'impact', label: 'Impact' }, { key: 'score', label: 'Score' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }],
    statusOptions: ['open', 'mitigated', 'accepted', 'closed'],
    fields: [
      { name: 'name', label: 'Risk', type: 'text', placeholder: 'e.g. Ransomware via unpatched endpoint' },
      { name: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Malware' },
      { name: 'likelihood', label: 'Likelihood (1–5)', type: 'number' },
      { name: 'impact', label: 'Impact (1–5)', type: 'number' },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['open', 'mitigated', 'accepted', 'closed'] },
    ],
    workflows: [
      { label: 'Mitigate', path: 'mitigate' },
      { label: 'Accept', path: 'accept' },
    ],
    showScore: true,
  },
  remediations: {
    key: 'remediations', label: 'Remediation Plans',
    description: 'Remediation tasks linked to findings, tracked against a due date.',
    endpoint: '/api/v1/grc/remediations/',
    columns: [{ key: 'name', label: 'Task' }, { key: 'owner', label: 'Owner' }, { key: 'due_at', label: 'Due' }, { key: 'status', label: 'Status' }],
    statusOptions: ['planned', 'in_progress', 'complete', 'overdue'],
    fields: [
      { name: 'finding_id', label: 'Finding', type: 'select', optionsFrom: 'findings' },
      { name: 'name', label: 'Task', type: 'text', placeholder: 'e.g. Enforce dedicated admin accounts' },
      { name: 'owner', label: 'Owner', type: 'text' },
      { name: 'due_at', label: 'Due date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['planned', 'in_progress', 'complete', 'overdue'] },
    ],
    workflows: [{ label: 'Complete', path: 'complete' }],
  },
  audits: {
    key: 'audits', label: 'Audit Schedule',
    description: 'Internal and external audits, scheduled against a framework.',
    endpoint: '/api/v1/grc/audits/',
    columns: [{ key: 'name', label: 'Audit' }, { key: 'auditor', label: 'Auditor' }, { key: 'scheduled_at', label: 'Scheduled' }, { key: 'status', label: 'Status' }],
    statusOptions: ['scheduled', 'in_progress', 'complete', 'cancelled'],
    fields: [
      { name: 'framework_id', label: 'Framework', type: 'select', optionsFrom: 'frameworks' },
      { name: 'name', label: 'Audit', type: 'text', placeholder: 'e.g. CIS v8 Internal Audit' },
      { name: 'auditor', label: 'Auditor', type: 'text' },
      { name: 'scheduled_at', label: 'Scheduled date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['scheduled', 'in_progress', 'complete', 'cancelled'] },
    ],
    workflows: [{ label: 'Complete', path: 'complete' }],
  },
  mappings: {
    key: 'mappings', label: 'Control Mapping',
    description: 'Controls mapped to equivalent controls in other frameworks; gaps are called out.',
    endpoint: '/api/v1/grc/mappings/',
    columns: [{ key: 'name', label: 'Mapping' }, { key: 'mapped_framework', label: 'Mapped framework' }, { key: 'mapped_control_ref', label: 'Mapped ref' }, { key: 'status', label: 'Status' }],
    statusOptions: ['mapped', 'gap', 'unmapped'],
    fields: [
      { name: 'control_id', label: 'Control', type: 'select', optionsFrom: 'controls' },
      { name: 'mapped_framework', label: 'Mapped framework', type: 'select', options: STANDARDS },
      { name: 'mapped_control_ref', label: 'Mapped control ref', type: 'text', placeholder: 'e.g. A.5.15' },
      { name: 'status', label: 'Status', type: 'select', options: ['mapped', 'gap', 'unmapped'] },
    ],
    workflows: [],
  },
  settings: {
    key: 'settings', label: 'Compliance Settings',
    description: 'Workspace settings (review cadence, evidence retention, risk appetite).',
    endpoint: '/api/v1/grc/settings/',
    columns: [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }, { key: 'status', label: 'Status' }],
    statusOptions: ['active', 'inactive'],
    fields: [
      { name: 'key', label: 'Key', type: 'text', placeholder: 'e.g. review_cadence' },
      { name: 'value', label: 'Value', type: 'text', placeholder: 'e.g. quarterly' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
    ],
    workflows: [],
  },
}

// ---------------------------------------------------------- generic page
function cellValue(r: Row, key: string): string {
  if (key === 'score') return String((Number(r.likelihood) || 0) * (Number(r.impact) || 0))
  if (key === 'due_at' || key === 'scheduled_at') return fmtDate(r[key])
  const v = r[key]
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function ResourcePage({ config, api, headers, lookups, reloadLookups, autoOpenForm, onFormConsumed }: {
  config: ResourceConfig
  api: string
  headers: Headers
  lookups: Lookups
  reloadLookups: () => void
  autoOpenForm: boolean
  onFormConsumed: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [extraFilter, setExtraFilter] = useState('')
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Row | null>(null)
  const [history, setHistory] = useState<Row[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const headersRef = useRef(headers)
  headersRef.current = headers

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get(`${api}${config.endpoint}`, { headers: headersRef.current })
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load records.')
    } finally {
      setLoading(false)
    }
  }, [api, config.endpoint])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (autoOpenForm) {
      setFormOpen(true)
      onFormConsumed()
    }
  }, [autoOpenForm, onFormConsumed])

  const openDetail = async (row: Row) => {
    setSelected(row)
    try {
      const res = await axios.get(`${api}/api/v1/grc/${config.key}/${row.id}/history`, { headers: headersRef.current })
      setHistory(Array.isArray(res.data) ? res.data : [])
    } catch {
      setHistory([])
    }
  }

  const lookupOptions = (field: Field): { value: string; label: string }[] => {
    if (field.options) return field.options.map(o => ({ value: o, label: o }))
    if (field.optionsFrom === 'frameworks') return lookups.frameworks.map(f => ({ value: f.id, label: displayName(f) }))
    if (field.optionsFrom === 'controls') return lookups.controls.map(c => ({ value: c.id, label: `${c.control_ref || ''} ${displayName(c)}`.trim() }))
    if (field.optionsFrom === 'findings') return lookups.findings.map(f => ({ value: f.id, label: displayName(f) }))
    return []
  }

  const submitForm = async () => {
    const payload: Record<string, any> = {}
    for (const f of config.fields) {
      const v = (form[f.name] || '').trim()
      if (!v) continue
      payload[f.name] = f.type === 'number' ? Number(v) : v
    }
    if (config.key === 'settings' && payload.key) payload.name = payload.key
    if (config.key === 'mappings' && payload.control_id && payload.mapped_framework) {
      payload.name = `${payload.mapped_framework} ${payload.mapped_control_ref || ''}`.trim()
    }
    try {
      await axios.post(`${api}${config.endpoint}`, payload, { headers: headersRef.current })
      setForm({})
      setFormOpen(false)
      setNotice('Record created.')
      load()
      reloadLookups()
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Create failed.')
    }
  }

  const runWorkflow = async (wf: Workflow) => {
    if (!selected) return
    try {
      const res = await axios.post(`${api}/api/v1/grc/${config.key}/${selected.id}/${wf.path}`, {}, { headers: headersRef.current })
      setSelected(res.data)
      setNotice(`"${wf.label}" applied.`)
      load()
      openDetail(res.data)
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Workflow action failed.')
    }
  }

  const changeStatus = async (status: string) => {
    if (!selected) return
    try {
      const res = await axios.post(`${api}${config.endpoint}${selected.id}/status`, { status }, { headers: headersRef.current })
      setSelected(res.data)
      setNotice(`Status set to ${status}.`)
      load()
      openDetail(res.data)
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Status change failed.')
    }
  }

  const filtered = rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (config.extraFilter && extraFilter && String(r[config.extraFilter.key]) !== extraFilter) return false
    if (search) {
      const hay = config.columns.map(c => cellValue(r, c.key)).concat([displayName(r), r.owner || '', r.category || '']).join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  }).sort((a, b) => {
    const av = sortKey === 'score' ? (Number(a.likelihood) || 0) * (Number(a.impact) || 0) : (a[sortKey] ?? displayName(a))
    const bv = sortKey === 'score' ? (Number(b.likelihood) || 0) * (Number(b.impact) || 0) : (b[sortKey] ?? displayName(b))
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const pageRows = filtered.slice((page - 1) * 10, page * 10)

  return (
    <div>
      <h2 style={{ color: NEXUS_COLORS.navy, fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{config.label}</h2>
      <p style={{ color: NEXUS_COLORS.slate, fontSize: 13, margin: '0 0 16px' }}>{config.description}</p>
      {notice && <p style={{ color: NEXUS_COLORS.tealDark, fontSize: 13 }}>{notice}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="nexus-input" style={{ flex: '1 1 200px' }} placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className="nexus-input" style={{ width: 170 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {config.statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {config.extraFilter && (
          <select className="nexus-input" style={{ width: 150 }} value={extraFilter} onChange={e => { setExtraFilter(e.target.value); setPage(1) }}>
            <option value="">All {config.extraFilter.label.toLowerCase()}</option>
            {config.extraFilter.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <select className="nexus-input" style={{ width: 150 }} value={sortKey} onChange={e => setSortKey(e.target.value)}>
          <option value="created_at">Sort: newest</option>
          <option value="name">Sort: name</option>
          <option value="status">Sort: status</option>
          {config.showScore && <option value="score">Sort: risk score</option>}
        </select>
        <select className="nexus-input" style={{ width: 90 }} value={sortDir} onChange={e => setSortDir(e.target.value as 'asc' | 'desc')}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <Btn label="Add" primary onClick={() => setFormOpen(!formOpen)} />
      </div>

      {formOpen && (
        <div className="nexus-card" style={{ padding: 16, marginBottom: 12 }}>
          <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Add {config.label.replace(/s$/, '').replace(' & Standards', '')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {config.fields.map(f => (
              <label key={f.name} style={{ fontSize: 12, color: NEXUS_COLORS.slateDark, fontWeight: 600 }}>
                {f.label}
                {f.type === 'select' ? (
                  <select className="nexus-input" style={{ width: '100%', marginTop: 4 }} value={form[f.name] || ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>
                    <option value="">—</option>
                    {lookupOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input className="nexus-input" style={{ width: '100%', marginTop: 4 }} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder || ''} value={form[f.name] || ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn label="Save" primary onClick={submitForm} />
            <Btn label="Cancel" onClick={() => setFormOpen(false)} />
          </div>
        </div>
      )}

      {loading ? <p style={{ color: NEXUS_COLORS.slate, fontSize: 13 }}>Loading…</p> : error ? <p style={{ color: NEXUS_COLORS.critical, fontSize: 13 }}>{error}</p> : (
        <>
          <div className="nexus-card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                  {config.columns.map(c => <th key={c.key} style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</th>)}
                  <th style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Data</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && <tr><td colSpan={config.columns.length + 1} style={{ padding: 16, color: NEXUS_COLORS.slate }}>No records yet.</td></tr>}
                {pageRows.map(r => (
                  <tr key={r.id} onClick={() => openDetail(r)} style={{ borderBottom: `1px solid ${NEXUS_COLORS.border}`, cursor: 'pointer', background: selected?.id === r.id ? NEXUS_COLORS.tealSoft : undefined }}>
                    {config.columns.map(c => (
                      <td key={c.key} style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>
                        {c.key === 'status' ? <Badge value={r.status || '—'} /> : c.key === 'severity' ? <Badge value={r.severity || '—'} /> : c.key === 'name' || c.key === 'key' ? <span>{cellValue(r, c.key)}<DemoPill isDemo={r.is_demo} /></span> : cellValue(r, c.key)}
                      </td>
                    ))}
                    <td style={{ padding: '9px 12px' }}>{r.is_demo ? <DemoPill isDemo /> : <span style={{ color: NEXUS_COLORS.slate, fontSize: 12 }}>Organization</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, color: NEXUS_COLORS.slate }}>
            <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Btn label="‹ Prev" disabled={page <= 1} onClick={() => setPage(page - 1)} />
              <span>Page {page} of {pages}</span>
              <Btn label="Next ›" disabled={page >= pages} onClick={() => setPage(page + 1)} />
            </span>
          </div>
        </>
      )}

      {selected && (
        <div className="nexus-card" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 15, fontWeight: 700, margin: 0 }}>
              {displayName(selected)}<DemoPill isDemo={selected.is_demo} />
            </h3>
            <Btn label="Close" onClick={() => setSelected(null)} />
          </div>
          <p style={{ color: NEXUS_COLORS.slate, fontSize: 12, margin: '4px 0 12px' }}>
            {selected.is_demo ? 'Demo data — marked Demo, not your organization’s compliance data.' : 'Organization data.'}
            {selected.attributes?.exception ? ' Exception accepted' + (selected.attributes.exception_expiry ? ` until ${selected.attributes.exception_expiry}` : '') + '.' : ''}
            {selected.attributes?.file_name ? ` File: ${selected.attributes.file_name}.` : ''}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 16px', fontSize: 13, marginBottom: 12 }}>
            {Object.entries(selected).filter(([k]) => !['id', 'tenant_id', 'attributes', 'created_at'].includes(k)).map(([k, v]) => (
              <div key={k}><span style={{ color: NEXUS_COLORS.slate }}>{k.replace(/_/g, ' ')}: </span><span style={{ color: NEXUS_COLORS.slateDark }}>{k === 'status' ? <Badge value={String(v)} /> : k === 'severity' ? <Badge value={String(v)} /> : (k === 'due_at' || k === 'scheduled_at') ? fmtDate(v) : (typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'))}</span></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {config.workflows.map(w => <Btn key={w.path} label={w.label} primary onClick={() => runWorkflow(w)} />)}
            <select className="nexus-input" style={{ width: 190 }} value={selected.status || ''} onChange={e => changeStatus(e.target.value)}>
              <option value="">Change status…</option>
              {config.statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <h4 style={{ color: NEXUS_COLORS.navy, fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>History</h4>
          {history.length === 0 ? <p style={{ color: NEXUS_COLORS.slate, fontSize: 12 }}>No recorded history for this record.</p> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: NEXUS_COLORS.slateDark }}>
              {history.map(h => <li key={h.id} style={{ marginBottom: 4 }}>{h.action} — {fmtDateTime(h.occurred_at)}{h.event_metadata?.status ? ` → ${h.event_metadata.status}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- overview
function Overview({ api, headers, onQuickAction }: { api: string; headers: Headers; onQuickAction: (category: string) => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [notice, setNotice] = useState('')
  const headersRef = useRef(headers)
  headersRef.current = headers

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get(`${api}/api/v1/grc/overview`, { headers: headersRef.current })
      setData(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load the GRC overview.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const demoAction = async (action: 'seed-demo' | 'clear-demo') => {
    try {
      const res = await axios.post(`${api}/api/v1/grc/${action}`, {}, { headers: headersRef.current })
      setNotice(action === 'seed-demo'
        ? (res.data.seeded ? 'Demo data seeded.' : 'Demo data already exists — nothing was duplicated.')
        : 'Demo data removed.')
      load()
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Demo action failed (owner/admin only).')
    }
  }

  const kpis = data ? [
    { label: 'Active frameworks', value: data.active_frameworks },
    { label: 'Total controls', value: data.total_controls },
    { label: 'Open findings', value: data.open_findings },
    { label: 'Evidence awaiting review', value: data.evidence_pending_review },
  ] : []

  const frameworks = (data?.frameworks || []).filter((f: Row) => {
    if (statusFilter && f.status !== statusFilter) return false
    if (search && !`${f.name} ${f.standard}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a: Row, b: Row) => sortKey === 'compliance'
    ? b.compliance_pct - a.compliance_pct
    : String(a.name).localeCompare(String(b.name)))

  return (
    <div>
      <h2 style={{ color: NEXUS_COLORS.navy, fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Compliance &amp; Reporting</h2>
      <p style={{ color: NEXUS_COLORS.slate, fontSize: 13, margin: '0 0 16px' }}>
        Organization-level compliance posture across frameworks, controls, evidence, findings, and risk — one workspace for governance, risk, and compliance.
      </p>
      {notice && <p style={{ color: NEXUS_COLORS.tealDark, fontSize: 13 }}>{notice}</p>}
      {data?.has_demo && (
        <div style={{ border: `1px solid ${NEXUS_COLORS.border}`, borderLeft: `3px solid ${NEXUS_COLORS.warning}`, background: '#FBF3E4', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: NEXUS_COLORS.slateDark, marginBottom: 16 }}>
          <strong>Demo data</strong> — some records in this workspace are marked Demo and are not your organization’s compliance data. Use “Remove demo data” below to clear them.
          <span style={{ display: 'inline-flex', gap: 8, marginLeft: 12 }}>
            <Btn label="Remove demo data" onClick={() => demoAction('clear-demo')} />
          </span>
        </div>
      )}
      {loading ? <p style={{ color: NEXUS_COLORS.slate, fontSize: 13 }}>Loading…</p> : error ? <p style={{ color: NEXUS_COLORS.critical, fontSize: 13 }}>{error}</p> : data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
            {kpis.map(k => (
              <div key={k.label} className="nexus-card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: NEXUS_COLORS.slate }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: NEXUS_COLORS.navy }}>{k.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Framework status</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input className="nexus-input" style={{ flex: 1 }} placeholder="Search frameworks…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="nexus-input" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="retired">Retired</option>
                </select>
                <select className="nexus-input" style={{ width: 160 }} value={sortKey} onChange={e => setSortKey(e.target.value)}>
                  <option value="name">Sort: name</option>
                  <option value="compliance">Sort: compliance %</option>
                </select>
              </div>
              <div className="nexus-card" style={{ overflowX: 'auto', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                      <th style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>Framework</th>
                      <th style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>Controls</th>
                      <th style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>Compliance</th>
                      <th style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frameworks.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: NEXUS_COLORS.slate }}>No frameworks yet — add one or seed demo data.</td></tr>}
                    {frameworks.map((f: Row) => (
                      <tr key={f.id} style={{ borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                        <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{f.name}<DemoPill isDemo={f.is_demo} /><div style={{ fontSize: 12, color: NEXUS_COLORS.slate }}>{f.standard} {f.version || ''}</div></td>
                        <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{f.implemented_controls} / {f.total_controls}</td>
                        <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark, minWidth: 140 }}>
                          <div style={{ height: 6, background: NEXUS_COLORS.cloudDeep, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${f.compliance_pct}%`, height: '100%', background: NEXUS_COLORS.teal }} />
                          </div>
                          <span style={{ fontSize: 12 }}>{f.compliance_pct}% implemented</span>
                        </td>
                        <td style={{ padding: '9px 12px' }}><Badge value={f.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 12, color: NEXUS_COLORS.slate, marginTop: 8 }}>
                Open risks: {data.open_risks} · Overdue remediations: {data.overdue_remediations} · Device benchmarks (legacy): {data.legacy_benchmarks.total} total, {data.legacy_benchmarks.compliant} compliant, {data.legacy_benchmarks.non_compliant} non-compliant.
                {data.findings_by_severity && <span> · Open findings by severity — critical {data.findings_by_severity.critical}, high {data.findings_by_severity.high}, medium {data.findings_by_severity.medium}, low {data.findings_by_severity.low}.</span>}
              </p>
            </div>
            <div>
              <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Quick actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <Btn label="Add framework" primary onClick={() => onQuickAction('frameworks')} />
                <Btn label="Start assessment" primary onClick={() => onQuickAction('assessments')} />
                <Btn label="Upload evidence" primary onClick={() => onQuickAction('evidence')} />
                {!data.has_demo && <Btn label="Seed demo data" onClick={() => demoAction('seed-demo')} />}
              </div>
              <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Recent compliance activity</h3>
              <div className="nexus-card" style={{ padding: '12px 14px' }}>
                {(!data.recent_activity || data.recent_activity.length === 0) ? <p style={{ color: NEXUS_COLORS.slate, fontSize: 12, margin: 0 }}>No GRC activity recorded yet.</p> : (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: NEXUS_COLORS.slateDark }}>
                    {data.recent_activity.map((a: Row) => (
                      <li key={a.id} style={{ marginBottom: 6 }}>
                        {a.action} — {a.entity_type}
                        <div style={{ color: NEXUS_COLORS.slate }}>{fmtDateTime(a.occurred_at)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// -------------------------------------------------------------- reports
function ReportsPage({ api, headers }: { api: string; headers: Headers }) {
  const [reports, setReports] = useState<Row[]>([])
  const [templates, setTemplates] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const headersRef = useRef(headers)
  headersRef.current = headers

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, t] = await Promise.all([
        axios.get(`${api}/api/v1/reports/`, { headers: headersRef.current }),
        axios.get(`${api}/api/v1/reports/templates/`, { headers: headersRef.current }),
      ])
      setReports(Array.isArray(r.data) ? r.data : [])
      setTemplates(Array.isArray(t.data) ? t.data : [])
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load reports.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    try {
      await axios.post(`${api}/api/v1/reports/`, { name: form.name, report_type: form.report_type, standard: form.standard, status: form.status || 'draft' }, { headers: headersRef.current })
      setForm({})
      setFormOpen(false)
      setNotice('Report created.')
      load()
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Create failed.')
    }
  }

  const changeStatus = async (id: string, status: string) => {
    try {
      await axios.post(`${api}/api/v1/reports/${id}/status`, { status }, { headers: headersRef.current })
      setNotice(`Status set to ${status}.`)
      load()
    } catch (e: any) {
      setNotice(e.response?.data?.detail || 'Status change failed.')
    }
  }

  return (
    <div>
      <h2 style={{ color: NEXUS_COLORS.navy, fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Compliance Reports</h2>
      <p style={{ color: NEXUS_COLORS.slate, fontSize: 13, margin: '0 0 16px' }}>
        Audit-ready reports and templates. These are the existing report catalogue from the reporting module, shown here as part of the GRC workspace.
      </p>
      {notice && <p style={{ color: NEXUS_COLORS.tealDark, fontSize: 13 }}>{notice}</p>}
      <div style={{ marginBottom: 12 }}>
        <Btn label="Add report" primary onClick={() => setFormOpen(!formOpen)} />
      </div>
      {formOpen && (
        <div className="nexus-card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: NEXUS_COLORS.slateDark }}>Report name<input className="nexus-input" style={{ width: '100%', marginTop: 4 }} value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 12, fontWeight: 600, color: NEXUS_COLORS.slateDark }}>Report type
              <select className="nexus-input" style={{ width: '100%', marginTop: 4 }} value={form.report_type || ''} onChange={e => setForm({ ...form, report_type: e.target.value })}>
                <option value="">—</option>
                {['audit', 'active-directory', 'compliance'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: NEXUS_COLORS.slateDark }}>Standard
              <select className="nexus-input" style={{ width: '100%', marginTop: 4 }} value={form.standard || ''} onChange={e => setForm({ ...form, standard: e.target.value })}>
                <option value="">—</option>
                {STANDARDS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Btn label="Save" primary onClick={submit} />
            <Btn label="Cancel" onClick={() => setFormOpen(false)} />
          </div>
        </div>
      )}
      {loading ? <p style={{ color: NEXUS_COLORS.slate, fontSize: 13 }}>Loading…</p> : error ? <p style={{ color: NEXUS_COLORS.critical, fontSize: 13 }}>{error}</p> : (
        <>
          <div className="nexus-card" style={{ overflowX: 'auto', padding: 0, marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                  {['Report', 'Type', 'Standard', 'Status', 'Change status'].map(h => <th key={h} style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: NEXUS_COLORS.slate }}>No reports yet.</td></tr>}
                {reports.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                    <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{displayName(r)}</td>
                    <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{r.report_type || '—'}</td>
                    <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{r.standard || '—'}</td>
                    <td style={{ padding: '9px 12px' }}><Badge value={r.status || '—'} /></td>
                    <td style={{ padding: '9px 12px' }}>
                      <select className="nexus-input" style={{ width: 130 }} value={r.status || ''} onChange={e => changeStatus(r.id, e.target.value)}>
                        {['draft', 'ready', 'generated'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ color: NEXUS_COLORS.navy, fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>Report templates</h3>
          <div className="nexus-card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                  {['Template', 'Standard', 'Status'].map(h => <th key={h} style={{ padding: '9px 12px', color: NEXUS_COLORS.slate, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 && <tr><td colSpan={3} style={{ padding: 16, color: NEXUS_COLORS.slate }}>No templates yet.</td></tr>}
                {templates.map(t => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${NEXUS_COLORS.border}` }}>
                    <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{displayName(t)}</td>
                    <td style={{ padding: '9px 12px', color: NEXUS_COLORS.slateDark }}>{t.standard || '—'}</td>
                    <td style={{ padding: '9px 12px' }}><Badge value={t.status || '—'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------ workspace
const CATEGORIES = [
  { id: 'overview', label: 'Overview' },
  { id: 'frameworks', label: 'Frameworks & Standards' },
  { id: 'controls', label: 'Control Library' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'evidence', label: 'Evidence Management' },
  { id: 'findings', label: 'Findings & Exceptions' },
  { id: 'risks', label: 'Risk Register' },
  { id: 'remediations', label: 'Remediation Plans' },
  { id: 'reports', label: 'Compliance Reports' },
  { id: 'audits', label: 'Audit Schedule' },
  { id: 'mappings', label: 'Control Mapping' },
  { id: 'settings', label: 'Compliance Settings' },
]

export default function GrcWorkspace({ api, headers }: { api: string; headers: Headers }) {
  const [category, setCategory] = useState('overview')
  const [lookups, setLookups] = useState<Lookups>({ frameworks: [], controls: [], findings: [] })
  const [formFor, setFormFor] = useState<string | null>(null)
  const [demoNotice, setDemoNotice] = useState('')

  const headersRef = useRef(headers)
  headersRef.current = headers
  const reloadLookups = useCallback(async () => {
    try {
      const [f, c, fi] = await Promise.all([
        axios.get(`${api}/api/v1/grc/frameworks/`, { headers: headersRef.current }),
        axios.get(`${api}/api/v1/grc/controls/`, { headers: headersRef.current }),
        axios.get(`${api}/api/v1/grc/findings/`, { headers: headersRef.current }),
      ])
      setLookups({ frameworks: f.data || [], controls: c.data || [], findings: fi.data || [] })
    } catch {
      // Lookups only feed form selects; the page itself reports load errors.
    }
  }, [api])

  useEffect(() => { reloadLookups() }, [reloadLookups])

  const quickAction = (cat: string) => {
    setCategory(cat)
    setFormFor(cat)
  }

  const demoAction = async (action: 'seed-demo' | 'clear-demo') => {
    try {
      const res = await axios.post(`${api}/api/v1/grc/${action}`, {}, { headers: headersRef.current })
      setDemoNotice(action === 'seed-demo'
        ? (res.data.seeded ? 'Demo data seeded.' : 'Demo data already exists — nothing was duplicated.')
        : `Demo data removed (${Object.values(res.data.deleted || {}).reduce((a: number, b: any) => a + Number(b), 0)} records).`)
      reloadLookups()
    } catch (e: any) {
      setDemoNotice(e.response?.data?.detail || 'Demo action failed (owner/admin only).')
    }
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <nav style={{ width: 210, flexShrink: 0, border: `1px solid ${NEXUS_COLORS.border}`, borderRadius: 8, background: NEXUS_COLORS.white, padding: 8, position: 'sticky', top: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: NEXUS_COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '6px 10px' }}>
          Governance, Risk &amp; Compliance
        </div>
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: category === c.id ? 700 : 400,
              background: category === c.id ? NEXUS_COLORS.tealSoft : 'transparent',
              color: category === c.id ? NEXUS_COLORS.tealDark : NEXUS_COLORS.slateDark,
            }}
          >
            {c.label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, minWidth: 0 }}>
        {category === 'overview' && <Overview api={api} headers={headers} onQuickAction={quickAction} />}
        {category === 'reports' && <ReportsPage api={api} headers={headers} />}
        {category === 'settings' && (
          <div>
            <p style={{ fontSize: 13, color: NEXUS_COLORS.slate, margin: '0 0 12px' }}>
              Settings control how the GRC workspace behaves: how often frameworks are reviewed, how long evidence is retained, and the organization’s risk appetite. Demo settings are marked Demo; organization settings are your own.
            </p>
            {demoNotice && <p style={{ color: NEXUS_COLORS.tealDark, fontSize: 13 }}>{demoNotice}</p>}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Btn label="Seed demo data" onClick={() => demoAction('seed-demo')} />
              <Btn label="Remove demo data" onClick={() => demoAction('clear-demo')} />
            </div>
            <ResourcePage config={CONFIGS.settings} api={api} headers={headers} lookups={lookups} reloadLookups={reloadLookups} autoOpenForm={formFor === 'settings'} onFormConsumed={() => setFormFor(null)} />
          </div>
        )}
        {category !== 'overview' && category !== 'reports' && category !== 'settings' && CONFIGS[category] && (
          <ResourcePage config={CONFIGS[category]} api={api} headers={headers} lookups={lookups} reloadLookups={reloadLookups} autoOpenForm={formFor === category} onFormConsumed={() => setFormFor(null)} />
        )}
      </div>
    </div>
  )
}
