# NEXUS Platform Audit — Phase 1 Implementation Inventory

- **Scope:** entire application — frontend console, backend API, scheduler/worker, Go agent, infrastructure, docs.
- **Branch audited:** `feature/endpoint-central-platform` (working tree at `~/workspace/nexus`; local git HEAD in the clone is stale at `f29bd56` — snapshot pushes do not update local git history, so `git log` in the clone does **not** reflect pushed work; remote head per brief is `bfa3641`, v0.5.0).
- **Version:** 0.5.0 (`nexus-backend/app/main.py`, FastAPI version + `/api/v1/status`).
- **Method:** static inspection of the real code (every router, model, and frontend component read, not inferred from file names), programmatic cross-check of every frontend axios call and module endpoint against backend routes, and a full pytest run.
- **Verification run:** `pytest tests/` in `/tmp/nexus-venv` — **34 passed, 248 warnings** (20 GRC + 7 scheduler + 7 workspaces). Warnings are mostly `datetime.utcnow()` deprecation warnings.
- **Not verified in this audit (constraints):** no live stack run (no Docker, no `npm install`), no browser run, no `tsc` type-check, no live end-to-end click-through. Findings below are from code inspection plus the test run. Anything marked Functional means the code path exists end to end (UI call → real route → tenant-scoped query); it does not mean it was clicked live.
- **Note on the working tree:** the tree contains uncommitted work from other tasks. This audit covers the tree as found; nothing was modified except this file.

## How to read the classifications

Strict definitions, applied per feature (not per page):

- **(1) Functional** — the full path works: UI calls a real backend route, the route does the operation tenant-scoped, and the UI reflects the result. A status-only record transition counts only if that is what the feature honestly is.
- **(2) Partially functional** — the core path works but a material part is missing, record-only where execution is implied, or the feature works only for a subset of its cases.
- **(3) Visual placeholder** — code/UI exists that presents a capability which does nothing (renders, logs, or runs a service nobody calls).
- **(4) Not implemented** — no code for it at all (no model, route, or UI).
- **(5) Broken** — the UI offers an action whose backend route does not exist, or the code path fails / contradicts its own contract (e.g. a security check that checks nothing).

## Summary counts

| Classification | Count |
|---|---|
| (1) Functional | 69 |
| (2) Partially functional | 43 |
| (3) Visual placeholder | 2 |
| (4) Not implemented | 52 |
| (5) Broken | 7 |
| **Total inventoried features** | **173** |

Subtotals per area (must sum to the table above):

| Area | Functional | Partial | Placeholder | Not impl. | Broken | Rows |
|---|---|---|---|---|---|---|
| Endpoint Management | 13 | 9 | 1 | 6 | 1 | 30 |
| Security | 13 | 5 | 0 | 2 | 2 | 22 |
| ITSM | 0 | 0 | 0 | 10 | 0 | 10 |
| GRC | 14 | 4 | 0 | 0 | 0 | 18 |
| Reports & Analytics | 1 | 3 | 0 | 9 | 0 | 13 |
| Automation | 9 | 3 | 0 | 3 | 0 | 15 |
| Users, Roles & Org | 2 | 3 | 0 | 8 | 0 | 13 |
| Design System / Shell | 7 | 6 | 0 | 6 | 0 | 19 |
| Security & Auth | 3 | 6 | 0 | 4 | 3 | 16 |
| Architecture / Performance | 7 | 4 | 1 | 4 | 1 | 17 |
| **Total** | **69** | **43** | **2** | **52** | **7** | **173** |

Headline: the record layer is broad and real (67 CRUD resources, ~460 routes, 80 tables, all module endpoints resolve), but the platform is **record management, not endpoint enforcement** — nothing in the codebase actually acts on a device. The biggest missing pieces are ITSM (entirely absent), exports/charts, user administration, server-side search/pagination, and role enforcement on mutations.

---

## 1. Endpoint Management (30 rows)

