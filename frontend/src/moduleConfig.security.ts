// Security Operations module-page presentation config.
// Keyed by API endpoint path, consumed by ModulePage.tsx.
// Stat labels only cover keys the section's /stats endpoint actually
// returns: the generic CRUD stats return total plus the seven workflow
// counts (active/open/new/available/deployed/detected/scheduled), so
// only the ones meaningful for each resource's own status values are
// labelled here. Vulnerabilities and alerts have custom /stats
// endpoints with their own keys (see below).
//
// Excluded on purpose: /api/v1/remediation-configurations/ renders its
// own RemediationConfigManager, not the generic module page.

import type { ModulePresentation } from './modulePresentation'

export const SECURITY_PRESENTATION: Record<string, ModulePresentation> = {
  // ---------------------------------------------------------- vulnerabilities
  '/api/v1/vulnerabilities/': {
    columns: [
      { key: 'name', label: 'Vulnerability', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'cvss_score', label: 'CVSS', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'detected_at', label: 'Detected', kind: 'date' },
    ],
    detailFields: ['cve_id', 'cvss_score', 'device_id', 'severity', 'status', 'detected_at'],
    // Custom /stats: total, open, mitigated, remediated, critical.
    statLabels: {
      total: 'Total',
      open: 'Open',
      mitigated: 'Mitigated',
      remediated: 'Remediated',
      critical: 'Critical',
    },
    emptyTitle: 'No vulnerabilities recorded',
    emptyDescription:
      'Vulnerabilities found on enrolled devices will appear here, with their severity and status.',
  },
  '/api/v1/zero-day-mitigations/': {
    columns: [
      { key: 'name', label: 'Mitigation', kind: 'name' },
      { key: 'cve_id', label: 'CVE', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['cve_id', 'mitigation_script', 'status', 'created_at'],
    // Statuses are notified / mitigated / patched, none of which the
    // generic /stats counts, so only the total is labelled.
    statLabels: { total: 'Total mitigations' },
    emptyTitle: 'No zero-day mitigations',
    emptyDescription:
      'Mitigation scripts prepared for vulnerabilities without a vendor fix yet will appear here.',
  },
  '/api/v1/security-configurations/': {
    columns: [
      { key: 'name', label: 'Finding', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'category', label: 'Category', kind: 'text' },
      { key: 'benchmark', label: 'Benchmark', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    detailFields: ['device_id', 'category', 'benchmark', 'severity', 'status', 'created_at'],
    statLabels: { total: 'Total', open: 'Open' },
    emptyTitle: 'No configuration findings',
    emptyDescription:
      'Misconfiguration findings from operating system, application, browser, firewall, and antivirus checks will appear here.',
  },
  '/api/v1/web-server-hardening/': {
    columns: [
      { key: 'name', label: 'Finding', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'host', label: 'Host', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['host', 'finding', 'recommendation', 'severity', 'status', 'created_at'],
    statLabels: { total: 'Total', open: 'Open' },
    emptyTitle: 'No web server findings',
    emptyDescription: 'Hardening findings for web servers will appear here.',
  },
  '/api/v1/high-risk-software/': {
    columns: [
      { key: 'name', label: 'Software', kind: 'name' },
      { key: 'reason', label: 'Reason', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['software_name', 'reason', 'device_id', 'status', 'created_at'],
    statLabels: { total: 'Total', open: 'Open' },
    emptyTitle: 'No high-risk software found',
    emptyDescription:
      'End-of-life, peer-to-peer, or insecure remote-access software found on devices will appear here.',
  },

  // --------------------------------------------------------------------- EDR
  '/api/v1/edr/telemetry/': {
    columns: [
      { key: 'name', label: 'Event', kind: 'name' },
      { key: 'event_type', label: 'Event type', kind: 'text' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    detailFields: ['device_id', 'event_type', 'mitre_tactic', 'mitre_technique', 'severity', 'status', 'created_at'],
    // Status is "recorded", which the generic /stats does not count.
    statLabels: { total: 'Total events' },
    emptyTitle: 'No telemetry recorded',
    emptyDescription: 'Endpoint activity recorded by the agent will appear here.',
  },
  '/api/v1/edr/hunts/': {
    columns: [
      { key: 'name', label: 'Hunt', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'findings_count', label: 'Findings', kind: 'text' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['query', 'lookback_days', 'findings_count', 'status', 'created_at'],
    statLabels: { total: 'Total hunts', scheduled: 'Scheduled' },
    emptyTitle: 'No threat hunts yet',
    emptyDescription:
      'Threat hunts you create will appear here, with their findings count once they run.',
  },
  '/api/v1/edr/incidents/': {
    columns: [
      { key: 'name', label: 'Incident', kind: 'name' },
      { key: 'action', label: 'Action', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'performed_by', label: 'Performed by', kind: 'text' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['device_id', 'alert_id', 'action', 'performed_by', 'status', 'created_at'],
    // Statuses are pending / in-progress / complete / failed, none of
    // which the generic /stats counts.
    statLabels: { total: 'Total incidents' },
    emptyTitle: 'No incidents recorded',
    emptyDescription: 'Incident response actions taken on endpoints will appear here.',
  },
  '/api/v1/alerts/': {
    columns: [
      { key: 'name', label: 'Alert', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'category', label: 'Category', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Raised', kind: 'date' },
    ],
    detailFields: ['category', 'severity', 'device_id', 'status', 'created_at'],
    // Custom /stats: total, new, contained.
    statLabels: { total: 'Total alerts', new: 'New', contained: 'Contained' },
    emptyTitle: 'No alerts',
    emptyDescription: 'Security alerts raised by detection sources will appear here.',
  },

  // -------------------------------------------------- malware & ransomware
  '/api/v1/malware/detections/': {
    columns: [
      { key: 'name', label: 'Detection', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'detection_layer', label: 'Detection layer', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Detected', kind: 'date' },
    ],
    detailFields: ['name', 'detection_layer', 'mitre_ttp', 'severity', 'quarantined', 'status', 'created_at'],
    statLabels: { total: 'Total detections', detected: 'Detected' },
    emptyTitle: 'No malware detections',
    emptyDescription:
      'Malware detections will appear here, with whether each item was quarantined.',
  },
  '/api/v1/ransomware/incidents/': {
    columns: [
      { key: 'name', label: 'Incident', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'behavior_score', label: 'Behaviour score', kind: 'text' },
      { key: 'created_at', label: 'Detected', kind: 'date' },
    ],
    detailFields: ['device_id', 'behavior_score', 'recovery_point_id', 'status', 'created_at'],
    statLabels: { total: 'Total incidents', detected: 'Detected' },
    emptyTitle: 'No ransomware incidents',
    emptyDescription: 'Ransomware behaviour incidents will appear here.',
  },
  '/api/v1/ransomware/recovery-points/': {
    columns: [
      { key: 'name', label: 'Recovery point', kind: 'name' },
      { key: 'snapshot_type', label: 'Snapshot type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['device_id', 'snapshot_type', 'status', 'created_at'],
    statLabels: { total: 'Total recovery points', available: 'Available' },
    emptyTitle: 'No recovery points',
    emptyDescription: 'Recovery points available for restoring a device will appear here.',
  },

  // ------------------------------------------------------------------ browser
  '/api/v1/browser/policies/': {
    columns: [
      { key: 'name', label: 'Policy', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['allowed_browsers', 'kiosk_mode', 'isolation_enabled', 'java_rules', 'router_rules', 'status', 'created_at'],
    statLabels: { total: 'Total policies', active: 'Active' },
    emptyTitle: 'No browser policies yet',
    emptyDescription: 'Browser policies you create will appear here.',
  },
  '/api/v1/browser/extensions/': {
    columns: [
      { key: 'name', label: 'Extension', kind: 'name' },
      { key: 'browser', label: 'Browser', kind: 'text' },
      { key: 'version', label: 'Version', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Seen', kind: 'date' },
    ],
    detailFields: ['name', 'browser', 'version', 'device_id', 'status', 'created_at'],
    // Statuses are monitored / allowed / blocked, none of which the
    // generic /stats counts.
    statLabels: { total: 'Total extensions' },
    emptyTitle: 'No extensions recorded',
    emptyDescription: 'Browser extensions found on enrolled devices will appear here.',
  },

  // ------------------------------------------------------- application control
  '/api/v1/app-control/rules/': {
    columns: [
      { key: 'name', label: 'Rule', kind: 'name' },
      { key: 'rule_type', label: 'Type', kind: 'text' },
      { key: 'target', label: 'Target', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['rule_type', 'target', 'scope', 'status', 'created_at'],
    statLabels: { total: 'Total rules', active: 'Active' },
    emptyTitle: 'No application control rules yet',
    emptyDescription: 'Allowlist and blocklist rules you create will appear here.',
  },
  '/api/v1/app-control/privilege-grants/': {
    columns: [
      { key: 'name', label: 'Grant', kind: 'name' },
      { key: 'privilege_type', label: 'Privilege type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'expires_at', label: 'Expires', kind: 'date' },
    ],
    detailFields: ['app_name', 'privilege_type', 'approved_by', 'device_id', 'expires_at', 'status', 'created_at'],
    statLabels: { total: 'Total grants', active: 'Active' },
    emptyTitle: 'No privilege grants',
    emptyDescription:
      'Privilege grants for applications will appear here, with when each one expires.',
  },

  // --------------------------------------------------------------------- DLP
  '/api/v1/dlp/findings/': {
    columns: [
      { key: 'name', label: 'Finding', kind: 'name' },
      { key: 'data_type', label: 'Data type', kind: 'text' },
      { key: 'classification', label: 'Classification', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Found', kind: 'date' },
    ],
    detailFields: ['location', 'data_type', 'classification', 'device_id', 'status', 'created_at'],
    statLabels: { total: 'Total findings', open: 'Open' },
    emptyTitle: 'No sensitive data findings',
    emptyDescription: 'Sensitive data found on devices and shares will appear here.',
  },
  '/api/v1/dlp/policies/': {
    columns: [
      { key: 'name', label: 'Policy', kind: 'name' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'action', label: 'Action', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['scope', 'action', 'status', 'created_at'],
    statLabels: { total: 'Total policies', active: 'Active' },
    emptyTitle: 'No DLP policies yet',
    emptyDescription: 'Data protection policies you create will appear here.',
  },
  '/api/v1/dlp/incidents/': {
    columns: [
      { key: 'name', label: 'Incident', kind: 'name' },
      { key: 'action_taken', label: 'Action taken', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['finding_id', 'device_id', 'action_taken', 'status', 'created_at'],
    statLabels: { total: 'Total incidents', new: 'New' },
    emptyTitle: 'No DLP incidents',
    emptyDescription: 'Data protection incidents will appear here.',
  },
  '/api/v1/dlp/containers/': {
    columns: [
      { key: 'name', label: 'Container', kind: 'name' },
      { key: 'owner_type', label: 'Owner', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['device_id', 'owner_type', 'encrypted', 'status', 'created_at'],
    statLabels: { total: 'Total containers', active: 'Active' },
    emptyTitle: 'No data containers yet',
    emptyDescription: 'Work data containers on enrolled devices will appear here.',
  },

  // ------------------------------------------------------- secure private access
  '/api/v1/access/segments/': {
    columns: [
      { key: 'name', label: 'Application', kind: 'name' },
      { key: 'dns', label: 'DNS', kind: 'text' },
      { key: 'port', label: 'Port', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['app_name', 'dns', 'port', 'team', 'status', 'created_at'],
    statLabels: { total: 'Total segments', active: 'Active' },
    emptyTitle: 'No application segments yet',
    emptyDescription:
      'Private applications you define for zero-trust access will appear here.',
  },
  '/api/v1/access/policies/': {
    columns: [
      { key: 'name', label: 'Policy', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['segment_id', 'device_trust_required', 'status', 'created_at'],
    statLabels: { total: 'Total policies', active: 'Active' },
    emptyTitle: 'No access policies yet',
    emptyDescription: 'Access policies for your application segments will appear here.',
  },
  '/api/v1/access/audit/': {
    columns: [
      { key: 'name', label: 'Access event', kind: 'name' },
      { key: 'decision', label: 'Decision', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Logged', kind: 'date' },
    ],
    detailFields: ['user_id', 'segment_id', 'device_id', 'decision', 'status', 'created_at'],
    // Status is "logged", which the generic /stats does not count.
    statLabels: { total: 'Total events' },
    emptyTitle: 'No access events logged',
    emptyDescription:
      'Access decisions for private applications will be logged here.',
  },

  // ------------------------------------------------------------------ policies
  '/api/v1/policies/': {
    columns: [
      { key: 'name', label: 'Policy', kind: 'name' },
      { key: 'policy_type', label: 'Type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['policy_type', 'status', 'created_at'],
    statLabels: { total: 'Total policies', active: 'Active' },
    emptyTitle: 'No policies yet',
    emptyDescription: 'Policies you create will appear here.',
  },
}
