# NEXUS Platform Modules (Expanded)

All modules below are designed as first-class capabilities on the same multi-tenant platform. Core data models and API scaffolds are in place; full agent workflows and automation are incremental.

## Endpoint & Asset Foundation
- Device inventory, groups, heartbeat, audit
- Asset management (hardware/software tracking, licenses, warranties, certificates)
- Geo-fencing, power management, USB control

## Patch & Vulnerability Management
- Automated patch discovery, testing, approval, deployment, decline
- Third-party application patching
- Vulnerability assessment, prioritization, zero-day mitigation
- Security configuration and CIS compliance checks

## Endpoint Detection & Response
- Endpoint activity monitoring (process, file, network, registry)
- Threat detection (behavioral + MITRE ATT&CK)
- Alert triage, investigation, containment, threat hunting

## Malware & Anti-Ransomware
- Multi-layered detection (AI/ML + deep learning)
- Contextual remediation and quarantine
- Behavior-based ransomware detection, device quarantine, single-click recovery

## Browser & Application Control
- Browser restriction, extension management, lockdown, isolation
- Allowlist/blocklist, privilege management, JIT access, least privilege

## Data Security & Access
- Sensitive data discovery, DLP (at rest/in use/in motion)
- Containerization, remote wipe, encryption (BitLocker/FileVault)
- Secure Private Access (zero-trust, application-level tunnels)

## Digital Experience & Operations
- DEX telemetry, RCA, automated remediation, experience scoring
- Remote access and troubleshooting
- Application distribution and self-service
- OS imaging and deployment
- Configuration and profile management

## Mobile & Server
- MDM (enrollment, profiles, apps, kiosk, remote)
- Disk encryption management
- Server lifecycle, caching, patching, monitoring

## Compliance & Reporting
- CIS, NIST, Cyber Essentials, HIPAA, GDPR, PCI
- Audit-ready reports and Active Directory integration

## Implementation Status
- [x] Multi-tenant models for devices, patches, vulnerabilities, alerts, policies, compliance
- [x] API routers for core modules
- [x] Console navigation covering all major capabilities
- [x] Platform models + API routers for all 17 feature areas (`nexus-backend/app/models_extended.py`, `nexus-backend/app/routers/_crud.py` + 18 domain routers) — 57 tenant-scoped tables, 57 CRUD resource endpoints, plus workflow actions: patch test / approve / decline / deploy, vulnerability mitigate / remediate, EDR contain, malware quarantine, ransomware single-click recovery, MDM lock / wipe, DLP container wipe, remote-session end, server patch-window approve, privilege-grant revoke
- [x] Console wired to all platform APIs (`frontend/src/App.tsx`) — per-module sub-sections, stats, table view, add, status change, and workflow buttons
- [x] Background scheduler / worker (v0.3.0, `app/scheduler.py` + `app/worker.py`) — patch deployments, threat hunts, remediation workflows, app/imaging deployments, server patch windows, and expiry housekeeping; one step per tick, idempotent; 7 pytest tests pass on in-memory SQLite (see `docs/scheduler.md`)
- [ ] Agent telemetry ingestion (endpoint / server / DEX telemetry endpoints exist; the Go agent does not yet send them)
- [ ] Real patch / AV / EDR enforcement on endpoints — the platform is the console, API, and data model; enforcement depends on the agent and on vendor patch / threat-intel feeds, which are not bundled

## Verification (2026-11-21)
- `python3 -m py_compile` passes for all new and changed backend files.
- All 63 frontend API endpoints cross-checked against backend routers — no missing endpoint.
- Not yet verified live: no database was available in this environment, so the API was not run end-to-end and the frontend was not built (`npm install` / `tsc` not run). Run `docker compose -f infra/docker-compose.yml up -d`, then the backend and frontend quick-start steps in the README, before demoing.
