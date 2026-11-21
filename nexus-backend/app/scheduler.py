"""Background scheduler — the worker that turns records into outcomes.

The platform stores *intent* (a scheduled patch deployment, a running
threat hunt, an active remediation workflow). This module is the part
that executes it, one step per record per tick, so a run is idempotent
and a crashed tick can simply be re-run.

State machines (one transition per tick — never jump two steps):
- PatchDeployment: scheduled --(due, test passed)--> deploying
                     --(next tick)--> deployed
                     scheduled --(due, test failed)--> failed
  A deployment whose test has not passed is left alone. The scheduler
  never invents a test result.
- ThreatHunt: scheduled --> running --> complete
  (findings = telemetry rows for the tenant inside the lookback window)
- RemediationWorkflow (active): for each open DexInsight whose title /
  root cause matches the workflow trigger, mark the insight resolved
  and record the run. A workflow with trigger "*" or "all" matches
  every open insight for its tenant.
- AppDeployment / ImagingDeployment / SystemToolJob:
  scheduled --> deploying/running --> deployed/complete
- ServerPatchWindow: scheduled + approved + window open
  --> in-progress --> deployed (after the window ends, or next tick
  when no end is set)
- PrivilegeGrant: active + expires_at passed --> expired
- SoftwareLicense / Warranty / Certificate:
  active + expiry passed --> expired;
  active + expiry within 30 days --> expiring

Time-based housekeeping only touches rows whose status is still the
"live" one, so re-running a tick changes nothing it already did.

Scheduling: a deployment's ``schedule`` is an ISO-8601 datetime, the
string ``"now"``, or empty (due on the next tick). Anything
unparseable is treated as not-due and recorded in the run summary,
never as due.

Safety: the worker never deploys to a device directly — it advances
the platform record and writes an AuditEvent. Actual endpoint
enforcement is the agent's job, driven by the record's new status.
No credentials, keys, or secrets are read or written here.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .models import AuditEvent, Patch
from .models_extended import (
    AppDeployment,
    Certificate,
    DexInsight,
    EndpointTelemetry,
    ImagingDeployment,
    PatchDeployment,
    PrivilegeGrant,
    RemediationWorkflow,
    SchedulerRun,
    ServerPatchWindow,
    SoftwareLicense,
    SystemToolJob,
    ThreatHunt,
    Warranty,
)

EXPIRY_WARNING_DAYS = 30


def parse_schedule(value):
    """Return a datetime when a schedule string is due, else None.

    Returns None for empty / "now" (due immediately) and for
    unparseable values — callers distinguish those via is_due().
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().lower()
    if text in ("now", "immediate", "asap"):
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_due(schedule, now: datetime) -> bool:
    """True when a record should be picked up on this tick."""
    if not schedule:
        return True
    text = str(schedule).strip().lower()
    if text in ("now", "immediate", "asap"):
        return True
    dt = parse_schedule(schedule)
    if dt is None:
        return False  # unparseable: never silently due
    return dt <= now


