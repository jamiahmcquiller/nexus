# NEXUS

Unified IT Operations & Security Management Platform.

Multi-tenant B2B SaaS for endpoint inventory, vulnerability operations, patch management, and ITSM with a cybersecurity-first design.

## Repository Structure

```
nexus/
├── nexus-backend/    # FastAPI application (console + APIs)
├── frontend/         # React + TypeScript admin console
├── agent/            # Go Windows endpoint agent (MVP: inventory + heartbeat)
├── docs/             # Product docs, ADRs, schemas
├── infra/            # Docker Compose, deployment configs
└── README.md
```

## Quick Start

One command starts everything — Postgres, API, scheduler worker,
and console — and checks the API actually answers:

```bash
./scripts/start-nexus.sh --docker
```

Then open the forwarded **5173** port (the console). In Codespaces,
only 5173 needs to be open: the console proxies `/api` to the
backend itself, so you do not need a separate -8000 port.

Manual start (if you prefer the pieces separate):

```bash
# From the repository root
docker compose -f infra/docker-compose.yml up -d

# Install Poetry (once per Codespace)
curl -sSL https://install.python-poetry.org | python3 -
export PATH="$HOME/.local/bin:$PATH"

# Backend
cd nexus-backend
poetry install
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Login says "Network Error" / "Backend not reachable"?

That means the console loaded but the backend did not answer — it
is almost never a wrong password. Check in this order:

1. Is the backend running? `curl http://localhost:8000/health`
   should return `{"status":"ok",...}`. If it does not, start it:
   `./scripts/start-nexus.sh --docker`.
2. Is Postgres up? The backend now retries table creation for
   60s while Postgres starts, instead of crashing — but if Postgres
   never comes up, the API never listens. Check
   `docker compose -f infra/docker-compose.yml ps`.
3. Are you opening the right URL? Open the **5173** console URL
   (in Codespaces, the forwarded 5173 port). Do not open a
   `-8000` URL directly, and do not expect `localhost:8000` to
   work from your phone — `localhost` there means the phone.
4. The login page now shows the backend status and the exact
   backend address it tried, with a Retry button — use that
   instead of guessing.

There is no public hosted Nexus site yet: the app runs from your
Codespace / machine with the steps above.

## MVP Scope

See `docs/PRD.md` (or the uploaded Product Requirements Document). First release focuses on:

- Tenant isolation and RBAC
- Windows agent enrollment
- Device inventory (hardware, OS, software)
- Heartbeat / check-in
- Groups and audit logging

## Platform Features (v0.2.0)

One platform covering the full Endpoint Central-style feature set — see
`docs/platform-features.md` for the full API table:

- **Patch & update management** — automated patching, test / approve, deployment policies with pre/post checks and reboot options, third-party patching, selective decline
- **Vulnerability remediation** — assessment & prioritisation, zero-day mitigation scripts, CIS / NIST / Cyber Essentials configuration checks, web-server hardening, high-risk software audit
- **Endpoint Detection & Response** — activity monitoring, MITRE ATT&CK-mapped detection, alert triage, containment, 30-day threat hunting
- **Malware & anti-ransomware** — multi-layered detection, quarantine, behaviour detection, single-click recovery from VSS recovery points
- **Browser security, app control & privilege management** — browser policies / extensions, allowlist / blocklist, JIT and time-based privileges
- **Data security & Secure Private Access** — DLP, sensitive-data discovery, BYOD containers, remote wipe, zero-trust app segments and access audit
- **Assets, distribution, DEX, remote, imaging, config** — licenses / warranties / certificates / geo-fencing / USB, software distribution & metering, experience scoring & RCA, remote sessions, OS imaging, configuration profiles & scripts
- **MDM, disk encryption, servers, reporting** — Android / iOS / iPadOS / macOS / Windows / ChromeOS / tvOS, BitLocker / FileVault escrow (references only), server lifecycle & patch windows, audit-ready reports

## GRC workspace (v0.5.0)

Governance, Risk & Compliance as a full enterprise module — see
`docs/grc.md` for the endpoint table, models, and demo-data rules.
Ten tenant-scoped resources under `/api/v1/grc/` (frameworks,
controls, assessments, evidence, findings, risks, remediations,
audits, mappings, settings) plus `GET /api/v1/grc/overview`, per-record
history at `GET /api/v1/grc/{resource}/{id}/history`, workflow
transitions (assessment start/complete, evidence approve/reject,
finding remediate/accept, risk accept/mitigate, remediation/audit
complete, framework activate/retire), and owner/admin-only
`POST /api/v1/grc/seed-demo` / `clear-demo`. The console is
`frontend/src/GrcWorkspace.tsx` — twelve categories, each a functional
page with search, filters, sorting, pagination, detail + history, and
add forms; demo rows carry a "Demo" pill and are never presented as
organization data.

## Status

- [x] Repository and foundational documentation
- [x] Backend skeleton with tenant-aware models
- [x] Frontend console shell
- [x] Platform models, APIs, and console for all 17 feature areas (v0.2.0)
- [x] Background scheduler / worker for deployments, hunts, and remediation workflows (v0.3.0 — see `docs/scheduler.md`; run `python -m app.worker`, or `docker compose -f infra/docker-compose.yml up -d` for API + worker)
- [x] Two administrator workspaces + brand theme (v0.4.0 — see `docs/workspaces-and-theme.md`): IT Operations and Security Operations, separate navigation and home dashboards, switch on one sign-in, role-based authorization; Midnight Navy / Teal / Cloud Gray system, light/dark mode, density
- [x] GRC workspace (v0.5.0 — see `docs/grc.md`): enterprise Governance, Risk & Compliance — frameworks, control library, assessments, evidence, findings & exceptions, risk register, remediation plans, compliance reports, audit schedule, control mapping, settings, with an overview, workflow transitions, AuditEvent history, and idempotent demo-data seeding/clearing (demo rows always flagged `is_demo`)
- [x] Endpoint agent v0.3.0 (see `agent/README.md`): Go agent for Windows/macOS/Linux — enrollment, hardware/OS/software inventory upload, heartbeat, remote command execution (owner/admin-authorized, audit-logged, 5-minute timeout), and Wake-on-LAN via any online agent on the same LAN; backend command queue at `/api/v1/agent` (45 backend tests passing)
- [x] End-to-end enrollment flow (agent enroll → inventory → heartbeat verified against a live backend; remote command + WoL round-trips verified)
- [ ] Vendor patch / CVE / threat-intel feed integrations
- [ ] Endpoint enforcement in the agent (patch / AV / EDR / DLP)

## License

Proprietary — All rights reserved.