| Feature | Class | Evidence |
|---|---|---|
| Device inventory list | (1) Functional | `routers/devices.py` `GET /api/v1/devices/` tenant-scoped; App.tsx Endpoints table renders it |
| Device stats (total / online / stale) | (1) Functional | `routers/devices.py` `GET /stats`; online = check-in within 1h |
| Device enrollment | (2) Partial | `POST /api/v1/devices/enroll` works, but token check is prefix-only (see §9) |
| Device heartbeat | (2) Partial | `POST /api/v1/devices/heartbeat` works, but unauthenticated, device_id only (see §9) |
| Device create / edit / delete from console | (5) Broken | No `POST /`, `PATCH /{id}`, `DELETE` on `/api/v1/devices/`; generic Add button posts there → 405, status select → 404 |
| Device groups (static / dynamic) | (4) Not implemented | `Group` / `DeviceGroup` models exist (`models.py`), zero routes and zero UI references |
| Device discovery | (4) Not implemented | No discovery code, model, route, or UI anywhere |
| Device detail page (hardware, OS, software, ownership) | (4) Not implemented | Generic table only (`App.tsx` Name/Detail/Status/Actions); no detail view for any module |
| Device activity / audit history | (4) Not implemented | No device-history endpoint or UI; `AuditEvent` has no read API outside GRC |
| Bulk selection / bulk operations | (4) Not implemented | No selection state or bulk endpoint in App.tsx or backend |
| Export (devices or any list) | (4) Not implemented | Zero export/CSV code in frontend or backend |
| Patch catalog list | (1) Functional | `routers/patches.py` `GET /api/v1/patches/` + stats |
| Patch test / approve / decline | (1) Functional | `routers/patching.py` `POST /patches/{id}/test|approve|decline`; test creates a `PatchTest` record |
| Patch deploy action | (2) Partial | `POST /patches/{id}/deploy` sets patch `deployed` + creates a `PatchDeployment` unconditionally — **does not check test result or approval**; only the scheduler enforces the test gate |
| Patch deployments list | (1) Functional | CRUD `POST/GET /api/v1/patch-deployments/` (`routers/patching.py`) |
| Third-party apps (1100+ catalog claim in copy) | (1) Functional | CRUD `/api/v1/third-party-apps/`; catalog is manual records, no vendor feed (see §9) |
| Patch tests | (1) Functional | CRUD `/api/v1/patch-tests/`; records created by the test action |
| Deployment schedules / windows | (2) Partial | `schedule` is a free-text/ISO string; scheduler advances due records; no calendar UI, no rollback plan |
| Patch compliance reporting | (2) Partial | Stats counts only (`/stats`); no compliance report file or view |
| Vulnerability list + stats | (1) Functional | `routers/vulnerabilities.py` `GET /` + `/stats` |
| Vulnerability mitigate / remediate | (1) Functional | `routers/vulnops.py` `POST /vulnerabilities/{id}/mitigate|remediate` (status transitions) |
| Zero-day mitigations | (1) Functional | CRUD `/api/v1/zero-day-mitigations/` |
| Security configurations (CIS) | (1) Functional | CRUD `/api/v1/security-configurations/` |
| Web server hardening | (1) Functional | CRUD `/api/v1/web-server-hardening/` |
| High-risk software | (1) Functional | CRUD `/api/v1/high-risk-software/` |
| CVE identification / CVSS / prioritization | (2) Partial | `Vulnerability` model exists; no CVE feed, no CVSS computation, no scoring code anywhere; prioritization is manual status/severity fields |
| Software inventory / catalog | (2) Partial | Distribution packages CRUD is a usable catalog; per-device installed software exists only as the `DeviceInventorySnapshot` model — no API or UI |
| Software deployment execution | (2) Partial | `AppDeployment` records advance scheduled → deploying → deployed via scheduler; no agent executes the install |
| Agent management (enrollment, versions, check-in, health) | (3) Visual placeholder | `agent/main.go` (27 lines) prints a banner and a "Heartbeat placeholder" log every 5 min; no HTTP, no enrollment, no inventory; agent README claims capabilities the code does not have |
| Agent health (online / stale) | (2) Partial | Derived from `Device.last_checkin_at` only; there is no agent to report health |

Subtotal: Functional 13, Partial 9, Placeholder 1, Not implemented 6, Broken 1.

---

## 2. Security (22 rows)

| Feature | Class | Evidence |
|---|---|---|
| EDR telemetry CRUD | (1) Functional | CRUD `/api/v1/edr/telemetry/` (`routers/edr.py`) |
| Threat hunts | (2) Partial | CRUD + `POST /hunts/{id}/run` (sets `running` only); scheduler completes hunts with a telemetry-row count as "findings" — no hunt analytics executes |
| EDR incident contain | (1) Functional | `POST /edr/incidents/{id}/contain` sets action + status, links the `SecurityAlert` to `contained` |
| Security alerts list + stats | (1) Functional | `routers/alerts.py` `GET /` + `/stats` |
| Security alerts Add / status change | (5) Broken | Alerts router is GET-only; generic Add → 405, status select → 404 |
| Malware detections + quarantine | (1) Functional | CRUD `/api/v1/malware/detections/` + `POST .../quarantine` (status transition) |
| Ransomware incidents + recovery points CRUD | (1) Functional | CRUD `/api/v1/ransomware/incidents/`, `/recovery-points/` (`routers/malware.py`) |
| Ransomware single-click recovery | (2) Partial | `POST /ransomware/incidents/{id}/recover` exists, but it is a record transition; no endpoint-side restore executes (agent is a stub) |
| Browser policies / extensions CRUD | (1) Functional | CRUD `/api/v1/browser/policies/`, `/extensions/` |
| App control rules CRUD | (1) Functional | CRUD `/api/v1/app-control/rules/` |
| Privilege grants + revoke + expiry | (1) Functional | CRUD + `POST .../revoke`; scheduler expires grants past `expires_at` |
| DLP findings / policies / incidents / containers CRUD | (1) Functional | CRUD on all four `/api/v1/dlp/*` resources |
| DLP container wipe | (2) Partial | `POST /dlp/containers/{id}/wipe` exists; wipe is a record status change, no device enforcement |
| Secure Private Access segments / policies / audit CRUD | (1) Functional | CRUD `/api/v1/access/segments|policies|audit/` |
| Disk encryption policies CRUD | (1) Functional | CRUD `/api/v1/encryption/policies/` |
| Recovery keys (escrow references) | (2) Partial | CRUD `/api/v1/encryption/recovery-keys/`; stores escrow references only by design (good), but no escrow verification, rotation, or retrieval flow |
| MDM devices / profiles / apps CRUD | (1) Functional | CRUD `/api/v1/mdm/devices|profiles|apps/` |
| MDM lock / wipe actions | (2) Partial | `POST /mdm/devices/{id}/lock|wipe` exist; lock/wipe are record status changes, no device enforcement |
| Policies module list | (1) Functional | `routers/policies.py` `GET /api/v1/policies/` tenant-scoped |
| Policies module Add / status change | (5) Broken | Policies router is GET-only; generic Add → 405, status select → 404 |
| Generic security incidents (non-EDR) | (4) Not implemented | No incident model outside EDR; ITSM incidents do not exist (see §3) |
| Threat intelligence | (4) Not implemented | No feed, model, route, or UI; the string "threat intel" appears nowhere in code |

