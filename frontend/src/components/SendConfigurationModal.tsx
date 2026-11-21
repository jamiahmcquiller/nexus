// NULL design system — send a remediation configuration to an endpoint.
//
// Flow (owner/admin only; the backend enforces the same rule):
//   1. Pick a remediation configuration (ones addressing this
//      vulnerability's CVE are listed first).
//   2. Pick the target endpoint — fixed to the endpoint the
//      vulnerability is linked to when it has one; the backend
//      rejects any other target for a linked vulnerability.
//   3. Read the EXACT script that will be sent, then confirm.
//   4. POST /api/v1/remediation-configurations/{id}/send queues it as
//      one agent command; the send record links configuration +
//      vulnerability + device + command, so the result shows here
//      (send history, joined to the command record) and in the
//      endpoint detail drawer's command history.
//
// Honest boundary, stated on screen: this is COMMAND-BASED
// remediation, not a native configuration-management engine — no
// config profiles, drift detection, or compliance enforcement. A sent
// command is never a verified configuration state, and sending never
// marks the vulnerability remediated; that still needs the existing
// Remediate workflow with a real result behind it.

import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Icon } from './Icon'
import { StatusBadge, SeverityBadge } from './StatusBadge'
import { EmptyState } from './EmptyState'
import { formatLocalDateTime } from '../time'

type SendConfigurationModalProps = {
  open: boolean
  /** The vulnerability being remediated. Must have an id; device_id
      (when set) fixes the target endpoint. */
  vulnerability: any | null
  api: string
  headers: Record<string, string>
  /** Called after a successful send so the parent can reload + toast. */
  onSent?: () => void
  onClose: () => void
}

// Send times render via ../time.ts — backend datetimes are naive
// UTC and must be parsed as UTC before rendering in local time.

