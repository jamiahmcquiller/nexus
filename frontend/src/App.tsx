import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { statusBadgeClasses, statusTone, DENSITY_STORAGE_KEY, THEME_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from './theme'
import GrcWorkspace from './GrcWorkspace'
import type { Density, ThemeMode } from './theme'
import { WORKSPACES, getWorkspace, pickStatValue } from './workspaces'
import type { WorkspaceDef, WorkspaceId } from './workspaces'

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
  workspace: WorkspaceId
  subsections?: Subsection[]
}

// Every feature area is one platform module with the same tenant-scoped API:
// GET <endpoint> (list), GET <endpoint>stats, POST <endpoint> (create),
// PATCH <endpoint>{id}, POST <endpoint>{id}/status
//
// Each module belongs to exactly one administrator workspace, so the
// two workspaces have separate navigation. The old single "Dashboard"
// module is gone: each workspace has its own home dashboard instead
// (see WORKSPACES in workspaces.ts).
const MODULES: ModuleDef[] = [
  {
    id: 'devices', label: 'Endpoints', description: 'Enrolled devices, inventory, heartbeat, and groups.', endpoint: '/api/v1/devices/', workspace: 'operations',
  },
  {
    id: 'patches', label: 'Patch Management',
    description: 'Automated patching — scan, test, approve, deploy — with deployment policies, third-party patching, and selective decline.',
    endpoint: '/api/v1/patches/', workspace: 'operations',
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
    endpoint: '/api/v1/vulnerabilities/', workspace: 'security',
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
    endpoint: '/api/v1/edr/telemetry/', workspace: 'security',
    subsections: [
      { id: 'telemetry', label: 'Telemetry', endpoint: '/api/v1/edr/telemetry/' },
      { id: 'hunts', label: 'Threat hunts', endpoint: '/api/v1/edr/hunts/' },
      { id: 'incidents', label: 'Incident response', endpoint: '/api/v1/edr/incidents/' },
      { id: 'alerts', label: 'Alerts', endpoint: '/api/v1/alerts/' },
    ],
  },
  { id: 'malware', label: 'Malware Protection', description: 'Multi-layered detection — behaviour-based AI plus deep-learning AV — with MITRE TTP forensics and quarantine.', endpoint: '/api/v1/malware/detections/', workspace: 'security' },
  {
    id: 'ransomware', label: 'Anti-Ransomware',
    description: 'Behaviour detection, device quarantine, incident analysis, and single-click recovery from incremental VSS shadow-copy backups.',
    endpoint: '/api/v1/ransomware/incidents/', workspace: 'security',
    subsections: [
      { id: 'incidents', label: 'Incidents', endpoint: '/api/v1/ransomware/incidents/' },
      { id: 'recovery', label: 'Recovery points', endpoint: '/api/v1/ransomware/recovery-points/' },
    ],
  },
  {
    id: 'browser', label: 'Browser Security',
    description: 'Trusted-browser restriction, extension management, kiosk lockdown, isolation, Java rules, and legacy-browser routing.',
    endpoint: '/api/v1/browser/policies/', workspace: 'security',
    subsections: [
      { id: 'policies', label: 'Policies', endpoint: '/api/v1/browser/policies/' },
      { id: 'extensions', label: 'Extensions', endpoint: '/api/v1/browser/extensions/' },
    ],
  },
  {
    id: 'appcontrol', label: 'Application Control',
    description: 'Allowlist / blocklist, privilege management, child-process control, admin-rights removal, and just-in-time access.',
    endpoint: '/api/v1/app-control/rules/', workspace: 'security',
    subsections: [
      { id: 'rules', label: 'Rules', endpoint: '/api/v1/app-control/rules/' },
      { id: 'grants', label: 'Privilege grants', endpoint: '/api/v1/app-control/privilege-grants/' },
    ],
  },
  {
    id: 'dlp', label: 'Data Security / DLP',
    description: 'Sensitive-data discovery and classification, leak prevention at rest / in use / in motion, BYOD containers, and remote wipe.',
    endpoint: '/api/v1/dlp/findings/', workspace: 'security',
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
    endpoint: '/api/v1/access/segments/', workspace: 'security',
    subsections: [
      { id: 'segments', label: 'App segments', endpoint: '/api/v1/access/segments/' },
      { id: 'policies', label: 'Access policies', endpoint: '/api/v1/access/policies/' },
      { id: 'audit', label: 'Access audit', endpoint: '/api/v1/access/audit/' },
    ],
  },
  {
    id: 'assets', label: 'Asset Management',
    description: 'Hardware / software / digital assets, licenses, warranties, certificates, geo-fencing, power, and USB control.',
    endpoint: '/api/v1/assets/', workspace: 'operations',
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
    endpoint: '/api/v1/distribution/packages/', workspace: 'operations',
    subsections: [
      { id: 'packages', label: 'Packages', endpoint: '/api/v1/distribution/packages/' },
      { id: 'deployments', label: 'Deployments', endpoint: '/api/v1/distribution/deployments/' },
      { id: 'metering', label: 'Metering', endpoint: '/api/v1/distribution/metering/' },
    ],
  },
  {
    id: 'dex', label: 'Digital Employee Experience',
    description: 'Telemetry into experience scores and benchmarks, root-cause analysis, and automated remediation workflows.',
    endpoint: '/api/v1/dex/telemetry/', workspace: 'operations',
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
    endpoint: '/api/v1/remote/sessions/', workspace: 'operations',
    subsections: [
      { id: 'sessions', label: 'Sessions', endpoint: '/api/v1/remote/sessions/' },
      { id: 'announcements', label: 'Announcements', endpoint: '/api/v1/remote/announcements/' },
      { id: 'tools', label: 'System tools', endpoint: '/api/v1/remote/system-tools/' },
    ],
  },
  {
    id: 'imaging', label: 'OS Imaging',
    description: 'Online / offline imaging, zero-touch PXE / USB / ISO deployment, standalone WFH deployment, and role-based templates.',
    endpoint: '/api/v1/imaging/images/', workspace: 'operations',
    subsections: [
      { id: 'images', label: 'Images', endpoint: '/api/v1/imaging/images/' },
      { id: 'deployments', label: 'Deployments', endpoint: '/api/v1/imaging/deployments/' },
      { id: 'templates', label: 'Templates', endpoint: '/api/v1/imaging/templates/' },
    ],
  },
  {
    id: 'config', label: 'Configuration Management',
    description: 'User- and computer-based configurations, profiles, kiosk lockdown, and a script repository.',
    endpoint: '/api/v1/config/profiles/', workspace: 'operations',
    subsections: [
      { id: 'profiles', label: 'Profiles', endpoint: '/api/v1/config/profiles/' },
      { id: 'scripts', label: 'Scripts', endpoint: '/api/v1/config/scripts/' },
      { id: 'kiosk', label: 'Kiosk', endpoint: '/api/v1/config/kiosk/' },
    ],
  },
  {
    id: 'mdm', label: 'Mobile Device Management',
    description: 'Android, iOS, iPadOS, macOS, Windows, ChromeOS, and tvOS — enrollment, profiles, apps, kiosk, and remote lock / wipe.',
    endpoint: '/api/v1/mdm/devices/', workspace: 'operations',
    subsections: [
      { id: 'devices', label: 'Devices', endpoint: '/api/v1/mdm/devices/' },
      { id: 'profiles', label: 'Profiles', endpoint: '/api/v1/mdm/profiles/' },
      { id: 'apps', label: 'Apps', endpoint: '/api/v1/mdm/apps/' },
    ],
  },
  {
    id: 'encryption', label: 'Disk Encryption',
    description: 'BitLocker / FileVault / TPM control, granular policies, encryption at scale, and secure recovery-key escrow (references only, never raw keys).',
    endpoint: '/api/v1/encryption/policies/', workspace: 'operations',
    subsections: [
      { id: 'policies', label: 'Policies', endpoint: '/api/v1/encryption/policies/' },
      { id: 'keys', label: 'Recovery keys', endpoint: '/api/v1/encryption/recovery-keys/' },
    ],
  },
  {
    id: 'servers', label: 'Server Management',
    description: 'Server lifecycle, unified multi-OS caching, self-service patch windows for app owners, and CIS-based vulnerability detection.',
    endpoint: '/api/v1/servers/', workspace: 'operations',
    subsections: [
      { id: 'servers', label: 'Servers', endpoint: '/api/v1/servers/' },
      { id: 'windows', label: 'Patch windows', endpoint: '/api/v1/servers/patch-windows/' },
      { id: 'health', label: 'Health checks', endpoint: '/api/v1/servers/health-checks/' },
    ],
  },
  {
    id: 'scheduler', label: 'Scheduler',
    description: 'Background worker — patch deployments, threat hunts, remediation workflows, and expiry housekeeping. Runs as a separate process (python -m app.worker); this page shows its runs and lets an owner/admin trigger one tick now.',
    endpoint: '/api/v1/scheduler/runs/', workspace: 'operations',
  },
  {
    // Governance, Risk & Compliance workspace — rendered by
    // GrcWorkspace (frontend/src/GrcWorkspace.tsx), not the generic
    // module table. The subsections below are its 12 categories;
    // the legacy device-benchmark results still live at
    // /api/v1/compliance/ and are surfaced in the GRC overview.
    id: 'compliance', label: 'Governance, Risk & Compliance',
    description: 'Enterprise GRC — frameworks and standards, control library, assessments, evidence, findings and exceptions, risk register, remediation plans, compliance reports, audit schedule, control mapping, and settings.',
    endpoint: '/api/v1/grc/overview', workspace: 'security',
    subsections: [
      { id: 'overview', label: 'Overview', endpoint: '/api/v1/grc/overview' },
      { id: 'frameworks', label: 'Frameworks & Standards', endpoint: '/api/v1/grc/frameworks/' },
      { id: 'controls', label: 'Control Library', endpoint: '/api/v1/grc/controls/' },
      { id: 'assessments', label: 'Assessments', endpoint: '/api/v1/grc/assessments/' },
      { id: 'evidence', label: 'Evidence Management', endpoint: '/api/v1/grc/evidence/' },
      { id: 'findings', label: 'Findings & Exceptions', endpoint: '/api/v1/grc/findings/' },
      { id: 'risks', label: 'Risk Register', endpoint: '/api/v1/grc/risks/' },
      { id: 'remediations', label: 'Remediation Plans', endpoint: '/api/v1/grc/remediations/' },
      { id: 'reports', label: 'Compliance Reports', endpoint: '/api/v1/reports/' },
      { id: 'audits', label: 'Audit Schedule', endpoint: '/api/v1/grc/audits/' },
      { id: 'mappings', label: 'Control Mapping', endpoint: '/api/v1/grc/mappings/' },
      { id: 'settings', label: 'Compliance Settings', endpoint: '/api/v1/grc/settings/' },
    ],
  },
  { id: 'policies', label: 'Policies', description: 'Cross-module policy definitions (patch, compliance, app control, encryption, browser, MDM).', endpoint: '/api/v1/policies/', workspace: 'security' },
]

