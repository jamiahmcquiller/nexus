"""GRC workspace tests — run against an in-memory SQLite database.

Covers the overview, CRUD, workflow transitions, demo-data seeding /
clearing, and AuditEvent history. The HTTP checks mount only the GRC
router with an overridden DB session and a real JWT, so they need no
Postgres and never import app.main (which connects to the database at
import time).

Run:  cd nexus-backend && python -m pytest tests/test_grc.py
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import models
from app.auth import create_access_token
from app.routers.grc import router as grc_router


@pytest.fixture()
def db_engine():
    # StaticPool + check_same_thread=False: TestClient serves requests
    # on another thread, and it must see the same in-memory database
    # the test wrote the user to. A fresh session is created per
    # request (a Session is not thread-safe to share).
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _make_user(db_engine, role="owner"):
    session = sessionmaker(bind=db_engine)()
    tenant = models.Tenant(id=uuid.uuid4(), name="Test Tenant")
    session.add(tenant)
    session.commit()
    user = models.User(
        id=uuid.uuid4(), tenant_id=tenant.id, username=f"user-{role}",
        hashed_password="<redacted>", role=role,
    )
    session.add(user)
    session.commit()
    out = {"id": user.id, "tenant_id": tenant.id, "username": user.username}
    session.close()
    return out


def _client(db_engine):
    app = FastAPI()
    app.include_router(grc_router)

    def override_get_db():
        session = sessionmaker(bind=db_engine)()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _auth(db_engine, role="owner"):
    user = _make_user(db_engine, role)
    token = create_access_token({"sub": str(user["id"]), "tenant_id": str(user["tenant_id"])})
    return {"Authorization": f"Bearer {token}"}


def test_overview_zero_counts_on_empty_tenant(db_engine):
    res = _client(db_engine).get("/api/v1/grc/overview", headers=_auth(db_engine))
    assert res.status_code == 200
    body = res.json()
    assert body["active_frameworks"] == 0
    assert body["total_controls"] == 0
    assert body["open_findings"] == 0
    assert body["evidence_pending_review"] == 0
    assert body["frameworks"] == []
    assert body["has_demo"] is False
    assert body["legacy_benchmarks"] == {"total": 0, "compliant": 0, "non_compliant": 0}


def test_create_framework_and_control_and_list_them(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    fw = client.post("/api/v1/grc/frameworks/", json={
        "name": "CIS Controls v8", "standard": "CIS v8", "version": "8.0",
        "owner": "GRC Team", "status": "active"}, headers=headers)
    assert fw.status_code == 201
    fw_id = fw.json()["id"]
    assert fw.json()["is_demo"] is False

    ctrl = client.post("/api/v1/grc/controls/", json={
        "framework_id": fw_id, "control_ref": "CIS 1.1",
        "name": "Inventory of enterprise assets", "category": "Asset Management",
        "owner": "GRC Team", "status": "implemented"}, headers=headers)
    assert ctrl.status_code == 201
    assert ctrl.json()["framework_id"] == fw_id

    listed = client.get("/api/v1/grc/controls/", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["control_ref"] == "CIS 1.1"

    overview = client.get("/api/v1/grc/overview", headers=headers).json()
    assert overview["active_frameworks"] == 1
    assert overview["total_controls"] == 1
    assert overview["controls_implemented"] == 1
    assert overview["frameworks"][0]["compliance_pct"] == 100


def test_assessment_start_then_complete(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    fw = client.post("/api/v1/grc/frameworks/", json={
        "name": "ISO 27001", "standard": "ISO 27001", "status": "active"},
        headers=headers).json()
    asm = client.post("/api/v1/grc/assessments/", json={
        "framework_id": fw["id"], "name": "Annual assessment",
        "scope": "ISMS", "assessor": "Auditor", "status": "planned"},
        headers=headers).json()
    assert asm["status"] == "planned"

    started = client.post(f"/api/v1/grc/assessments/{asm['id']}/start", headers=headers)
    assert started.status_code == 200
    assert started.json()["status"] == "in_progress"

    done = client.post(f"/api/v1/grc/assessments/{asm['id']}/complete", headers=headers)
    assert done.status_code == 200
    assert done.json()["status"] == "complete"


def test_evidence_approve_and_finding_remediate(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    ev = client.post("/api/v1/grc/evidence/", json={
        "name": "Firewall export", "evidence_type": "log",
        "uploaded_by": "admin", "status": "pending_review"}, headers=headers).json()
    approved = client.post(f"/api/v1/grc/evidence/{ev['id']}/approve", headers=headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    finding = client.post("/api/v1/grc/findings/", json={
        "name": "Admin accounts not dedicated", "severity": "critical",
        "owner": "IT", "status": "open"}, headers=headers).json()
    remediated = client.post(f"/api/v1/grc/findings/{finding['id']}/remediate", headers=headers)
    assert remediated.status_code == 200
    assert remediated.json()["status"] == "remediated"


def test_risk_score_is_stored_and_visible(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    risk = client.post("/api/v1/grc/risks/", json={
        "name": "Ransomware via unpatched endpoint", "category": "Malware",
        "likelihood": 4, "impact": 5, "owner": "Security", "status": "open"},
        headers=headers).json()
    assert risk["likelihood"] == 4
    assert risk["impact"] == 5
    assert risk["likelihood"] * risk["impact"] == 20

    listed = client.get("/api/v1/grc/risks/", headers=headers).json()
    assert listed[0]["likelihood"] * listed[0]["impact"] == 20
    overview = client.get("/api/v1/grc/overview", headers=headers).json()
    assert overview["open_risks"] == 1


def test_seed_demo_is_idempotent(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    first = client.post("/api/v1/grc/seed-demo", headers=headers)
    assert first.status_code == 200
    assert first.json()["seeded"] is True
    assert first.json()["frameworks"] == 3
    assert first.json()["controls"] == 12
    assert first.json()["findings"] == 5

    frameworks = client.get("/api/v1/grc/frameworks/", headers=headers).json()
    assert len(frameworks) == 3
    assert all(f["is_demo"] is True for f in frameworks)
    assert {f["standard"] for f in frameworks} == {"CIS v8", "NIST CSF 2.0", "ISO 27001"}

    findings = client.get("/api/v1/grc/findings/", headers=headers).json()
    assert any(f["severity"] == "critical" and f["status"] == "open" for f in findings)
    risks = client.get("/api/v1/grc/risks/", headers=headers).json()
    assert any(r["likelihood"] * r["impact"] >= 15 for r in risks)
    evidence = client.get("/api/v1/grc/evidence/", headers=headers).json()
    assert sum(1 for e in evidence if e["status"] == "pending_review") == 2

    overview = client.get("/api/v1/grc/overview", headers=headers).json()
    assert overview["has_demo"] is True
    assert overview["active_frameworks"] == 3
    assert overview["overdue_remediations"] == 1

    second = client.post("/api/v1/grc/seed-demo", headers=headers)
    assert second.status_code == 200
    assert second.json()["seeded"] is False
    assert second.json()["reason"] == "demo data already exists"
    assert len(client.get("/api/v1/grc/frameworks/", headers=headers).json()) == 3


def test_clear_demo_removes_only_demo_rows(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    org = client.post("/api/v1/grc/frameworks/", json={
        "name": "Our SOC 2", "standard": "SOC 2", "status": "active"},
        headers=headers).json()
    assert org["is_demo"] is False
    seeded = client.post("/api/v1/grc/seed-demo", headers=headers)
    assert seeded.json()["seeded"] is True
    assert len(client.get("/api/v1/grc/frameworks/", headers=headers).json()) == 4

    cleared = client.post("/api/v1/grc/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    assert cleared.json()["deleted"]["frameworks"] == 3

    remaining = client.get("/api/v1/grc/frameworks/", headers=headers).json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == org["id"]
    assert client.get("/api/v1/grc/controls/", headers=headers).json() == []
    assert client.get("/api/v1/grc/overview", headers=headers).json()["has_demo"] is False


def test_history_returns_create_and_status_events(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    fw = client.post("/api/v1/grc/frameworks/", json={
        "name": "CIS Controls v8", "standard": "CIS v8", "status": "draft"},
        headers=headers).json()
    changed = client.post(
        f"/api/v1/grc/frameworks/{fw['id']}/status", json={"status": "active"},
        headers=headers)
    assert changed.status_code == 200

    history = client.get(f"/api/v1/grc/frameworks/{fw['id']}/history", headers=headers)
    assert history.status_code == 200
    actions = [h["action"] for h in history.json()]
    assert "grc_framework.created" in actions
    assert "grc_framework.status_changed" in actions
    assert all(h["entity_type"] == "grc_framework" for h in history.json())


@pytest.mark.parametrize("plural", [
    "frameworks", "controls", "assessments", "evidence", "findings",
    "risks", "remediations", "audits", "mappings", "settings",
])
def test_every_grc_resource_has_working_crud(db_engine, plural):
    """Every resource the console calls must list and create."""
    client = _client(db_engine)
    headers = _auth(db_engine)
    created = client.post(f"/api/v1/grc/{plural}/", json={"name": f"test {plural}"}, headers=headers)
    assert created.status_code == 201, plural
    assert created.json()["is_demo"] is False
    listed = client.get(f"/api/v1/grc/{plural}/", headers=headers)
    assert listed.status_code == 200, plural
    assert len(listed.json()) == 1
    stats = client.get(f"/api/v1/grc/{plural}/stats", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["total"] == 1


def test_seed_demo_requires_owner_or_admin(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine, role="technician")
    res = client.post("/api/v1/grc/seed-demo", headers=headers)
    assert res.status_code == 403


def test_workflow_on_missing_row_returns_404(db_engine):
    client = _client(db_engine)
    headers = _auth(db_engine)
    missing = str(uuid.uuid4())
    res = client.post(f"/api/v1/grc/findings/{missing}/remediate", headers=headers)
    assert res.status_code == 404
