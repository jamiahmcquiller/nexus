import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Copy, Check, Download, Terminal, MonitorCheck, Info } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardHeader, PageHeader, Button } from '../components/ui'
import { EndpointTabs } from './Endpoints'

// Agents talk to the API directly. In a Codespace the console runs on port 5173 and the API on 8000.
export function agentServerUrl() {
  const { protocol, host } = window.location
  if (host.includes('-5173.')) return `${protocol}//${host.replace('-5173.', '-8000.')}`
  if (host.endsWith(':5173')) return `${protocol}//${host.replace(':5173', ':8000')}`
  return `${protocol}//${host}`
}

type Platform = 'macos' | 'windows'

function installCommand(platform: Platform, server: string, token: string) {
  if (platform === 'macos') {
    return `curl -fsSL ${server}/api/v1/agent/download/macos-$(uname -m) -o nexus-agent && chmod +x nexus-agent && ./nexus-agent enroll --server ${server} --token ${token} && ./nexus-agent install`
  }
  return `Invoke-WebRequest ${server}/api/v1/agent/download/windows -OutFile nexus-agent.exe; .\\nexus-agent.exe enroll --server ${server} --token ${token}; .\\nexus-agent.exe install`
}

function CopyBox({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300">
      <code className={`flex-1 break-all bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</code>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        className="flex items-center gap-1.5 border-l border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function Enroll() {
  const [token, setToken] = useState<{ enrollment_token: string; expires_in_days: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [platform, setPlatform] = useState<Platform>(navigator.userAgent.includes('Mac') ? 'macos' : 'windows')
  const server = agentServerUrl()

  const generate = async () => {
    setBusy(true)
    try { setToken((await api.post('/devices/enrollment-token')).data) } finally { setBusy(false) }
  }

  const steps = [
    { icon: KeyRound, title: 'Create an enrollment code', body: 'Each code connects devices to this organization.' },
    { icon: Download, title: 'Run one command', body: 'Paste it into Terminal (Mac) or PowerShell (Windows) on the computer.' },
    { icon: MonitorCheck, title: 'Confirm it appears', body: 'The device shows up under All devices within a minute.' },
  ]

  return (
    <>
      <PageHeader title="Endpoints" subtitle="Connect a new Windows device to NEXUS" />
      <EndpointTabs />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Enroll a device" subtitle="Three steps, about two minutes per computer" />
          <div className="p-5 space-y-6">
            <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-[11px] font-semibold text-white">{i + 1}</span>
                    <s.icon size={16} className="text-teal" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-900">{s.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{s.body}</p>
                </li>
              ))}
            </ol>

            {!token ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-cloud p-6 text-center">
                <KeyRound className="mx-auto text-teal" />
                <p className="mt-2 text-sm font-medium text-slate-900">Start with an enrollment code</p>
                <p className="mt-1 text-xs text-slate-500">Treat it like a password: anyone with it can connect a device to your organization.</p>
                <Button className="mt-4" onClick={generate} disabled={busy}>{busy ? 'Creating…' : 'Create enrollment code'}</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-1 rounded-lg border border-slate-300 p-0.5 text-sm w-fit">
                  {(['macos', 'windows'] as Platform[]).map(p => (
                    <button key={p} onClick={() => setPlatform(p)} className={`rounded-md px-4 py-1.5 ${platform === p ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                      {p === 'macos' ? 'Mac' : 'Windows'}
                    </button>
                  ))}
                </div>
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700"><Terminal size={14} />
                    {platform === 'macos' ? 'Open Terminal on the Mac and paste this' : 'Open PowerShell on the PC and paste this'}</p>
                  <CopyBox value={installCommand(platform, server, token.enrollment_token)} />
                  <p className="mt-1.5 text-xs text-slate-500">This downloads the agent, connects the computer, and keeps it checking in in the background. The code works for {token.expires_in_days} days.</p>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Show the enrollment code and server address on their own</summary>
                  <div className="mt-3 space-y-3">
                    <div><p className="mb-1 text-xs text-slate-500">Server</p><CopyBox value={server} /></div>
                    <div><p className="mb-1 text-xs text-slate-500">Enrollment code</p><CopyBox value={token.enrollment_token} /></div>
                  </div>
                </details>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={generate}>Create a new code</Button>
                  <Link to="/endpoints"><Button variant="ghost" className="text-slate-600">View all devices</Button></Link>
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <p className="text-sm font-semibold text-slate-900">Requirements</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>macOS 11 or later (Apple chip or Intel)</li>
              <li>Windows 10 or Windows 11</li>
              <li>Outbound internet access (HTTPS)</li>
            </ul>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Info size={16} className="text-teal" />What the agent reports</p>
            <p className="mt-2 text-sm text-slate-600">
              Hardware, operating system, installed software, and whether disk encryption, the firewall, and antivirus are on.
              It is read-only and never runs commands sent from the console.
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