Subtotal: Functional 13, Partial 5, Not implemented 2, Broken 2.

---
## 3. IT Service Management (10 rows)

No ITSM code exists anywhere: no model, router, endpoint, or UI. EDR `IncidentResponse` records are security incidents, not service-desk incidents, and must not be presented as ITSM.

| Feature | Class | Evidence |
|---|---|---|
| Incidents (create, assign, prioritize, notes, escalation, resolve/close) | (4) Not implemented | No model/route/UI; closest match is EDR incidents (`routers/edr.py`), a different domain |
| Service requests / service catalog | (4) Not implemented | Nothing in code |
| Change management (requests, approvals, windows, backout, calendar) | (4) Not implemented | Nothing in code; server patch windows (`ServerPatchWindow`) are patch scheduling, not change control |
| Problem management (root cause, known errors) | (4) Not implemented | Nothing in code |
| Knowledge base / self-service | (4) Not implemented | Nothing in code |
| Service desk dashboard (open/unassigned/SLA/workload) | (4) Not implemented | Nothing in code |
| SLA management | (4) Not implemented | Nothing in code |
| Technicians / groups / roles administration | (4) Not implemented | No user-admin API or UI; roles exist only as a string on `User` |
| Employee self-service portal | (4) Not implemented | Nothing in code |
| ITSM automation (assignment, escalation) | (4) Not implemented | Nothing in code |

Subtotal: Not implemented 10.

---

## 4. Governance, Risk & Compliance (18 rows)

Verified wired in: `App.tsx` module `compliance` (label "Governance, Risk & Compliance", Security workspace) renders `GrcWorkspace` (`frontend/src/GrcWorkspace.tsx`, 938 lines) with all 12 categories; backend `routers/grc.py` (10 CRUD resources + overview + history + 12 workflows + seed/clear-demo); 20 pytest tests pass.

| Feature | Class | Evidence |
|---|---|---|
| GRC overview (KPIs, framework table, activity, quick actions) | (1) Functional | `GET /api/v1/grc/overview` + `Overview` in GrcWorkspace.tsx; KPIs are live counts; framework table has search, status filter, sort by name/compliance % |
| Frameworks & Standards | (1) Functional | CRUD `/api/v1/grc/frameworks/`; add form (name, standard, version, owner); activate/retire workflows; detail + history |
| Control Library | (1) Functional | CRUD `/api/v1/grc/controls/`; framework-linked add form; search/filter/sort/pagination (10/page) |
| Assessments + start/complete | (1) Functional | CRUD `/api/v1/grc/assessments/` + `POST .../start|complete` |
| Evidence Management + approve/reject | (1) Functional | CRUD `/api/v1/grc/evidence/` + `POST .../approve|reject`; stores file reference/name only, never file content |
| Findings & Exceptions + remediate/accept | (1) Functional | CRUD `/api/v1/grc/findings/` + `POST .../remediate|accept`; exception flag lives in record attributes |
| Risk Register + score + accept/mitigate | (1) Functional | CRUD `/api/v1/grc/risks/`; score shown as likelihood × impact (1–25), computed client-side |
| Remediation Plans + complete | (1) Functional | CRUD `/api/v1/grc/remediations/` + `POST .../complete`; due-date tracking; scheduler counts overdue |
| Compliance Reports | (2) Partial | Reports CRUD + status change work (`ReportsPage`); templates are a read-only list (no add/edit UI); no report file is ever generated |
| Audit Schedule + complete | (1) Functional | CRUD `/api/v1/grc/audits/` + `POST .../complete` |
| Control Mapping | (1) Functional | CRUD `/api/v1/grc/mappings/`; mapped/gap/unmapped statuses |
| Compliance Settings | (2) Partial | CRUD `/api/v1/grc/settings/` works, but no setting is read by any code — settings change no behavior |
| Per-record history | (1) Functional | `GET /api/v1/grc/{resource}/{id}/history` (AuditEvent, newest first, limit 50); create/status/workflow writes are tested |
| Demo seed / clear | (1) Functional | `POST /api/v1/grc/seed-demo` (idempotent, owner/admin only) and `clear-demo` (deletes only `is_demo` rows); tested |
| Demo vs organization data distinction | (1) Functional | `is_demo` Boolean on all 10 GRC tables; Demo pill on every row/detail; banner on overview; "Organization" label on org rows |
| Framework standards coverage | (2) Partial | Standard select lists CIS v8, NIST CSF 2.0, ISO 27001, SOC 2, HIPAA, GDPR, PCI DSS, Cyber Essentials; seed data ships only CIS v8 / NIST CSF 2.0 / ISO 27001; no built-in control sets for HIPAA, CJIS, PCI DSS, or NIST SP 800-53 |
| No false compliance claims in UI | (1) Functional | Overview shows "% implemented" (controls implemented / total), not "% compliant"; no code claims an org is compliant from a passing check |
| Legacy compliance results detail page | (2) Partial | `GET /api/v1/compliance/` still works and overview shows legacy benchmark counts, but the old "Compliance results" subsection was removed — there is no page listing individual benchmark results |

