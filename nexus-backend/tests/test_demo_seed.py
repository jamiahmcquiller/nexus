"""Demo-data seed tests — run against an in-memory SQLite database.

Covers idempotent seeding, clear-demo deleting only demo rows, the
owner/admin role gate, and the real enrolled Mac surviving seed +
clear-demo untouched. Mounts only the demo router plus the list
routers used to verify counts, with an overridden DB session and a
real JWT — no Postgres, never imports app.main (which connects to
the database at import time).

Run:  cd nexus-backend && python -m pytest tests/test_demo_seed.py
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import models
from app.auth import create_access_token
from app.routers.demo import router as demo_router, PROTECTED_DEVICE_ID
from app.routers.devices import router as devices_router
from app.routers.patches import router as patches_router
from app.routers.vulnerabilities import router as vulns_router
from app.routers.edr import router as edr_router
from app.routers.malware import router as malware_router
from app.routers.dlp import router as dlp_router
from app.routers.policies import router as policies_router
from app.routers.servers import router as servers_router
from app.routers.grc import router as grc_router

EXPECTED = {
    "devices": 60,
    "servers": 8,
    "patches": 120,
    "patch_deployments": 30,
    "vulnerabilities": 40,
    "incidents": 12,
    "malware_detections": 20,
    "dlp_findings": 15,
    "policies": 10,
}


import pytest


@pytest.fixture()
def db_engine():
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
    for r in (demo_router, devices_router, patches_router, vulns_router,
              edr_router, malware_router, dlp_router, policies_router,
              servers_router, grc_router):
        app.include_router(r)

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
    return {"Authorization": f"Bearer {token}"}, user


def _db(db_engine):
    return sessionmaker(bind=db_engine)()


def test_seed_twice_yields_identical_counts(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    first = client.post("/api/v1/demo/seed", headers=headers)
    assert first.status_code == 200
    body = first.json()
    assert body["seeded"] is True
    assert body["counts"] == EXPECTED
    assert body["label"] == "Sample data — not live telemetry"

    devices = client.get("/api/v1/devices/", headers=headers).json()
    assert len(devices) == 60
    # DeviceOut exposes is_demo + created_at top-level (added so the
    # home screens' Sample-data pill can read them off device rows);
    # the flag is also mirrored in attributes.
    assert all(d["is_demo"] is True for d in devices)
    assert all(d["created_at"] for d in devices)
    assert all(d["attributes"]["is_demo"] is True for d in devices)
    assert {d["attributes"]["department"] for d in devices} == {
        "Finance", "Engineering", "HR", "Operations", "Security"}
    assert {d["attributes"]["device_group"] for d in devices} == {
        "HQ-Desktops", "Remote-Laptops", "Lab-Workstations", "Exec-Devices"}
    assert all(d["hostname"].startswith(("WS-", "MB-", "LT-")) for d in devices)

    patches = client.get("/api/v1/patches/", headers=headers).json()
    assert len(patches) == 120
    assert all(p["is_demo"] is True for p in patches)
    assert {p["status"] for p in patches} >= {"available", "deployed", "failed"}

    vulns = client.get("/api/v1/vulnerabilities/", headers=headers).json()
    assert len(vulns) == 40
    assert all(v["is_demo"] is True for v in vulns)
    assert all(v["cve_id"].startswith("CVE-") for v in vulns)
    assert any(v["cve_id"] == "CVE-2021-44228" and v["cvss_score"] == "10.0" for v in vulns)
    assert any(v["cve_id"] == "CVE-2021-34527" and v["cvss_score"] == "8.8" for v in vulns)
    assert any(v["cve_id"] == "CVE-2023-23397" and v["cvss_score"] == "9.8" for v in vulns)
    assert {v["severity"] for v in vulns} >= {"critical", "high", "medium"}

    assert len(client.get("/api/v1/edr/incidents/", headers=headers).json()) == 12
    assert len(client.get("/api/v1/malware/detections/", headers=headers).json()) == 20
    assert len(client.get("/api/v1/dlp/findings/", headers=headers).json()) == 15
    assert client.get("/api/v1/policies/stats", headers=headers).json()["total"] == 10
    assert client.get("/api/v1/servers/stats", headers=headers).json()["total"] == 8
    assert client.get("/api/v1/patches/stats", headers=headers).json()["total"] == 120
    assert client.get("/api/v1/vulnerabilities/stats", headers=headers).json()["total"] == 40

    second = client.post("/api/v1/demo/seed", headers=headers)
    assert second.status_code == 200
    assert second.json()["seeded"] is False
    assert second.json()["reason"] == "demo data already exists"
    assert second.json()["counts"] == EXPECTED
    assert len(client.get("/api/v1/devices/", headers=headers).json()) == 60
    assert len(client.get("/api/v1/patches/", headers=headers).json()) == 120


def test_clear_demo_removes_only_demo_rows(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    session = _db(db_engine)
    real_device = models.Device(
        tenant_id=user["tenant_id"], hostname="REAL-PC-01",
        device_id="real-pc-01", enrollment_status="enrolled")
    real_patch = models.Patch(
        tenant_id=user["tenant_id"], title="Real patch",
        status="available", product="Windows")
    session.add(real_device)
    session.add(real_patch)
    session.commit()
    session.close()

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.json()["seeded"] is True
    assert len(client.get("/api/v1/devices/", headers=headers).json()) == 61

    # GRC demo rows have their own clear-demo and must survive this one.
    grc = client.post("/api/v1/grc/seed-demo", headers=headers)
    assert grc.json()["seeded"] is True
    assert len(client.get("/api/v1/grc/frameworks/", headers=headers).json()) == 3

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    assert cleared.json()["deleted"] == EXPECTED

    devices = client.get("/api/v1/devices/", headers=headers).json()
    assert len(devices) == 1
    assert devices[0]["device_id"] == "real-pc-01"
    assert devices[0]["is_demo"] is False
    assert devices[0]["attributes"].get("is_demo") is not True
    patches = client.get("/api/v1/patches/", headers=headers).json()
    assert len(patches) == 1
    assert patches[0]["title"] == "Real patch"
    assert patches[0]["is_demo"] is False
    assert client.get("/api/v1/vulnerabilities/", headers=headers).json() == []
    assert client.get("/api/v1/edr/incidents/", headers=headers).json() == []
    assert client.get("/api/v1/policies/stats", headers=headers).json()["total"] == 0
    # GRC demo untouched.
    assert len(client.get("/api/v1/grc/frameworks/", headers=headers).json()) == 3

    # Re-seeding after a clear works.
    again = client.post("/api/v1/demo/seed", headers=headers)
    assert again.json()["seeded"] is True
    assert again.json()["counts"] == EXPECTED


def test_seed_and_clear_require_owner_or_admin(db_engine):
    client = _client(db_engine)
    for role in ("technician", "auditor"):
        headers, _ = _auth(db_engine, role=role)
        assert client.post("/api/v1/demo/seed", headers=headers).status_code == 403
        assert client.post("/api/v1/demo/clear-demo", headers=headers).status_code == 403
    # Admin (not just owner) may seed.
    headers, _ = _auth(db_engine, role="admin")
    assert client.post("/api/v1/demo/seed", headers=headers).status_code == 200


def test_real_mac_survives_seed_and_clear_demo(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    session = _db(db_engine)
    mac = models.Device(
        tenant_id=user["tenant_id"], hostname="Jamiahs-MacBook-Air-2.local",
        device_id=PROTECTED_DEVICE_ID, enrollment_status="enrolled",
        agent_version="0.3.1")
    session.add(mac)
    session.commit()
    session.close()

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.json()["seeded"] is True
    assert seeded.json()["counts"]["devices"] == 60

    session = _db(db_engine)
    mac_after_seed = session.query(models.Device).filter(
        models.Device.device_id == PROTECTED_DEVICE_ID).one()
    assert mac_after_seed.hostname == "Jamiahs-MacBook-Air-2.local"
    assert mac_after_seed.enrollment_status == "enrolled"
    assert mac_after_seed.agent_version == "0.3.1"
    assert mac_after_seed.is_demo is False
    assert session.query(models.Device).filter(
        models.Device.tenant_id == user["tenant_id"],
        models.Device.device_id == PROTECTED_DEVICE_ID).count() == 1
    session.close()

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.json()["deleted"]["devices"] == 60

    session = _db(db_engine)
    mac_after_clear = session.query(models.Device).filter(
        models.Device.device_id == PROTECTED_DEVICE_ID).one()
    assert mac_after_clear.hostname == "Jamiahs-MacBook-Air-2.local"
    assert mac_after_clear.is_demo is False
    session.close()