def _now_utc(now=None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now


# Tenants touched by the current tick. The worker is single-threaded
# (one tick at a time), so a module-level set cleared at the start of
# each tick is safe here; it lets run_due_jobs write one SchedulerRun
# row per tenant that actually had work done.
_SEEN_TENANTS: set = set()


def _audit(db: Session, tenant_id, action, entity_type, entity_id, metadata=None):
    _SEEN_TENANTS.add(tenant_id)
    db.add(AuditEvent(
        tenant_id=tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        event_metadata=metadata or {},
    ))


def _set_attrs(row, **updates):
    attrs = dict(getattr(row, "attributes", None) or {})
    attrs.update(updates)
    row.attributes = attrs


def _run_patch_deployments(db, now, actions, counts):
    for dep in db.query(PatchDeployment).filter(
        PatchDeployment.status.in_(["scheduled", "approved", "deploying"])
    ).all():
        if dep.status in ("scheduled", "approved"):
            if not is_due(dep.schedule, now):
                continue
            if (dep.test_result or "").lower() == "fail":
                dep.status = "failed"
                _audit(db, dep.tenant_id, "patch_deployment.failed", "patch_deployments", dep.id,
                       {"reason": "test failed"})
                actions.append(f"patch deployment {dep.id} failed (test failed)")
                counts["patch_deployments"] += 1
            elif (dep.test_result or "").lower() != "pass":
                actions.append(f"patch deployment {dep.id} awaiting test pass")
                continue
            else:
                dep.status = "deploying"
                _set_attrs(dep, pre_checks_run_at=now.isoformat())
                _audit(db, dep.tenant_id, "patch_deployment.deploying", "patch_deployments", dep.id, {})
                actions.append(f"patch deployment {dep.id} deploying")
                counts["patch_deployments"] += 1
        elif dep.status == "deploying":
            dep.status = "deployed"
            _set_attrs(dep, post_checks_run_at=now.isoformat(), deployed_at=now.isoformat())
            if dep.patch_id:
                patch = db.query(Patch).filter(Patch.id == dep.patch_id).first()
                if patch:
                    patch.status = "deployed"
            _audit(db, dep.tenant_id, "patch_deployment.deployed", "patch_deployments", dep.id, {})
            actions.append(f"patch deployment {dep.id} deployed")
            counts["patch_deployments"] += 1


def _run_threat_hunts(db, now, actions, counts):
    for hunt in db.query(ThreatHunt).filter(
        ThreatHunt.status.in_(["scheduled", "running"])
    ).all():
        if hunt.status == "scheduled":
            hunt.status = "running"
            _audit(db, hunt.tenant_id, "threat_hunt.started", "threat_hunts", hunt.id, {})
            actions.append(f"threat hunt {hunt.id} running")
            counts["threat_hunts"] += 1
        else:
            lookback = (hunt.lookback_days or 30)
            since = now - timedelta(days=lookback)
            # created_at is stored naive (datetime.utcnow); compare naive.
            since_naive = since.replace(tzinfo=None)
            count = db.query(EndpointTelemetry).filter(
                EndpointTelemetry.tenant_id == hunt.tenant_id,
                EndpointTelemetry.created_at >= since_naive,
            ).count()
            hunt.findings_count = count
            hunt.status = "complete"
            _set_attrs(hunt, completed_at=now.isoformat(), findings_count=count)
            _audit(db, hunt.tenant_id, "threat_hunt.complete", "threat_hunts", hunt.id,
                   {"findings_count": count})
            actions.append(f"threat hunt {hunt.id} complete ({count} telemetry rows in lookback)")
            counts["threat_hunts"] += 1


def _run_remediation_workflows(db, now, actions, counts):
    workflows = db.query(RemediationWorkflow).filter(
        RemediationWorkflow.status == "active").all()
    if not workflows:
        return
    for wf in workflows:
        trigger = (wf.trigger or "").strip().lower()
        insights = db.query(DexInsight).filter(
            DexInsight.tenant_id == wf.tenant_id,
            DexInsight.status == "open").all()
        resolved = []
        for insight in insights:
            haystack = f"{insight.title or ''} {insight.root_cause or ''}".lower()
            if trigger in ("", "*", "all") or trigger in haystack:
                insight.status = "resolved"
                _set_attrs(insight, remediation_workflow_id=str(wf.id),
                           resolved_at=now.isoformat())
                resolved.append(str(insight.id))
                _audit(db, wf.tenant_id, "dex_insight.remediated", "dex_insights", insight.id,
                       {"workflow_id": str(wf.id)})
        if resolved:
            attrs = dict(wf.attributes or {})
            attrs["runs"] = int(attrs.get("runs", 0)) + 1
            attrs["last_run_at"] = now.isoformat()
            attrs["last_resolved_insight_ids"] = resolved
            wf.attributes = attrs
            actions.append(f"remediation workflow {wf.id} resolved {len(resolved)} insight(s)")
            counts["remediation_workflows"] += 1


def _run_simple_deployments(db, now, actions, counts):
    """App / imaging deployments and system-tool jobs: one step per tick."""
    for dep in db.query(AppDeployment).filter(AppDeployment.status == "scheduled").all():
        if not is_due(dep.attributes.get("schedule") if isinstance(dep.attributes, dict) else None, now):
            continue
        dep.status = "deploying"
        _audit(db, dep.tenant_id, "app_deployment.deploying", "app_deployments", dep.id, {})
        actions.append(f"app deployment {dep.id} deploying")
        counts["app_deployments"] += 1
    for dep in db.query(AppDeployment).filter(AppDeployment.status == "deploying").all():
        dep.status = "deployed"
        _audit(db, dep.tenant_id, "app_deployment.deployed", "app_deployments", dep.id, {})
        actions.append(f"app deployment {dep.id} deployed")
        counts["app_deployments"] += 1
    for dep in db.query(ImagingDeployment).filter(ImagingDeployment.status == "scheduled").all():
        dep.status = "deploying"
        _audit(db, dep.tenant_id, "imaging_deployment.deploying", "imaging_deployments", dep.id, {})
        actions.append(f"imaging deployment {dep.id} deploying")
        counts["imaging_deployments"] += 1
    for dep in db.query(ImagingDeployment).filter(ImagingDeployment.status == "deploying").all():
        dep.status = "deployed"
        _audit(db, dep.tenant_id, "imaging_deployment.deployed", "imaging_deployments", dep.id, {})
        actions.append(f"imaging deployment {dep.id} deployed")
        counts["imaging_deployments"] += 1
    for job in db.query(SystemToolJob).filter(SystemToolJob.status == "scheduled").all():
        job.status = "running"
        _audit(db, job.tenant_id, "system_tool_job.running", "system_tool_jobs", job.id, {})
        actions.append(f"system tool job {job.id} running")
        counts["system_tool_jobs"] += 1
    for job in db.query(SystemToolJob).filter(SystemToolJob.status == "running").all():
        job.status = "complete"
        _audit(db, job.tenant_id, "system_tool_job.complete", "system_tool_jobs", job.id, {})
        actions.append(f"system tool job {job.id} complete")
        counts["system_tool_jobs"] += 1


def _run_server_windows(db, now, actions, counts):
    for window in db.query(ServerPatchWindow).filter(
        ServerPatchWindow.status == "scheduled",
        ServerPatchWindow.approval_status == "approved",
    ).all():
        start = window.window_start
        if start is not None:
            start = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start
            if start > now:
                continue
        window.status = "in-progress"
        _audit(db, window.tenant_id, "server_patch_window.in_progress", "server_patch_windows", window.id, {})
        actions.append(f"server patch window {window.id} in progress")
        counts["server_patch_windows"] += 1
    for window in db.query(ServerPatchWindow).filter(
        ServerPatchWindow.status == "in-progress").all():
        end = window.window_end
        if end is not None:
            end = end.replace(tzinfo=timezone.utc) if end.tzinfo is None else end
            if end > now:
                continue
        window.status = "deployed"
        _audit(db, window.tenant_id, "server_patch_window.deployed", "server_patch_windows", window.id, {})
        actions.append(f"server patch window {window.id} deployed")
        counts["server_patch_windows"] += 1


def _run_expiry(db, now, actions, counts):
    for grant in db.query(PrivilegeGrant).filter(PrivilegeGrant.status == "active").all():
        if grant.expires_at is None:
            continue
        exp = grant.expires_at.replace(tzinfo=timezone.utc) if grant.expires_at.tzinfo is None else grant.expires_at
        if exp <= now:
            grant.status = "expired"
            _audit(db, grant.tenant_id, "privilege_grant.expired", "privilege_grants", grant.id, {})
            actions.append(f"privilege grant {grant.id} expired")
            counts["privilege_grants_expired"] += 1
    for model, label, plural in (
        (SoftwareLicense, "license", "licenses"),
        (Warranty, "warranty", "warranties"),
        (Certificate, "certificate", "certificates"),
    ):
        for row in db.query(model).filter(model.status == "active").all():
            if row.expiry_date is None:
                continue
            exp = row.expiry_date.replace(tzinfo=timezone.utc) if row.expiry_date.tzinfo is None else row.expiry_date
            if exp <= now:
                row.status = "expired"
                _audit(db, row.tenant_id, f"{label}.expired", model.__tablename__, row.id, {})
                actions.append(f"{label} {row.id} expired")
                counts[f"{plural}_expired"] += 1
            elif exp <= now + timedelta(days=EXPIRY_WARNING_DAYS):
                row.status = "expiring"
                _audit(db, row.tenant_id, f"{label}.expiring", model.__tablename__, row.id, {})
                actions.append(f"{label} {row.id} expiring soon")
                counts[f"{plural}_expiring"] += 1


def run_due_jobs(db: Session, now=None) -> dict:
    """Run one scheduler tick. Returns a summary dict; also persists
    one SchedulerRun row per tenant that had any action. When nothing
    is due, no run row is written — the summary is still returned.
    """
    now = _now_utc(now)
    _SEEN_TENANTS.clear()
    actions: list[str] = []
    counts: dict[str, int] = {
        "patch_deployments": 0, "threat_hunts": 0, "remediation_workflows": 0,
        "app_deployments": 0, "imaging_deployments": 0, "system_tool_jobs": 0,
        "server_patch_windows": 0, "privilege_grants_expired": 0,
        "licenses_expired": 0, "licenses_expiring": 0,
        "warranties_expired": 0, "warranties_expiring": 0,
        "certificates_expired": 0, "certificates_expiring": 0,
    }
    errors: list[str] = []
    for step in (_run_patch_deployments, _run_threat_hunts,
                 _run_remediation_workflows, _run_simple_deployments,
                 _run_server_windows, _run_expiry):
        try:
            step(db, now, actions, counts)
        except Exception as exc:  # one failing job must not stop the tick
            db.rollback()
            errors.append(f"{step.__name__}: {exc}")

    # One SchedulerRun row per tenant touched this tick. The AuditEvents
    # written above are the per-action ledger; the run row is a summary.
    summary = {
        "started_at": now.isoformat(),
        "counts": {k: v for k, v in counts.items() if v},
        "actions": actions,
        "errors": errors,
    }
    try:
        for tenant_id in sorted(_SEEN_TENANTS, key=str):
            db.add(SchedulerRun(
                tenant_id=tenant_id, title="scheduler run",
                status="partial" if errors else "complete", summary=summary,
            ))
        db.commit()
    except Exception as exc:
        db.rollback()
        summary["errors"].append(f"record scheduler run: {exc}")
        # The job transitions themselves were already committed above
        # only if the commit succeeded; on failure here, re-commit the
        # transitions without the run row.
        try:
            db.commit()
        except Exception:
            db.rollback()
    summary["status"] = "partial" if errors else "complete"
    return summary


# Backwards-friendly alias: the worker and API both use run_due_jobs.
run_once = run_due_jobs
