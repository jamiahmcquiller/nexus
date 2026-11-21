# Governance, Risk & Compliance (GRC) workspace — v0.5.0

Enterprise GRC module: frameworks, control library, assessments,
evidence, findings & exceptions, risk register, remediation plans,
compliance reports, audit schedule, control mapping, and settings —
one tenant-scoped workspace, wired into the console as
`frontend/src/GrcWorkspace.tsx` (the parent App renders it; it owns
its own category state).

## Models

All ten models live in `nexus-backend/app/models_extended.py`, are
tenant-scoped (`tenant_id`), carry free-form detail in `attributes`
(JSON), and carry `is_demo` (Boolean, default `False`) so demo data
is always distinguishable from the organization's own data.

| Table | Key columns | Status values |
|---|---|---|
| `grc_frameworks` | name, title, standard, version, owner | active, draft, retired |
| `grc_controls` | framework_id → grc_frameworks, control_ref, category, owner | implemented, partial, not_implemented, not_applicable |
| `grc_assessments` | framework_id, scope, assessor, due_at | planned, in_progress, complete, draft |
| `grc_evidence` | control_id, framework_id, evidence_type, uploaded_by | pending_review, approved, rejected, expired |
| `grc_findings` | control_id, framework_id, severity, owner | open, in_progress, remediated, accepted, closed |
| `grc_risks` | category, likelihood 1–5, impact 1–5, owner | open, mitigated, accepted, closed |
| `grc_remediations` | finding_id, control_id, owner, due_at | planned, in_progress, complete, overdue |
| `grc_audits` | framework_id, auditor, scheduled_at | scheduled, in_progress, complete, cancelled |
| `grc_control_mappings` | control_id, mapped_framework, mapped_control_ref | mapped, gap, unmapped |
| `grc_settings` | key, value (JSON column), status | active, inactive |

Standards used by frameworks: CIS v8, NIST CSF 2.0, ISO 27001, SOC 2,
HIPAA, GDPR, PCI DSS, Cyber Essentials. Finding severities:
critical, high, medium, low. Evidence types: document, screenshot,
log, attestation. Evidence stores a file reference and file name in
`attributes` only — never file content. Finding attributes hold the
exception flag and exception expiry. Risk score is
likelihood × impact (1–25); 15+ is high priority.

## Endpoints

Base: `/api/v1/grc`. Every resource has the standard tenant-scoped
CRUD from `routers/_crud.py`: `GET /`, `GET /stats`, `POST /` (201),
`GET /{id}`, `PATCH /{id}`, `POST /{id}/status`.

| Endpoint | Description |
|---|---|
| `GET /api/v1/grc/overview` | Tenant summary (see below) |
| `GET /api/v1/grc/{resource}/{id}/history` | Audit history for one record, newest first, limit 50 |
| `POST /api/v1/grc/seed-demo` | Seed the demo set (owner/admin) |
| `POST /api/v1/grc/clear-demo` | Delete only demo rows (owner/admin) |
| `GET/POST /api/v1/grc/frameworks/` | Frameworks CRUD |
| `GET/POST /api/v1/grc/controls/` | Controls CRUD |
| `GET/POST /api/v1/grc/assessments/` | Assessments CRUD |
| `GET/POST /api/v1/grc/evidence/` | Evidence CRUD |
| `GET/POST /api/v1/grc/findings/` | Findings CRUD |
| `GET/POST /api/v1/grc/risks/` | Risks CRUD |
| `GET/POST /api/v1/grc/remediations/` | Remediations CRUD |
| `GET/POST /api/v1/grc/audits/` | Audits CRUD |
| `GET/POST /api/v1/grc/mappings/` | Control mappings CRUD |
| `GET/POST /api/v1/grc/settings/` | Settings CRUD |

### Overview shape