const STATUS_OPTIONS = ['active', 'open', 'new', 'available', 'scheduled', 'testing', 'approved', 'declined', 'deployed', 'mitigated', 'remediated', 'contained', 'resolved', 'quarantined', 'recovered', 'locked', 'wiped', 'ended', 'draft', 'disabled', 'complete', 'running']

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function displayName(item: any): string {
  return item.title || item.name || item.hostname || item.cve_id || item.software_name || item.app_name || item.device_id || item.id
}

function displayDetail(item: any): string {
  return item.severity || item.category || item.platform || item.rule_type || item.scope || item.benchmark || item.detection_layer || item.event_type || item.action || item.status || ''
}

type SessionUser = { username: string; role: string; workspaces: WorkspaceId[] }

function storedTheme(): ThemeMode {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
}

function storedDensity(): Density {
  const value = localStorage.getItem(DENSITY_STORAGE_KEY)
  return value === 'compact' || value === 'spacious' ? value : 'comfortable'
}

function storedWorkspace(): WorkspaceId {
  const value = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  return value === 'security' ? 'security' : 'operations'
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('nexus_token') || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  // Before the backend answers, assume both workspaces so the UI
  // never flashes a locked-out state on a slow first load.
  const [authorizedWorkspaces, setAuthorizedWorkspaces] = useState<WorkspaceId[]>(['operations', 'security'])
  const [workspace, setWorkspace] = useState<WorkspaceId>(storedWorkspace)
  const [module, setModule] = useState('home')
  const [subsection, setSubsection] = useState('')
  const [stats, setStats] = useState<Record<string, any>>({})
  const [items, setItems] = useState<any[]>([])
  const [homeStats, setHomeStats] = useState<Record<string, number>>({})
  const [attentionItems, setAttentionItems] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState('')
  const [navQuery, setNavQuery] = useState('')
  const [theme, setTheme] = useState<ThemeMode>(storedTheme)
  const [density, setDensity] = useState<Density>(storedDensity)
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'unreachable'>('checking')

  const workspaceDef: WorkspaceDef = getWorkspace(workspace)
  const workspaceModules = MODULES.filter((m) => m.workspace === workspace)
  const navModules = navQuery.trim()
    ? workspaceModules.filter((m) => m.label.toLowerCase().includes(navQuery.trim().toLowerCase()))
    : workspaceModules

  // Theme + density apply to <html> / the app root, so every screen
  // follows the same tokens (see index.css).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(DENSITY_STORAGE_KEY, density)
  }, [density])

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

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  // Resolve the signed-in user and the workspaces they may open.
  // One token authorizes both workspaces — this call re-validates
  // the token, it never asks for credentials again.
  const fetchSession = useCallback(async () => {
    if (!token) return
    try {
      const res = await axios.get(`${API}/api/v1/auth/workspaces`, { headers })
      const list = (res.data.workspaces || []) as WorkspaceId[]
      setSessionUser({ username: res.data.username, role: res.data.role, workspaces: list })
      setAuthorizedWorkspaces(list)
      // If the stored workspace is not authorized for this user,
      // fall back to their first authorized workspace.
      if (list.length > 0 && !list.includes(storedWorkspace())) {
        setWorkspace(list[0])
      }
    } catch {
      // Older backend without /workspaces: fall back to /me.
      try {
        const res = await axios.get(`${API}/api/v1/auth/me`, { headers })
        const list = (res.data.workspaces || ['operations', 'security']) as WorkspaceId[]
        setSessionUser({ username: res.data.username, role: res.data.role, workspaces: list })
        setAuthorizedWorkspaces(list)
        if (list.length > 0 && !list.includes(storedWorkspace())) {
          setWorkspace(list[0])
        }
      } catch {
        // Token no longer valid — sign out rather than guessing.
        setToken('')
        localStorage.removeItem('nexus_token')
        setSessionUser(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { fetchSession() }, [fetchSession])

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

  const current = MODULES.find((m) => m.id === module)
  const endpoint = current
    ? (current.subsections
      ? (current.subsections.find((s) => s.id === subsection) || current.subsections[0]).endpoint
      : current.endpoint)
    : ''

  const loadHome = useCallback(async () => {
    if (!token) return
    const def = getWorkspace(workspace)
    const values: Record<string, number> = {}
    await Promise.all(def.homeStats.map(async (stat) => {
      try {
        const res = await axios.get(`${API}${stat.endpoint}`, { headers })
        values[stat.label] = pickStatValue(res.data || {}, stat.preferKeys)
      } catch {
        values[stat.label] = 0
      }
    }))
    setHomeStats(values)
    try {
      const res = await axios.get(`${API}${def.attentionEndpoint}`, { headers })
      const list = (Array.isArray(res.data) ? res.data : [])
        .filter((item: any) => def.attentionStatuses.includes((item.status || '').toLowerCase()))
        .sort((a: any, b: any) => (SEVERITY_RANK[(a.severity || '').toLowerCase()] ?? 9) - (SEVERITY_RANK[(b.severity || '').toLowerCase()] ?? 9))
        .slice(0, 5)
      setAttentionItems(list)
    } catch {
      setAttentionItems([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspace])

  const load = useCallback(async () => {
    if (!token) return
    if (module === 'home' || !current) {
      loadHome()
      return
    }
    // GRC has its own data fetching inside GrcWorkspace.
    if (module === 'compliance') return
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
  }, [token, endpoint, module, loadHome])

  useEffect(() => { load() }, [load])

  const pickModule = (id: string) => {
    setModule(id)
    setSubsection('')
    setNotice('')
  }

  // Switch workspaces on the same sign-in: the token is untouched,
  // nothing re-authenticates, and the choice is remembered for
  // the next visit. Only workspaces the backend authorized for
  // this user can be opened.
  const switchWorkspace = (id: WorkspaceId) => {
    if (!authorizedWorkspaces.includes(id)) return
    setWorkspace(id)
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id)
    setModule('home')
    setSubsection('')
    setNotice('')
    setNavQuery('')
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

  const signOut = () => {
    setToken('')
    localStorage.removeItem('nexus_token')
    setSessionUser(null)
    setModule('home')
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

  const workflowButtons = (_item: any): { label: string; action: string }[] => {
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
      <div className="min-h-screen bg-nexus-navy flex items-center justify-center p-4">
        <div className="nexus-card w-96">
          <h1 className="text-2xl font-bold mb-1 text-nexus-navy dark:text-white">NEXUS</h1>
          <p className="text-sm text-nexus-slate mb-6">Unified IT & Security Platform</p>
          {backendStatus === 'checking' && <p className="text-sm text-nexus-slate mb-4">Checking backend…</p>}
          {backendStatus === 'unreachable' && (
            <div className="rounded p-3 mb-4 border" style={{ background: '#FBECEC', borderColor: '#E5AFB0' }}>
              <p className="text-sm font-medium" style={{ color: '#C64D4D' }}>Backend not reachable at {BACKEND_LABEL}</p>
              <p className="text-xs mt-1" style={{ color: '#C64D4D' }}>Start it with “docker compose -f infra/docker-compose.yml up -d” or “./scripts/start-nexus.sh”, wait for it to come up, then tap Retry.</p>
              <button className="text-xs underline mt-2" style={{ color: '#C64D4D' }} onClick={checkBackend}>Retry backend check</button>
            </div>
          )}
          {error && <p className="text-sm mb-4" style={{ color: '#C64D4D' }}>{error}</p>}
          <input className="nexus-input p-2 mb-3 text-sm" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="nexus-input p-2 mb-4 text-sm" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="w-full bg-nexus-teal hover:bg-nexus-tealDark text-white p-2 rounded mb-2 text-sm font-medium" onClick={login}>Sign In</button>
          <button className="w-full bg-white hover:bg-nexus-cloud border border-nexus-border p-2 rounded text-sm" onClick={register}>Create Organization</button>
          <p className="text-xs text-nexus-slate mt-4">One sign-in opens both administrator workspaces — IT Operations and Security Operations — with no second login to switch between them.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-nexus-cloud dark:bg-nexus-navyDeep flex" data-density={density}>
      <aside className="w-64 bg-nexus-navy text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-white/10">
          <h1 className="text-xl font-bold tracking-wide">NEXUS</h1>
          <p className="text-xs" style={{ color: '#8AA0B8' }}>IT & Security Platform</p>
        </div>
        {/* Workspace switcher — same sign-in, no re-login to switch. */}
        <div className="p-3 border-b border-white/10">
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: '#8AA0B8' }}>Workspace</p>
          <div className="flex flex-col gap-1" role="tablist" aria-label="Administrator workspace">
            {WORKSPACES.map((w) => {
              const allowed = authorizedWorkspaces.includes(w.id)
              const active = workspace === w.id
              return (
                <button
                  key={w.id}
                  role="tab"
                  aria-selected={active}
                  disabled={!allowed}
                  onClick={() => switchWorkspace(w.id)}
                  title={allowed ? `Switch to ${w.label} — no sign-in needed` : `Your role (${sessionUser?.role || '…'}) does not authorize ${w.label}`}
                  className={`w-full text-left px-3 py-2 rounded text-sm border-l-4 ${active ? 'bg-nexus-navyLight font-semibold' : 'hover:bg-nexus-navyLight/60'} ${allowed ? '' : 'opacity-40 cursor-not-allowed'}`}
                  style={{ borderLeftColor: active ? '#167C80' : 'transparent' }}
                >
                  <span className="block">{w.label}</span>
                  <span className="block text-xs font-normal" style={{ color: '#8AA0B8' }}>{allowed ? w.tagline : 'Not authorized for your role'}</span>
                </button>
              )
            })}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label={`${workspaceDef.label} navigation`}>
          <button
            onClick={() => pickModule('home')}
            className={`w-full text-left px-3 py-2 rounded text-sm mb-1 border-l-4 ${module === 'home' ? 'bg-nexus-navyLight font-semibold' : 'hover:bg-nexus-navyLight/60'}`}
            style={{ borderLeftColor: module === 'home' ? '#167C80' : 'transparent' }}
          >
            Home
          </button>
          {navModules.map((m) => (
            <button
              key={m.id}
              onClick={() => pickModule(m.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm mb-1 border-l-4 ${module === m.id ? 'bg-nexus-navyLight font-semibold' : 'hover:bg-nexus-navyLight/60'}`}
              style={{ borderLeftColor: module === m.id ? '#167C80' : 'transparent' }}
            >
              {m.label}
            </button>
          ))}
          {navModules.length === 0 && (
            <p className="text-xs px-3 py-2" style={{ color: '#8AA0B8' }}>No sections match “{navQuery}”.</p>
          )}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs" style={{ color: '#8AA0B8' }}>
          {sessionUser && <p className="mb-2 truncate">{sessionUser.username} · {sessionUser.role}</p>}
          <button className="text-sm text-white/80 hover:text-white" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top navigation — white, subtle bottom border, slate icons. */}
        <header className="bg-white dark:bg-[#16283F] border-b border-nexus-border dark:border-[#243A56] px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold font-display text-nexus-navy dark:text-white truncate">{module === 'home' ? workspaceDef.homeTitle : current?.label}</h2>
            <p className="text-xs text-nexus-slate truncate">{workspaceDef.label} workspace</p>
          </div>
          <div className="flex-1" />
          <input
            className="nexus-input !w-56 p-2 text-sm"
            placeholder={`Search ${workspaceDef.shortLabel.toLowerCase()} sections…`}
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            aria-label="Search sections in this workspace"
          />
          <label className="text-xs text-nexus-slate flex items-center gap-1">
            Density
            <select className="nexus-input !w-auto p-1 text-xs" value={density} onChange={(e) => setDensity(e.target.value as Density)} aria-label="Display density">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
          <button
            className="border border-nexus-border bg-white dark:bg-transparent rounded px-3 py-1.5 text-xs hover:bg-nexus-cloud"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </header>

        <main className="flex-1 p-6 min-w-0">
          {module === 'home' ? (
            <div>
              <div className="nexus-card mb-6">
                <h2 className="text-lg font-semibold mb-1 text-nexus-navy dark:text-white">{workspaceDef.homeTitle}</h2>
                <p className="text-sm text-nexus-slate">{workspaceDef.homeDescription}</p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {workspaceDef.homeStats.map((stat) => (
                  <div key={stat.label} className="nexus-card">
                    <div className="text-2xl font-bold text-nexus-navy dark:text-white">{homeStats[stat.label] ?? '—'}</div>
                    <div className="text-sm text-nexus-slate">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="nexus-card">
                  <h3 className="font-semibold mb-3 text-nexus-navy dark:text-white">{workspaceDef.attentionTitle}</h3>
                  {attentionItems.length === 0 ? (
                    <p className="text-sm text-nexus-slate">Nothing needs attention right now.</p>
                  ) : (
                    <ul className="space-y-2">
                      {attentionItems.map((item) => {
                        const badge = statusBadgeClasses(item.severity || item.status)
                        return (
                          <li key={item.id} className="flex items-start justify-between gap-3 text-sm border-b border-nexus-border last:border-0 pb-2 last:pb-0">
                            <span className="font-medium">{displayName(item)}</span>
                            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: badge.color, background: badge.background }}>
                              {displayDetail(item)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div className="nexus-card">
                  <h3 className="font-semibold mb-3 text-nexus-navy dark:text-white">Go to a section</h3>
                  <div className="flex flex-wrap gap-2">
                    {workspaceModules.map((m) => (
                      <button key={m.id} onClick={() => pickModule(m.id)} className="px-3 py-1.5 rounded-full text-xs border border-nexus-border hover:bg-nexus-tealSoft hover:border-nexus-teal hover:text-nexus-tealDark">
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-nexus-slate mt-4">
                    Switch workspaces any time from the sidebar — your sign-in carries over, no second login.
                    {authorizedWorkspaces.length < 2 && ' Your role authorizes only this workspace.'}
                  </p>
                </div>
              </div>
            </div>
          ) : module === 'compliance' ? (
            <GrcWorkspace api={API} headers={headers} />
          ) : current ? (
            <div>
              <div className="nexus-card mb-6">
                <h2 className="text-lg font-semibold mb-1 text-nexus-navy dark:text-white">{current.label}</h2>
                <p className="text-sm text-nexus-slate mb-4">{current.description}</p>
                {current.subsections && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {current.subsections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSubsection(s.id)}
                        className={`px-3 py-1 rounded-full text-xs border ${(subsection || current.subsections![0].id) === s.id ? 'bg-nexus-teal text-white border-nexus-teal' : 'text-nexus-slateDark hover:bg-nexus-cloud'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(stats).map(([k, v]) => (
                    <div key={k} className="border border-nexus-border rounded p-4">
                      <div className="text-2xl font-bold text-nexus-navy dark:text-white">{String(v)}</div>
                      <div className="text-sm text-nexus-slate capitalize">{k}</div>
                    </div>
                  ))}
                  {Object.keys(stats).length === 0 && <div className="text-nexus-slate">No stats yet</div>}
                </div>
                <div className="flex gap-2 mt-4">
                  <input className="nexus-input flex-1 p-2 text-sm" placeholder="New record name / title" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <button className="bg-nexus-teal hover:bg-nexus-tealDark text-white px-4 rounded text-sm font-medium" onClick={createItem}>Add</button>
                  {module === 'scheduler' && (
                    <button className="text-white px-4 rounded text-sm font-medium" style={{ background: '#218568' }} onClick={runSchedulerNow}>Run now</button>
                  )}
                </div>
                {notice && <p className="text-sm text-nexus-slate mt-2">{notice}</p>}
              </div>
              <div className="nexus-card">
                <h3 className="font-semibold mb-3 text-nexus-navy dark:text-white">Items</h3>
                {items.length === 0 ? (
                  <p className="text-nexus-slate">No records yet. Add one above, or ingest data from an enrolled endpoint agent.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-nexus-slate border-b border-nexus-border">
                        <th className="py-2 pr-2">Name</th>
                        <th className="py-2 pr-2">Detail</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const badge = statusBadgeClasses(item.severity || item.status)
                        return (
                          <tr key={item.id} className="nexus-table-row border-b border-nexus-border align-top">
                            <td className="py-2 pr-2 font-medium">{displayName(item)}</td>
                            <td className="py-2 pr-2 text-nexus-slate">
                              {displayDetail(item)}
                              {item.severity && (
                                <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: badge.color, background: badge.background }}>
                                  {item.severity}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusBadgeClasses(item.status).color }} title={`Status tone: ${statusTone(item.status)}`} />
                                <select
                                  className="nexus-input !w-auto px-2 py-1 text-xs"
                                  value={item.status || ''}
                                  onChange={(e) => setStatus(item, e.target.value)}
                                  aria-label={`Status for ${displayName(item)}`}
                                >
                                  <option value="">{item.status || '—'}</option>
                                  {STATUS_OPTIONS.filter((s) => s !== item.status).map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                </select>
                              </span>
                            </td>
                            <td className="py-2">
                              <div className="flex flex-wrap gap-1">
                                {workflowButtons(item).map((b) => (
                                  <button key={b.action} className="border border-nexus-border rounded px-2 py-1 text-xs hover:bg-nexus-cloud" onClick={() => workflowAction(b.action, item)}>{b.label}</button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}

export default App
