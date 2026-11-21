import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API = (() => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  // In dev (npm run dev) use a relative URL: Vite proxies /api to the
  // backend (see vite.config.ts), so the browser never has to reach
  // the backend directly. This is the fix for login "Network Error"
  // in Codespaces — no separate -8000 port to forward or expose.
  if (import.meta.env.DEV) return ''
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.includes('app.github.dev')) {
      const origin = window.location.origin
      const backend = origin.replace(/-5173\.app\.github\.dev/, '-8000.app.github.dev')
      if (backend !== origin) return backend
      return origin.replace(/-\d+\.app\.github\.dev/, '-8000.app.github.dev')
    }
  }
  return 'http://localhost:8000'
})()

// What the login page shows as the backend address. '' means
// "same origin, via the Vite proxy".
const BACKEND_LABEL = API || (typeof window !== 'undefined' ? window.location.origin : '')

if (typeof window !== 'undefined') {
  console.log('[NEXUS] API base URL:', API)
}

type Subsection = { id: string; label: string; endpoint: string }
type ModuleDef = {
  id: string
  label: string
  description: string
  endpoint: string
  subsections?: Subsection[]
}

// Every feature area is one platform module with the same tenant-scoped API:
// GET <endpoint> (list), GET <endpoint>stats, POST <endpoint> (create),
// PATCH <endpoint>{id}, POST <endpoint>{id}/status
const MODULES: ModuleDef[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Fleet health at a glance — endpoints online, patches, vulnerabilities, and alerts.', endpoint: '/api/v1/devices/' },
  { id: 'devices', label: 'Endpoints', description: 'Enrolled devices, inventory, heartbeat, and groups.', endpoint: '/api/v1/devices/' },
  {
    id: 'patches', label: 'Patch Management',
    description: 'Automated patching — scan, test, approve, deploy — with deployment policies, third-party patching, and selective decline.',
    endpoint: '/api/v1/patches/',
    subsections: [
      { id: 'patches', label: 'Patches', endpoint: '/api/v1/patches/' },
      { id: 'deployments', label: 'Deployments', endpoint: '/api/v1/patch-deployments/' },
      { id: 'third-party', label: 'Third-party apps', endpoint: '/api/v1/third-party-apps/' },
      { id: 'tests', label: 'Test results', endpoint: '/api/v1/patch-tests/' },
    ],
  },
  {
    id: 'vulnerabilities', label: 'Vulnerabilities',
    description: 'Assessment and prioritisation, zero-day mitigation scripts, CIS configuration checks, web-server hardening, and high-risk software audit.',
    endpoint: '/api/v1/vulnerabilities/',
    subsections: [
      { id: 'vulns', label: 'Vulnerabilities', endpoint: '/api/v1/vulnerabilities/' },
      { id: 'zero-day', label: 'Zero-day mitigations', endpoint: '/api/v1/zero-day-mitigations/' },
      { id: 'configs', label: 'Security configurations', endpoint: '/api/v1/security-configurations/' },
      { id: 'web', label: 'Web server hardening', endpoint: '/api/v1/web-server-hardening/' },
      { id: 'high-risk', label: 'High-risk software', endpoint: '/api/v1/high-risk-software/' },
    ],
  },
  {
    id: 'edr', label: 'Endpoint Detection & Response',
    description: 'Continuous activity monitoring, MITRE ATT&CK-mapped detection, AI-guided triage, containment, and 30-day threat hunting.',
    endpoint: '/api/v1/edr/telemetry/',
    subsections: [
      { id: 'telemetry', label: 'Telemetry', endpoint: '/api/v1/edr/telemetry/' },
      { id: 'hunts', label: 'Threat hunts', endpoint: '/api/v1/edr/hunts/' },
      { id: 'incidents', label: 'Incident response', endpoint: '/api/v1/edr/incidents/' },
      { id: 'alerts', label: 'Alerts', endpoint: '/api/v1/alerts/' },
    ],
  },
  { id: 'malware', label: 'Malware Protection', description: 'Multi-layered detection — behaviour-based AI plus deep-learning AV — with MITRE TTP forensics and quarantine.', endpoint: '/api/v1/malware/detections/' },
  {
    id: 'ransomware', label: 'Anti-Ransomware',
    description: 'Behaviour detection, device quarantine, incident analysis, and single-click recovery from incremental VSS shadow-copy backups.',
    endpoint: '/api/v1/ransomware/incidents/',
    subsections: [
      { id: 'incidents', label: 'Incidents', endpoint: '/api/v1/ransomware/incidents/' },
      { id: 'recovery', label: 'Recovery points', endpoint: '/api/v1/ransomware/recovery-points/' },
    ],
  },
  {
    id: 'browser', label: 'Browser Security',
    description: 'Trusted-browser restriction, extension management, kiosk lockdown, isolation, Java rules, and legacy-browser routing.',
    endpoint: '/api/v1/browser/policies/',
    subsections: [
      { id: 'policies', label: 'Policies', endpoint: '/api/v1/browser/policies/' },
      { id: 'extensions', label: 'Extensions', endpoint: '/api/v1/browser/extensions/' },
    ],
  },
  {
    id: 'appcontrol', label: 'Application Control',
    description: 'Allowlist / blocklist, privilege management, child-process control, admin-rights removal, and just-in-time access.',
    endpoint: '/api/v1/app-control/rules/',
    subsections: [
      { id: 'rules', label: 'Rules', endpoint: '/api/v1/app-control/rules/' },
      { id: 'grants', label: 'Privilege grants', endpoint: '/api/v1/app-control/privilege-grants/' },
    ],
  },
  {
    id: 'dlp', label: 'Data Security / DLP',
    description: 'Sensitive-data discovery and classification, leak prevention at rest / in use / in motion, BYOD containers, and remote wipe.',
    endpoint: '/api/v1/dlp/findings/',
    subsections: [
      { id: 'findings', label: 'Sensitive data', endpoint: '/api/v1/dlp/findings/' },
      { id: 'policies', label: 'DLP policies', endpoint: '/api/v1/dlp/policies/' },
      { id: 'incidents', label: 'Incidents', endpoint: '/api/v1/dlp/incidents/' },
      { id: 'containers', label: 'Containers', endpoint: '/api/v1/dlp/containers/' },
    ],
  },
  {
    id: 'access', label: 'Secure Private Access',
    description: 'Zero-trust, application-level access that replaces VPNs — users reach only authorised apps on trusted devices, fully audited.',
    endpoint: '/api/v1/access/segments/',
    subsections: [
      { id: 'segments', label: 'App segments', endpoint: '/api/v1/access/segments/' },
      { id: 'policies', label: 'Access policies', endpoint: '/api/v1/access/policies/' },
      { id: 'audit', label: 'Access audit', endpoint: '/api/v1/access/audit/' },
    ],
  },
  {
    id: 'assets', label: 'Asset Management',
    description: 'Hardware / software / digital assets, licenses, warranties, certificates, geo-fencing, power, and USB control.',
    endpoint: '/api/v1/assets/',
    subsections: [
      { id: 'assets', label: 'Assets', endpoint: '/api/v1/assets/' },
      { id: 'licenses', label: 'Licenses', endpoint: '/api/v1/assets/licenses/' },
      { id: 'warranties', label: 'Warranties', endpoint: '/api/v1/assets/warranties/' },
      { id: 'certificates', label: 'Certificates', endpoint: '/api/v1/assets/certificates/' },
      { id: 'geo', label: 'Geo-fences', endpoint: '/api/v1/assets/geo-fences/' },
      { id: 'usb', label: 'USB events', endpoint: '/api/v1/assets/usb-events/' },
      { id: 'power', label: 'Power schemes', endpoint: '/api/v1/assets/power-schemes/' },
    ],
  },
  {
    id: 'distribution', label: 'Application Distribution',
    description: 'MSI / EXE / mobile apps from tested templates, a central repository, over-the-air updates, metering, and a self-service portal.',
    endpoint: '/api/v1/distribution/packages/',
    subsections: [
      { id: 'packages', label: 'Packages', endpoint: '/api/v1/distribution/packages/' },
      { id: 'deployments', label: 'Deployments', endpoint: '/api/v1/distribution/deployments/' },
      { id: 'metering', label: 'Metering', endpoint: '/api/v1/distribution/metering/' },
    ],
  },
  {
    id: 'dex', label: 'Digital Employee Experience',
    description: 'Telemetry into experience scores and benchmarks, root-cause analysis, and automated remediation workflows.',
    endpoint: '/api/v1/dex/telemetry/',
    subsections: [
      { id: 'telemetry', label: 'Telemetry', endpoint: '/api/v1/dex/telemetry/' },
      { id: 'insights', label: 'Insights & RCA', endpoint: '/api/v1/dex/insights/' },
      { id: 'workflows', label: 'Remediation workflows', endpoint: '/api/v1/dex/workflows/' },
      { id: 'scores', label: 'Experience scores', endpoint: '/api/v1/dex/experience-scores/' },
    ],
  },
  {
    id: 'remote', label: 'Remote Access',
    description: 'Remote control, recorded sessions, system tools, announcements, and collaborative troubleshooting.',
    endpoint: '/api/v1/remote/sessions/',
    subsections: [
      { id: 'sessions', label: 'Sessions', endpoint: '/api/v1/remote/sessions/' },
      { id: 'announcements', label: 'Announcements', endpoint: '/api/v1/remote/announcements/' },
      { id: 'tools', label: 'System tools', endpoint: '/api/v1/remote/system-tools/' },
    ],
  },
  {
    id: 'imaging', label: 'OS Imaging',
    description: 'Online / offline imaging, zero-touch PXE / USB / ISO deployment, standalone WFH deployment, and role-based templates.',
    endpoint: '/api/v1/imaging/images/',
    subsections: [
      { id: 'images', label: 'Images', endpoint: '/api/v1/imaging/images/' },
      { id: 'deployments', label: 'Deployments', endpoint: '/api/v1/imaging/deployments/' },
      { id: 'templates', label: 'Templates', endpoint: '/api/v1/imaging/templates/' },
    ],
  },
  {
    id: 'config', label: 'Configuration Management',
    description: 'User- and computer-based configurations, profiles, kiosk lockdown, and a script repository.',
    endpoint: '/api/v1/config/profiles/',
    subsections: [
      { id: 'profiles', label: 'Profiles', endpoint: '/api/v1/config/profiles/' },
      { id: 'scripts', label: 'Scripts', endpoint: '/api/v1/config/scripts/' },
      { id: 'kiosk', label: 'Kiosk', endpoint: '/api/v1/config/kiosk/' },
    ],
  },
  {
    id: 'mdm', label: 'Mobile Device Management',
    description: 'Android, iOS, iPadOS, macOS, Windows, ChromeOS, and tvOS — enrollment, profiles, apps, kiosk, and remote lock / wipe.',
    endpoint: '/api/v1/mdm/devices/',
    subsections: [
      { id: 'devices', label: 'Devices', endpoint: '/api/v1/mdm/devices/' },
      { id: 'profiles', label: 'Profiles', endpoint: '/api/v1/mdm/profiles/' },
      { id: 'apps', label: 'Apps', endpoint: '/api/v1/mdm/apps/' },
    ],
  },
  {
    id: 'encryption', label: 'Disk Encryption',
    description: 'BitLocker / FileVault / TPM control, granular policies, encryption at scale, and secure recovery-key escrow (references only, never raw keys).',
    endpoint: '/api/v1/encryption/policies/',
    subsections: [
      { id: 'policies', label: 'Policies', endpoint: '/api/v1/encryption/policies/' },
      { id: 'keys', label: 'Recovery keys', endpoint: '/api/v1/encryption/recovery-keys/' },
    ],
  },
  {
    id: 'servers', label: 'Server Management',
    description: 'Server lifecycle, unified multi-OS caching, self-service patch windows for app owners, and CIS-based vulnerability detection.',
    endpoint: '/api/v1/servers/',
    subsections: [
      { id: 'servers', label: 'Servers', endpoint: '/api/v1/servers/' },
      { id: 'windows', label: 'Patch windows', endpoint: '/api/v1/servers/patch-windows/' },
      { id: 'health', label: 'Health checks', endpoint: '/api/v1/servers/health-checks/' },
    ],
  },
  {
    id: 'scheduler', label: 'Scheduler',
    description: 'Background worker — patch deployments, threat hunts, remediation workflows, and expiry housekeeping. Runs as a separate process (python -m app.worker); this page shows its runs and lets an owner/admin trigger one tick now.',
    endpoint: '/api/v1/scheduler/runs/',
  },
  {
    id: 'compliance', label: 'Compliance & Reporting',
    description: 'CIS, NIST, Cyber Essentials, HIPAA, GDPR, and PCI — audit-ready reports and Active Directory reporting.',
    endpoint: '/api/v1/compliance/',
    subsections: [
      { id: 'results', label: 'Compliance results', endpoint: '/api/v1/compliance/' },
      { id: 'reports', label: 'Reports', endpoint: '/api/v1/reports/' },
      { id: 'templates', label: 'Report templates', endpoint: '/api/v1/reports/templates/' },
    ],
  },
  { id: 'policies', label: 'Policies', description: 'Cross-module policy definitions (patch, compliance, app control, encryption, browser, MDM).', endpoint: '/api/v1/policies/' },
]

