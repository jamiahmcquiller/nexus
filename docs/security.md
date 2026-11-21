# NEXUS security model

## Roles

Every user has one role: `owner`, `admin`, `technician`, or `auditor`.
`owner` passes every role check; the other roles are checked exactly
as listed.

| Action | Who can do it |
| --- | --- |
| Read anything (list, get, stats) | Any authenticated role |
| Create / update / status change | owner, admin, technician |
| Delete a record | owner, admin only |
| Patch deploy, MDM lock / wipe, DLP wipe, ransomware recover, privilege-grant revoke | owner, admin only |
| Scheduler run-once, agent command create, device wake, enrollment-token issue, GRC demo seed / clear | owner, admin only |
| GRC workflow transitions (assessments, evidence, findings, risks, remediations, audits, frameworks) | owner, admin, technician |

An `auditor` is read-only everywhere: every create, update, status,
delete, and workflow action returns 403 for them. The console hides
the Delete button and shows Edit only for owner/admin/technician, but
the backend enforces the same rules — the console is not the control.

## Device authentication (backend v0.7.0, agent v0.3.1)

Enrollment is two steps, and the two credentials are never the same:

1. **Enrollment token** — one-time, stored, issued by an owner/admin
   (`POST /api/v1/devices/enrollment-tokens`, or
   `python -m app.scripts.generate_token <tenant_uuid>`). Only its
   SHA-256 hash is stored; the plaintext is shown once. It enrolls
   exactly one device in one tenant, then it is spent. Expired or
   already-used tokens are rejected (400).
2. **Device credential** — issued at enrollment, returned once in the
   enroll response. The agent saves it to `agent-config.json` (0600)
   and sends it as the `X-Device-Token` header on every call after
   enrollment: heartbeat, inventory upload, command poll, command
   completion. Only its SHA-256 hash is stored (`Device.device_token_hash`).
   Re-enrolling a device with a fresh enrollment token rotates its
   device credential.

An enrollment token can never authenticate a heartbeat, an inventory
upload, or a command poll — those endpoints reject it with 401. A
device credential only works for the device it was issued to: using
another device's credential returns 403.

Breaking change from v0.6.0 / agent v0.3.0: the old flow accepted any
token starting with `nexus-` and let the heartbeat run unauthenticated.
Old enrollment tokens and agent v0.3.0 binaries stop working against
a v0.7.0 backend. Issue a fresh enrollment token and use agent v0.3.1.

## Secrets

No secret has a working default in the repo:

- `nexus-backend/app/database.py` — `DATABASE_URL` must be set or the
  app fails closed at import. `SECRET_KEY` unset means an ephemeral
  random key is generated with a loud warning: the app runs, but JWTs
  stop validating after a restart.
- `infra/docker-compose.yml` — `POSTGRES_PASSWORD` and `SECRET_KEY`
  come from the environment with fail-fast `${VAR:?...}` interpolation;
  compose refuses to start without them. The worker gets the same
  `SECRET_KEY` as the backend.
- `infra/.env` — the local home for those two values (gitignored via
  the `.env` rule). `infra/.env.example` documents the shape.
  `scripts/start-nexus.sh` generates `infra/.env` with random values
  on first run; pass `--env-file infra/.env` when running compose by
  hand.

### Existing Postgres volume

A Postgres volume is initialized with the password in effect at first
start. Before v0.7.0 that was the hardcoded dev password. If you
rebuild a stack that already has a `postgres_data` volume, put THAT
password in `infra/.env` (same value, moved out of the repo) or
Postgres will refuse to start. Rotate the password separately: change
it in Postgres itself first, then in `infra/.env` — never by editing
`docker-compose.yml` alone, and never silently.

### What is still not done

- No MFA, SSO, or user administration UI yet (Phase 9).
- JWTs live 24h and are stored in the browser's localStorage.
- The agent binary is unsigned; verify downloads come from the
  project's own links.
- Recovery keys are escrow references only — raw BitLocker / FileVault
  keys are never stored. Keep it that way.
