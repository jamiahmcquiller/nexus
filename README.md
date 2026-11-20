# NEXUS

Unified IT Operations & Security Management Platform.

Multi-tenant B2B SaaS for endpoint inventory, vulnerability operations, patch management, and ITSM with a cybersecurity-first design.

## Repository Structure

```
nexus/
├── backend/          # FastAPI application (console + APIs)
├── frontend/         # React + TypeScript admin console
├── agent/            # Go Windows endpoint agent (MVP: inventory + heartbeat)
├── docs/             # Product docs, ADRs, schemas
├── infra/            # Docker Compose, deployment configs
└── README.md
```

## Quick Start (Local Development)

```bash
# From repo root
docker compose -f infra/docker-compose.yml up -d
cd backend && poetry install && poetry run uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

## MVP Scope

See `docs/PRD.md` (or the uploaded Product Requirements Document). First release focuses on:

- Tenant isolation and RBAC
- Windows agent enrollment
- Device inventory (hardware, OS, software)
- Heartbeat / check-in
- Groups and audit logging

## Status

- [x] Repository and foundational documentation
- [ ] Backend skeleton with tenant-aware models
- [ ] Frontend console shell
- [ ] Go agent prototype (read-only inventory)
- [ ] End-to-end enrollment flow

## License

Proprietary — All rights reserved.
