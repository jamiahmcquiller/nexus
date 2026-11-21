import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { THEME_STORAGE_KEY, WORKSPACE_STORAGE_KEY, TOKEN_STORAGE_KEY } from './theme'
import GrcWorkspace from './GrcWorkspace'
import type { ThemeMode } from './theme'
import { WORKSPACES, getWorkspace } from './workspaces'
import type { WorkspaceDef, WorkspaceId } from './workspaces'
import { Breadcrumbs, Icon, ModulePage, ToastProvider, useToast, EndpointDetailDrawer, RemediationConfigManager, SendConfigurationModal } from './components'
import type { IconName } from './components'
import { OPERATIONS_PRESENTATION } from './moduleConfig.operations'
import { SECURITY_PRESENTATION } from './moduleConfig.security'
import type { ModulePresentation } from './modulePresentation'
import { ItOpsHome } from './homes/ItOpsHome'
import SecOpsHome from './homes/SecOpsHome'
import { NULL_LOGO_SRC } from './logoDataUri'

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
  console.log('[NULL] API base URL:', API)
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
      { id: 'remediation-configs', label: 'Remediation configurations', endpoint: '/api/v1/remediation-configurations/' },
      { id: 'zero-day', label: 'Zero-day mitigations', endpoint: '/api/v1/zero-day-mitigations/' },
      { id: 'configs', label: 'Security configurations', endpoint: '/api/v1/security-configurations/' },
      { id: 'web', label: 'Web server hardening', endpoint: '/api/v1/web-server-hardening/' },
      { id: 'high-risk', label: 'High-risk software', endpoint: '/api/v1/high-risk-software/' },
    ],
  },
  {
    id: 'edr', label: 'Endpoint Detection',
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
    id: 'dex', label: 'Employee Experience',
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
    id: 'config', label: 'Configuration',
    description: 'User- and computer-based configurations, profiles, kiosk lockdown, and a script repository.',
    endpoint: '/api/v1/config/profiles/', workspace: 'operations',
    subsections: [
      { id: 'profiles', label: 'Profiles', endpoint: '/api/v1/config/profiles/' },
      { id: 'scripts', label: 'Scripts', endpoint: '/api/v1/config/scripts/' },
      { id: 'kiosk', label: 'Kiosk', endpoint: '/api/v1/config/kiosk/' },
    ],
  },
  {
    id: 'mdm', label: 'Mobile Devices',
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
    id: 'compliance', label: 'GRC',
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

// Rolled-out module presentation: per-endpoint columns, detail
// fields, stat labels, and empty states in the approved NULL
// design language. Keyed by API endpoint path. Sections without
// an entry fall back to the generic presentation below.
const MODULE_PRESENTATION: Record<string, ModulePresentation> = {
  ...OPERATIONS_PRESENTATION,
  ...SECURITY_PRESENTATION,
}

const FALLBACK_PRESENTATION: ModulePresentation = {
  columns: [
    { key: 'name', label: 'Name', kind: 'name' },
    { key: 'detail', label: 'Detail', kind: 'detail' },
    { key: 'status', label: 'Status', kind: 'status' },
  ],
  detailFields: ['status', 'created_at'],
  statLabels: { total: 'Total' },
  emptyTitle: 'No records yet',
  emptyDescription: 'No records exist in this section yet.',
}


// Sidebar navigation groups (brief §6). Each group lists module ids
// in display order; groups with no visible modules are not rendered.
const NAV_GROUPS: Record<WorkspaceId, { label: string; modules: string[] }[]> = {
  operations: [
    { label: 'Overview', modules: ['home'] },
    { label: 'Endpoint Management', modules: ['devices', 'mdm', 'encryption'] },
    { label: 'Software & Deployment', modules: ['patches', 'distribution', 'imaging'] },
    { label: 'Infrastructure', modules: ['servers', 'assets', 'config'] },
    { label: 'Employee Experience', modules: ['dex', 'remote'] },
    { label: 'Administration', modules: ['scheduler'] },
  ],
  security: [
    { label: 'Overview', modules: ['home'] },
    { label: 'Threat & Exposure', modules: ['vulnerabilities', 'edr', 'malware', 'ransomware'] },
    { label: 'Data & Access Security', modules: ['browser', 'appcontrol', 'dlp', 'access'] },
    { label: 'Governance', modules: ['compliance', 'policies'] },
  ],
}

const MODULE_ICONS: Record<string, IconName> = {
  home: 'home',
  devices: 'server',
  patches: 'download',
  vulnerabilities: 'alert-triangle',
  edr: 'search',
  malware: 'x-circle',
  ransomware: 'shield',
  browser: 'file-text',
  appcontrol: 'settings',
  dlp: 'file-text',
  access: 'users',
  assets: 'file-text',
  distribution: 'download',
  dex: 'check-circle',
  remote: 'users',
  imaging: 'server',
  config: 'settings',
  mdm: 'server',
  encryption: 'shield',
  servers: 'server',
  scheduler: 'clock',
  compliance: 'file-text',
  policies: 'file-text',
}

const SIDEBAR_COLLAPSED_KEY = 'null_sidebar_collapsed'

const STATUS_OPTIONS = ['active', 'open', 'new', 'available', 'scheduled', 'testing', 'approved', 'declined', 'deployed', 'mitigated', 'remediated', 'contained', 'resolved', 'quarantined', 'recovered', 'locked', 'wiped', 'ended', 'draft', 'disabled', 'complete', 'running']

// Devices carry their workflow state in enrollment_status, and the
// backend only accepts these three values (devices.py
// status_values) — offering the generic list here made every
// selection from a device row fail with 400.
const DEVICE_STATUSES = ['enrolled', 'suspended', 'decommissioned']

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

function storedWorkspace(): WorkspaceId {
  const value = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  return value === 'security' ? 'security' : 'operations'
}

function storedSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

function Console() {
  const toast = useToast()
  const [token, setToken] = useState(localStorage.getItem(TOKEN_STORAGE_KEY) || '')
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
  const [attentionItems, setAttentionItems] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [navQuery, setNavQuery] = useState('')
  const [theme, setTheme] = useState<ThemeMode>(storedTheme)
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'unreachable'>('checking')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedSidebarCollapsed)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [detailDevice, setDetailDevice] = useState<any | null>(null)
  // Vulnerability a "Send config" action was opened for; the modal
  // queues the configuration's script as one agent command.
  const [sendVuln, setSendVuln] = useState<any | null>(null)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [bellOpen, setBellOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const paletteInputRef = useRef<HTMLInputElement>(null)

  const workspaceDef: WorkspaceDef = getWorkspace(workspace)
  // Role gates for the write controls. The backend enforces the same
  // rules; these only hide buttons a role could never use.
  const canWrite = !!sessionUser && ['owner', 'admin', 'technician'].includes(sessionUser.role)
  const canDelete = !!sessionUser && ['owner', 'admin'].includes(sessionUser.role)
  // Sending a configuration queues an agent command — owner/admin
  // only, matching the backend gate (agent.py + remediation_configs.py).
  const canRunCommands = !!sessionUser && ['owner', 'admin'].includes(sessionUser.role)
  const workspaceModules = MODULES.filter((m) => m.workspace === workspace)
  const navModules = navQuery.trim()
    ? workspaceModules.filter((m) => m.label.toLowerCase().includes(navQuery.trim().toLowerCase()))
    : workspaceModules

  // Theme applies to <html> / the app root, so every screen
  // follows the same tokens (see index.css).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

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

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

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
        localStorage.removeItem(TOKEN_STORAGE_KEY)
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
    if (module === 'compliance') {
      // Still refresh the attention feed so the header bell stays
      // live on pages that don't load home data themselves.
      loadHome()
      return
    }
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
    // Keep the notification bell populated on module pages too.
    loadHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, endpoint, module, loadHome])

  useEffect(() => { load() }, [load])

  const pickModule = (id: string, subId?: string) => {
    setModule(id)
    setSubsection(subId || '')
    setEditingId(null)
    setDetailDevice(null)
    setSendVuln(null)
    setNewName('')
    setPaletteOpen(false)
    setBellOpen(false)
    setUserMenuOpen(false)
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
    setNavQuery('')
    setPaletteOpen(false)
    setBellOpen(false)
    setUserMenuOpen(false)
  }

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const login = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/auth/token`, { username, password })
      setToken(res.data.access_token)
      localStorage.setItem(TOKEN_STORAGE_KEY, res.data.access_token)
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
      localStorage.setItem(TOKEN_STORAGE_KEY, res.data.access_token)
      setError('')
    } catch (err: any) {
      if (!err.response) setBackendStatus('unreachable')
      setError(describeAuthError(err, 'registration'))
    }
  }

  const signOut = () => {
    setToken('')
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setSessionUser(null)
    setModule('home')
    setPaletteOpen(false)
    setBellOpen(false)
    setUserMenuOpen(false)
  }

  const createItem = async () => {
    if (!newName.trim()) return
    try {
      if (editingId) {
        // Edit: the Add box doubles as the edit box while editing.
        await axios.patch(`${API}${endpoint}${editingId}`, { title: newName, name: newName }, { headers })
        setEditingId(null)
        toast.success('Updated.')
      } else {
        await axios.post(`${API}${endpoint}`, { title: newName, name: newName }, { headers })
        toast.success('Created.')
      }
      setNewName('')
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Save failed')
    }
  }

  const editItem = (item: any) => {
    setEditingId(item.id)
    setNewName(displayName(item))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setNewName('')
  }

  const deleteItem = async (item: any) => {
    if (!window.confirm(`Delete ${displayName(item)}? This cannot be undone.`)) return
    try {
      await axios.delete(`${API}${endpoint}${item.id}`, { headers })
      toast.success('Deleted.')
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Delete failed')
    }
  }

  const runSchedulerNow = async () => {
    try {
      const res = await axios.post(`${API}/api/v1/scheduler/run-once`, {}, { headers })
      toast.success(`Scheduler tick done: ${(res.data.actions || []).length} action(s).`)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Scheduler run failed — owner/admin only, and the API must be running.')
    }
  }

  const setStatus = async (item: any, status: string) => {
    try {
      await axios.post(`${API}${endpoint}${item.id}/status`, { status }, { headers })
      toast.success(`Status set to ${status}.`)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Status update failed')
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
      toast.success('Action completed.')
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Action failed')
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

  /* ------------------------- command palette ------------------------- */

  type PaletteEntry = { id: string; label: string; detail: string; run: () => void }
  const paletteEntries: PaletteEntry[] = [
    ...workspaceModules.map((m) => ({
      id: `module-${m.id}`,
      label: m.label,
      detail: `${workspaceDef.label} · section`,
      run: () => pickModule(m.id),
    })),
    { id: 'home', label: workspaceDef.homeTitle, detail: `${workspaceDef.label} · home`, run: () => pickModule('home') },
    ...WORKSPACES.filter((w) => w.id !== workspace && authorizedWorkspaces.includes(w.id)).map((w) => ({
      id: `ws-${w.id}`,
      label: `Switch to ${w.label}`,
      detail: 'Workspace · same sign-in',
      run: () => switchWorkspace(w.id),
    })),
    { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, detail: 'Appearance', run: toggleTheme },
    { id: 'signout', label: 'Sign out', detail: 'Session', run: signOut },
  ]
  const paletteFiltered = paletteQuery.trim()
    ? paletteEntries.filter((e) => `${e.label} ${e.detail}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()))
    : paletteEntries

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('')
      setPaletteIndex(0)
      paletteInputRef.current?.focus()
    }
  }, [paletteOpen])

  // Ctrl+K / Cmd+K opens the palette from anywhere; ESC closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setPaletteOpen(false)
        setBellOpen(false)
        setUserMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPaletteIndex((i) => Math.min(i + 1, paletteFiltered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPaletteIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      paletteFiltered[paletteIndex]?.run()
    }
  }

  /* --------------------------- breadcrumbs --------------------------- */

  const activeSubsection = current?.subsections
    ? (current.subsections.find((s) => s.id === subsection) || current.subsections[0])
    : undefined
  const breadcrumbItems = [
    { label: 'NULL', onClick: () => pickModule('home') },
    { label: workspaceDef.label, onClick: () => pickModule('home') },
    ...(module === 'home'
      ? [{ label: workspaceDef.homeTitle }]
      : current
        ? [{ label: current.label, onClick: activeSubsection ? () => pickModule(current.id) : undefined }, ...(activeSubsection ? [{ label: activeSubsection.label }] : [])]
        : []),
  ]

  // The attention feed belongs to the current workspace's home
  // dashboard (patches for IT Ops, vulnerabilities for SecOps);
  // the bell navigates to that module.
  const attentionModuleId = workspace === 'operations' ? 'patches' : 'vulnerabilities'

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !(prev[label] ?? true) }))
  }
  const isGroupOpen = (label: string) => openGroups[label] ?? true

  const navItemClass = (active: boolean) =>
    `w-full text-left px-3 py-2 rounded text-sm mb-1 border-l-4 flex items-center gap-2.5 ${active ? 'bg-null-navy2 font-semibold' : 'hover:bg-null-navy2/60'}`

  const renderNavItem = (id: string, label: string) => {
    const active = module === id
    return (
      <button
        key={id}
        onClick={() => pickModule(id)}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={navItemClass(active)}
        style={{ borderLeftColor: active ? '#17C3B2' : 'transparent' }}
      >
        <Icon name={MODULE_ICONS[id] || 'file-text'} size={18} className="shrink-0" />
        {!sidebarCollapsed && <span className="truncate">{label}</span>}
      </button>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-null-obsidian flex items-center justify-center p-4">
        <div className="w-96">
          {/* Full lockup sits on the dark backdrop, not inside the white
              card — the chrome wordmark washes out on white. */}
          <img src={NULL_LOGO_SRC} alt="NULL — Control the Complexity" className="w-full max-w-[320px] h-auto mx-auto mb-6" />
          <div className="null-card w-full">
          {backendStatus === 'checking' && <p className="text-sm text-null-muted mb-4">Checking backend…</p>}
          {backendStatus === 'unreachable' && (
            <div className="rounded p-3 mb-4 border" style={{ background: '#FBECEC', borderColor: '#E5AFB0' }}>
              <p className="text-sm font-medium" style={{ color: '#C64D4D' }}>Backend not reachable at {BACKEND_LABEL}</p>
              <p className="text-xs mt-1" style={{ color: '#C64D4D' }}>Start it with “docker compose -f infra/docker-compose.yml up -d” or “./scripts/start-nexus.sh”, wait for it to come up, then tap Retry.</p>
              <button className="text-xs underline mt-2" style={{ color: '#C64D4D' }} onClick={checkBackend}>Retry backend check</button>
            </div>
          )}
          {error && <p className="text-sm mb-4" style={{ color: '#C64D4D' }}>{error}</p>}
          <input className="null-input p-2 mb-3 text-sm" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="null-input p-2 mb-4 text-sm" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="w-full bg-null-teal hover:bg-null-tealDark text-white p-2 rounded mb-2 text-sm font-medium" onClick={login}>Sign In</button>
          <button className="w-full bg-white hover:bg-null-cloud border border-null-line p-2 rounded text-sm" onClick={register}>Create Organization</button>
          <p className="text-xs text-null-muted mt-4">One sign-in opens both administrator workspaces — IT Operations and Security Operations — with no second login to switch between them.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-null-cloud dark:bg-null-obsidian flex">
      <aside className="bg-null-obsidian text-white flex flex-col shrink-0" style={{ width: sidebarCollapsed ? 72 : 248 }}>
        {/* Brand row — the logo lives in a shrinkable flex-1 wrapper so its
            intrinsic 1320px width can never push over (or swallow clicks
            for) the collapse button beside it. */}
        <div className="px-3 py-3 border-b border-white/10 flex items-center gap-2">
          {sidebarCollapsed ? (
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded bg-null-teal text-lg font-bold text-white" title="NULL">N</span>
          ) : (
            <span className="min-w-0 flex-1">
              <img src={NULL_LOGO_SRC} alt="NULL — Control the Complexity" className="pointer-events-none block h-[68px] w-auto max-w-full object-contain object-left" />
            </span>
          )}
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="relative z-10 shrink-0 rounded p-1.5 text-white/70 hover:bg-null-navy2 hover:text-white"
            >
              <Icon name="collapse" size={18} />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <div className="flex justify-center border-b border-white/10 py-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="rounded p-1.5 text-white/70 hover:bg-null-navy2 hover:text-white"
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        )}
        {/* Workspace switcher — same sign-in, no re-login to switch. */}
        <div className="p-3 border-b border-white/10">
          {!sidebarCollapsed && <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: '#8AA0B8' }}>Workspace</p>}
          <div className="flex flex-col gap-1" role="tablist" aria-label="Administrator workspace">
            {WORKSPACES.map((w) => {
              const allowed = authorizedWorkspaces.includes(w.id)
              const active = workspace === w.id
              if (sidebarCollapsed) {
                return (
                  <button
                    key={w.id}
                    role="tab"
                    aria-selected={active}
                    disabled={!allowed}
                    onClick={() => switchWorkspace(w.id)}
                    title={allowed ? `Switch to ${w.label} — no sign-in needed` : `Your role (${sessionUser?.role || '…'}) does not authorize ${w.label}`}
                    className={`mx-auto flex h-9 w-9 items-center justify-center rounded text-sm font-semibold border-l-4 ${active ? 'bg-null-navy2' : 'hover:bg-null-navy2/60'} ${allowed ? '' : 'opacity-40 cursor-not-allowed'}`}
                    style={{ borderLeftColor: active ? '#17C3B2' : 'transparent' }}
                  >
                    {w.label.charAt(0)}
                  </button>
                )
              }
              return (
                <button
                  key={w.id}
                  role="tab"
                  aria-selected={active}
                  disabled={!allowed}
                  onClick={() => switchWorkspace(w.id)}
                  title={allowed ? `Switch to ${w.label} — no sign-in needed` : `Your role (${sessionUser?.role || '…'}) does not authorize ${w.label}`}
                  className={`w-full text-left px-3 py-2 rounded text-sm border-l-4 ${active ? 'bg-null-navy2 font-semibold' : 'hover:bg-null-navy2/60'} ${allowed ? '' : 'opacity-40 cursor-not-allowed'}`}
                  style={{ borderLeftColor: active ? '#17C3B2' : 'transparent' }}
                >
                  <span className="block">{w.label}</span>
                  <span className="block text-xs font-normal" style={{ color: '#8AA0B8' }}>{allowed ? w.tagline : 'Not authorized for your role'}</span>
                </button>
              )
            })}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label={`${workspaceDef.label} navigation`}>
          {sidebarCollapsed ? (
            <>
              {renderNavItem('home', workspaceDef.homeTitle)}
              {navModules.map((m) => renderNavItem(m.id, m.label))}
            </>
          ) : (
            NAV_GROUPS[workspace].map((group) => {
              const groupModules = group.modules
                .map((id) => (id === 'home' ? { id: 'home', label: workspaceDef.homeTitle } : workspaceModules.find((m) => m.id === id)))
                .filter((m): m is { id: string; label: string } => !!m && (navQuery.trim() === '' || m.id === 'home' || navModules.some((nm) => nm.id === m.id)))
              if (groupModules.length === 0) return null
              const open = isGroupOpen(group.label)
              return (
                <div key={group.label} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider hover:text-white"
                    style={{ color: '#8AA0B8' }}
                  >
                    <span>{group.label}</span>
                    <Icon name="chevron-down" size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                  </button>
                  {open && groupModules.map((m) => renderNavItem(m.id, m.label))}
                </div>
              )
            })
          )}
          {navModules.length === 0 && !sidebarCollapsed && (
            <p className="text-xs px-3 py-2" style={{ color: '#8AA0B8' }}>No sections match “{navQuery}”.</p>
          )}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs" style={{ color: '#8AA0B8' }}>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-null-navy2 text-white" title={sessionUser ? `${sessionUser.username} · ${sessionUser.role}` : 'Signed in'}>
                <Icon name="user" size={16} />
              </span>
              <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" className="rounded p-1.5 text-white/80 hover:bg-null-navy2 hover:text-white">
                <Icon name="x-circle" size={18} />
              </button>
            </div>
          ) : (
            <>
              {sessionUser && <p className="mb-2 truncate">{sessionUser.username} · {sessionUser.role}</p>}
              <button className="text-sm text-white/80 hover:text-white" onClick={signOut}>Sign out</button>
            </>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top navigation — white, subtle bottom border, slate icons. */}
        <header className="h-16 bg-white dark:bg-null-navy2 border-b border-null-line dark:border-white/10 px-6 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <Breadcrumbs items={breadcrumbItems} />
          </div>
          <div className="flex-1" />
          <input
            className="null-input !w-56 p-2 text-sm"
            placeholder={`Search ${workspaceDef.shortLabel.toLowerCase()} sections…`}
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            aria-label="Search sections in this workspace"
          />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Ctrl+K)"
            aria-label="Open command palette"
            className="flex items-center gap-1.5 rounded border border-null-line bg-white px-2.5 py-2 text-xs text-null-muted hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-[#8AA0B8]"
          >
            <Icon name="command" size={14} />
            <span>Ctrl+K</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => { setBellOpen((v) => !v); setUserMenuOpen(false) }}
              title="Notifications"
              aria-label={`Notifications, ${attentionItems.length} needing attention`}
              aria-expanded={bellOpen}
              className="relative rounded p-2 text-null-muted hover:bg-null-cloud dark:text-[#8AA0B8] dark:hover:bg-white/10"
            >
              <Icon name="bell" size={20} />
              {attentionItems.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-null-critical px-1 text-[10px] font-bold text-white">
                  {attentionItems.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-11 z-40 w-80 rounded-lg border border-null-line bg-white shadow-lg dark:border-white/10 dark:bg-null-navy2">
                <p className="border-b border-null-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">Notifications</p>
                {attentionItems.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-null-muted dark:text-[#8AA0B8]">No notifications</p>
                ) : (
                  <ul>
                    {attentionItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => pickModule(attentionModuleId)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-null-cloud dark:hover:bg-white/5"
                        >
                          <span className="block font-medium text-null-ink dark:text-white">{displayName(item)}</span>
                          <span className="block text-xs text-null-muted dark:text-[#8AA0B8]">{displayDetail(item)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {/* Org selector — display only. The register flow creates the
              tenant as "Demo Organization" and there is no endpoint
              that returns the tenant name, so no other org can be
              listed here without inventing one. */}
          <span
            className="hidden items-center gap-1.5 rounded border border-null-line px-2.5 py-2 text-xs font-medium text-null-ink md:flex dark:border-white/10 dark:text-white"
            title="Organization — set at registration; no tenant-name endpoint exists yet"
          >
            <Icon name="users" size={14} />
            Demo Organization
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => { setUserMenuOpen((v) => !v); setBellOpen(false) }}
              aria-expanded={userMenuOpen}
              aria-label="User menu"
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-null-cloud dark:hover:bg-white/10"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-null-teal text-white">
                <Icon name="user" size={16} />
              </span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block font-medium text-null-ink dark:text-white">{sessionUser?.username || '…'}</span>
                <span className="block text-xs text-null-muted dark:text-[#8AA0B8]">{sessionUser?.role || '…'}</span>
              </span>
              <Icon name="chevron-down" size={14} className="text-null-muted dark:text-[#8AA0B8]" />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-11 z-40 w-56 rounded-lg border border-null-line bg-white shadow-lg dark:border-white/10 dark:bg-null-navy2">
                <div className="border-b border-null-line px-3 py-2 dark:border-white/10">
                  <p className="text-sm font-medium text-null-ink dark:text-white">{sessionUser?.username}</p>
                  <p className="text-xs text-null-muted dark:text-[#8AA0B8]">{sessionUser?.role} · Demo Organization</p>
                </div>
                <button type="button" onClick={signOut} className="w-full px-3 py-2 text-left text-sm text-null-ink hover:bg-null-cloud dark:text-white dark:hover:bg-white/5">
                  Sign out
                </button>
              </div>
            )}
          </div>
          <button
            className="rounded border border-null-line bg-white px-3 py-1.5 text-xs hover:bg-null-cloud dark:border-white/10 dark:bg-transparent dark:text-white"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </header>

        <main className="flex-1 p-6 min-w-0">
          {module === 'home' && workspace === 'operations' ? (
            <ItOpsHome api={API} headers={headers} userRole={sessionUser?.role} onNavigate={(moduleId, subsectionId) => pickModule(moduleId, subsectionId)} />
          ) : module === 'home' ? (
            <SecOpsHome api={API} headers={headers} userRole={sessionUser?.role} onNavigate={(moduleId, subsectionId) => pickModule(moduleId, subsectionId)} />
          ) : module === 'compliance' ? (
            <GrcWorkspace api={API} headers={headers} />
          ) : current ? (
            endpoint === '/api/v1/remediation-configurations/' ? (
              <div>
                <div className="null-card mb-6">
                  <h2 className="text-lg font-semibold mb-1 text-null-ink dark:text-white">{current.label}</h2>
                  <p className="text-sm text-null-muted dark:text-[#8AA0B8] mb-4">{current.description}</p>
                  {current.subsections && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {current.subsections.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSubsection(s.id)}
                          className={`px-3 py-1 rounded-full text-xs border ${(subsection || current.subsections![0].id) === s.id ? 'bg-null-teal text-white border-null-teal' : 'text-null-ink hover:bg-null-cloud dark:text-[#8AA0B8]'}`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* The remediation-configurations subsection renders its
                      own manager (create with script content + send
                      history) instead of the generic module page. */}
                  <RemediationConfigManager api={API} headers={headers} canWrite={canWrite} canDelete={canDelete} />
                </div>
              </div>
            ) : (
              <ModulePage
                moduleId={current.id}
                title={current.label}
                description={current.description}
                subsections={current.subsections || []}
                activeSubsectionId={subsection || (current.subsections ? current.subsections[0].id : '')}
                onSubsectionChange={setSubsection}
                endpoint={endpoint}
                items={items}
                stats={stats}
                presentation={MODULE_PRESENTATION[endpoint] || FALLBACK_PRESENTATION}
                canWrite={canWrite}
                canDelete={canDelete}
                canRunCommands={canRunCommands}
                isScheduler={module === 'scheduler'}
                editingId={editingId}
                newName={newName}
                onNewNameChange={setNewName}
                onCreate={createItem}
                onCancelEdit={cancelEdit}
                onEdit={editItem}
                onDelete={deleteItem}
                onSetStatus={setStatus}
                workflowButtons={workflowButtons}
                onWorkflow={workflowAction}
                onViewDevice={setDetailDevice}
                onSendConfig={setSendVuln}
                onRunSchedulerNow={runSchedulerNow}
                statusOptions={STATUS_OPTIONS}
                deviceStatusOptions={DEVICE_STATUSES}
              />
            )
          ) : null}
        </main>
      </div>

      {/* Endpoint detail drawer — opened from a "View details" action on
          an Endpoints row. Owner/admin only for remote commands + wake;
          the backend enforces the same rule. */}
      <EndpointDetailDrawer
        open={!!detailDevice}
        device={detailDevice}
        api={API}
        headers={headers}
        canRunCommands={!!sessionUser && ['owner', 'admin'].includes(sessionUser.role)}
        userRole={sessionUser?.role}
        onClose={() => setDetailDevice(null)}
      />

      {/* Send a remediation configuration for a vulnerability — opened
          from a "Send config" action on a Vulnerabilities row.
          Owner/admin only; the modal shows the exact script before
          sending and the send history with agent results. */}
      <SendConfigurationModal
        open={!!sendVuln}
        vulnerability={sendVuln}
        api={API}
        headers={headers}
        onSent={() => { toast.success('Configuration queued — the agent runs it on its next poll.'); load() }}
        onClose={() => setSendVuln(null)}
      />

      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={() => setPaletteOpen(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-null-line bg-white shadow-2xl dark:border-white/10 dark:bg-null-navy2"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-2 border-b border-null-line px-4 py-3 dark:border-white/10">
              <Icon name="search" size={18} className="shrink-0 text-null-muted dark:text-[#8AA0B8]" />
              <input
                ref={paletteInputRef}
                className="flex-1 bg-transparent text-sm text-null-ink outline-none dark:text-white"
                placeholder="Search sections and actions…"
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0) }}
                onKeyDown={onPaletteKeyDown}
                aria-label="Search sections and actions"
              />
              <kbd className="rounded border border-null-line px-1.5 py-0.5 text-[11px] text-null-muted dark:border-white/10 dark:text-[#8AA0B8]">ESC</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {paletteFiltered.length === 0 && (
                <li className="px-4 py-3 text-sm text-null-muted dark:text-[#8AA0B8]">No matches.</li>
              )}
              {paletteFiltered.map((entry, i) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setPaletteIndex(i)}
                    onClick={() => entry.run()}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${i === paletteIndex ? 'bg-null-tealSoft dark:bg-white/10' : ''}`}
                  >
                    <span className="font-medium text-null-ink dark:text-white">{entry.label}</span>
                    <span className="text-xs text-null-muted dark:text-[#8AA0B8]">{entry.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <ToastProvider>
      <Console />
    </ToastProvider>
  )
}

export default App
