"""Vulnerability-driven remediation configurations.

Run:  cd nexus-backend && python -m pytest tests/test_remediation_configs.py
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
from app.routers.agent import router as agent_router
from app.routers.vulnerabilities import router as vulnerabilities_router
from app.routers.remediation_configs import router as remediation_router

SCRIPT = "defaults write com.apple.Safari AutoOpenSafeDownloads -bool false\n"


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
    app.include_router(vulnerabilities_router)
    app.include_router(remediation_router)

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


def _enroll(client, headers, device_id="dev-1"):
    r = client.post("/api/v1/devices/enrollment-tokens", headers=headers, json={"label": "test"})
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    r = client.post("/api/v1/devices/enroll", json={
        "enrollment_token": token,
        "hostname": "TEST-PC", "device_id": device_id, "agent_version": "0.3.1",
        "attributes": {},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    body["enrollment_token"] = token
    return body


def _make_config(client, headers, **overrides):
    payload = {
        "name": "Disable Safari auto-open",
        "description": "Stops Safari auto-opening safe downloads (CVE-2024-23222 mitigation).",
        "content": SCRIPT,
        "kind": "shell",
        "cve_id": "CVE-2024-23222",
    }
    payload.update(overrides)
    r = client.post("/api/v1/remediation-configurations/", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _make_vuln(client, headers, device_uuid=None):
    payload = {"title": "Safari WebKit flaw", "cve_id": "CVE-2024-23222",
               "severity": "high", "status": "open"}
    if device_uuid:
        payload["device_id"] = device_uuid
    r = client.post("/api/v1/vulnerabilities/", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _auth_in_tenant(db_engine, tenant_id, role):
    """A second user in an EXISTING tenant (role gates are per-tenant)."""
    session = sessionmaker(bind=db_engine)()
    user = models.User(
        id=uuid.uuid4(), tenant_id=tenant_id, username=f"user-{role}-b",
        hashed_password="<redacted>", role=role,
    )
    session.add(user)
    session.commit()
    token = create_access_token({"sub": str(user.id), "tenant_id": str(tenant_id)})
    session.close()
    return {"Authorization": f"Bearer {token}"}


def test_config_crud_and_role_gates(db_engine):
    client = _client(db_engine)
    headers, owner = _auth(db_engine, role="owner")
    tenant_id = owner["tenant_id"]
    tech_headers = _auth_in_tenant(db_engine, tenant_id, "technician")
    auditor_headers = _auth_in_tenant(db_engine, tenant_id, "auditor")

    # owner creates; technician may create too (standard write tier)
    cfg = _make_config(client, headers)
    assert cfg["name"] == "Disable Safari auto-open"
    assert cfg["content"] == SCRIPT
    assert cfg["cve_id"] == "CVE-2024-23222"
    assert cfg["status"] == "active"
    r = client.post("/api/v1/remediation-configurations/", headers=tech_headers,
                    json={"name": "Tech config", "content": "echo hi"})
    assert r.status_code == 201, r.text
    # auditor is read-only
    r = client.post("/api/v1/remediation-configurations/", headers=auditor_headers,
                    json={"name": "Nope", "content": "echo hi"})
    assert r.status_code == 403
    # list (any role) shows both configs for this tenant
    r = client.get("/api/v1/remediation-configurations/", headers=auditor_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2
    # update content
    r = client.patch(f"/api/v1/remediation-configurations/{cfg['id']}", headers=headers,
                     json={"content": "echo updated\n"})
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "echo updated\n"
    # technician may not delete; owner may
    r = client.delete(f"/api/v1/remediation-configurations/{cfg['id']}", headers=tech_headers)
    assert r.status_code == 403
    r = client.delete(f"/api/v1/remediation-configurations/{cfg['id']}", headers=headers)
    assert r.status_code == 200, r.text
    r = client.get("/api/v1/remediation-configurations/", headers=headers)
    assert len(r.json()) == 1


def test_send_flow_links_config_vuln_device_command(db_engine):
    client = _client(db_engine)
    headers, user = _auth(db_engine, role="owner")
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    devices = client.get("/api/v1/devices/", headers=headers).json()
    device_uuid = devices[0]["id"]

    vuln = _make_vuln(client, headers, device_uuid=device_uuid)
    cfg = _make_config(client, headers, vulnerability_id=vuln["id"])

    r = client.post(f"/api/v1/remediation-configurations/{cfg['id']}/send",
                    headers=headers,
                    json={"vulnerability_id": vuln["id"], "device_id": device_uuid})
    assert r.status_code == 201, r.text
    body = r.json()
    send, cmd = body["send"], body["command"]
    # the exact script is queued verbatim as the command
    assert cmd["command"] == SCRIPT.strip()
    assert cmd["kind"] == "shell"
    assert cmd["device_id"] == device_uuid
    assert cmd["status"] == "pending"
    # linkage on the command record itself
    assert cmd["attributes"]["remediation_configuration_id"] == cfg["id"]
    assert cmd["attributes"]["vulnerability_id"] == vuln["id"]
    # the send record links all four
    assert send["configuration_id"] == cfg["id"]
    assert send["vulnerability_id"] == vuln["id"]
    assert send["device_id"] == device_uuid
    assert send["command_id"] == cmd["id"]
    # audit event written on send
    session = sessionmaker(bind=db_engine)()
    events = session.query(models.AuditEvent).filter(
        models.AuditEvent.action == "remediation_configuration.sent").all()
    assert len(events) == 1
    assert events[0].event_metadata["command_id"] == cmd["id"]
    session.close()
    # send history is filterable by vulnerability and by device
    r = client.get("/api/v1/remediation-configurations/sends",
                   params={"vulnerability_id": vuln["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
    r = client.get("/api/v1/remediation-configurations/sends",
                   params={"device_id": device_uuid}, headers=headers)
    assert len(r.json()) == 1
    r = client.get(f"/api/v1/remediation-configurations/{cfg['id']}/sends", headers=headers)
    assert len(r.json()) == 1
    # the vuln itself is NOT auto-remediated by sending
    r = client.get(f"/api/v1/vulnerabilities/{vuln['id']}", headers=headers)
    assert r.json()["status"] == "open"


def test_send_result_visible_on_linked_command(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine, role="owner")
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    device_uuid = client.get("/api/v1/devices/", headers=headers).json()[0]["id"]
    vuln = _make_vuln(client, headers, device_uuid=device_uuid)
    cfg = _make_config(client, headers)
    r = client.post(f"/api/v1/remediation-configurations/{cfg['id']}/send",
                    headers=headers,
                    json={"vulnerability_id": vuln["id"], "device_id": device_uuid})
    cmd_id = r.json()["command"]["id"]
    # agent claims and completes it with a failure
    r = client.get("/api/v1/agent/commands/next", params={"device_id": "dev-1"},
                   headers=device_headers)
    assert r.json()["id"] == cmd_id
    r = client.post(f"/api/v1/agent/commands/{cmd_id}/complete", headers=device_headers,
                    json={"exit_code": 1, "result": "defaults: command not found\n"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "failed"
    assert r.json()["exit_code"] == 1
    # the send record still points at that command, so the console can
    # show the failure next to the vulnerability and the endpoint
    r = client.get("/api/v1/remediation-configurations/sends",
                   params={"vulnerability_id": vuln["id"]}, headers=headers)
    assert r.json()[0]["command_id"] == cmd_id
    r = client.get(f"/api/v1/agent/commands/{cmd_id}", headers=headers)
    assert r.json()["result"] == "defaults: command not found\n"


def test_send_rejects_vulnerability_linked_to_another_device(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine, role="owner")
    _enroll(client, headers, device_id="dev-1")
    _enroll(client, headers, device_id="dev-2")
    devices = {d["device_id"]: d["id"] for d in client.get("/api/v1/devices/", headers=headers).json()}
    vuln = _make_vuln(client, headers, device_uuid=devices["dev-1"])
    cfg = _make_config(client, headers)
    r = client.post(f"/api/v1/remediation-configurations/{cfg['id']}/send",
                    headers=headers,
                    json={"vulnerability_id": vuln["id"], "device_id": devices["dev-2"]})
    assert r.status_code == 400, r.text


def test_send_requires_owner_or_admin(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine, role="owner")
    tech_headers, _ = _auth(db_engine, role="technician")
    _enroll(client, headers)
    device_uuid = client.get("/api/v1/devices/", headers=headers).json()[0]["id"]
    vuln = _make_vuln(client, headers, device_uuid=device_uuid)
    cfg = _make_config(client, headers)
    r = client.post(f"/api/v1/remediation-configurations/{cfg['id']}/send",
                    headers=tech_headers,
                    json={"vulnerability_id": vuln["id"], "device_id": device_uuid})
    assert r.status_code == 403


def test_send_rejects_empty_content(db_engine):
    client = _client(db_engine)
    headers, _ = _auth(db_engine, role="owner")
    _enroll(client, headers)
    device_uuid = client.get("/api/v1/devices/", headers=headers).json()[0]["id"]
    vuln = _make_vuln(client, headers, device_uuid=device_uuid)
    cfg = _make_config(client, headers, content="   ")
    r = client.post(f"/api/v1/remediation-configurations/{cfg['id']}/send",
                    headers=headers,
                    json={"vulnerability_id": vuln["id"], "device_id": device_uuid})
    assert r.status_code == 400, r.text