Subtotal: Functional 14, Partial 4.

---

## 5. Reports & Analytics (13 rows)

| Feature | Class | Evidence |
|---|---|---|
| Report catalogue CRUD | (1) Functional | CRUD `/api/v1/reports/` (`routers/reporting.py`); GRC Reports page add form + status change work |
| Report templates CRUD (backend) | (2) Partial | CRUD `/api/v1/reports/templates/` exists, but the only UI is a read-only list in GRC Reports — no add/edit UI |
| Report generation (actual file output) | (4) Not implemented | `Report.status` is only a string (`draft`/`ready`/`generated`); no generator, no file, no download |
| CSV / Excel / PDF export | (4) Not implemented | Zero export code in frontend or backend (grep: no csv/pdf/export) |
| Print | (4) Not implemented | No print view or handler |
| Scheduled reports | (4) Not implemented | No model, route, or UI |
| Report history | (4) Not implemented | No model; `SchedulerRun` is scheduler history, not report history |
| Charts / visualizations | (4) Not implemented | No chart library in `frontend/package.json`; only text KPIs and one CSS compliance bar (GRC overview) |
| Custom report builder | (4) Not implemented | Nothing in code |
| Saved reports | (2) Partial | `Report` records persist and are listable, but there is no builder, no saved filters, and no way to re-run a report |
| Date-range filters | (4) Not implemented | No date filtering in any list (backend lists are `ORDER BY created_at DESC LIMIT 500`) |
| Drill-down | (2) Partial | GRC detail panels + history drill down; generic module tables have no detail view at all |
| Role-based report access | (4) Not implemented | Any authenticated user can list reports; no per-report permissions |

Subtotal: Functional 1, Partial 3, Not implemented 9.

---
## 6. Automation (15 rows)

| Feature | Class | Evidence |
|---|---|---|
| Scheduler run-once (manual tick) | (1) Functional | `POST /api/v1/scheduler/run-once`, owner/admin only (`require_role`); console "Run now" button calls it |
| Scheduler status / jobs / runs APIs | (1) Functional | `GET /api/v1/scheduler/status|jobs|runs|runs/stats` (`routers/scheduler.py`) |
| Scheduler worker (loop / --once / interval) | (1) Functional | `app/worker.py` (stdlib only, 60s default, min 5s); compose `worker` service |
| Patch deployment state machine | (1) Functional | `scheduler.py` `_run_patch_deployments`: scheduled → deploying → deployed, one step/tick, test-fail → failed, untested left alone; 7 pytest tests |
| Threat hunt state machine | (1) Functional | `scheduler.py` `_run_threat_hunts`: scheduled → running → complete, findings = telemetry rows in lookback window |
| Remediation workflows (DEX insights) | (1) Functional | `scheduler.py` `_run_remediation_workflows`: active workflow resolves matching open insights, trigger `*`/`all` = all open for tenant |
| App / imaging deployments, system-tool jobs | (1) Functional | `scheduler.py` `_run_simple_deployments`: scheduled → deploying/running → deployed/complete |
| Server patch windows | (1) Functional | `scheduler.py` `_run_server_windows`: scheduled + approved + window open → in-progress → deployed |
| Expiry housekeeping | (1) Functional | `scheduler.py` `_run_expiry`: privilege grants expire; licenses/warranties/certificates expire or become "expiring" within 30 days |
| Scheduler console page | (2) Partial | Generic table over `/api/v1/scheduler/runs/` works for list/stats; Add button → 405 and status select → 404 (no such routes); jobs list is a hardcoded `JOBS` constant — no job configuration UI |
| Workflow builder (triggers / conditions / actions) | (4) Not implemented | `RemediationWorkflow` is a record with a free-text `trigger`; no builder UI or condition/action model |
| Automation templates | (4) Not implemented | Nothing in code |
| Approval gates for automation | (2) Partial | Run-once is owner/admin-gated; workflow transitions and UI Deploy have no approval gate (see §1 patch deploy) |
| Failed workflow handling | (2) Partial | Per-step errors are captured in the run summary and a tick continues; no retry, no alerting, no failed-run UI beyond the runs table |
| Scheduled tasks UI | (4) Not implemented | Schedules are free-text strings (`"now"`, ISO datetime); no cron UI or schedule editor |

Subtotal: Functional 9, Partial 3, Not implemented 3.

---

## 7. Users, Roles & Organization Management (13 rows)

