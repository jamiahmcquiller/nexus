"""Device inventory endpoints — enroll + inventory upload + latest snapshot.

Device auth (backend v0.7.0): enrollment tokens are one-time stored
tokens issued by an owner/admin. Enrolling spends the token and issues
the device its own long-lived credential, returned once. Heartbeat,
inventory upload and command polling authenticate with that device
credential in the X-Device-Token header — an enrollment token never
authenticates those calls.

Run:  cd nexus-backend && python -m pytest tests/test_devices_inventory.py
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


def _issue_token(client, headers):
    r = client.post("/api/v1/devices/enrollment-tokens", headers=headers,
                    json={"label": "test"})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _enroll(client, headers, device_id="dev-1"):
    token = _issue_token(client, headers)
    r = client.post("/api/v1/devices/enroll", json={
        "enrollment_token": token,
        "hostname": "TEST-PC", "device_id": device_id, "agent_version": "0.3.1",
        "attributes": {"os": "Windows 11"},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    body["enrollment_token"] = token
    return body


def test_enroll_then_inventory_then_latest(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    r = client.post("/api/v1/devices/dev-1/inventory", headers=device_headers, json={
        "hardware": {"cpu": {"count": 8}, "network": [{"name": "Ethernet", "mac": "AA:BB:CC:DD:EE:FF"}]},
        "os": {"platform": "windows", "name": "Windows 11"},
        "software": [{"name": "Chrome", "version": "120"}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["os"]["name"] == "Windows 11"
    assert body["software"][0]["name"] == "Chrome"
    assert body["hardware"]["network"][0]["mac"] == "AA:BB:CC:DD:EE:FF"


def test_inventory_without_device_token_is_401(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    _enroll(client, headers)
    r = client.post("/api/v1/devices/dev-1/inventory", json={
        "hardware": {}, "os": {}, "software": [],
    })
    assert r.status_code == 401


def test_inventory_enrollment_token_does_not_authenticate(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    r = client.post("/api/v1/devices/dev-1/inventory",
                    headers={"X-Device-Token": enrolled["enrollment_token"]},
                    json={"hardware": {}, "os": {}, "software": []})
    assert r.status_code == 401


def test_inventory_wrong_device_token_is_403(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    _enroll(client, headers, device_id="dev-1")
    other = _enroll(client, headers, device_id="dev-2")
    r = client.post("/api/v1/devices/dev-1/inventory",
                    headers={"X-Device-Token": other["device_token"]},
                    json={"hardware": {}, "os": {}, "software": []})
    assert r.status_code == 403


def test_inventory_unknown_device_path_is_403(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    r = client.post("/api/v1/devices/nope/inventory",
                    headers={"X-Device-Token": enrolled["device_token"]},
                    json={"hardware": {}, "os": {}, "software": []})
    assert r.status_code == 403


def test_latest_without_snapshot_is_404(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    _enroll(client, headers)
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.status_code == 404


def test_latest_cross_tenant_is_404(db_engine):
    client = _client(db_engine)
    headers_a, user_a = _auth(db_engine)
    enrolled = _enroll(client, headers_a)
    client.post("/api/v1/devices/dev-1/inventory",
                headers={"X-Device-Token": enrolled["device_token"]},
                json={"hardware": {}, "os": {}, "software": []})
    headers_b, _ = _auth(db_engine, role="owner")
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers_b)
    assert r.status_code == 404
