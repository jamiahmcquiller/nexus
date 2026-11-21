# NEXUS Platform Features

One platform, one tenant-scoped data model. Every table carries
`tenant_id`; every API call is authenticated and tenant-filtered.

## API pattern

Every resource supports the same five calls:

| Call | Purpose |
| --- | --- |
| `GET /api/v1/<resource>/` | List (tenant-scoped, newest first, max 500) |
| `GET /api/v1/<resource>/stats` | Counts by status |
| `POST /api/v1/<resource>/` | Create — `{title | name, status?, …}`; unknown fields go to `attributes` |
| `PATCH /api/v1/<resource>/{id}` | Update fields / status |
| `POST /api/v1/<resource>/{id}/status` | Set status: `{status}` |

## Feature areas and resources

| Area | Resources |
| --- | --- |
| Patch & update management | `patches`, `patch-deployments`, `patch-tests`, `third-party-apps` |
| Vulnerability remediation | `vulnerabilities`, `zero-day-mitigations`, `security-configurations`, `web-server-hardening`, `high-risk-software` |
| Endpoint Detection & Response | `edr/telemetry`, `edr/hunts`, `edr/incidents`, `alerts` |
| Malware protection | `malware/detections` |
| Anti-ransomware | `ransomware/incidents`, `ransomware/recovery-points` |
| Browser security | `browser/policies`, `browser/extensions` |
| Application control & privilege | `app-control/rules`, `app-control/privilege-grants` |
| Data security / DLP | `dlp/findings`, `dlp/policies`, `dlp/incidents`, `dlp/containers` |
| Secure Private Access | `access/segments`, `access/policies`, `access/audit` |
| Asset management | `assets`, `assets/licenses`, `assets/warranties`, `assets/certificates`, `assets/geo-fences`, `assets/usb-events`, `assets/power-schemes` |
| Application distribution | `distribution/packages`, `distribution/deployments`, `distribution/metering` |
| Digital Employee Experience | `dex/telemetry`, `dex/insights`, `dex/workflows`, `dex/experience-scores` |
| Remote access & troubleshooting | `remote/sessions`, `remote/announcements`, `remote/system-tools` |
| OS imaging & deployment | `imaging/images`, `imaging/deployments`, `imaging/templates` |
| Configuration management | `config/profiles`, `config/scripts`, `config/kiosk` |
| Mobile Device Management | `mdm/devices`, `mdm/profiles`, `mdm/apps` |
| Disk encryption | `encryption/policies`, `encryption/recovery-keys` |
| Server management | `servers`, `servers/patch-windows`, `servers/health-checks` |
| Reporting & auditing | `reports`, `reports/templates`, `compliance`, `policies` |

## Workflow actions (beyond CRUD)

- `POST /api/v1/patches/{id}/test` — create a testbed test, patch → `testing`
- `POST /api/v1/patches/{id}/approve` — patch → `approved`
- `POST /api/v1/patches/{id}/decline` — `{reason, duration: temporary|permanent}`, patch → `declined`
- `POST /api/v1/patches/{id}/deploy` — `{scope, schedule, reboot_option, pre_checks, post_checks}`, creates a `patch-deployments` record
- `POST /api/v1/vulnerabilities/{id}/mitigate` — vulnerability → `mitigated`, creates a zero-day mitigation
- `POST /api/v1/vulnerabilities/{id}/remediate` — vulnerability → `remediated`
- `POST /api/v1/edr/incidents/{id}/contain` — `{action: isolate|kill-process|quarantine|rollback}`, linked alert → `contained`
- `POST /api/v1/edr/hunts/{id}/run` — start a 30-day threat hunt
- `POST /api/v1/malware/detections/{id}/quarantine`
- `POST /api/v1/ransomware/incidents/{id}/recover` — `{recovery_point_id?}`, single-click recovery from a VSS recovery point
- `POST /api/v1/mdm/devices/{id}/lock` / `/wipe`
- `POST /api/v1/dlp/containers/{id}/wipe`
- `POST /api/v1/remote/sessions/{id}/end`
- `POST /api/v1/servers/patch-windows/{id}/approve`
- `POST /api/v1/app-control/privilege-grants/{id}/revoke`

## Scheduler

Deployments, hunts, and remediation workflows are executed by the
background worker — see `docs/scheduler.md`. One step per record per
tick, idempotent, with an AuditEvent per transition and a
`SchedulerRun` row per tenant. Run it with `python -m app.worker`,
or `docker compose -f infra/docker-compose.yml up -d`.

## What this is not (yet)
- No vendor feeds bundled: patch catalogues, CVE intelligence, and
  threat-intel feeds need a provider integration.
- No endpoint enforcement: the Go agent reports inventory and heartbeat
  only. Patch / AV / EDR / DLP enforcement on the endpoint is agent work.
- Recovery keys are escrow *references* only. Never store a raw
  BitLocker / FileVault recovery key in this database.

## Code map

- Models: `nexus-backend/app/models_extended.py` (57 tables)
- Shared CRUD: `nexus-backend/app/routers/_crud.py`
- Domain routers: `nexus-backend/app/routers/{patching,vulnops,edr,malware,browser,appcontrol,dlp,access,assets,distribution,dex,remote,imaging,configmgmt,mdm,encryption,servers,reporting}.py`
- Console: `frontend/src/App.tsx` (all modules + sub-sections)
- Workspaces & theme (v0.4.0): `frontend/src/workspaces.ts`,
  `frontend/src/theme.ts`, `docs/workspaces-and-theme.md` — two
  administrator workspaces (IT Operations, Security Operations)
  with separate navigation and home dashboards, single-sign-on
  switching, role-based authorization
  (`GET /api/v1/auth/workspaces`), and the Midnight Navy / Teal
  brand system (light/dark mode) applied to every screen