export function SendConfigurationModal({
  open,
  vulnerability,
  api,
  headers,
  onSent,
  onClose,
}: SendConfigurationModalProps) {
  const [configs, setConfigs] = useState<any[]>([])
  const [devices, setDevices] = useState<any[]>([])
  const [sends, setSends] = useState<any[]>([])
  const [commands, setCommands] = useState<any[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState<any | null>(null)

  const vulnId = vulnerability?.id
  const vulnDeviceId = vulnerability?.device_id as string | undefined
  const vulnCve = (vulnerability?.cve_id as string | undefined)?.toLowerCase()

  // The target is fixed when the vulnerability is linked to an
  // endpoint; otherwise the sender picks one from the fleet.
  useEffect(() => {
    if (vulnDeviceId) setSelectedDeviceId(vulnDeviceId)
    else setSelectedDeviceId('')
    setSelectedConfigId('')
    setSent(null)
    setMsg('')
  }, [vulnId, vulnDeviceId])

  useEffect(() => {
    if (!open || !vulnerability) return
    let cancelled = false
    const load = async () => {
      try {
        const c = await axios.get(`${api}/api/v1/remediation-configurations/`, { headers })
        if (!cancelled) setConfigs(Array.isArray(c.data) ? c.data : [])
      } catch { if (!cancelled) setConfigs([]) }
      try {
        const d = await axios.get(`${api}/api/v1/devices/`, { headers })
        if (!cancelled) setDevices(Array.isArray(d.data) ? d.data : [])
      } catch { if (!cancelled) setDevices([]) }
      try {
        const s = await axios.get(`${api}/api/v1/remediation-configurations/sends`, {
          params: { vulnerability_id: vulnerability.id }, headers,
        })
        if (!cancelled) setSends(Array.isArray(s.data) ? s.data : [])
      } catch { if (!cancelled) setSends([]) }
      try {
        const c = await axios.get(`${api}/api/v1/agent/commands`, { headers })
        if (!cancelled) setCommands(Array.isArray(c.data) ? c.data : [])
      } catch { if (!cancelled) setCommands([]) }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vulnId, api])

  // Configurations addressing this CVE / vulnerability first.
  const sortedConfigs = useMemo(() => {
    const matches = (c: any) =>
      (c.vulnerability_id && c.vulnerability_id === vulnId) ||
      (c.cve_id && vulnCve && String(c.cve_id).toLowerCase() === vulnCve)
    return [...configs].sort((a, b) => Number(matches(b)) - Number(matches(a)))
  }, [configs, vulnId, vulnCve])

  const selectedConfig = configs.find((c: any) => c.id === selectedConfigId) ?? null
  const targetDevice = devices.find((d: any) => d.id === selectedDeviceId) ?? null
  const commandById = useMemo(() => {
    const map = new Map<string, any>()
    for (const c of commands) map.set(c.id, c)
    return map
  }, [commands])

  const send = async () => {
    if (!vulnerability || !selectedConfig || !selectedDeviceId) return
    setBusy(true)
    setMsg('')
    try {
      const res = await axios.post(
        `${api}/api/v1/remediation-configurations/${selectedConfig.id}/send`,
        { vulnerability_id: vulnerability.id, device_id: selectedDeviceId },
        { headers },
      )
      setSent(res.data)
      setMsg('Configuration queued as an agent command. The agent runs it on its next poll; the result will appear in the send history below and in the endpoint’s command history.')
      // Refresh the history so the new send shows immediately.
      try {
        const s = await axios.get(`${api}/api/v1/remediation-configurations/sends`, {
          params: { vulnerability_id: vulnerability.id }, headers,
        })
        setSends(Array.isArray(s.data) ? s.data : [])
        const c = await axios.get(`${api}/api/v1/agent/commands`, { headers })
        setCommands(Array.isArray(c.data) ? c.data : [])
      } catch { /* history refresh is best-effort */ }
      onSent?.()
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Send failed — owner/admin only, and the configuration must have script content.')
    } finally {
      setBusy(false)
    }
  }

  if (!open || !vulnerability) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Send configuration — ${vulnerability.cve_id || vulnerability.title || 'vulnerability'}`}>
      <button type="button" aria-label="Close panel" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-black/50" />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-null-navy2">
        <header className="flex items-start justify-between gap-3 border-b border-null-line px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-null-ink dark:text-white">Send configuration</h2>
            <p className="mt-1 text-sm text-null-muted dark:text-[#8AA0B8]">
              {vulnerability.cve_id || vulnerability.title || 'Vulnerability'}
              {vulnerability.severity && <span className="ml-2"><SeverityBadge value={vulnerability.severity} size="sm" /></span>}
              {vulnerability.status && <span className="ml-2"><StatusBadge value={vulnerability.status} size="sm" /></span>}
            </p>
            {vulnerability.title && vulnerability.cve_id && (
              <p className="mt-0.5 text-xs text-null-muted dark:text-[#8AA0B8]">{vulnerability.title}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close panel"
            className="shrink-0 rounded p-1 text-null-muted hover:bg-null-cloud hover:text-null-ink dark:text-[#8AA0B8] dark:hover:bg-null-deepSlate dark:hover:text-white"
          >
            <Icon name="x-circle" size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-null-ink dark:text-white">
          <p className="rounded border border-null-line bg-null-cloud/60 p-3 text-xs text-null-muted dark:border-white/10 dark:bg-white/5 dark:text-[#8AA0B8]">
            Command-based remediation, not a configuration-management engine: sending queues
            one script as an agent command that the endpoint runs once as its own user. There
            are no config profiles, drift detection, or compliance enforcement yet. A sent
            command is not a verified configuration state, and sending never marks this
            vulnerability remediated — use the Remediate workflow only when a real result
            supports it.
          </p>

          {/* 1 — pick the configuration */}
          <section className="border border-null-line rounded-lg p-4 dark:border-white/10">
            <h3 className="text-sm font-semibold">1 · Configuration to send</h3>
            {configs.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  icon="shield"
                  title="No remediation configurations yet"
                  description="Create one first — in Security → Vulnerabilities → Remediation configurations — with the script that addresses this vulnerability's CVE. Nothing can be sent until a configuration exists."
                />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <select
                  className="null-input w-full p-2 text-sm"
                  value={selectedConfigId}
                  onChange={(e) => setSelectedConfigId(e.target.value)}
                  aria-label="Remediation configuration"
                >
                  <option value="">Choose a configuration…</option>
                  {sortedConfigs.map((c: any) => {
                    const match = (c.vulnerability_id && c.vulnerability_id === vulnId) ||
                      (c.cve_id && vulnCve && String(c.cve_id).toLowerCase() === vulnCve)
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name || c.title || 'Untitled configuration'}{c.cve_id ? ` · ${c.cve_id}` : ''}{match ? ' · addresses this CVE' : ''}
                      </option>
                    )
                  })}
                </select>
                {selectedConfig && (
                  <div>
                    {selectedConfig.description && (
                      <p className="text-sm text-null-muted dark:text-[#8AA0B8]">{selectedConfig.description}</p>
                    )}
                    <p className="mt-2 text-xs font-medium text-null-muted dark:text-[#8AA0B8]">
                      Exact script that will be sent ({selectedConfig.kind || 'shell'} — nothing is added or wrapped):
                    </p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-3 font-mono text-xs dark:bg-white/5">
                      {selectedConfig.content || '(no script content — this configuration cannot be sent)'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2 — target endpoint */}
          <section className="border border-null-line rounded-lg p-4 dark:border-white/10">
            <h3 className="text-sm font-semibold">2 · Target endpoint</h3>
            {vulnDeviceId ? (
              <p className="mt-2 text-sm text-null-muted dark:text-[#8AA0B8]">
                Fixed to the endpoint this vulnerability is linked to:{' '}
                <span className="font-medium text-null-ink dark:text-white">
                  {targetDevice ? `${targetDevice.hostname || targetDevice.device_id}` : vulnDeviceId}
                </span>
                {targetDevice?.is_demo && ' (sample data)'}
                . A configuration is only sent to the endpoint the vulnerability affects.
              </p>
            ) : (
              <div className="mt-3">
                <p className="text-sm text-null-muted dark:text-[#8AA0B8]">
                  This vulnerability is not linked to a specific endpoint, so choose the target.
                  Only send to an endpoint you know is affected.
                </p>
                <select
                  className="null-input mt-2 w-full p-2 text-sm"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  aria-label="Target endpoint"
                >
                  <option value="">Choose an endpoint…</option>
                  {devices.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.hostname || d.device_id}{d.is_demo ? ' · sample data' : ' · live'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          {/* 3 — confirm */}
          <div>
            <button
              type="button"
              className="rounded bg-null-teal px-4 py-2 text-sm font-medium text-white hover:bg-null-tealDark disabled:opacity-50"
              onClick={send}
              disabled={busy || !selectedConfigId || !selectedDeviceId || !(selectedConfig?.content || '').trim()}
              title={!selectedConfigId ? 'Choose a configuration first' : !selectedDeviceId ? 'Choose a target endpoint first' : 'Queue the exact script above as one agent command'}
            >
              {busy ? 'Queueing…' : `Send configuration${targetDevice ? ` to ${targetDevice.hostname || targetDevice.device_id}` : ''}`}
            </button>
            {sent && (
              <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">
                Queued — command <span className="font-mono">{sent.command?.id}</span>, status{' '}
                <span className="font-medium">{sent.command?.status || 'pending'}</span>. Creation is
                audit-logged (remediation_configuration.sent).
              </p>
            )}
            {msg && <p className="mt-2 text-xs text-null-muted dark:text-[#8AA0B8]">{msg}</p>}
          </div>

          {/* Send history for this vulnerability, with results. */}
          <section className="border border-null-line rounded-lg p-4 dark:border-white/10">
            <h3 className="text-sm font-semibold">Send history — this vulnerability</h3>
            {sends.length === 0 ? (
              <p className="mt-2 text-sm text-null-muted dark:text-[#8AA0B8]">
                No configuration has been sent for this vulnerability yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sends.map((s: any) => {
                  const cmd = s.command_id ? commandById.get(s.command_id) : null
                  const cfg = configs.find((c: any) => c.id === s.configuration_id)
                  const dev = devices.find((d: any) => d.id === s.device_id)
                  return (
                    <li key={s.id} className="rounded border border-null-line p-2.5 dark:border-white/10">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{cfg?.name || cfg?.title || 'Configuration'}</span>
                        {cmd ? <StatusBadge value={cmd.status} size="sm" /> : <StatusBadge value={s.status} size="sm" />}
                        {cmd?.exit_code != null && <span className="text-xs text-null-muted dark:text-[#8AA0B8]">exit {cmd.exit_code}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">
                        To {dev ? (dev.hostname || dev.device_id) : s.device_id} · sent {formatLocalDateTime(s.created_at)}
                        {cmd?.completed_at ? ` · completed ${formatLocalDateTime(cmd.completed_at)}` : cmd ? ' · awaiting agent result' : ''}
                      </span>
                      {cmd?.result ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-null-tealDark">Agent result</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-null-cloud p-2 font-mono text-xs dark:bg-white/5">{cmd.result}</pre>
                        </details>
                      ) : null}
                      {!cmd && (
                        <span className="mt-0.5 block text-xs text-null-muted dark:text-[#8AA0B8]">
                          Command record not in the latest queue listing — it may have aged out of the 200-row list.
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-null-muted dark:text-[#8AA0B8]">
              A succeeded command means the script ran and returned exit 0 — it does not by
              itself prove the vulnerability is fixed. Mark the vulnerability remediated only
              through the Remediate workflow, with the result above as evidence.
            </p>
          </section>
        </div>
      </aside>
    </div>
  )
}
