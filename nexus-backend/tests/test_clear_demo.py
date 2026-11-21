"""Clear-demo FK tests — in-memory SQLite WITH FK enforcement ON.

The default harness in tests/test_demo_seed.py does NOT enforce FKs
(SQLite defaults to PRAGMA foreign_keys=OFF), which is why Bug 1
shipped: clear-demo 500s on the live FK-enforcing Postgres while every
existing test passed. This file turns FK enforcement on per connection
(required with StaticPool, where one connection is shared) and proves
seed -> clear works on an FK-enforcing database — including the exact
live failure, a child row whose is_demo flag is stale (False or NULL)
still referencing a demo device.

Run:  cd nexus-backend && python -m pytest tests/test_clear_demo.py
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://")

from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import models
from app.models import ComplianceResult, DeviceInventorySnapshot, SecurityAlert
from app.models_extended import (
    AgentCommand, IncidentResponse, MalwareDetection,
    RemediationConfiguration, RemediationConfigurationSend,
)
from app.auth import create_access_token
from app.routers.demo import (
    router as demo_router, DEMO_MODELS, PROTECTED_DEVICE_ID,
)
from app.routers.devices import router as devices_router

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

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        # SQLite FK enforcement is per connection and defaults to OFF;
        # without this the deletes below can never fail, and neither
        # can this file catch a regression of Bug 1.
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    # Prove the pragma actually took on this connection before any
    # test trusts it.
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").fetchone()[0] == 1
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
    app.include_router(demo_router)
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


def _db(db_engine):
    return sessionmaker(bind=db_engine)()


def _demo_device_ids(session, tenant_id):
    return [row.id for row in session.query(models.Device.id).filter(
        models.Device.tenant_id == tenant_id,
        models.Device.is_demo.is_(True)).all()]


def _row_snapshot(session, device):
    """Every column value of a Device row, for byte-identical checks."""
    return {col.name: getattr(device, col.name)
            for col in models.Device.__table__.columns}


def test_clear_demo_succeeds_with_fk_enforcement(db_engine):
    """(a) seed -> clear on an FK-enforcing DB, zero demo rows left."""
    client = _client(db_engine)
    headers, user = _auth(db_engine)

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.status_code == 200
    assert seeded.json()["seeded"] is True
    assert seeded.json()["counts"] == EXPECTED

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    assert cleared.json()["deleted"] == EXPECTED

    session = _db(db_engine)
    try:
        for _name, model in DEMO_MODELS:
            assert session.query(model).filter(
                model.tenant_id == user["tenant_id"],
                model.is_demo.is_(True)).count() == 0, model.__tablename__
        # No demo device survives for a child row to reference.
        assert session.query(models.Device).filter(
            models.Device.tenant_id == user["tenant_id"],
            models.Device.is_demo.is_(True)).count() == 0
        # And no rows in the flag-less tables reference demo devices
        # (none were created here; the membership-scoped tables are
        # exercised in test_demo_linked_rows_in_other_tables_are_removed).
        assert session.query(DeviceInventorySnapshot).count() == 0
        assert session.query(SecurityAlert).count() == 0
        assert session.query(ComplianceResult).count() == 0
        assert session.query(AgentCommand).count() == 0
        assert session.query(RemediationConfigurationSend).count() == 0
    finally:
        session.close()


def test_unflagged_vulnerability_blocking_demo_device_is_removed(db_engine):
    """(b) The exact live FK: a vulnerability referencing a demo device
    whose is_demo flag is stale (False) or NULL.

    Live Postgres raised IntegrityError / ForeignKeyViolation on
    DELETE FROM devices (vulnerabilities_device_id_fkey) because the
    old clear-demo only deleted rows whose own is_demo flag is True,
    so these rows were never in the delete set and the device delete
    tripped the FK. Clear-demo must delete device-referencing rows by
    demo-device membership, whatever their own flag says.
    """
    client = _client(db_engine)
    headers, user = _auth(db_engine)

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.json()["seeded"] is True

    session = _db(db_engine)
    demo_ids = _demo_device_ids(session, user["tenant_id"])
    assert len(demo_ids) == 60
    # Stale-flag rows, as the live DB holds them: seeded before the
    # flag existed, or backfilled with DEFAULT FALSE.
    session.add(models.Vulnerability(
        tenant_id=user["tenant_id"], cve_id="CVE-2021-44228",
        title="stale-flag vuln", severity="critical", cvss_score="10.0",
        status="open", device_id=demo_ids[0], is_demo=False))
    session.add(models.Vulnerability(
        tenant_id=user["tenant_id"], cve_id="CVE-2020-1472",
        title="null-flag vuln", severity="critical", cvss_score="10.0",
        status="open", device_id=demo_ids[1], is_demo=None))
    # The same staleness in the other device-referencing demo tables.
    session.add(IncidentResponse(
        tenant_id=user["tenant_id"], device_id=demo_ids[2],
        title="stale-flag incident", action="isolate", status="pending",
        is_demo=False))
    session.add(MalwareDetection(
        tenant_id=user["tenant_id"], device_id=demo_ids[3],
        title="stale-flag malware", name="Stale", status="detected",
        is_demo=None))
    session.commit()
    session.close()

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    # The stale rows are counted under their own model's key.
    assert cleared.json()["deleted"]["vulnerabilities"] == 42
    assert cleared.json()["deleted"]["incidents"] == 13
    assert cleared.json()["deleted"]["malware_detections"] == 21
    assert cleared.json()["deleted"]["devices"] == 60

    session = _db(db_engine)
    try:
        assert session.query(models.Vulnerability).filter(
            models.Vulnerability.tenant_id == user["tenant_id"]).count() == 0
        assert session.query(IncidentResponse).filter(
            IncidentResponse.tenant_id == user["tenant_id"]).count() == 0
        assert session.query(MalwareDetection).filter(
            MalwareDetection.tenant_id == user["tenant_id"]).count() == 0
        assert session.query(models.Device).filter(
            models.Device.tenant_id == user["tenant_id"]).count() == 0
    finally:
        session.close()


def test_real_mac_survives_seed_and_clear_byte_identical(db_engine):
    """(c) The real Mac survives seed + clear byte-identically, and so
    do the rows that reference it — clear-demo deletes by demo-device
    membership, and the Mac is never in that set."""
    client = _client(db_engine)
    headers, user = _auth(db_engine)

    mac_checkin = datetime(2026, 11, 21, 9, 11, 46)
    mac_attrs = {"os": {"platform": "darwin", "name": "macOS", "version": "15 Sequoia"},
                 "department": "Security"}
    session = _db(db_engine)
    mac = models.Device(
        tenant_id=user["tenant_id"], hostname="Jamiahs-MacBook-Air-2.local",
        device_id=PROTECTED_DEVICE_ID, enrollment_status="enrolled",
        agent_version="0.3.1", last_checkin_at=mac_checkin,
        device_token_hash="sha256:mac-token-hash",
        attributes=mac_attrs)
    lookalike = models.Device(
        tenant_id=user["tenant_id"], hostname="DEMO-LOOKALIKE",
        device_id="demo-not-a-demo-row", enrollment_status="enrolled",
        is_demo=False)
    session.add(mac)
    session.add(lookalike)
    session.commit()
    mac_id = mac.id
    # Rows that reference the Mac — these must never be touched, even
    # though their tables are swept for demo-device references.
    session.add(DeviceInventorySnapshot(
        tenant_id=user["tenant_id"], device_id=mac_id,
        hardware={"model": "MacBook Air"}, os={"name": "macOS"},
        software=[{"name": "Safari", "version": "18.0"}]))
    session.add(SecurityAlert(
        tenant_id=user["tenant_id"], device_id=mac_id,
        title="Real alert on the Mac", severity="high", category="edr"))
    session.add(ComplianceResult(
        tenant_id=user["tenant_id"], device_id=mac_id,
        benchmark="CIS", score="92", status="compliant"))
    session.add(AgentCommand(
        tenant_id=user["tenant_id"], device_id=mac_id,
        command="echo mac-command", status="succeeded"))
    session.commit()
    before = _row_snapshot(session, session.query(models.Device).filter(
        models.Device.id == mac_id).one())
    session.close()

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.json()["seeded"] is True
    assert seeded.json()["counts"]["devices"] == 60

    session = _db(db_engine)
    try:
        assert _row_snapshot(session, session.query(models.Device).filter(
            models.Device.id == mac_id).one()) == before
    finally:
        session.close()

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["deleted"]["devices"] == 60

    session = _db(db_engine)
    try:
        after = _row_snapshot(session, session.query(models.Device).filter(
            models.Device.id == mac_id).one())
        assert after == before
        # Spot-check the fields the task names explicitly.
        assert after["attributes"] == mac_attrs
        assert after["agent_version"] == "0.3.1"
        assert after["last_checkin_at"] == mac_checkin
        assert after["device_token_hash"] == "sha256:mac-token-hash"
        assert after["is_demo"] is False
        # The Mac's own referencing rows all survived.
        assert session.query(DeviceInventorySnapshot).filter(
            DeviceInventorySnapshot.device_id == mac_id).count() == 1
        assert session.query(SecurityAlert).filter(
            SecurityAlert.device_id == mac_id).count() == 1
        assert session.query(ComplianceResult).filter(
            ComplianceResult.device_id == mac_id).count() == 1
        assert session.query(AgentCommand).filter(
            AgentCommand.device_id == mac_id).count() == 1
        # The lookalike survives too: deletion is by is_demo /
        # demo-device membership, never by device_id prefix.
        assert session.query(models.Device).filter(
            models.Device.device_id == "demo-not-a-demo-row").one().is_demo is False
        assert session.query(models.Device).filter(
            models.Device.tenant_id == user["tenant_id"]).count() == 2
    finally:
        session.close()


def test_seed_clear_seed_cycle_with_fk_enforcement(db_engine):
    """(d) seed -> clear -> seed end to end under FK enforcement."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)

    first = client.post("/api/v1/demo/seed", headers=headers)
    assert first.json()["seeded"] is True
    assert first.json()["counts"] == EXPECTED

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] == EXPECTED

    second = client.post("/api/v1/demo/seed", headers=headers)
    assert second.status_code == 200
    assert second.json()["seeded"] is True
    assert second.json()["counts"] == EXPECTED
    assert len(client.get("/api/v1/devices/", headers=headers).json()) == 60


