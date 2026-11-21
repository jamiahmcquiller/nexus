# NEXUS Scheduler

The background worker that turns platform records into outcomes.
Without it, patch deployments, threat hunts, and remediation
workflows are just records with a status. With it, they advance.

## How to run it

```bash
# One tick (cron / manual / CI)
cd nexus-backend
python -m app.worker --once

# Loop forever, tick every 60s (default)
python -m app.worker
python -m app.worker --interval 30

# Docker Compose (API + worker + Postgres + Redis)
docker compose -f infra/docker-compose.yml up -d
```

Run exactly one worker replica. Two workers would both advance the
same records — the one-step-per-tick design makes that harmless, but
it would double the AuditEvents. The API does **not** start a
scheduler itself; the worker is a separate process so a worker crash
cannot take the API down.

Environment: `DATABASE_URL` (same as the API),
`SCHEDULER_INTERVAL_SECONDS` (default 60, minimum 5).

## What one tick does

One transition per record per tick, so a tick is idempotent and a
crashed tick can simply be re-run. A failing job is recorded in the
run summary and does not stop the rest of the tick.

| Job | Transition |
| --- | --- |
| Patch deployments | `scheduled`/`approved` + due + test passed → `deploying` → `deployed` (linked patch → `deployed`); test failed → `failed` |
| Threat hunts | `scheduled` → `running` → `complete`, findings = telemetry rows in the lookback window (default 30 days) |
| Remediation workflows | Active workflow resolves open DEX insights matching its trigger (`*` / `all` = every open insight for the tenant) |
| App / imaging deployments | `scheduled` → `deploying` → `deployed` |
| System tool jobs | `scheduled` → `running` → `complete` |
| Server patch windows | Approved + window open → `in-progress` → `deployed` |
| Privilege grants | `active` + expired → `expired` |
| Licenses / warranties / certificates | `active` + expired → `expired`; expiring within 30 days → `expiring` |

Every transition writes an `AuditEvent`, and each tick writes one
`SchedulerRun` row per tenant that had work done (status `complete`
or `partial` when a job errored).

## Scheduling a deployment

A `PatchDeployment.schedule` is an ISO-8601 datetime, `"now"`, or
empty (due on the next tick). An unparseable schedule is **never**
treated as due — it is left alone, so a typo cannot trigger a
deployment.

A deployment whose test has not passed is also left alone. The
scheduler never invents a test result: test in the console first
(`POST /api/v1/patches/{id}/test`, then approve), and only then
does the worker deploy it.

## API

| Call | Purpose |
| --- | --- |
| `GET /api/v1/scheduler/status` | Worker description, job list, last run |
| `GET /api/v1/scheduler/jobs` | The job list above |
| `GET /api/v1/scheduler/runs` | Run history (tenant-scoped) |
| `GET /api/v1/scheduler/runs/stats` | Run counts by status |
| `POST /api/v1/scheduler/run-once` | Run one tick now — owner/admin only |

The console has a Scheduler module with the run history and a
**Run now** button (owner/admin only).

## What the scheduler does not do

- It never deploys to a device directly. It advances the platform
  record; actual endpoint enforcement is the agent's job, driven by
  the record's new status.
- It never reads or writes credentials, keys, or secrets.
- It does not run scripts itself: a remediation workflow records
  which insights it resolved and when; executing its
  `action_script` on endpoints is agent work.

## Code map

- Core: `nexus-backend/app/scheduler.py` (`run_due_jobs`)
- Worker: `nexus-backend/app/worker.py` (`python -m app.worker`)
- API: `nexus-backend/app/routers/scheduler.py`
- Run records: `SchedulerRun` in `nexus-backend/app/models_extended.py`
- Tests: `nexus-backend/tests/test_scheduler.py`
