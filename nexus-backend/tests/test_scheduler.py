"""Scheduler tests — run against an in-memory SQLite database.

These tests exercise run_due_jobs() directly, not the HTTP API, so
they need no Postgres and no running worker. They prove the state
machines in docs/scheduler.md: one transition per tick, no invented
test results, and idempotency (a third tick does nothing).

Run:  cd nexus-backend && poetry run pytest tests/test_scheduler.py
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app import models, models_extended
from app.scheduler import run_due_jobs


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _tenant(db):
    tenant = models.Tenant(id=uuid.uuid4(), name="Test Tenant")
    db.add(tenant)
    db.commit()
    return tenant.id


def test_patch_deployment_advances_one_step_per_tick(db):
    tenant_id = _tenant(db)
    patch = models.Patch(id=uuid.uuid4(), tenant_id=tenant_id, title="KB123", status="approved")
    db.add(patch)
    dep = models_extended.PatchDeployment(
        tenant_id=tenant_id, patch_id=patch.id, title="KB123",
        schedule="now", test_result="pass", status="scheduled",
    )
    db.add(dep)
    db.commit()
    now = datetime.now(timezone.utc)

    run_due_jobs(db, now=now)
    assert db.query(models_extended.PatchDeployment).first().status == "deploying"

    run_due_jobs(db, now=now)
    assert db.query(models_extended.PatchDeployment).first().status == "deployed"
    assert db.query(models.Patch).first().status == "deployed"

    # Third tick: idempotent, nothing left to do.
    summary = run_due_jobs(db, now=now)
    assert summary["actions"] == []


def test_patch_deployment_waits_for_a_passed_test(db):
    tenant_id = _tenant(db)
    dep = models_extended.PatchDeployment(
        tenant_id=tenant_id, title="KB999", schedule="now",
        test_result="pending", status="scheduled",
    )
    db.add(dep)
    db.commit()
    run_due_jobs(db, now=datetime.now(timezone.utc))
    # The scheduler never invents a test result.
    assert db.query(models_extended.PatchDeployment).first().status == "scheduled"


def test_patch_deployment_with_failed_test_fails(db):
    tenant_id = _tenant(db)
    dep = models_extended.PatchDeployment(
        tenant_id=tenant_id, title="KB999", schedule="now",
        test_result="fail", status="scheduled",
    )
    db.add(dep)
    db.commit()
    run_due_jobs(db, now=datetime.now(timezone.utc))
    assert db.query(models_extended.PatchDeployment).first().status == "failed"


def test_unparseable_schedule_is_never_due(db):
    tenant_id = _tenant(db)
    dep = models_extended.PatchDeployment(
        tenant_id=tenant_id, title="KB999", schedule="not-a-date",
        test_result="pass", status="scheduled",
    )
    db.add(dep)
    db.commit()
    run_due_jobs(db, now=datetime.now(timezone.utc))
    assert db.query(models_extended.PatchDeployment).first().status == "scheduled"


def test_threat_hunt_counts_telemetry_in_lookback(db):
    tenant_id = _tenant(db)
    hunt = models_extended.ThreatHunt(
        tenant_id=tenant_id, name="hunt1", lookback_days=30, status="scheduled")
    db.add(hunt)
    db.add(models_extended.EndpointTelemetry(
        tenant_id=tenant_id, title="proc", event_type="process"))
    db.commit()
    now = datetime.now(timezone.utc)

    run_due_jobs(db, now=now)
    assert db.query(models_extended.ThreatHunt).first().status == "running"

    run_due_jobs(db, now=now)
    hunt = db.query(models_extended.ThreatHunt).first()
    assert hunt.status == "complete"
    assert hunt.findings_count == 1


def test_remediation_workflow_resolves_matching_insights(db):
    tenant_id = _tenant(db)
    db.add(models_extended.RemediationWorkflow(
        tenant_id=tenant_id, name="wf1", trigger="cpu", status="active"))
    db.add(models_extended.DexInsight(
        tenant_id=tenant_id, title="High CPU usage", root_cause="cpu spike", status="open"))
    db.add(models_extended.DexInsight(
        tenant_id=tenant_id, title="Disk full", root_cause="disk", status="open"))
    db.commit()
    run_due_jobs(db, now=datetime.now(timezone.utc))
    insights = {i.title: i.status for i in db.query(models_extended.DexInsight).all()}
    assert insights["High CPU usage"] == "resolved"
    assert insights["Disk full"] == "open"


def test_expired_privilege_grant_expires(db):
    tenant_id = _tenant(db)
    db.add(models_extended.PrivilegeGrant(
        tenant_id=tenant_id, title="jit", privilege_type="just-in-time",
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1), status="active"))
    db.commit()
    run_due_jobs(db, now=datetime.now(timezone.utc))
    assert db.query(models_extended.PrivilegeGrant).first().status == "expired"