| Feature | Class | Evidence |
|---|---|---|
| Register / login / JWT | (1) Functional | `POST /api/v1/auth/register` (creates tenant + owner), `POST /api/v1/auth/token`, JWT via `app/auth.py`; token stored in `localStorage` |
| Registration validation & org naming | (2) Partial | Works, but: no password length/complexity rule; duplicate username → unhandled 500 "Registration failed"; frontend `register()` hardcodes `tenant_name: 'Demo Organization'` for every new org (`App.tsx`) |
| Roles (owner / admin / technician / auditor) | (2) Partial | Roles stored on `User`; workspace mapping enforced server-side (`routers/auth.py` `WORKSPACE_ACCESS`); but `require_role` is used on only 3 endpoints in the whole API, so most mutations accept any authenticated role |
| Workspace authorization endpoint | (1) Functional | `GET /api/v1/auth/workspaces` returns the role's workspaces; console renders only authorized workspaces and disables the others |
| User management (list / invite / deactivate) | (4) Not implemented | No user-admin API or UI; only `GET /api/v1/auth/me` |
| Departments / locations | (4) Not implemented | No models, routes, or UI |
| Groups / teams administration | (4) Not implemented | `Group` model exists, no API or UI (see §1) |
| MFA | (4) Not implemented | No MFA code (grep: no totp/webauthn/passkey); a GRC demo finding merely mentions MFA as text |
| SSO (SAML / OIDC / OAuth) | (4) Not implemented | No SSO code; `OAuth2PasswordBearer` is only the JWT bearer scheme for the login endpoint |
| Session management | (2) Partial | JWT expires after 24h (`access_token_expire_minutes = 60*24`); no refresh, no revocation, no session list |
| Audit log viewing | (4) Not implemented | `AuditEvent` rows are written (GRC + scheduler) but there is no API or UI to list them, except per-record GRC history |
| Invitation / provisioning | (4) Not implemented | Nothing in code |
| Permission management UI | (4) Not implemented | Permissions exist only as the hardcoded role→workspace map; no per-permission model or UI |

Subtotal: Functional 2, Partial 3, Not implemented 8.

---

## 8. Design System & Application Shell (19 rows)

Design tokens are genuinely centralized (`frontend/src/theme.ts`, `frontend/src/index.css`, `frontend/tailwind.config.js`): Midnight Navy `#142B4A`, Teal `#167C80`, Cloud `#F5F7FA`, Slate `#667085`, Border `#E5EAF0`, Success `#218568`, Warning `#D99536`, Critical `#C64D4D`, Info `#3D6C9A`, Pending `#7959C7`; Inter (+ Manrope display) via Google Fonts import.

| Feature | Class | Evidence |
|---|---|---|
| Brand tokens (single source of truth) | (1) Functional | `theme.ts` `NEXUS_COLORS` + `statusTone`/`statusBadgeClasses`; Tailwind `nexus-*` colors mirror them |
| Light / dark mode | (1) Functional | Class-based dark mode (`darkMode: 'class'`), CSS vars in `.dark`, toggle in header, persisted in `localStorage` |
| Density (compact / comfortable / spacious) | (1) Functional | `data-density` on app root, `--pad-card`/`--pad-row` vars, select in header, persisted |
| Sidebar navigation (2 workspaces) | (1) Functional | `App.tsx` aside: workspace switcher + module nav (22 modules across 2 workspaces) |
| Workspace switching without re-login | (1) Functional | `switchWorkspace()` keeps the JWT; backend `/workspaces` is the source of truth |
| Navigation search (module names) | (1) Functional | Header input filters sidebar sections (`navQuery`); empty state "No sections match" |
| Global search (across records) | (4) Not implemented | Header search filters section names only; no record search outside GRC pages |
| Notification center | (4) Not implemented | No notifications code, model, or UI |
| Organization selector | (4) Not implemented | One tenant per login; no org switching UI (register always creates a new tenant) |
| User profile / account menu | (2) Partial | Sidebar footer shows `username · role` + Sign out; no profile page, no password change, no account settings |
| Breadcrumbs | (4) Not implemented | Header shows only the current module title + workspace label |
| Collapsible sidebar | (4) Not implemented | Fixed `w-64` aside; no collapse control |
| Responsive layout | (2) Partial | Flex layout with `min-w-0` and horizontal table scroll; sidebar never collapses and GRC side nav is a fixed 210px — no mobile layout; small screens squeeze, not reflow |
| Keyboard focus visible | (1) Functional | `:focus-visible` teal outline in `index.css`; `aria-label`s on search, density, theme, status selects; sidebar nav has `aria-label` |
| Charts | (4) Not implemented | See §5 |
| Shared components (buttons / cards / tables / modals / forms) | (2) Partial | `.nexus-card` / `.nexus-input` shared classes exist; but there is no shared table or modal component — the generic table in `App.tsx` and the GRC tables are separate implementations, and hardcoded hex colors remain in `App.tsx` (e.g. `#8AA0B8`, `#C64D4D`) and `GrcWorkspace.tsx` (`#FBF3E4`) |
| Loading / empty / error states | (2) Partial | GRC pages have loading/error/empty text; generic pages show "No records yet" and a notice line; but `App.tsx` `load()` swallows fetch failures (`catch { setItems([]) }`), so a failed load looks identical to an empty list |
| Icons | (2) Partial | No icon set; navigation and actions are text-only |
| Consistent page headers | (2) Partial | Module pages share the card + title + description pattern, but GRC pages use inline styles and their own nav while generic pages use Tailwind classes — two visual dialects in one console (see §10) |

Subtotal: Functional 7, Partial 6, Not implemented 6.

---
## 9. Security & Auth (16 rows)

