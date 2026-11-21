// NULL design system — remediation configuration manager.
//
// Renders as the "Remediation configurations" subsection of the
// Vulnerabilities module (Security workspace). A remediation
// configuration is a reusable script that addresses a specific
// vulnerability (CVE / vulnerability record): name, description, the
// exact script to apply, and which vulnerability it addresses.
//
// Uses the existing module endpoints:
//   GET / POST / PATCH / DELETE  /api/v1/remediation-configurations/
//   GET /api/v1/remediation-configurations/sends (send history)
//   GET /api/v1/agent/commands (joined on command_id for results)
//
// Honest boundary, stated on screen: this is COMMAND-BASED
// remediation, not a native configuration-management engine — no
// config profiles, drift detection, or compliance enforcement.

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { StatusBadge } from './StatusBadge'
import { EmptyState } from './EmptyState'

type RemediationConfigManagerProps = {
  api: string
  headers: Record<string, string>
  canWrite: boolean
  canDelete: boolean
}

function formatUtc(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`
}

const EMPTY_FORM = {
  name: '',
  description: '',
  kind: 'shell',
  cve_id: '',
  vulnerability_id: '',
  content: '',
  status: 'active',
}

export function RemediationConfigManager({ api, headers, canWrite, canDelete }: RemediationConfigManagerProps) {
  const [configs, setConfigs] = useState<any[]>([])
  const [vulns, setVulns] = useState<any[]>([])
  const [sends, setSends] = useState<any[]>([])
  const [commands, setCommands] = useState<any[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const c = await axios.get(`${api}/api/v1/remediation-configurations/`, { headers })
      setConfigs(Array.isArray(c.data) ? c.data : [])
    } catch { setConfigs([]) }
    try {
      const v = await axios.get(`${api}/api/v1/vulnerabilities/`, { headers })
      setVulns(Array.isArray(v.data) ? v.data : [])
    } catch { setVulns([]) }
    try {
      const s = await axios.get(`${api}/api/v1/remediation-configurations/sends`, { headers })
      setSends(Array.isArray(s.data) ? s.data : [])
    } catch { setSends([]) }
    try {
      const c = await axios.get(`${api}/api/v1/agent/commands`, { headers })
      setCommands(Array.isArray(c.data) ? c.data : [])
    } catch { setCommands([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => { load() }, [load])

  const commandById = useMemo(() => {
    const map = new Map<string, any>()
    for (const c of commands) map.set(c.id, c)
    return map
  }, [commands])

  const sendsByConfig = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const s of sends) {
      const list = map.get(s.configuration_id) ?? []
      list.push(s)
      map.set(s.configuration_id, list)
    }
    return map
  }, [sends])

  const knownCves = useMemo(() => {
    const set = new Set<string>()
    for (const v of vulns) if (v.cve_id) set.add(v.cve_id)
    for (const c of configs) if (c.cve_id) set.add(c.cve_id)
    return [...set].sort()
  }, [vulns, configs])

  const startEdit = (cfg: any) => {
    setEditingId(cfg.id)
    setForm({
      name: cfg.name || cfg.title || '',
      description: cfg.description || '',
      kind: cfg.kind || 'shell',
      cve_id: cfg.cve_id || '',
      vulnerability_id: cfg.vulnerability_id || '',
      content: cfg.content || '',
      status: cfg.status || 'active',
    })
    setMsg('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setMsg('')
  }

  const save = async () => {
    if (!form.name.trim()) { setMsg('A name is required.'); return }
    setBusy(true)
    setMsg('')
    try {
      const payload = {
        name: form.name.trim(),
        title: form.name.trim(),
        description: form.description.trim(),
        kind: form.kind,
        cve_id: form.cve_id.trim() || null,
        vulnerability_id: form.vulnerability_id || null,
        content: form.content,
        status: form.status,
      }
      if (editingId) {
        await axios.patch(`${api}/api/v1/remediation-configurations/${editingId}`, payload, { headers })
        setMsg('Configuration updated.')
      } else {
        await axios.post(`${api}/api/v1/remediation-configurations/`, payload, { headers })
        setMsg('Configuration created.')
      }
      cancelEdit()
      load()
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (cfg: any) => {
    if (!window.confirm(`Delete ${cfg.name || cfg.title || 'this configuration'}? This cannot be undone.`)) return
    try {
      await axios.delete(`${api}/api/v1/remediation-configurations/${cfg.id}`, { headers })
      setMsg('Configuration deleted.')
      load()
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Delete failed.')
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded border border-null-line bg-null-cloud/60 p-3 text-xs text-null-muted dark:border-white/10 dark:bg-white/5 dark:text-[#8AA0B8]">
        A remediation configuration is a reusable script that addresses one vulnerability
        (a CVE / vulnerability record). Sending it queues the script as a single agent
        command on the affected endpoint — this is command-based remediation, not a native
        configuration-management engine: there are no config profiles, drift detection, or
        compliance enforcement yet, and a sent command is never a verified configuration state.
      </p>

      {/* Create / edit form */}
      {canWrite ? (
        <div className="rounded border border-null-line p-4 dark:border-white/10">
          <h3 className="text-sm font-semibold text-null-ink dark:text-white">
            {editingId ? 'Edit configuration' : 'New remediation configuration'}
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">Name *</span>
              <input
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Disable Safari auto-open"
                aria-label="Configuration name"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">Script kind</span>
              <select
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                aria-label="Script kind"
              >
                <option value="shell">shell</option>
                <option value="powershell">powershell</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">CVE it addresses</span>
              <input
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.cve_id}
                onChange={(e) => setForm({ ...form, cve_id: e.target.value })}
                placeholder="e.g. CVE-2024-23222"
                list="remediation-known-cves"
                aria-label="CVE id"
              />
              <datalist id="remediation-known-cves">
                {knownCves.map((cve) => <option key={cve} value={cve} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">Linked vulnerability (optional)</span>
              <select
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.vulnerability_id}
                onChange={(e) => setForm({ ...form, vulnerability_id: e.target.value })}
                aria-label="Linked vulnerability"
              >
                <option value="">None — CVE reference only</option>
                {vulns.map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {v.cve_id ? `${v.cve_id} — ` : ''}{v.title || 'Vulnerability'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">Description</span>
              <input
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this script changes, and why it addresses the CVE"
                aria-label="Description"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">
                Script content — this exact text is sent as the agent command
              </span>
              <textarea
                className="null-input mt-1 w-full p-2 font-mono text-sm"
                rows={6}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={form.kind === 'powershell' ? 'Set-ItemProperty -Path ...' : 'defaults write ...'}
                aria-label="Script content"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-null-muted dark:text-[#8AA0B8]">Status</span>
              <select
                className="null-input mt-1 w-full p-2 text-sm"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                aria-label="Status"
              >
                <option value="active">active</option>
                <option value="draft">draft</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark disabled:opacity-50"
              onClick={save}
              disabled={busy}
            >
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create configuration'}
            </button>
            {editingId && (
              <button type="button" className="rounded border border-null-line px-4 py-2 text-sm hover:bg-null-cloud dark:hover:bg-white/5" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
          {msg && <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">{msg}</p>}
        </div>
      ) : (
        <p className="rounded border border-null-line bg-null-cloud/60 p-3 text-xs text-null-muted dark:border-white/10 dark:bg-white/5 dark:text-[#8AA0B8]">
          Creating and editing configurations needs owner, admin, or technician — your role is
          read-only here. The list and send history below are still visible.
        </p>
      )}

      {/* Configuration list with send history */}
      {configs.length === 0 ? (
        <EmptyState
          icon="shield"
          title="No remediation configurations yet"
          description="Create one above: give it a name, the CVE it addresses, and the exact script the agent should run on the affected endpoint. It can then be sent from any vulnerability row or from an endpoint's detail view."
        />
      ) : (
        <ul className="space-y-3">
          {configs.map((cfg: any) => {
            const history = sendsByConfig.get(cfg.id) ?? []
            const linkedVuln = vulns.find((v: any) => v.id === cfg.vulnerability_id)
            return (
              <li key={cfg.id} className="rounded border border-null-line p-4 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-null-ink dark:text-white">{cfg.name || cfg.title || 'Untitled configuration'}</span>
                  {cfg.cve_id && (
                    <span className="rounded bg-null-cloud px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">{cfg.cve_id}</span>
                  )}
                  <span className="rounded bg-null-cloud px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">{cfg.kind || 'shell'}</span>
                  {cfg.status && <StatusBadge value={cfg.status} size="sm" />}
                  {cfg.is_demo && (
                    <span className="rounded-full bg-null-tealSoft px-2 py-0.5 text-xs font-medium text-null-tealDark" title="Sample data — this is a demonstration record.">
                      Sample data
                    </span>
                  )}
                </div>
                {cfg.description && <p className="mt-1 text-sm text-null-muted dark:text-[#8AA0B8]">{cfg.description}</p>}
                {linkedVuln && (
                  <p className="mt-1 text-xs text-null-muted dark:text-[#8AA0B8]">
                    Linked vulnerability: {linkedVuln.cve_id || linkedVuln.title} ({linkedVuln.status || '—'})
                  </p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-null-tealDark">Show script</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-2 font-mono text-xs dark:bg-white/5">
                    {cfg.content || '(no script content)'}
                  </pre>
                </details>
                <div className="mt-3 flex flex-wrap gap-1">
                  {canWrite && (
                    <button type="button" className="rounded border border-null-line px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-white/5" onClick={() => startEdit(cfg)}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-null-cloud dark:hover:bg-white/5" style={{ borderColor: '#E5AFB0', color: '#C64D4D' }} onClick={() => remove(cfg)}>
                      Delete
                    </button>
                  )}
                </div>
                <div className="mt-3 border-t border-null-line pt-3 dark:border-white/10">
                  <h4 className="text-xs font-semibold text-null-ink dark:text-white">
                    Send history ({history.length})
                  </h4>
                  {history.length === 0 ? (
                    <p className="mt-1 text-xs text-null-muted dark:text-[#8AA0B8]">
                      Not sent to any endpoint yet. Send it from a vulnerability row
                      (Vulnerabilities → Send config) or from an endpoint’s detail view.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {history.map((s: any) => {
                        const cmd = s.command_id ? commandById.get(s.command_id) : null
                        const vuln = vulns.find((v: any) => v.id === s.vulnerability_id)
                        return (
                          <li key={s.id} className="rounded border border-null-line p-2.5 dark:border-white/10">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-xs">{vuln?.cve_id || vuln?.title || 'Vulnerability'}</span>
                              {cmd ? <StatusBadge value={cmd.status} size="sm" /> : <StatusBadge value={s.status} size="sm" />}
                              {cmd?.exit_code != null && <span className="text-xs text-null-muted dark:text-[#8AA0B8]">exit {cmd.exit_code}</span>}
                            </span>
                            <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">
                              Sent {formatUtc(s.created_at)}
                              {cmd?.completed_at ? ` · completed ${formatUtc(cmd.completed_at)}` : cmd ? ' · awaiting agent result' : ''}
                            </span>
                            {cmd?.result ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs font-medium text-null-tealDark">Agent result</summary>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-2 font-mono text-xs dark:bg-white/5">{cmd.result}</pre>
                              </details>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
