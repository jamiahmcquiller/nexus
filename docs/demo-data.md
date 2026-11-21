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
  label (online/attention/offline/degraded — the same four bucket names
  the IT Ops home computes) live in the `attributes` JSON.
  Hostnames look like `WS-FIN-014`, `MB-ENG-022`; demo `device_id`s
  are `demo-<hostname>`.
- Patch deployments have `created_at` spread over the past 30 days so
  trend charts have data.
- Vulnerability `owner`, `due_at` and remediation text live in the
  `attributes` JSON (`Vulnerability` has no owner/deadline columns).

## Reconciliation — what the home screens show from these rows

Pinned by `tests/test_demo_seed.py::test_seed_counts_reconcile_with_home_screens`.
If you change a seed cycle, update the test and this table together.

| Screen / section | Formula (client-side, from the list endpoints) | Seeded value |
| --- | --- | --- |
| IT Ops — endpoint health | enrolled + check-in ≤1h → online; 1–24h → attention; >24h → offline; suspended → degraded | online 30 · attention 12 · offline 12 · degraded 6 = 60 |
| IT Ops — OS distribution | `attributes.os.platform` | Windows 24 · macOS 24 · Linux 12 |
| IT Ops — enrollment activity | `attributes.collected`, weekly buckets | 12 per week × 5 weeks |
| IT Ops — patch compliance | deployed ÷ (deployed + available + testing + approved) | 57 ÷ 102 = **56%**; pending 45 |
| IT Ops — patch statuses | all five model statuses | deployed 57 · approved 18 · available 18 · testing 9 · declined 18 = 120 |
| IT Ops — deployment outcomes | pipeline stage per status | deployed 12 · failed 6 · scheduled 3 · approved 3 · deploying 3 · declined 3 = **30** (all rows shown) |
| IT Ops — servers | `health_status` | healthy 5 · degraded 2 · down 1 = 8 |
| SecOps — vulnerabilities | severity from published CVSS; status | 30 critical / 8 high / 2 medium; open 21 (critical 15 / high 5 / medium 1) · mitigated 7 · remediated 6 · accepted 6 = 40 |
| SecOps — incidents | pending / in-progress = active | active 5 · complete 6 · failed 1 = 12 |
| SecOps — malware | status detected = open; quarantined flag or status | detected 5 · quarantined 10 of 20 (5 quarantined + 5 remediated; 5 false-positive) |
| SecOps — DLP | open / closed (remediated + encrypted) | open 6 · closed 6 · accepted 3 = 15 |
| SecOps — protection coverage | enrolled reporting in last 24h | 42 of 54 enrolled |
| SecOps — risk posture | Elevated if any open critical vuln, active incident, or unquarantined critical detection | **Elevated** (15 open critical + 5 active incidents + 5 unquarantined critical detections) |
| Both — timestamps | stored naive UTC; both homes treat zoneless values as UTC and render local time; `attributes.collected` carries an explicit `Z` | all within the last 90 days (servers exactly 90), none in the future; patch years 2024–2026 only, zero future years |

## What the seed deliberately does NOT back (explained states)

- **Mean time to remediate: "—".** Neither `Vulnerability` (only
  `detected_at`) nor `IncidentResponse` (only `created_at`) has a
  resolution timestamp, so no MTTR can be computed. No new field was
  added — inventing a resolution timestamp would fabricate history.
- **Overdue remediation: omitted.** No security model has a deadline
  field. The seed tucks a `due_at` into vulnerability `attributes`,
  but that is seed-only synthetic data, absent on real rows, so the
  frontend deliberately does not use it.
- **Policy violations: 0.** The SecOps KPI counts non-compliant
  `ComplianceResult` rows, and this seed creates no compliance
  assessments (GRC owns that data). The 10 demo policies are
  definitions; their sample violation counts live in `definition`
  and are not used as a metric.
- **Alert severity: empty state.** The seed creates no
  `SecurityAlert` rows, so the incident section's alert-severity
  donut renders its "No alerts recorded" empty state. Incidents
  carry no severity of their own.
- **EDR / agent protection coverage: not claimed.** There is no
  agent-health or EDR-coverage field in the platform; the coverage
  card measures check-in recency and closure rates only, and says so.

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
- `Patch.status` has no `failed` value — the model comment lists
  available / testing / approved / declined / deployed, and the
  frontend compliance formula only handles those five. The seed
  previously used `failed` for 9 rows, which appeared in no KPI;
  it now uses only the five model statuses (see the reconciliation
  table above).
- `Server` has both `health_status` (healthy/degraded/down) and
  `status` (active); the seed sets both.
