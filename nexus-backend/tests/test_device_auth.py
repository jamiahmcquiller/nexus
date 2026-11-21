"""Device auth lifecycle (backend v0.7.0): one-time stored enrollment
tokens, per-device credentials, and delete cleanup.

Run:  cd nexus-backend && python -m pytest tests/test_device_auth.py
"""
import hashlib
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
from app.models_extended import AgentCommand
from app.models import DeviceInventorySnapshot
from app.auth import create_access_token
from app.routers.devices import router as devices_router
from app.routers.agent import router as agent_router


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
    app.include_router(devices_router)
    app.include_router(agent_router)

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


def _issue_token(client, headers, expires_hours=72):
    r = client.post("/api/v1/devices/enrollment-tokens", headers=headers,
                    json={"label": "test", "expires_hours": expires_hours})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _enroll(client, headers, device_id="dev-1", token=None):
    token = token or _issue_token(client, headers)
    r = client.post("/api/v1/devices/enroll", json={
        "enrollment_token": token,
        "hostname": "TEST-PC", "device_id": device_id, "agent_version": "0.3.1",
        "attributes": {},
    })
    return r


def test_issue_token_requires_owner_or_admin(db_engine):
    client = _client(db_engine)
    for role in ("technician", "auditor"):
        headers, _ = _auth(db_engine, role=role)
        r = client.post("/api/v1/devices/enrollment-tokens", headers=headers,
                        json={"label": "test"})
        assert r.status_code == 403, r.text


def test_enrollment_token_is_single_use(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    token = _issue_token(client, headers)
    r = _enroll(client, headers, token=token)
    assert r.status_code == 200, r.text
    assert r.json()["device_token"].startswith("dev-")
    r = _enroll(client, headers, device_id="dev-2", token=token)
    assert r.status_code == 400
    assert "already used" in r.json()["detail"]


def test_enroll_unknown_token_is_400(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    r = _enroll(client, headers, token=f"nexus-{user['tenant_id']}-deadbeef")
    assert r.status_code == 400


def test_enroll_expired_token_is_400(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    token = _issue_token(client, headers, expires_hours=-1)
    r = _enroll(client, headers, token=token)
    assert r.status_code == 400
    assert "expired" in r.json()["detail"]


def test_heartbeat_device_token_flow(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    token = _issue_token(client, headers)
    enrolled = _enroll(client, headers, token=token).json()
    # no credential at all
    r = client.post("/api/v1/devices/heartbeat")
    assert r.status_code == 401
    # the (now spent) enrollment token does not authenticate a heartbeat
    r = client.post("/api/v1/devices/heartbeat",
                    headers={"X-Device-Token": token})
    assert r.status_code == 401
    # the device credential does
    r = client.post("/api/v1/devices/heartbeat",
                    headers={"X-Device-Token": enrolled["device_token"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"


def test_device_credential_stored_as_hash_only(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers).json()
    session = sessionmaker(bind=db_engine)()
    device = session.query(models.Device).filter(
        models.Device.device_id == "dev-1").first()
    assert device is not None
    assert device.device_token_hash is not None
    assert device.device_token_hash != enrolled["device_token"]
    assert device.device_token_hash == hashlib.sha256(
        enrolled["device_token"].encode()).hexdigest()
    session.close()


def test_device_delete_cleans_snapshots_and_commands(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers).json()
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    client.post("/api/v1/devices/dev-1/inventory", headers=device_headers, json={
        "hardware": {}, "os": {}, "software": []})
    devices = client.get("/api/v1/devices/", headers=headers).json()
    device_uuid = devices[0]["id"]
    r = client.post("/api/v1/agent/commands", headers=headers, json={
        "device_id": device_uuid, "kind": "shell", "command": "whoami"})
    assert r.status_code == 201, r.text
    # owner deletes the device
    r = client.delete(f"/api/v1/devices/{device_uuid}", headers=headers)
    assert r.status_code == 200, r.text
    # device, snapshots and queued commands are all gone
    assert client.get("/api/v1/devices/", headers=headers).json() == []
    session = sessionmaker(bind=db_engine)()
    assert session.query(DeviceInventorySnapshot).count() == 0
    assert session.query(AgentCommand).count() == 0
    session.close()