| Feature | Class | Evidence |
|---|---|---|
| Password hashing (bcrypt) | (1) Functional | `app/auth.py` `CryptContext(schemes=["bcrypt"])`, bcrypt pinned 4.0.1 in `pyproject.toml` |
| JWT auth on API routes | (1) Functional | `get_current_user` dependency on every router except the two device endpoints below |
| Tenant isolation on reads/writes | (1) Functional | `_crud.py` list/stats/get/patch/status all filter `tenant_id == current_user.tenant_id`; `_get_or_404` enforces tenant on every row access; core routers (devices, patches, vulns, alerts, policies, compliance, GRC, scheduler) filter by tenant |
| Enrollment token validation | (5) Broken | `POST /api/v1/devices/enroll` only checks the token starts with `"nexus-"` and parses a UUID from it; the random suffix is never validated against anything stored, and the token is not one-time (`app/scripts/generate_token.py` prints a token with no server-side record) — anyone who knows a tenant UUID can enroll a device into that tenant |
| Heartbeat authentication | (5) Broken | `POST /api/v1/devices/heartbeat` has no auth dependency at all; anyone who knows a `device_id` can mark any device online |
| Role enforcement on mutations | (2) Partial | `require_role` is used on exactly 3 endpoints (scheduler run-once, GRC seed-demo, GRC clear-demo); destructive actions — MDM wipe/lock, ransomware recover, DLP wipe, patch deploy, any CRUD status change — accept any authenticated role, including technician/auditor |
| Input validation | (2) Partial | Pydantic models on auth + device enroll; but all CRUD payloads are raw `dict`s — `_apply_payload` accepts arbitrary keys into `attributes`, and `PATCH` can set `status` to any string; no length/range validation anywhere |
| CORS | (2) Partial | `main.py`: `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]` with `allow_credentials=False`; workable for Codespaces dev, not a production posture |
| Secrets management | (5) Broken | Default `SECRET_KEY = "dev-secret-change-in-production-nexus-2026"` in `app/database.py` (used unless env overrides); Postgres password `"nexus"` hardcoded in `infra/docker-compose.yml`; the same dev secret is also passed as backend env in compose |
| Encryption in transit (TLS) | (4) Not implemented | No TLS configuration in the app; relies entirely on the hosting/proxy layer; compose runs `uvicorn --reload` (dev server) |
| Rate limiting / lockout | (4) Not implemented | No rate limiting, no failed-login lockout, no request throttling anywhere |
| Audit logging coverage | (2) Partial | `AuditEvent` is written by GRC (create/status/workflow), by the scheduler (every transition), and by CRUD create/status only when `audit_prefix` is set (GRC only); workflow actions in patching/edr/malware/mdm/etc. write no audit rows; there is no read API for audit events |
| Agent communication security | (4) Not implemented | Agent is a stub (see §1); no mTLS, no signing, no authenticated agent channel; the enrollment-token scheme is the only mechanism and it is unvalidated (row 4) |
| Backup / recovery | (4) Not implemented | Postgres data volume only; no backup job, schedule, or restore docs |
| Data retention / deletion | (2) Partial | `clear-demo` deletes demo rows; otherwise there is no retention policy and **no DELETE endpoint exists anywhere** — records cannot be deleted at all |
| Token storage / session security | (2) Partial | JWT is stored in `localStorage` (XSS-accessible); no httpOnly-cookie option, no refresh/revocation |

Subtotal: Functional 3, Partial 6, Not implemented 4, Broken 3.

---

## 10. Architecture / Performance (17 rows)

| Feature | Class | Evidence |
|---|---|---|
| FastAPI + SQLAlchemy layering | (1) Functional | Routers / models / scheduler split cleanly; `main.py` includes 24 routers |
| Vite dev proxy (same-origin API) | (1) Functional | `frontend/vite.config.ts` proxies `/api` → backend; fixes the Codespaces login Network Error; production fallback still guesses a `-8000` origin |
| Docker Compose (5 services) | (1) Functional | `infra/docker-compose.yml`: postgres (healthy), redis, backend, frontend, worker |
| Devcontainer | (1) Functional | `.devcontainer/devcontainer.json` (python:3.12, node 20, docker-in-docker, forwards 8000/5173) |
| One-command start (`scripts/start-nexus.sh`) | (2) Partial | Script works when run as `bash ./scripts/start-nexus.sh --docker`, but it is **not executable in git** (mode `100644` in the index; local file is executable only in the working tree) — direct `./scripts/start-nexus.sh` fails with Permission denied in a fresh checkout |
| Database migrations (Alembic) | (4) Not implemented | `alembic` is a declared dependency but there is no migrations directory; schema is created by `Base.metadata.create_all()` on every boot (twice in `main.py`) |
| Redis service | (3) Visual placeholder | `redis:7-alpine` runs in compose; zero references to redis anywhere in backend code |
| Background worker single-instance | (2) Partial | Docs warn to run exactly one replica; there is no leader election or lock — two workers would double AuditEvents (design makes double-advance harmless) |
| Server-side pagination | (4) Not implemented | CRUD list is `ORDER BY created_at DESC LIMIT 500` with no offset; GRC pagination is client-side slicing (10/page) |
| Server-side search / sort | (4) Not implemented | All filtering/sorting is client-side (GRC) or absent (generic pages); no query parameters on any list endpoint |
| Caching | (4) Not implemented | No cache layer; every page load re-fetches every list + stats |
| Frontend build / dependencies | (2) Partial | `npm run build` = `tsc -b && vite build`; but `react-router-dom` and `@tanstack/react-query` are installed and **never imported**; no frontend tests; `tsc` was not run in this audit |
| Automated tests (backend) | (1) Functional | 34 passed (20 GRC, 7 scheduler, 7 workspaces) on in-memory SQLite; tests live in `nexus-backend/tests/` |
| Test coverage gaps | (2) Partial | No tests for CRUD routers, auth, devices, patching workflows, or tenant isolation; no frontend tests; no end-to-end tests |
| API documentation (OpenAPI) | (1) Functional | FastAPI auto-generates `/docs`; not exercised live in this audit |
| Local git hygiene | (5) Broken | The clone's git HEAD is `f29bd56`, while the branch has moved on via snapshot pushes (brand `85b042c`, GRC `bfa3641` per brief); `git log`/`git status` in the clone do not reflect pushed work, and the same file (`frontend/src/App.tsx`) was overwritten on the branch by a stale snapshot push (`ca5b2fc`) before being restored — concurrent snapshot pushes to one branch are unsafe without a head check |
| Monorepo layout (backend / frontend / agent / infra / docs) | (1) Functional | Clean separation; `docs/` covers modules, scheduler, GRC, workspaces/theme, schema, and 2 ADRs |