const STATUS_OPTIONS = ['active', 'open', 'new', 'available', 'scheduled', 'testing', 'approved', 'declined', 'deployed', 'mitigated', 'remediated', 'contained', 'resolved', 'quarantined', 'recovered', 'locked', 'wiped', 'ended', 'draft', 'disabled', 'complete', 'running']

function displayName(item: any): string {
  return item.title || item.name || item.hostname || item.cve_id || item.software_name || item.app_name || item.device_id || item.id
}

function displayDetail(item: any): string {
  return item.severity || item.category || item.platform || item.rule_type || item.scope || item.benchmark || item.detection_layer || item.event_type || item.action || item.status || ''
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('nexus_token') || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [module, setModule] = useState('dashboard')
  const [subsection, setSubsection] = useState('')
  const [stats, setStats] = useState<Record<string, any>>({})
  const [items, setItems] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState('')
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'unreachable'>('checking')

  // On load, check whether the backend is actually reachable, so the
  // login page can say so plainly instead of failing with a bare
  // "Network Error" at login time.
  const checkBackend = useCallback(async () => {
    try {
      await axios.get(`${API}/health`, { timeout: 5000 })
      setBackendStatus('ok')
    } catch {
      setBackendStatus('unreachable')
    }
  }, [])

  useEffect(() => { checkBackend() }, [checkBackend])

  const describeAuthError = (err: any, what: string) => {
    if (!err.response) {
      // axios "Network Error": no response at all — backend down,
      // wrong URL, or CORS/preflight blocked. This is the error Miah
      // hit on login; say what to do instead of repeating it.
      return `Cannot reach the backend at ${BACKEND_LABEL}. The backend is not running, or this page cannot reach it from here. Start it with "docker compose -f infra/docker-compose.yml up -d" or "./scripts/start-nexus.sh", wait for it to come up, then tap Retry below and try ${what} again.`
    }
    const msg = err.response?.data?.detail || err.message || `${what} failed`
    return `${typeof msg === 'string' ? msg : JSON.stringify(msg)} (backend: ${BACKEND_LABEL})`
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const current = MODULES.find(m => m.id === module) || MODULES[0]
  const endpoint = current.subsections
    ? (current.subsections.find(s => s.id === subsection) || current.subsections[0]).endpoint
    : current.endpoint

  const load = useCallback(async () => {
    if (!token) return
    try {
      const d = await axios.get(`${API}${endpoint}`, { headers })
      setItems(Array.isArray(d.data) ? d.data : [])
    } catch {
      setItems([])
    }
    try {
      const s = await axios.get(`${API}${endpoint}stats`, { headers })
      setStats(s.data || {})
    } catch {
      setStats({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, endpoint])

  useEffect(() => { load() }, [load])

  const pickModule = (id: string) => {
    setModule(id)
    setSubsection('')
    setNotice('')
  }

  const login = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/token`, { username, password })
      setToken(res.data.access_token)
      localStorage.setItem('nexus_token', res.data.access_token)
      setError('')
    } catch (err: any) {
      if (!err.response) setBackendStatus('unreachable')
      setError(describeAuthError(err, 'login'))
    }
  }

  const register = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/register`, {
        tenant_name: 'Demo Organization',
        username,
        password,
      })
      setToken(res.data.access_token)
      localStorage.setItem('nexus_token', res.data.access_token)
      setError('')
    } catch (err: any) {
      if (!err.response) setBackendStatus('unreachable')
      setError(describeAuthError(err, 'registration'))
    }
  }

  const createItem = async () => {
    if (!newName.trim()) return
    try {
      await axios.post(`${API}${endpoint}`, { title: newName, name: newName }, { headers })
      setNewName('')
      setNotice('Created.')
      load()
    } catch (err: any) {
      setNotice(err.response?.data?.detail || 'Create failed')
    }
  }

  const runSchedulerNow = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/scheduler/run-once`, {}, { headers })
      setNotice(`Scheduler tick done: ${(res.data.actions || []).length} action(s).`)
      load()
    } catch (err: any) {
      setNotice(err.response?.data?.detail || 'Scheduler run failed — owner/admin only, and the API must be running.')
    }
  }

  const setStatus = async (item: any, status: string) => {
    try {
      await axios.post(`${API}${endpoint}${item.id}/status`, { status }, { headers })
      setNotice(`Status set to ${status}.`)
      load()
    } catch (err: any) {
      setNotice(err.response?.data?.detail || 'Status update failed')
    }
  }

  const workflowAction = async (action: string, item: any) => {
    // Real workflow endpoints (not just a status flip) for the core flows.
    const calls: Record<string, string> = {
      'patch-test': `/api/v1/patches/${item.id}/test`,
      'patch-approve': `/api/v1/patches/${item.id}/approve`,
      'patch-decline': `/api/v1/patches/${item.id}/decline`,
      'patch-deploy': `/api/v1/patches/${item.id}/deploy`,
      'vuln-mitigate': `/api/v1/vulnerabilities/${item.id}/mitigate`,
      'vuln-remediate': `/api/v1/vulnerabilities/${item.id}/remediate`,
      'edr-contain': `/api/v1/edr/incidents/${item.id}/contain`,
      'malware-quarantine': `/api/v1/malware/detections/${item.id}/quarantine`,
      'ransomware-recover': `/api/v1/ransomware/incidents/${item.id}/recover`,
      'mdm-lock': `/api/v1/mdm/devices/${item.id}/lock`,
      'mdm-wipe': `/api/v1/mdm/devices/${item.id}/wipe`,
      'dlp-wipe': `/api/v1/dlp/containers/${item.id}/wipe`,
      'remote-end': `/api/v1/remote/sessions/${item.id}/end`,
      'server-approve': `/api/v1/servers/patch-windows/${item.id}/approve`,
      'grant-revoke': `/api/v1/app-control/privilege-grants/${item.id}/revoke`,
    }
    const url = calls[action]
    if (!url) return
    try {
      await axios.post(`${API}${url}`, action === 'edr-contain' ? { action: 'isolate' } : {}, { headers })
      setNotice('Action completed.')
      load()
    } catch (err: any) {
      setNotice(err.response?.data?.detail || 'Action failed')
    }
  }

  const workflowButtons = (item: any): { label: string; action: string }[] => {
    if (endpoint === '/api/v1/patches/') return [
      { label: 'Test', action: 'patch-test' }, { label: 'Approve', action: 'patch-approve' },
      { label: 'Decline', action: 'patch-decline' }, { label: 'Deploy', action: 'patch-deploy' },
    ]
    if (endpoint === '/api/v1/vulnerabilities/') return [
      { label: 'Mitigate', action: 'vuln-mitigate' }, { label: 'Remediate', action: 'vuln-remediate' },
    ]
    if (endpoint === '/api/v1/edr/incidents/') return [{ label: 'Contain', action: 'edr-contain' }]
    if (endpoint === '/api/v1/malware/detections/') return [{ label: 'Quarantine', action: 'malware-quarantine' }]
    if (endpoint === '/api/v1/ransomware/incidents/') return [{ label: 'Recover', action: 'ransomware-recover' }]
    if (endpoint === '/api/v1/mdm/devices/') return [
      { label: 'Lock', action: 'mdm-lock' }, { label: 'Wipe', action: 'mdm-wipe' },
    ]
    if (endpoint === '/api/v1/dlp/containers/') return [{ label: 'Wipe', action: 'dlp-wipe' }]
    if (endpoint === '/api/v1/remote/sessions/') return [{ label: 'End', action: 'remote-end' }]
    if (endpoint === '/api/v1/servers/patch-windows/') return [{ label: 'Approve', action: 'server-approve' }]
    if (endpoint === '/api/v1/app-control/privilege-grants/') return [{ label: 'Revoke', action: 'grant-revoke' }]
    return []
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow w-96">
          <h1 className="text-2xl font-semibold mb-2">NEXUS</h1>
          <p className="text-sm text-gray-500 mb-6">Unified IT & Security Platform</p>
          {backendStatus === 'checking' && <p className="text-sm text-gray-500 mb-4">Checking backend…</p>}
          {backendStatus === 'unreachable' && (
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <p className="text-sm text-red-700 font-medium">Backend not reachable at {BACKEND_LABEL}</p>
              <p className="text-xs text-red-600 mt-1">Start it with “docker compose -f infra/docker-compose.yml up -d” or “./scripts/start-nexus.sh”, wait for it to come up, then tap Retry.</p>
              <button className="text-xs underline mt-2" onClick={checkBackend}>Retry backend check</button>
            </div>
          )}
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <input className="w-full border p-2 mb-3 rounded" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border p-2 mb-4 rounded" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="w-full bg-blue-600 text-white p-2 rounded mb-2" onClick={login}>Sign In</button>
          <button className="w-full border p-2 rounded" onClick={register}>Create Organization</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-semibold">NEXUS</h1>
          <p className="text-xs text-gray-500">IT & Security Platform</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {MODULES.map(m => (
            <button
              key={m.id}
              onClick={() => pickModule(m.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-1 ${module === m.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t">
          <button className="text-sm text-gray-600" onClick={() => { setToken(''); localStorage.removeItem('nexus_token') }}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-medium mb-1">{current.label}</h2>
          <p className="text-sm text-gray-500 mb-4">{current.description}</p>
          {current.subsections && (
            <div className="flex flex-wrap gap-2 mb-4">
              {current.subsections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSubsection(s.id)}
                  className={`px-3 py-1 rounded-full text-xs border ${(subsection || current.subsections![0].id) === s.id ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="border rounded p-4">
                <div className="text-2xl font-bold">{String(v)}</div>
                <div className="text-sm text-gray-500 capitalize">{k}</div>
              </div>
            ))}
            {Object.keys(stats).length === 0 && <div className="text-gray-400">No stats yet</div>}
          </div>
          <div className="flex gap-2 mt-4">
            <input className="flex-1 border p-2 rounded text-sm" placeholder="New record name / title" value={newName} onChange={e => setNewName(e.target.value)} />
            <button className="bg-blue-600 text-white px-4 rounded text-sm" onClick={createItem}>Add</button>
            {module === 'scheduler' && (
              <button className="bg-green-600 text-white px-4 rounded text-sm" onClick={runSchedulerNow}>Run now</button>
            )}
          </div>
          {notice && <p className="text-sm text-gray-600 mt-2">{notice}</p>}
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-medium mb-3">Items</h3>
          {items.length === 0 ? (
            <p className="text-gray-500">No records yet. Add one above, or ingest data from an enrolled endpoint agent.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Detail</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="py-2 pr-2 font-medium">{displayName(item)}</td>
                    <td className="py-2 pr-2 text-gray-600">{displayDetail(item)}</td>
                    <td className="py-2 pr-2">
                      <select
                        className="border rounded px-2 py-1 text-xs"
                        value={item.status || ''}
                        onChange={e => setStatus(item, e.target.value)}
                      >
                        <option value="">{item.status || '—'}</option>
                        {STATUS_OPTIONS.filter(s => s !== item.status).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {workflowButtons(item).map(b => (
                          <button key={b.action} className="border rounded px-2 py-1 text-xs hover:bg-gray-100" onClick={() => workflowAction(b.action, item)}>{b.label}</button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
