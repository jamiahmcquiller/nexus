// IT Operations presentation config for the module-page rollout.
// Keyed by API endpoint path. Field names were verified against the
// backend routers (nexus-backend/app/routers/) and models
// (models.py / models_extended.py) — no invented field names.
// statLabels only lists keys the section's /stats endpoint returns:
//  - generic crud_router /stats returns {total, active, open, new,
//    available, deployed, detected, scheduled} when the model has a
//    status column, so only those keys (plus total) are used below,
//    and only the ones meaningful for that model's status values.
//  - /api/v1/patches/stats returns {total, available, testing,
//    approved, declined, deployed}.
//  - /api/v1/devices/stats returns {total, online, stale}.
//  - /api/v1/scheduler/runs/stats returns {total, complete, partial}.
// Scheduler runs are read-only: no Add box, status is a badge only
// (the shell enforces that); columns + empty state are still provided.

import type { ModulePresentation } from './modulePresentation'

export const OPERATIONS_PRESENTATION: Record<string, ModulePresentation> = {
  // ---------------------------------------------------------- Endpoints
  '/api/v1/devices/': {
    columns: [
      { key: 'name', label: 'Device', kind: 'name' },
      { key: 'detail', label: 'Details', kind: 'detail' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'agent_version', label: 'Agent', kind: 'text' },
      { key: 'last_checkin_at', label: 'Last check-in', kind: 'date' },
    ],
    detailFields: ['hostname', 'device_id', 'os', 'enrollment_status', 'agent_version', 'last_checkin_at', 'created_at'],
    statLabels: { total: 'Total devices', online: 'Online', stale: 'Stale' },
    emptyTitle: 'No endpoints yet',
    emptyDescription: 'No devices have been enrolled yet. Enroll a device with an enrollment token and it will appear here with its inventory and check-in status.',
  },

  // --------------------------------------------------- Patch Management
  '/api/v1/patches/': {
    columns: [
      { key: 'name', label: 'Patch', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'product', label: 'Product', kind: 'text' },
      { key: 'kb_id', label: 'KB', kind: 'text' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['title', 'kb_id', 'product', 'severity', 'status', 'created_at'],
    statLabels: { total: 'Total patches', available: 'Available', testing: 'Testing', approved: 'Approved', declined: 'Declined', deployed: 'Deployed' },
    emptyTitle: 'No patches yet',
    emptyDescription: 'Patches that need review will appear here once they are recorded. Test, approve, or decline a patch to move it through deployment.',
  },
  '/api/v1/patch-deployments/': {
    columns: [
      { key: 'name', label: 'Deployment', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'schedule', label: 'Schedule', kind: 'text' },
      { key: 'test_result', label: 'Test result', kind: 'text' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'scope', 'schedule', 'status', 'reboot_option', 'test_result', 'created_at'],
    statLabels: { total: 'Total deployments', scheduled: 'Scheduled', deployed: 'Deployed' },
    emptyTitle: 'No patch deployments yet',
    emptyDescription: 'No patch deployments have been scheduled yet. Deploy an approved patch to roll it out to devices in scope.',
  },
  '/api/v1/third-party-apps/': {
    columns: [
      { key: 'name', label: 'Application', kind: 'name' },
      { key: 'vendor', label: 'Vendor', kind: 'text' },
      { key: 'version', label: 'Version', kind: 'text' },
      { key: 'platform', label: 'Platform', kind: 'text' },
      { key: 'patch_count', label: 'Patches available', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    detailFields: ['name', 'vendor', 'version', 'platform', 'auto_update', 'patch_count', 'status', 'created_at'],
    statLabels: { total: 'Total apps', available: 'Available' },
    emptyTitle: 'No third-party apps yet',
    emptyDescription: 'Third-party applications in the patch catalogue will appear here, with the vendor, version, and how many patches are available for each.',
  },
  '/api/v1/patch-tests/': {
    columns: [
      { key: 'name', label: 'Test', kind: 'name' },
      { key: 'testbed', label: 'Testbed', kind: 'text' },
      { key: 'result', label: 'Result', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Tested', kind: 'date' },
    ],
    detailFields: ['title', 'testbed', 'result', 'notes', 'status', 'created_at'],
    statLabels: { total: 'Total tests' },
    emptyTitle: 'No test results yet',
    emptyDescription: 'No patches have been tested yet. Test a patch on a testbed first — the result recorded here decides whether it can be approved for deployment.',
  },

  // ---------------------------------------------------- Asset Management
  '/api/v1/assets/': {
    columns: [
      { key: 'name', label: 'Asset', kind: 'name' },
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'asset_type', label: 'Type', kind: 'text' },
      { key: 'os', label: 'OS', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['title', 'asset_tag', 'asset_type', 'manufacturer', 'os', 'status', 'created_at'],
    statLabels: { total: 'Total assets', active: 'Active' },
    emptyTitle: 'No assets yet',
    emptyDescription: 'No hardware, software, or digital assets have been recorded yet. Add an asset to track it here with its tag, type, and operating system.',
  },
  '/api/v1/assets/licenses/': {
    columns: [
      { key: 'name', label: 'License', kind: 'name' },
      { key: 'software_name', label: 'Software', kind: 'text' },
      { key: 'total_seats', label: 'Seats', kind: 'text' },
      { key: 'used_seats', label: 'Used', kind: 'text' },
      { key: 'expiry_date', label: 'Expires', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    detailFields: ['title', 'software_name', 'total_seats', 'used_seats', 'expiry_date', 'status', 'created_at'],
    statLabels: { total: 'Total licenses', active: 'Active' },
    emptyTitle: 'No licenses yet',
    emptyDescription: 'No software licenses have been recorded yet. Add a license to track its seats and expiry date here.',
  },
  '/api/v1/assets/warranties/': {
    columns: [
      { key: 'name', label: 'Warranty', kind: 'name' },
      { key: 'provider', label: 'Provider', kind: 'text' },
      { key: 'expiry_date', label: 'Expires', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['title', 'provider', 'expiry_date', 'status', 'created_at'],
    statLabels: { total: 'Total warranties', active: 'Active' },
    emptyTitle: 'No warranties yet',
    emptyDescription: 'No warranties have been recorded yet. Add a warranty to track its provider and expiry date here.',
  },
  '/api/v1/assets/certificates/': {
    columns: [
      { key: 'name', label: 'Certificate', kind: 'name' },
      { key: 'cert_type', label: 'Type', kind: 'text' },
      { key: 'expiry_date', label: 'Expires', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['title', 'name', 'cert_type', 'expiry_date', 'status', 'created_at'],
    statLabels: { total: 'Total certificates', active: 'Active' },
    emptyTitle: 'No certificates yet',
    emptyDescription: 'No certificates have been recorded yet. Add a certificate to track its type and expiry date here.',
  },
  '/api/v1/assets/geo-fences/': {
    columns: [
      { key: 'name', label: 'Geo-fence', kind: 'name' },
      { key: 'radius_m', label: 'Radius (m)', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'radius_m', 'status', 'created_at'],
    statLabels: { total: 'Total geo-fences', active: 'Active' },
    emptyTitle: 'No geo-fences yet',
    emptyDescription: 'No geo-fences have been defined yet. Add one to mark an area devices should stay within.',
  },
  '/api/v1/assets/usb-events/': {
    columns: [
      { key: 'name', label: 'Event', kind: 'name' },
      { key: 'device_name', label: 'Device', kind: 'text' },
      { key: 'action', label: 'Action', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    detailFields: ['title', 'device_name', 'action', 'status', 'created_at'],
    statLabels: { total: 'Total events' },
    emptyTitle: 'No USB events yet',
    emptyDescription: 'No USB device events have been recorded yet. When a USB device is connected, whether it was allowed or blocked will be logged here.',
  },
  '/api/v1/assets/power-schemes/': {
    columns: [
      { key: 'name', label: 'Power scheme', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'status', 'created_at'],
    statLabels: { total: 'Total schemes', active: 'Active' },
    emptyTitle: 'No power schemes yet',
    emptyDescription: 'No power schemes have been defined yet. Add a scheme to set how devices manage power.',
  },

  // ------------------------------------------ Application Distribution
  '/api/v1/distribution/packages/': {
    columns: [
      { key: 'name', label: 'Package', kind: 'name' },
      { key: 'version', label: 'Version', kind: 'text' },
      { key: 'package_type', label: 'Type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'version', 'package_type', 'template', 'install_switches', 'status', 'created_at'],
    statLabels: { total: 'Total packages', available: 'Available', deployed: 'Deployed' },
    emptyTitle: 'No packages yet',
    emptyDescription: 'No software packages have been added to the repository yet. Add a package to make it available for deployment to devices.',
  },
  '/api/v1/distribution/deployments/': {
    columns: [
      { key: 'name', label: 'Deployment', kind: 'name' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['title', 'scope', 'status', 'created_at'],
    statLabels: { total: 'Total deployments', scheduled: 'Scheduled', deployed: 'Deployed' },
    emptyTitle: 'No app deployments yet',
    emptyDescription: 'No application deployments have been scheduled yet. Deploy a package to roll it out to users or devices in scope.',
  },
  '/api/v1/distribution/metering/': {
    columns: [
      { key: 'name', label: 'Metered app', kind: 'name' },
      { key: 'usage_count', label: 'Uses', kind: 'text' },
      { key: 'duration_minutes', label: 'Minutes used', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    detailFields: ['title', 'usage_count', 'duration_minutes', 'status', 'created_at'],
    statLabels: { total: 'Total records' },
    emptyTitle: 'No metering records yet',
    emptyDescription: 'No software usage has been metered yet. Usage records will appear here as applications are used on devices.',
  },

  // ---------------------------------------------- Employee Experience
  '/api/v1/dex/telemetry/': {
    columns: [
      { key: 'name', label: 'Telemetry', kind: 'name' },
      { key: 'cpu_percent', label: 'CPU %', kind: 'text' },
      { key: 'memory_percent', label: 'Memory %', kind: 'text' },
      { key: 'disk_percent', label: 'Disk %', kind: 'text' },
      { key: 'app_crashes', label: 'App crashes', kind: 'text' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    detailFields: ['title', 'cpu_percent', 'memory_percent', 'disk_percent', 'app_crashes', 'status', 'created_at'],
    statLabels: { total: 'Total records' },
    emptyTitle: 'No telemetry yet',
    emptyDescription: 'No endpoint telemetry has been collected yet. CPU, memory, disk, and app-crash readings from devices will appear here.',
  },
  '/api/v1/dex/insights/': {
    columns: [
      { key: 'name', label: 'Insight', kind: 'name' },
      { key: 'severity', label: 'Severity', kind: 'severity' },
      { key: 'root_cause', label: 'Root cause', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Found', kind: 'date' },
    ],
    detailFields: ['title', 'root_cause', 'severity', 'status', 'created_at'],
    statLabels: { total: 'Total insights', open: 'Open' },
    emptyTitle: 'No insights yet',
    emptyDescription: 'No experience insights have been raised yet. When telemetry points to a problem on a device, the finding and its root cause will appear here.',
  },
  '/api/v1/dex/workflows/': {
    columns: [
      { key: 'name', label: 'Workflow', kind: 'name' },
      { key: 'trigger', label: 'Trigger', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'trigger', 'action_script', 'status', 'created_at'],
    statLabels: { total: 'Total workflows', active: 'Active' },
    emptyTitle: 'No remediation workflows yet',
    emptyDescription: 'No automated remediation workflows have been set up yet. Add a workflow to resolve matching experience issues automatically when its trigger fires.',
  },
  '/api/v1/dex/experience-scores/': {
    columns: [
      { key: 'name', label: 'Score', kind: 'name' },
      { key: 'score', label: 'Score', kind: 'text' },
      { key: 'reliability', label: 'Reliability', kind: 'text' },
      { key: 'performance', label: 'Performance', kind: 'text' },
      { key: 'responsiveness', label: 'Responsiveness', kind: 'text' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    detailFields: ['title', 'score', 'reliability', 'performance', 'responsiveness', 'app_reliability', 'status', 'created_at'],
    statLabels: { total: 'Total scores' },
    emptyTitle: 'No experience scores yet',
    emptyDescription: 'No experience scores have been calculated yet. Scores for reliability, performance, and responsiveness will appear here as telemetry comes in.',
  },

  // ----------------------------------------------------- Remote Access
  '/api/v1/remote/sessions/': {
    columns: [
      { key: 'name', label: 'Session', kind: 'name' },
      { key: 'technician', label: 'Technician', kind: 'text' },
      { key: 'session_type', label: 'Type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'started_at', label: 'Started', kind: 'date' },
    ],
    detailFields: ['title', 'technician', 'session_type', 'recorded', 'status', 'started_at', 'ended_at', 'created_at'],
    statLabels: { total: 'Total sessions', active: 'Active' },
    emptyTitle: 'No remote sessions yet',
    emptyDescription: 'No remote sessions have been held yet. Sessions with a device — who helped, how, and when — will be listed here.',
  },
  '/api/v1/remote/announcements/': {
    columns: [
      { key: 'name', label: 'Announcement', kind: 'name' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'priority', label: 'Priority', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['title', 'message', 'scope', 'priority', 'status', 'created_at'],
    statLabels: { total: 'Total announcements' },
    emptyTitle: 'No announcements yet',
    emptyDescription: 'No announcements have been sent yet. Add one to show a message on devices in scope.',
  },
  '/api/v1/remote/system-tools/': {
    columns: [
      { key: 'name', label: 'Tool job', kind: 'name' },
      { key: 'tool', label: 'Tool', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['title', 'tool', 'status', 'created_at'],
    statLabels: { total: 'Total jobs', scheduled: 'Scheduled' },
    emptyTitle: 'No system tool jobs yet',
    emptyDescription: 'No system tool jobs have been queued yet. Queue a tool — such as disk cleanup — for a device and its progress will show here.',
  },

  // --------------------------------------------------------- OS Imaging
  '/api/v1/imaging/images/': {
    columns: [
      { key: 'name', label: 'Image', kind: 'name' },
      { key: 'os_version', label: 'OS version', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'os_version', 'hardware_independent', 'status', 'created_at'],
    statLabels: { total: 'Total images' },
    emptyTitle: 'No OS images yet',
    emptyDescription: 'No operating system images have been added yet. Add an image to use it as the base for deploying devices.',
  },
  '/api/v1/imaging/deployments/': {
    columns: [
      { key: 'name', label: 'Deployment', kind: 'name' },
      { key: 'scope', label: 'Scope', kind: 'text' },
      { key: 'method', label: 'Method', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['title', 'scope', 'method', 'status', 'created_at'],
    statLabels: { total: 'Total deployments', scheduled: 'Scheduled', deployed: 'Deployed' },
    emptyTitle: 'No imaging deployments yet',
    emptyDescription: 'No imaging deployments have been scheduled yet. Deploy an OS image to set up devices from a template.',
  },
  '/api/v1/imaging/templates/': {
    columns: [
      { key: 'name', label: 'Template', kind: 'name' },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'role', 'status', 'created_at'],
    statLabels: { total: 'Total templates', active: 'Active' },
    emptyTitle: 'No deployment templates yet',
    emptyDescription: 'No deployment templates have been created yet. Add a template to define how an image is deployed for a role or department.',
  },

  // ------------------------------------------------------ Configuration
  '/api/v1/config/profiles/': {
    columns: [
      { key: 'name', label: 'Profile', kind: 'name' },
      { key: 'target', label: 'Applies to', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'target', 'status', 'created_at'],
    statLabels: { total: 'Total profiles' },
    emptyTitle: 'No configuration profiles yet',
    emptyDescription: 'No configuration profiles have been created yet. Add a profile to apply settings to users or computers.',
  },
  '/api/v1/config/scripts/': {
    columns: [
      { key: 'name', label: 'Script', kind: 'name' },
      { key: 'language', label: 'Language', kind: 'text' },
      { key: 'category', label: 'Category', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'language', 'category', 'content', 'status', 'created_at'],
    statLabels: { total: 'Total scripts', active: 'Active' },
    emptyTitle: 'No scripts yet',
    emptyDescription: 'No scripts have been added to the repository yet. Add a script to keep it ready for reuse on devices.',
  },
  '/api/v1/config/kiosk/': {
    columns: [
      { key: 'name', label: 'Kiosk profile', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'status', 'created_at'],
    statLabels: { total: 'Total profiles', active: 'Active' },
    emptyTitle: 'No kiosk profiles yet',
    emptyDescription: 'No kiosk profiles have been created yet. Add one to lock a device down to its allowed apps.',
  },

  // --------------------------------------------------- Mobile Devices
  '/api/v1/mdm/devices/': {
    columns: [
      { key: 'name', label: 'Device', kind: 'name' },
      { key: 'platform', label: 'Platform', kind: 'text' },
      { key: 'ownership', label: 'Ownership', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['title', 'hostname', 'device_id', 'platform', 'ownership', 'enrollment_status', 'compliant', 'status', 'created_at'],
    statLabels: { total: 'Total devices' },
    emptyTitle: 'No mobile devices yet',
    emptyDescription: 'No mobile devices have been enrolled yet. Enroll a phone or tablet and it will appear here with its platform and ownership.',
  },
  '/api/v1/mdm/profiles/': {
    columns: [
      { key: 'name', label: 'Profile', kind: 'name' },
      { key: 'platform', label: 'Platform', kind: 'text' },
      { key: 'profile_type', label: 'Type', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'platform', 'profile_type', 'status', 'created_at'],
    statLabels: { total: 'Total profiles', active: 'Active' },
    emptyTitle: 'No mobile profiles yet',
    emptyDescription: 'No mobile profiles have been created yet. Add a profile to push settings — such as Wi-Fi, VPN, or passcode rules — to enrolled devices.',
  },
  '/api/v1/mdm/apps/': {
    columns: [
      { key: 'name', label: 'App', kind: 'name' },
      { key: 'platform', label: 'Platform', kind: 'text' },
      { key: 'version', label: 'Version', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'platform', 'version', 'status', 'created_at'],
    statLabels: { total: 'Total apps', available: 'Available', deployed: 'Deployed' },
    emptyTitle: 'No mobile apps yet',
    emptyDescription: 'No mobile apps have been added yet. Add an app to make it available for enrolled devices.',
  },

  // --------------------------------------------------- Disk Encryption
  '/api/v1/encryption/policies/': {
    columns: [
      { key: 'name', label: 'Policy', kind: 'name' },
      { key: 'platform', label: 'Platform', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Created', kind: 'date' },
    ],
    detailFields: ['name', 'title', 'platform', 'tpm_required', 'status', 'created_at'],
    statLabels: { total: 'Total policies', active: 'Active' },
    emptyTitle: 'No encryption policies yet',
    emptyDescription: 'No disk encryption policies have been created yet. Add a policy to set encryption requirements for devices.',
  },
  '/api/v1/encryption/recovery-keys/': {
    columns: [
      { key: 'name', label: 'Recovery key', kind: 'name' },
      { key: 'key_type', label: 'Key type', kind: 'text' },
      { key: 'escrow_location', label: 'Escrow', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Stored', kind: 'date' },
    ],
    detailFields: ['title', 'key_type', 'key_reference', 'escrow_location', 'status', 'created_at'],
    statLabels: { total: 'Total keys' },
    emptyTitle: 'No recovery keys yet',
    emptyDescription: 'No recovery keys have been escrowed yet. Escrowed keys are listed here by reference only — the key itself is never shown or stored here.',
  },

  // -------------------------------------------------- Server Management
  '/api/v1/servers/': {
    columns: [
      { key: 'name', label: 'Server', kind: 'name' },
      { key: 'os', label: 'OS', kind: 'text' },
      { key: 'role', label: 'Role', kind: 'text' },
      { key: 'health_status', label: 'Health', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Added', kind: 'date' },
    ],
    detailFields: ['hostname', 'title', 'os', 'role', 'health_status', 'status', 'created_at'],
    statLabels: { total: 'Total servers', active: 'Active' },
    emptyTitle: 'No servers yet',
    emptyDescription: 'No servers have been added yet. Add a server to track its operating system, role, and health here.',
  },
  '/api/v1/servers/patch-windows/': {
    columns: [
      { key: 'name', label: 'Patch window', kind: 'name' },
      { key: 'owner', label: 'Owner', kind: 'text' },
      { key: 'window_start', label: 'Window starts', kind: 'date' },
      { key: 'window_end', label: 'Window ends', kind: 'date' },
      { key: 'approval_status', label: 'Approval', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    detailFields: ['title', 'owner', 'window_start', 'window_end', 'approval_status', 'status', 'created_at'],
    statLabels: { total: 'Total windows', scheduled: 'Scheduled' },
    emptyTitle: 'No patch windows yet',
    emptyDescription: 'No server patch windows have been requested yet. A window lets an application owner choose when their server is patched.',
  },
  '/api/v1/servers/health-checks/': {
    columns: [
      { key: 'name', label: 'Health check', kind: 'name' },
      { key: 'metric', label: 'Metric', kind: 'text' },
      { key: 'value', label: 'Value', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Checked', kind: 'date' },
    ],
    detailFields: ['title', 'metric', 'value', 'status', 'created_at'],
    statLabels: { total: 'Total checks' },
    emptyTitle: 'No health checks yet',
    emptyDescription: 'No server health checks have been recorded yet. Checks for CPU, memory, disk, services, and logs will appear here.',
  },

  // ---------------------------------------------------------- Scheduler
  // Read-only: no Add box, status is a badge only.
  '/api/v1/scheduler/runs/': {
    columns: [
      { key: 'name', label: 'Run', kind: 'name' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'created_at', label: 'Run started', kind: 'date' },
    ],
    detailFields: ['title', 'status', 'created_at'],
    statLabels: { total: 'Total runs', complete: 'Complete', partial: 'Partial' },
    emptyTitle: 'No scheduler runs yet',
    emptyDescription: 'The background worker has not recorded a run yet. Runs for patch deployments, threat hunts, remediation workflows, and expiry housekeeping will appear here.',
  },
}
