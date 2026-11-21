// NEXUS Service — administrator workspaces.
//
// Two workspaces, one sign-in. The JWT from a single login authorizes
// both; switching only changes which navigation and home dashboard
// the console renders, and never clears the token or asks for a
// password again. Which workspaces a user may open is decided by
// the backend (`GET /api/v1/auth/workspaces`, role-based) — this
// file only describes what each workspace contains.
//
//   IT Operations — running the fleet: endpoints, patching, assets,
//     distribution, experience, remote, imaging, config, MDM,
//     encryption, servers, scheduler.
//   Security Operations — reducing risk: vulnerabilities, EDR,
//     malware, ransomware, browser, app control, DLP, secure
//     access, compliance, policies.

export type WorkspaceId = 'operations' | 'security'

export type HomeStat = {
  label: string
  /** Stats endpoint, e.g. `/api/v1/devices/stats` */
  endpoint: string
  /** Stat keys to prefer, in order; falls back to the first numeric value. */
  preferKeys: string[]
}

export type WorkspaceDef = {
  id: WorkspaceId
  label: string
  shortLabel: string
  tagline: string
  homeTitle: string
  homeDescription: string
  /** Module ids (see MODULES in App.tsx) shown in this workspace's nav, in order. */
  modules: string[]
  /** KPI cards on this workspace's home dashboard. */
  homeStats: HomeStat[]
  /** List endpoint for the "Needs attention" panel on the home dashboard. */
  attentionEndpoint: string
  /** Item statuses that count as needing attention. */
  attentionStatuses: string[]
  attentionTitle: string
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: 'operations',
    label: 'IT Operations',
    shortLabel: 'Operations',
    tagline: 'Run the fleet',
    homeTitle: 'IT Operations',
    homeDescription:
      'Fleet health at a glance — endpoints, patching, deployments, and servers. Security posture lives in the Security Operations workspace.',
    modules: [
      'devices',
      'patches',
      'assets',
      'distribution',
      'dex',
      'remote',
      'imaging',
      'config',
      'mdm',
      'encryption',
      'servers',
      'scheduler',
    ],
    homeStats: [
      { label: 'Endpoints', endpoint: '/api/v1/devices/stats', preferKeys: ['total', 'enrolled', 'online'] },
      { label: 'Patches available', endpoint: '/api/v1/patches/stats', preferKeys: ['available', 'open', 'total'] },
      { label: 'Deployments scheduled', endpoint: '/api/v1/patch-deployments/stats', preferKeys: ['scheduled', 'deploying', 'total'] },
      { label: 'Servers', endpoint: '/api/v1/servers/stats', preferKeys: ['total', 'online'] },
    ],
    attentionEndpoint: '/api/v1/patches/',
    attentionStatuses: ['available', 'testing', 'approved'],
    attentionTitle: 'Patches needing attention',
  },
  {
    id: 'security',
    label: 'Security Operations',
    shortLabel: 'Security',
    tagline: 'Reduce risk',
    homeTitle: 'Security Operations',
    homeDescription:
      'Risk at a glance — open vulnerabilities, active incidents, detections, and data findings. Fleet operations live in the IT Operations workspace.',
    modules: [
      'vulnerabilities',
      'edr',
      'malware',
      'ransomware',
      'browser',
      'appcontrol',
      'dlp',
      'access',
      'compliance',
      'policies',
    ],
    homeStats: [
      { label: 'Open vulnerabilities', endpoint: '/api/v1/vulnerabilities/stats', preferKeys: ['open', 'total'] },
      { label: 'Active incidents', endpoint: '/api/v1/edr/incidents/stats', preferKeys: ['open', 'active', 'total'] },
      { label: 'Malware detections', endpoint: '/api/v1/malware/detections/stats', preferKeys: ['new', 'open', 'total'] },
      { label: 'DLP findings', endpoint: '/api/v1/dlp/findings/stats', preferKeys: ['open', 'new', 'total'] },
    ],
    attentionEndpoint: '/api/v1/vulnerabilities/',
    attentionStatuses: ['open'],
    attentionTitle: 'Vulnerabilities needing attention',
  },
]

export function getWorkspace(id: string | null | undefined): WorkspaceDef {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0]
}

/** Pick one number out of a stats object: first preferred key present, else first numeric value. */
export function pickStatValue(stats: Record<string, unknown>, preferKeys: string[]): number {
  for (const key of preferKeys) {
    const value = stats[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  }
  for (const value of Object.values(stats)) {
    if (typeof value === 'number') return value
  }
  return 0
}
