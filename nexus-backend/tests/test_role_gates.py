"""Role gates on module writes and workflow actions (backend v0.7.0).

Policy (docs/security.md): reads are open to any authenticated role;
create / update / status are owner, admin, technician (auditor is
read-only); delete and the destructive workflow actions (deploy, wipe,
lock, ransomware recover, privilege-grant revoke) are owner/admin only.

Run:  cd nexus-backend && python -m pytest tests/test_role_gates.py
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
from app.routers.devices import router as devices_router
from app.routers.patches import router as patches_router
from app.routers.patching import router as patching_router
from app.routers.mdm import router as mdm_router
from app.routers.grc import router as grc_router


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


def _users(db_engine):
    """One tenant, one user per role. Returns {role: (headers, user)}."""
    session = sessionmaker(bind=db_engine)()
    tenant = models.Tenant(id=uuid.uuid4(), name="Test Tenant")
    session.add(tenant)
    session.commit()
    out = {}
    for role in ("owner", "admin", "technician", "auditor"):
        user = models.User(
            id=uuid.uuid4(), tenant_id=tenant.id, username=f"user-{role}",
            hashed_password="<redacted>", role=role,
        )
        session.add(user)
        session.commit()
        token = create_access_token({"sub": str(user.id), "tenant_id": str(tenant.id)})
        out[role] = ({"Authorization": f"Bearer {token}"},
                     {"id": user.id, "tenant_id": tenant.id})
    session.close()
    return out


def _client(db_engine):
    app = FastAPI()
    app.include_router(devices_router)
    app.include_router(patches_router)
    app.include_router(patching_router)
    app.include_router(mdm_router)
    app.include_router(grc_router)

    def override_get_db():
        session = sessionmaker(bind=db_engine)()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _create_patch(client, headers, title="KB5001"):
    r = client.post("/api/v1/patches/", headers=headers, json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()


def test_auditor_cannot_create_technician_can(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    r = client.post("/api/v1/patches/", headers=users["auditor"][0],
                    json={"title": "KB5001"})
    assert r.status_code == 403
    r = client.post("/api/v1/patches/", headers=users["technician"][0],
                    json={"title": "KB5001"})
    assert r.status_code == 201, r.text


def test_delete_is_owner_admin_only(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    patch = _create_patch(client, users["technician"][0])
    r = client.delete(f"/api/v1/patches/{patch['id']}", headers=users["technician"][0])
    assert r.status_code == 403
    r = client.delete(f"/api/v1/patches/{patch['id']}", headers=users["owner"][0])
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/patches/{patch['id']}", headers=users["owner"][0])
    assert r.status_code == 404


def test_status_change_excludes_auditor(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    patch = _create_patch(client, users["owner"][0])
    r = client.post(f"/api/v1/patches/{patch['id']}/status",
                    headers=users["auditor"][0], json={"status": "approved"})
    assert r.status_code == 403
    r = client.post(f"/api/v1/patches/{patch['id']}/status",
                    headers=users["technician"][0], json={"status": "approved"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


def test_patch_deploy_is_owner_admin_only(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    patch = _create_patch(client, users["owner"][0])
    r = client.post(f"/api/v1/patches/{patch['id']}/deploy",
                    headers=users["technician"][0], json={})
    assert r.status_code == 403
    r = client.post(f"/api/v1/patches/{patch['id']}/deploy",
                    headers=users["owner"][0], json={})
    assert r.status_code == 200, r.text
    assert r.json()["patch"]["status"] == "deployed"


def test_mdm_wipe_is_owner_admin_only(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    r = client.post("/api/v1/mdm/devices/", headers=users["technician"][0],
                    json={"title": "iPhone 15"})
    assert r.status_code == 201, r.text
    device = r.json()
    r = client.post(f"/api/v1/mdm/devices/{device['id']}/wipe",
                    headers=users["technician"][0])
    assert r.status_code == 403
    r = client.post(f"/api/v1/mdm/devices/{device['id']}/wipe",
                    headers=users["admin"][0])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "wiped"


def test_grc_transition_excludes_auditor(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    r = client.post("/api/v1/grc/frameworks/", headers=users["owner"][0],
                    json={"title": "CIS v8"})
    assert r.status_code == 201, r.text
    framework = r.json()
    r = client.post(f"/api/v1/grc/frameworks/{framework['id']}/activate",
                    headers=users["auditor"][0])
    assert r.status_code == 403
    r = client.post(f"/api/v1/grc/frameworks/{framework['id']}/activate",
                    headers=users["technician"][0])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"


def test_device_manual_create_and_status(db_engine):
    client = _client(db_engine)
    users = _users(db_engine)
    r = client.post("/api/v1/devices/", headers=users["technician"][0],
                    json={"title": "LAB-PC"})
    assert r.status_code == 201, r.text
    device = r.json()
    assert device["device_id"].startswith("manual-")
    assert device["hostname"] == "LAB-PC"
    r = client.post(f"/api/v1/devices/{device['id']}/status",
                    headers=users["technician"][0], json={"status": "bogus"})
    assert r.status_code == 400
    r = client.post(f"/api/v1/devices/{device['id']}/status",
                    headers=users["technician"][0], json={"status": "suspended"})
    assert r.status_code == 200, r.text
    assert r.json()["enrollment_status"] == "suspended"
