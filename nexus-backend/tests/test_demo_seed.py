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
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import models
from app.auth import create_access_token
from app.routers.demo import router as demo_router, PROTECTED_DEVICE_ID
from app.routers.devices import router as devices_router
from app.routers.patches import router as patches_router
from app.routers.patching import router as patching_router
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
    for r in (demo_router, devices_router, patches_router, patching_router, vulns_router,
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
    # Every patch status is one of the model's five — there is no
    # "failed" patch status, and the old seed used it for 9 rows the
    # compliance formula silently dropped.
    assert {p["status"] for p in patches} == {
        "available", "deployed", "approved", "testing", "declined"}

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
    from datetime import datetime

    client = _client(db_engine)
    headers, user = _auth(db_engine)
    session = _db(db_engine)
    # Distinctive values so "survives" means byte-identical, not just
    # "a row with that id still exists".
    mac_checkin = datetime(2026, 11, 21, 9, 11, 46)
    mac_attrs = {"os": {"platform": "darwin", "name": "macOS", "version": "15 Sequoia"},
                 "department": "Security"}
    mac = models.Device(
        tenant_id=user["tenant_id"], hostname="Jamiahs-MacBook-Air-2.local",
        device_id=PROTECTED_DEVICE_ID, enrollment_status="enrolled",
        agent_version="0.3.1", last_checkin_at=mac_checkin,
        attributes=mac_attrs)
    # A real row whose device_id merely LOOKS like a demo id: clear-demo
    # deletes by is_demo, never by prefix, so this must survive too.
    lookalike = models.Device(
        tenant_id=user["tenant_id"], hostname="DEMO-LOOKALIKE",
        device_id="demo-not-a-demo-row", enrollment_status="enrolled",
        is_demo=False)
    session.add(mac)
    session.add(lookalike)
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
    assert mac_after_seed.last_checkin_at == mac_checkin
    assert mac_after_seed.attributes == mac_attrs
    assert session.query(models.Device).filter(
        models.Device.tenant_id == user["tenant_id"],
        models.Device.device_id == PROTECTED_DEVICE_ID).count() == 1
    # Exactly 60 demo devices + the Mac + the lookalike; no demo row
    # shares the Mac's id or hostname.
    assert session.query(models.Device).filter(
        models.Device.tenant_id == user["tenant_id"],
        models.Device.is_demo.is_(True)).count() == 60
    assert session.query(models.Device).filter(
        models.Device.tenant_id == user["tenant_id"],
        models.Device.hostname == "Jamiahs-MacBook-Air-2.local").count() == 1
    session.close()

    assert len(client.get("/api/v1/devices/", headers=headers).json()) == 62

    cleared = client.post("/api/v1/demo/clear-demo", headers=headers)
    assert cleared.json()["deleted"]["devices"] == 60

    session = _db(db_engine)
    mac_after_clear = session.query(models.Device).filter(
        models.Device.device_id == PROTECTED_DEVICE_ID).one()
    assert mac_after_clear.hostname == "Jamiahs-MacBook-Air-2.local"
    assert mac_after_clear.is_demo is False
    assert mac_after_clear.last_checkin_at == mac_checkin
    assert mac_after_clear.attributes == mac_attrs
    assert session.query(models.Device).filter(
        models.Device.device_id == "demo-not-a-demo-row").one().is_demo is False
    assert session.query(models.Device).filter(
        models.Device.tenant_id == user["tenant_id"]).count() == 2
    session.close()

    # Re-seeding after a clear still works with the Mac present.
    again = client.post("/api/v1/demo/seed", headers=headers)
    assert again.json()["seeded"] is True
    assert again.json()["counts"]["devices"] == 60
    assert len(client.get("/api/v1/devices/", headers=headers).json()) == 62


def test_ensure_is_demo_columns_backfills_old_schema(db_engine):
    """A database created before the demo seed has no is_demo columns.

    create_all never alters existing tables, so the boot-time backfill
    must add the flag or every list query fails. Simulate the old
    schema by dropping the column, run the backfill, then seed.
    """
    from app.database import ensure_is_demo_columns

    session = _db(db_engine)
    session.execute(text("ALTER TABLE devices DROP COLUMN is_demo"))
    session.execute(text("ALTER TABLE patches DROP COLUMN is_demo"))
    session.commit()
    session.close()

    ensure_is_demo_columns(db_engine)
    # Idempotent: a second run is a no-op, not an error.
    ensure_is_demo_columns(db_engine)

    insp = inspect(db_engine)
    assert "is_demo" in {c["name"] for c in insp.get_columns("devices")}
    assert "is_demo" in {c["name"] for c in insp.get_columns("patches")}

    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    seeded = client.post("/api/v1/demo/seed", headers=headers)
    assert seeded.status_code == 200
    assert seeded.json()["seeded"] is True
    assert seeded.json()["counts"]["devices"] == 60
    devices = client.get("/api/v1/devices/", headers=headers).json()
    assert len(devices) == 60
    assert all(d["is_demo"] is True for d in devices)


def test_seed_counts_reconcile_with_home_screens(db_engine):
    """Every number the two home screens show must reconcile with the seed.

    Replicates the frontend formulas over the API lists a seeded tenant
    returns — ItOpsHome's health buckets (1h / 24h thresholds) and patch
    compliance, SecOpsHome's open / remediated / quarantined / closed
    splits. If you change a seed cycle, update the expected numbers
    here and in docs/demo-data.md.
    """
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    body = client.post("/api/v1/demo/seed", headers=headers).json()
    assert body["seeded"] is True
    assert sum(body["counts"].values()) == 315

    def _get(path):
        r = client.get(path, headers=headers)
        assert r.status_code == 200, path
        return r.json()

    def _parse(value):
        # Backend datetimes are naive UTC; treat them as UTC, exactly
        # as both home screens' parseDate does (append "Z").
        assert value, "seeded rows must always carry a timestamp"
        v = value if value.endswith("Z") or "+" in value[10:] else value + "Z"
        return datetime.fromisoformat(v.replace("Z", "+00:00"))

    now = datetime.now(timezone.utc)
    devices = _get("/api/v1/devices/")
    patches = _get("/api/v1/patches/")
    deployments = _get("/api/v1/patch-deployments/")
    servers = _get("/api/v1/servers/")
    vulns = _get("/api/v1/vulnerabilities/")
    incidents = _get("/api/v1/edr/incidents/")
    malware = _get("/api/v1/malware/detections/")
    dlp = _get("/api/v1/dlp/findings/")
    policies = _get("/api/v1/policies/")

    # --- devices: health buckets, OS, departments, groups, enrollment
    health = Counter()
    for d in devices:
        assert d["device_id"].startswith("demo-")
        status = (d["enrollment_status"] or "").lower()
        if status == "suspended":
            health["degraded"] += 1
            continue
        assert status == "enrolled"
        last = _parse(d["last_checkin_at"])
        assert now - timedelta(days=7) <= last <= now + timedelta(minutes=5)
        age = (now - last).total_seconds()
        if age <= 3600:
            health["online"] += 1
        elif age <= 86400:
            health["attention"] += 1
        else:
            health["offline"] += 1
    assert dict(health) == {"online": 30, "attention": 12, "offline": 12, "degraded": 6}
    assert Counter((d["attributes"]["os"] or {}).get("platform") for d in devices) == {
        "windows": 24, "darwin": 24, "linux": 12}
    assert Counter(d["attributes"]["department"] for d in devices) == {
        dept: 12 for dept in ("Finance", "Engineering", "HR", "Operations", "Security")}
    assert Counter(d["attributes"]["device_group"] for d in devices) == {
        group: 15 for group in ("HQ-Desktops", "Remote-Laptops", "Lab-Workstations", "Exec-Devices")}
    assert all(d["attributes"]["collected"].endswith("Z") for d in devices)
    assert Counter((now - _parse(d["attributes"]["collected"])).days // 7
                   for d in devices) == {0: 12, 1: 12, 2: 12, 3: 12, 4: 12}
    # Protection coverage denominator: 54 enrolled, of which the 30
    # online + 12 attention checked in within the last 24h.
    enrolled = [d for d in devices if d["enrollment_status"] == "enrolled"]
    assert len(enrolled) == 54
    assert sum(1 for d in enrolled
               if (now - _parse(d["last_checkin_at"])).total_seconds() <= 86400) == 42

    # --- patches: every status is a model status; compliance reconciles
    assert Counter(p["status"] for p in patches) == {
        "deployed": 57, "approved": 18, "available": 18, "testing": 9, "declined": 18}
    assert "failed" not in {p["status"] for p in patches}
    years = {int(p["title"].rsplit(" ", 1)[-1].split(".")[0]) for p in patches}
    assert years <= {now.year - 2, now.year - 1, now.year}
    deployed = sum(1 for p in patches if p["status"] == "deployed")
    denom = sum(1 for p in patches if p["status"] in
                ("deployed", "available", "testing", "approved"))
    assert (deployed, denom) == (57, 102)
    assert round(deployed / denom * 100) == 56  # patch compliance %
    assert sum(1 for p in patches if p["status"] in
               ("available", "testing", "approved")) == 45  # pending

    # --- deployments: the pipeline renders a stage per status, and
    # those stages must account for all 30 rows.
    assert Counter(d["status"] for d in deployments) == {
        "deployed": 12, "failed": 6, "scheduled": 3, "approved": 3,
        "deploying": 3, "declined": 3}
    assert len(deployments) == 30

    # --- servers: all three health states exercised, 8 total.
    assert Counter(s["health_status"] for s in servers) == {
        "healthy": 5, "degraded": 2, "down": 1}
    assert all(s["status"] == "active" for s in servers)

    # --- vulnerabilities: severity from published CVSS, open split
    assert Counter(v["severity"] for v in vulns) == {
        "critical": 30, "high": 8, "medium": 2}
    assert Counter(v["status"] for v in vulns) == {
        "open": 21, "mitigated": 7, "remediated": 6, "accepted": 6}
    open_vulns = [v for v in vulns if v["status"] == "open"]
    assert Counter(v["severity"] for v in open_vulns) == {
        "critical": 15, "high": 5, "medium": 1}
    for v in vulns:
        score = float(v["cvss_score"])
        expected = ("critical" if score >= 9.0 else "high" if score >= 7.0
                    else "medium" if score >= 4.0 else "low")
        assert v["severity"] == expected, v["cve_id"]
    assert len({v["device_id"] for v in open_vulns
               if v["severity"] in ("critical", "high")}) == 20  # high-risk endpoints

    # --- incidents: bars Open / Resolved / Failed sum to 12.
    assert Counter(i["status"] for i in incidents) == {
        "complete": 6, "pending": 2, "in-progress": 3, "failed": 1}
    assert sum(1 for i in incidents if i["status"] in ("pending", "in-progress")) == 5

    # --- malware: detected 5, quarantined 10 of 20.
    assert Counter(m["status"] for m in malware) == {
        "detected": 5, "quarantined": 5, "remediated": 5, "false-positive": 5}
    assert sum(1 for m in malware if m["status"] == "detected") == 5
    assert sum(1 for m in malware if m["quarantined"] or m["status"] in
               ("quarantined", "remediated")) == 10
    assert all(m["severity"] == "critical" for m in malware
               if m["status"] == "detected")

    # --- DLP: open 6, closed 6, accepted 3 = 15.
    assert Counter(d["status"] for d in dlp) == {
        "open": 6, "encrypted": 3, "remediated": 3, "accepted": 3}
    assert sum(1 for d in dlp if d["status"] in ("remediated", "encrypted")) == 6

    # --- policies: 10 definitions, 9 active + 1 draft.
    assert len(policies) == 10
    assert Counter(p["status"] for p in policies) == {"active": 9, "draft": 1}

    # --- timestamps: every seeded timestamp is a UTC instant in the
    # recent past (servers are stamped exactly 90 days back), never in
    # the future and never in a future year.
    stamp_rows = (
        [(d["last_checkin_at"], d["created_at"]) for d in devices]
        + [(p["created_at"],) for p in patches]
        + [(d["created_at"],) for d in deployments]
        + [(s["created_at"],) for s in servers]
        + [(v["detected_at"],) for v in vulns]
        + [(i["created_at"],) for i in incidents]
        + [(m["created_at"],) for m in malware]
        + [(d["created_at"],) for d in dlp]
    )
    for stamps in stamp_rows:
        for stamp in stamps:
            t = _parse(stamp)
            assert now - timedelta(days=91) <= t <= now + timedelta(minutes=5), stamp


def test_seed_online_bucket_survives_read_delay(db_engine):
    """Fresh seed still shows 30 online when stats are read minutes later.

    Regression test for the live 29-online reading (Nov 21, 2026):
    /devices/stats counts a device online only while last_checkin_at
    is within the last hour *at query time*, and minutes pass between
    the seed and the home screen reading stats. The old seed stamped
    the oldest online device 58 min back, so it aged past the hour
    before the read and showed as attention (29 online / 14
    attention). The seed now caps online check-ins at 50 min, leaving
    a 10-minute margin — evaluate the buckets as of 5 minutes after
    the seed and they must still read 30 / 12 / 12 / 6.
    """
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    # Reference instant just before the seed: the seed stamps check-ins
    # relative to its own "now", a fraction of a second after this.
    now_before_seed = datetime.now(timezone.utc)
    body = client.post("/api/v1/demo/seed", headers=headers).json()
    assert body["seeded"] is True
    r = client.get("/api/v1/devices/", headers=headers)
    assert r.status_code == 200
    devices = r.json()

    def _parse(value):
        v = value if value.endswith("Z") or "+" in value[10:] else value + "Z"
        return datetime.fromisoformat(v.replace("Z", "+00:00"))

    # The home screen reads stats minutes after the seed lands.
    later = datetime.now(timezone.utc) + timedelta(minutes=5)
    health = Counter()
    for d in devices:
        if (d["enrollment_status"] or "").lower() == "suspended":
            health["degraded"] += 1
            continue
        age = (later - _parse(d["last_checkin_at"])).total_seconds()
        if age <= 3600:
            health["online"] += 1
        elif age <= 86400:
            health["attention"] += 1
        else:
            health["offline"] += 1
    assert dict(health) == {"online": 30, "attention": 12, "offline": 12, "degraded": 6}
    # Pin the margin itself: no online device may be older than 50 min
    # at seed time, so up to 10 minutes of read delay cannot flip one.
    # (5s slack covers the POST round-trip between now_before_seed and
    # the seed's own "now"; the old 58-min stamp would read ~3480s.)
    oldest_online = max(
        (now_before_seed - _parse(d["last_checkin_at"])).total_seconds()
        for d in devices
        if (d["enrollment_status"] or "").lower() == "enrolled"
        and (now_before_seed - _parse(d["last_checkin_at"])).total_seconds() <= 3600
    )
    assert oldest_online <= 50 * 60 + 5
