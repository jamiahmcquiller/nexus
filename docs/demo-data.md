# Demo data (NULL redesign preview)

Platform-wide sample data for the redesigned IT Operations and
Security Operations home screens, modeled on the GRC demo seed
(`app/routers/grc.py`). Implemented in `app/routers/demo.py`.

## Endpoints

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/v1/demo/seed` | owner / admin only |
| POST | `/api/v1/demo/clear-demo` | owner / admin only |

- `POST /api/v1/demo/seed` — seeds the tenant once. Idempotent:
  if demo rows already exist for the tenant it returns
  `{"seeded": false, "reason": "demo data already exists", "counts": {...}}`
  without inserting anything. On success it returns
  `{"seeded": true, "is_demo": true, "label": "Sample data — not live telemetry", "counts": {...}}`.
- `POST /api/v1/demo/clear-demo` — deletes **only** rows with
  `is_demo=True` in the models this seed writes, children first
  (deployments before patches, vulnerabilities/incidents/malware/DLP
  before devices). Returns `{"cleared": true, "deleted": {...}}`.
  It never touches GRC demo rows (GRC has its own clear-demo) and
  never touches a real row.

Both endpoints write an `AuditEvent` (`demo.seeded` / `demo.cleared`).

## Scale (per tenant)

| Model | Rows |
| --- | --- |
| Devices | 60 |
| Servers | 8 |
| Patches | 120 |
| Patch deployments | 30 |
| Vulnerabilities | 40 |
| EDR incidents (`IncidentResponse`) | 12 |
| Malware detections | 20 |
| DLP findings (`SensitiveDataFinding`) | 15 |
| Policies | 10 |
| **Total** | **315** |

- Devices span 5 departments (Finance, Engineering, HR, Operations,
  Security) and 4 device groups (HQ-Desktops, Remote-Laptops,
  Lab-Workstations, Exec-Devices), mixed Windows/macOS/Linux, with
  `enrollment_status` enrolled/suspended and `last_checkin_at` spread
  over the past 7 days. **There is no department or group column on
  `Device`**, so department, device group, OS and the derived health
  label (online/degraded/stale/offline) live in the `attributes` JSON.
  Hostnames look like `WS-FIN-014`, `MB-ENG-022`; demo `device_id`s
  are `demo-<hostname>`.
- Patch deployments have `created_at` spread over the past 30 days so
  trend charts have data.
- Vulnerability `owner`, `due_at` and remediation text live in the
  `attributes` JSON (`Vulnerability` has no owner/deadline columns).

## "Sample data" labeling rule

Every seeded row carries `is_demo=True` (plus `"is_demo": true`
inside `attributes` where the model has one, so the flag survives
serializers like `DeviceOut` that do not expose the column). Any
surface showing these rows **must** label them "Sample data". Never
present sample rows as live telemetry, real endpoints, real patch
state, or real detections.

## Honesty constraints

- **Never present sample rows as live telemetry.** They exist only
  so the redesigned screens can be previewed on an empty tenant.
- **Never claim compliance from framework configuration.** Configuring
  a framework or seeding demo controls is not evidence of compliance.
- **Vulnerabilities use only real, well-known CVE IDs with their
  published CVSS scores** (e.g. CVE-2021-44228 Log4Shell 10.0,
  CVE-2021-34527 PrintNightmare 8.8, CVE-2023-23397 Outlook EoP 9.8).
  No CVE ID or score is invented; severity is derived from the
  published score (≥9.0 critical, 7.0–8.9 high, 4.0–6.9 medium,
  <4.0 low). That is why the set has no low-severity row — the
  famous-CVE set is naturally critical/high.
- **Patch KB numbers and malware family names are illustrative
  sample labels**, not records of real vendor releases or detections.
- **No user login accounts are seeded.**
- **The real enrolled Mac is protected.** Device
  `darwin-ac913e0958751651` is never seeded over, never flagged demo,
  and never deleted: the seed only creates `demo-*` device IDs and
  clear-demo only deletes `is_demo` rows.

## Model-field surprises (for the frontend)

- `Device` has no department/group/status columns: department, group,
  OS and health are in `attributes`; the console status maps to
  `enrollment_status` (enrolled/suspended/decommissioned).
- `IncidentResponse.status` is `pending` / `in-progress` /
  `complete` / `failed` — not `open`/`contained`/`resolved` (those
  are `SecurityAlert` statuses). The seed uses the model values.
- `Policy` is a policy *definition* (name, policy_type, status,
  definition); there is no violation record type in the platform.
  The 10 demo policies carry their sample violation counts/examples
  inside `definition` (`sample_violation_count`,
  `sample_violation_example`).
- `Patch.status` has no `failed` value in its model comment, but the
  column is a free string and the seed uses `failed` for a few rows
  (the patch stats endpoint simply does not count it).
- `Server` has both `health_status` (healthy/degraded/down) and
  `status` (active); the seed sets both.