Subtotal: Functional 7, Partial 4, Placeholder 1, Not implemented 4, Broken 1.

---

## 11. Endpoint cross-check (programmatic)

Method: extracted every `endpoint: '…'` string from `App.tsx` MODULES/subsections (73 endpoints) and every axios call in `App.tsx` + `GrcWorkspace.tsx`, and matched them against backend routes (CRUD prefixes from `crud_router(...)` calls + explicit `@router.*` decorators + GRC loop resources).

- **Module endpoints: 73 / 73 resolve** to a real backend route (CRUD list or explicit route). **Zero missing read endpoints.**
- **Workflow action URLs in App.tsx: 15 / 15 resolve** (patch test/approve/decline/deploy, vuln mitigate/remediate, EDR contain, malware quarantine, ransomware recover, MDM lock/wipe, DLP wipe, remote end, server patch-window approve, privilege-grant revoke).
- **GRC endpoints: all resolve** — 10 CRUD resources, overview, history, seed/clear-demo, 12 workflow transitions, plus the existing `/api/v1/reports/` + `/templates/` used by GRC Reports.
- **Auth/session calls resolve:** `GET /health`, `GET /api/v1/auth/me`, `GET /api/v1/auth/workspaces`, `POST /api/v1/auth/token`, `POST /api/v1/auth/register`, `POST /api/v1/scheduler/run-once`.
- **The mismatch is on writes, not reads.** The generic console renders an Add box and a status dropdown for **every** module, but these routes do not exist, so the buttons fail:
  - `POST /api/v1/devices/`, `POST /api/v1/patches/`, `POST /api/v1/vulnerabilities/`, `POST /api/v1/alerts/`, `POST /api/v1/policies/` → **405** (routers are GET-only).
  - `POST /{id}/status` on devices / patches / vulnerabilities / alerts / policies / scheduler-runs → **404** (no such route).
  - `GET {endpoint}stats` for policies and compliance → **404** (no `/stats` route) — those pages always show "No stats yet".
  - The UI reports these only as a small notice line ("Create failed" / "Status update failed"); nothing in the UI distinguishes a working Add from a dead one.
- **No DELETE route exists anywhere** in the API (grep for `@router.delete`: zero hits). `PATCH /{id}` exists on all 67 CRUD resources but has **no UI** — there is no edit form anywhere except GRC's status/workflow controls.

## 12. Route & model inventory (counts)

- **Frontend:** 22 modules (12 IT Operations, 10 Security Operations) + 2 workspace home dashboards; 64 subsections; GRC adds its own 12-category in-workspace nav. Single-page app: no client-side routing (react-router-dom installed, unused).
- **Backend:** 24 routers in `main.py`; 67 CRUD resources × 6 standard endpoints (list, stats, create, get-by-id, patch, set-status) ≈ 400 routes; ~56 explicit action/utility endpoints (auth, device enroll/heartbeat, workflows, scheduler, GRC overview/history/seed/clear, health/status); **≈ 460 routes total**.
- **Database:** 80 tables — 12 in `models.py` (Tenant, User, Device, DeviceInventorySnapshot, Group, DeviceGroup, Patch, Vulnerability, SecurityAlert, Policy, ComplianceResult, AuditEvent) + 68 in `models_extended.py` (57 platform + 10 GRC + SchedulerRun). Every table carries `tenant_id` except none — all 80 are tenant-scoped by column; enforcement is per-query, not at the ORM level.
- **Dead models (table exists, no API/UI):** `Group`, `DeviceGroup`, `DeviceInventorySnapshot`. `ComplianceResult` has only a list endpoint and no detail page.
- **Tests:** `nexus-backend/tests/` — `test_scheduler.py` (7), `test_grc.py` (20), `test_workspaces.py` (7) = **34 tests, all passing**. No frontend tests, no e2e tests.

---
## 13. Prioritized gap list (input to Phases 2–12, in build order)