def test_demo_linked_rows_in_other_tables_are_removed(db_engine):
    """Rows in tables with no is_demo column, tied to demo devices,
    must be deleted by demo-device membership — otherwise they block
    the device delete on an FK-enforcing DB exactly like the stale
    vulnerability did. Rows tied to the real Mac must survive."""
    client = _client(db_engine)
    headers, user = _auth(db_engine)

    session = _db(db_engine)
    mac = models.Device(
        tenant_id=user["tenant_id"], hostname="Jamiahs-MacBook-Air-2.local",
        device_id=PROTECTED_DEVICE_ID, enrollment_status="enrolled",
        agent_version="0.3.1")
    session.add(mac)
    session.commit()
    mac_id = mac.id
    session.close()

    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.json()["seeded"] is True

    session = _db(db_engine)
    demo_ids = _demo_device_ids(session, user["tenant_id"])
    demo_vuln = session.query(models.Vulnerability).filter(
        models.Vulnerability.tenant_id == user["tenant_id"],
        models.Vulnerability.is_demo.is_(True)).first()
    # Demo-linked rows, one per FK path (and one per AgentCommand FK
    # column), plus Mac-linked controls that must survive.
    session.add(DeviceInventorySnapshot(
        tenant_id=user["tenant_id"], device_id=demo_ids[0],
        hardware={}, os={}, software=[]))
    session.add(DeviceInventorySnapshot(
        tenant_id=user["tenant_id"], device_id=mac_id,
        hardware={}, os={}, software=[]))
    session.add(SecurityAlert(
        tenant_id=user["tenant_id"], device_id=demo_ids[1],
        title="demo alert", severity="medium", category="edr"))
    session.add(SecurityAlert(
        tenant_id=user["tenant_id"], device_id=mac_id,
        title="mac alert", severity="medium", category="edr"))
    session.add(ComplianceResult(
        tenant_id=user["tenant_id"], device_id=demo_ids[2],
        benchmark="CIS", score="70", status="non_compliant"))
    session.add(ComplianceResult(
        tenant_id=user["tenant_id"], device_id=mac_id,
        benchmark="CIS", score="92", status="compliant"))
    cmd_device = AgentCommand(
        tenant_id=user["tenant_id"], device_id=demo_ids[3],
        command="echo device", status="pending")
    cmd_target = AgentCommand(
        tenant_id=user["tenant_id"], target_device_id=demo_ids[4],
        command="echo target", status="pending")
    cmd_claimed = AgentCommand(
        tenant_id=user["tenant_id"], claimed_by_device_id=demo_ids[5],
        command="echo claimed", status="claimed")
    cmd_mac = AgentCommand(
        tenant_id=user["tenant_id"], device_id=mac_id,
        command="echo mac", status="succeeded")
    session.add_all([cmd_device, cmd_target, cmd_claimed, cmd_mac])
    session.flush()
    # Remediation chain: config -> send -> command, all demo-linked.
    # The config is stale-flagged (is_demo False) but points at a demo
    # vulnerability, so it must still be swept by membership.
    config = RemediationConfiguration(
        tenant_id=user["tenant_id"], name="demo config",
        content="echo remediate", vulnerability_id=demo_vuln.id,
        is_demo=False)
    session.add(config)
    session.flush()
    session.add(RemediationConfigurationSend(
        tenant_id=user["tenant_id"], configuration_id=config.id,
        vulnerability_id=demo_vuln.id, device_id=demo_ids[6],
        command_id=cmd_device.id, status="sent"))
    session.commit()
    session.close()

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    assert cleared.json()["deleted"] == EXPECTED

    session = _db(db_engine)
    try:
        # No demo-linked rows remain in any flag-less table.
        assert session.query(DeviceInventorySnapshot).filter(
            DeviceInventorySnapshot.device_id.in_(demo_ids)).count() == 0
        assert session.query(SecurityAlert).filter(
            SecurityAlert.device_id.in_(demo_ids)).count() == 0
        assert session.query(ComplianceResult).filter(
            ComplianceResult.device_id.in_(demo_ids)).count() == 0
        assert session.query(AgentCommand).filter(
            AgentCommand.device_id.in_(demo_ids)
            | AgentCommand.target_device_id.in_(demo_ids)
            | AgentCommand.claimed_by_device_id.in_(demo_ids)).count() == 0
        assert session.query(RemediationConfigurationSend).filter(
            RemediationConfigurationSend.device_id.in_(demo_ids)).count() == 0
        assert session.query(RemediationConfiguration).count() == 0
        assert session.query(models.Vulnerability).filter(
            models.Vulnerability.tenant_id == user["tenant_id"]).count() == 0
        assert session.query(models.Device).filter(
            models.Device.tenant_id == user["tenant_id"],
            models.Device.is_demo.is_(True)).count() == 0
        # Every Mac-linked row survived.
        assert session.query(DeviceInventorySnapshot).filter(
            DeviceInventorySnapshot.device_id == mac_id).count() == 1
        assert session.query(SecurityAlert).filter(
            SecurityAlert.device_id == mac_id).count() == 1
        assert session.query(ComplianceResult).filter(
            ComplianceResult.device_id == mac_id).count() == 1
        assert session.query(AgentCommand).filter(
            AgentCommand.device_id == mac_id).count() == 1
        assert session.query(models.Device).filter(
            models.Device.device_id == PROTECTED_DEVICE_ID).one().is_demo is False
    finally:
        session.close()