`GET /api/v1/grc/overview` returns: `active_frameworks`,
`total_frameworks`, `total_controls`, `controls_implemented`,
`open_findings`, `findings_by_severity` (critical/high/medium/low
counts for open findings), `evidence_pending_review`, `open_risks`,
`overdue_remediations` (due date in the past, not complete),
`has_demo`, `frameworks` (per-framework `{id, name, standard,
version, owner, status, is_demo, total_controls,
implemented_controls, compliance_pct}`), `recent_activity` (latest
10 `AuditEvent`s whose `entity_type` starts with `grc_`), and
`legacy_benchmarks` (`{total, compliant, non_compliant}` from the
existing device-level `ComplianceResult` rows).

### Workflow actions

Each loads the tenant-scoped row, sets the status, commits, writes
an `AuditEvent`, and returns the serialized row; 404 if missing.

| Endpoint | New status |
|---|---|
| `POST /assessments/{id}/start` | in_progress |
| `POST /assessments/{id}/complete` | complete |
| `POST /evidence/{id}/approve` | approved |
| `POST /evidence/{id}/reject` | rejected |
| `POST /findings/{id}/remediate` | remediated |
| `POST /findings/{id}/accept` | accepted |
| `POST /risks/{id}/accept` | accepted |
| `POST /risks/{id}/mitigate` | mitigated |
| `POST /remediations/{id}/complete` | complete |
| `POST /audits/{id}/complete` | complete |
| `POST /frameworks/{id}/activate` | active |
| `POST /frameworks/{id}/retire` | retired |

## History via AuditEvent

`routers/_crud.py` `crud_router` takes an optional `audit_prefix`
(default `None`, fully backward-compatible). When set, create writes
`AuditEvent(action="{prefix}.created", entity_type="{prefix}")` and
`POST /{id}/status` writes `"{prefix}.status_changed"` with the new
status in `event_metadata`. GRC passes `grc_framework`,
`grc_control`, etc. Workflow transitions write their own events the
same way. `GET /api/v1/grc/{resource}/{id}/history` filters
`AuditEvent` by `entity_type='grc_<singular>'` and `entity_id`,
newest first. The console's detail panel shows this history per
record.

## Demo data rules

- Every demo row has `is_demo=True`; organization rows have
  `is_demo=False`. The console shows a "Demo" pill on demo rows and
  an "Organization" label on org rows, plus a banner on the overview
  whenever any demo rows exist.
- `POST /api/v1/grc/seed-demo` (owner/admin) is idempotent-ish: if
  any demo GRC rows exist for the tenant it returns
  `{seeded: false, reason: "demo data already exists"}` and creates
  nothing. Otherwise it creates 3 frameworks (CIS v8, NIST CSF 2.0,
  ISO 27001), 12 controls, 2 assessments, 6 evidence items (2 pending
  review), 5 findings (including 1 critical open), 4 risks (one with
  score ≥ 15), 3 remediations (1 overdue), 2 audits, 3 mappings, and
  3 settings — and writes one seeding `AuditEvent`.
- `POST /api/v1/grc/clear-demo` (owner/admin) deletes only
  `is_demo=True` GRC rows for the tenant and returns the count
  deleted per resource. Organization rows are never touched.

## Console

`frontend/src/GrcWorkspace.tsx` (default export `GrcWorkspace({api,
headers})`) has twelve categories in a left nav: Overview, Frameworks
& Standards, Control Library, Assessments, Evidence Management,
Findings & Exceptions, Risk Register, Remediation Plans, Compliance
Reports, Audit Schedule, Control Mapping, Compliance Settings. The
eight GRC resource pages share one generic table/form/detail
implementation (search, status/severity filters, sorting,
pagination at 10/page, detail panel with history, workflow buttons,
and status select, add form). Compliance Reports reuses the existing
`/api/v1/reports/` and `/api/v1/reports/templates/` catalogue.
Compliance Settings uses the GRC settings resource plus the demo
seed/remove buttons. Overview quick actions jump to Frameworks /
Assessments / Evidence with the add form open.
