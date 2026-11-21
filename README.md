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

### GitHub Codespaces

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

Forward ports 8000 (backend) and 5173 (frontend) in the Ports panel if they are not auto-forwarded.

### Local Development

```bash
# From repo root
docker compose -f infra/docker-compose.yml up -d
cd nexus-backend && poetry install && poetry run uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

## MVP Scope

See `docs/PRD.md` (or the uploaded Product Requirements Document). First release focuses on:

- Tenant isolation and RBAC
- Windows agent enrollment
- Device inventory (hardware, OS, software)
- Heartbeat / check-in
- Groups and audit logging

## Sample data

To fill an organization with sample devices, vulnerabilities, patches, tickets, workflows, warranty, and compliance data:

```bash
cd nexus-backend
poetry run python -m app.scripts.seed_demo <your-username>          # add (safe to rerun)
poetry run python -m app.scripts.seed_demo <your-username> --remove # remove sample devices
```

## Console modules

| Module | What works today |
|---|---|
| Overview | Live device health, attention list, activity, ticket and warranty counts |
| Endpoint Management | Inventory, search/filter/export, device profiles, groups, enrollment codes, warranty tracker with CSV import |
| Vulnerability Management | Findings with CVSS, exploit likelihood, exploited-in-the-wild flag, priority score; mark fixed / accept risk |
| Patch Management | Catalog, approval queue, deployments (install is simulated until the agent can patch), policies |
| Software Management | Fleet-wide software inventory, approve / mark unapproved |
| Service Desk | Incidents, requests, changes with SLAs, approvals, comments, employee portal |
| Automation | Trigger and action workflows that run on schedule or on demand |
| Security & Compliance | CIS v8 / NIST CSF controls (auto-checked and manual), risk register, audit log |
| Reports | Inventory, exposure, patching, service desk, and warranty analytics; print to PDF |

## Status

- [x] Repository and foundational documentation
- [ ] Backend skeleton with tenant-aware models
- [ ] Frontend console shell
- [ ] Go agent prototype (read-only inventory)
- [ ] End-to-end enrollment flow

## License

Proprietary — All rights reserved.
