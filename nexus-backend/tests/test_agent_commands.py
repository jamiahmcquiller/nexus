"""Agent command queue: remote execution + Wake-on-LAN.

Device auth (backend v0.7.0): the agent polls and completes commands
with its per-device credential (X-Device-Token), issued once at
enrollment. Enrollment tokens never authenticate these calls.

Run:  cd nexus-backend && python -m pytest tests/test_agent_commands.py
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
from app.models_extended import AgentCommand
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
        "attributes": {},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    body["enrollment_token"] = token
    return body


def test_command_round_trip(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    # create (owner) -> audit event written
    r = client.post("/api/v1/agent/commands", headers=headers, json={
        "device_id": None, "kind": "shell", "command": "echo hello-nexus"})
    assert r.status_code == 201, r.text
    cmd = r.json()
    assert cmd["status"] == "pending"
    # agent polls and claims it
    r = client.get("/api/v1/agent/commands/next",
                   params={"device_id": "dev-1"}, headers=device_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == cmd["id"]
    # nothing else pending
    r = client.get("/api/v1/agent/commands/next",
                   params={"device_id": "dev-1"}, headers=device_headers)
    assert r.status_code == 204
    # agent reports the result
    r = client.post(f"/api/v1/agent/commands/{cmd['id']}/complete",
                    headers=device_headers,
                    json={"exit_code": 0, "result": "hello-nexus\n"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "succeeded"
    assert r.json()["result"] == "hello-nexus\n"
    # completing again is idempotent
    r = client.post(f"/api/v1/agent/commands/{cmd['id']}/complete",
                    headers=device_headers,
                    json={"exit_code": 1, "result": "different"})
    assert r.status_code == 200
    assert r.json()["status"] == "succeeded"


def test_command_requires_owner_or_admin(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine, role="technician")
    r = client.post("/api/v1/agent/commands", headers=headers, json={
        "kind": "shell", "command": "whoami"})
    assert r.status_code == 403


def test_wol_command_requires_mac(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    r = client.post("/api/v1/agent/commands", headers=headers, json={
        "kind": "wol", "command": "not-a-mac"})
    assert r.status_code == 400


def test_next_with_wrong_device_token_is_403(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    _enroll(client, headers, device_id="dev-1")
    other = _enroll(client, headers, device_id="dev-2")
    client.post("/api/v1/agent/commands", headers=headers, json={
        "kind": "shell", "command": "echo hi"})
    r = client.get("/api/v1/agent/commands/next",
                   params={"device_id": "dev-1"},
                   headers={"X-Device-Token": other["device_token"]})
    assert r.status_code == 403


def test_next_without_device_token_is_401(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    _enroll(client, headers)
    client.post("/api/v1/agent/commands", headers=headers, json={
        "kind": "shell", "command": "echo hi"})
    r = client.get("/api/v1/agent/commands/next", params={"device_id": "dev-1"})
    assert r.status_code == 401


def test_wake_queues_wol_from_inventory_mac(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    client.post("/api/v1/devices/dev-1/inventory", headers=device_headers, json={
        "hardware": {"network": [{"name": "Ethernet", "mac": "AA:BB:CC:DD:EE:FF"}]},
        "os": {}, "software": []})
    # the target device's own id is needed: fetch it from the device list
    devices = client.get("/api/v1/devices/", headers=headers).json()
    target_id = devices[0]["id"]
    r = client.post(f"/api/v1/agent/devices/{target_id}/wake", headers=headers, json={})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "wol"
    assert body["command"] == "AA:BB:CC:DD:EE:FF"
    assert body["target_device_id"] == target_id


def test_wake_without_mac_is_conflict(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine)
    _enroll(client, headers)
    devices = client.get("/api/v1/devices/", headers=headers).json()
    r = client.post(f"/api/v1/agent/devices/{devices[0]['id']}/wake",
                    headers=headers, json={})
    assert r.status_code == 409