1. **Fix the broken Add / status controls on GET-only modules** (devices, patches, vulnerabilities, alerts, policies, scheduler runs) — either add the missing `POST /`, `PATCH /{id}`, `POST /{id}/status` routes or hide the controls where they cannot work. Cheapest high-visibility fix; currently the console promises actions it cannot perform. (Phases 10, 12)
2. **Enforce roles on mutations + fix device auth.** Apply `require_role` to destructive/workflow actions (MDM wipe/lock, ransomware recover, DLP wipe, patch deploy, status changes); validate enrollment tokens server-side (stored one-time tokens, not prefix parsing); authenticate heartbeat. (Phase 11)
3. **Remove hardcoded secrets.** No default `SECRET_KEY` in code; Postgres password and JWT secret from environment only; stop shipping the dev secret in `docker-compose.yml`. (Phase 11)
4. **Add record edit + delete.** `PATCH` exists on all CRUD resources but has no UI; `DELETE` exists nowhere. Add delete endpoints (with confirmation + audit) and an edit form. (Phase 10)
5. **Build ITSM.** Incidents, service requests/catalog, change, problem, knowledge, SLA, technician admin — the largest missing workspace; nothing exists yet. (Phase 5)
6. **Server-side list capabilities.** Search, filter, sort, and pagination query parameters on list endpoints; per-table search/filter/sort in the generic console (today only GRC pages have them, client-side). (Phases 3, 10)
7. **Real reporting.** Report generation that produces a file, CSV export at minimum, then Excel/PDF; charts; scheduled reports. (Phase 7)
8. **User / role / org administration.** User list, invite, deactivate, departments, permission management UI. (Phase 9)
9. **Device groups, discovery, device detail pages, bulk operations.** `Group`/`DeviceGroup` models are dead; discovery does not exist; there is no per-device view. (Phase 3)
10. **Make the agent real.** Enrollment, inventory, heartbeat, and enforcement for patch/EDR/DLP/MDM actions — until then every "action on a device" is a record transition and must be labelled as such. (Phases 3, 4)
11. **Feeds or explicit non-integration.** Vendor patch feed, CVE/NVD feed, threat-intel feed — or, if out of scope, an explicit "not connected" integration contract in the UI instead of silent absence. (Phases 3, 4)
12. **MFA + session management.** TOTP/WebAuthn, refresh/revoke, session list. (Phases 9, 11)
13. **Complete the app shell.** Global record search, notification center, breadcrumbs, collapsible sidebar, org selector, responsive/mobile layout. (Phase 2)
14. **Production hardening.** Alembic migrations (stop `create_all` on boot), remove `uvicorn --reload` from compose, tighten CORS, add rate limiting, backup/restore + retention policy, remove dead Redis service or use it. (Phases 11, 12)
15. **Close the test gap.** Tests for CRUD routers, auth, tenant isolation, and patching workflows; frontend tests; one end-to-end smoke test (login → create → status change → scheduler tick). (Phase 12)
16. **Unify the two UI dialects.** Generic pages (Tailwind classes) and GRC pages (inline styles) diverge — shared table/modal/form components, one status-option vocabulary (today `STATUS_OPTIONS` in App.tsx is a different list from GRC's per-resource options), no hardcoded hex outside tokens. (Phase 2)
17. **Fix repo hygiene.** Make `scripts/start-nexus.sh` executable in git (`chmod +x` commit); reconcile the clone's stale git HEAD with the branch (snapshot pushes bypass local git history); add a head check to the snapshot-push flow so a stale push cannot overwrite a newer branch head (already happened once to `App.tsx`). (Phase 12)

## 14. Things that must NOT be claimed as working

- Do **not** claim an organization is compliant because endpoint checks pass or controls are "implemented" — implementation % is not compliance, and no framework content for HIPAA / CJIS / PCI DSS / NIST SP 800-53 ships in the product.
- Do **not** claim NEXUS itself is HIPAA / CJIS / SOC 2 / PCI DSS compliant — no such attestation exists.
- Do **not** claim patch deployment installs anything on endpoints — deployments are record transitions; the scheduler advances records and the agent is a stub.
- Do **not** claim EDR containment, malware quarantine, ransomware recovery, DLP wipe, or MDM lock/wipe execute on devices — all are record status changes today.
- Do **not** claim threat hunts execute analytics — a completed hunt reports a telemetry-row count.
- Do **not** claim enrollment tokens are validated or one-time — the backend checks only the `nexus-` prefix and a parseable UUID.
- Do **not** claim reports are generated files — they are catalogue records with a status string.
- Do **not** claim MFA, SSO, email notifications, CVE/threat-intel feeds, or a vendor patch feed exist — none do.
- Do **not** claim the Go agent collects inventory or enforces anything — it prints a banner and a placeholder heartbeat log.
- Do **not** present demo data as organization data — GRC demo rows are flagged `is_demo`; the same discipline must apply to any future seeded/demo content.
- Do **not** claim the generic console's Add / status controls work on every page — they fail on devices, patches, vulnerabilities, alerts, policies, and scheduler runs (see §11).

## 15. What is genuinely strong (keep it)

- Tenant isolation is consistently enforced in query code (`_crud.py`, core routers, GRC, scheduler audit attribution).
- The GRC workspace is the most complete module in the product: real forms, workflows, history, demo labelling, and 20 passing tests.
- The scheduler/worker is a careful design (one step per tick, idempotent, test-gated deployments, per-tenant audit rows) with 7 passing tests.
- The design system is real and centralized (tokens, dark mode, density, focus-visible), not a skin.
- The endpoint surface is broad and consistent (one CRUD pattern, one status model), which makes Phases 2–12 additive rather than a rewrite.
- Recovery keys store escrow references only, never raw keys — the one place where a security-sensitive design decision is already correct.
