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

## Status

- [x] Repository and foundational documentation
- [x] Backend skeleton with tenant-aware models
- [x] Frontend console shell
- [x] Platform models, APIs, and console for all 17 feature areas (v0.2.0)
- [ ] Go agent prototype (read-only inventory)
- [ ] End-to-end enrollment flow
- [ ] Background scheduler / worker for deployments, hunts, and remediation workflows
- [ ] Vendor patch / CVE / threat-intel feed integrations
- [ ] Endpoint enforcement in the agent (patch / AV / EDR / DLP)

## License

Proprietary — All rights reserved.
