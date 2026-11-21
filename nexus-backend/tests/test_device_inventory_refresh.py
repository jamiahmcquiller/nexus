"""Bug 3 (NULL refinement fix round 2): inventory upload must refresh
the device row, not just store the snapshot.

Before this fix, GET /api/v1/devices/ kept showing the enrollment-time
snapshot (OS "macOS <nil>", 13 software, 13 disks, agent 0.3.1) while
GET /{device_id}/inventory/latest already had the fresh v0.3.2 data
(OS macOS 26.6.2, 78 software, 4 disks) — the upload stored the
snapshot and last_checkin_at but never stamped device.agent_version
or device.attributes["os"]/counts.

The 78-app case mirrors the shape of the real Mac snapshot collected
2026-11-21T15:54:55 UTC (macOS 26.6.2 build 25G83 arm64, 78 software
entries with unique bundle ids and real versions, 4 disk entries);
the apps themselves are synthetic, generated here.

Run:  cd nexus-backend && python -m pytest tests/test_device_inventory_refresh.py
"""
import os
import uuid
from datetime import datetime

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


# The stale enrollment-time row, modeled on the real Mac row
# (agent 0.3.1, OS "macOS <nil>", 13 software, 13 disks).
STALE_ATTRS = {
    "os": {"arch": "arm64", "name": "macOS <nil>", "platform": "darwin", "version": None},
    "cpu": {"count": 10, "model": "Apple M5"},
    "memory": {"total_mb": 16384},
    "software": 13,
    "disks": 13,
    "collected": "2026-11-21T09:11:45Z",
}

FRESH_OS = {"arch": "arm64", "build": "25G83", "name": "macOS",
            "platform": "darwin", "version": "26.6.2"}


def _enroll(client, headers, device_id="dev-1"):
    token = _issue_token(client, headers)
    r = client.post("/api/v1/devices/enroll", json={
        "enrollment_token": token,
        "hostname": "TEST-MAC", "device_id": device_id, "agent_version": "0.3.1",
        "attributes": dict(STALE_ATTRS),
    })
    assert r.status_code == 200, r.text
    body = r.json()
    body["enrollment_token"] = token
    return body


def _device_row(client, headers, device_id="dev-1"):
    r = client.get("/api/v1/devices/", headers=headers)
    assert r.status_code == 200, r.text
    rows = [d for d in r.json() if d["device_id"] == device_id]
    assert len(rows) == 1, r.text
    return rows[0]


def _upload(client, device_headers, payload):
    r = client.post("/api/v1/devices/dev-1/inventory",
                    headers=device_headers, json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"
    return r.json()


def _fresh_payload(agent_version="0.3.3", n_apps=3, n_disks=2):
    return {
        "hardware": {
            "cpu": {"count": 10, "model": "Apple M5"},
            "memory": {"total_mb": 16384},
            "disks": [{"device": f"/dev/disk{i}", "filesystem": "GUID_partition_scheme",
                       "total_gb": 460, "free_gb": 325} for i in range(1, n_disks + 1)],
        },
        "os": dict(FRESH_OS),
        "software": [{"bundle_id": f"com.example.app{i}", "name": f"App {i}",
                      "vendor": "Example", "version": f"1.{i}.0"} for i in range(n_apps)],
        "collected_at": "2026-11-21T15:54:55",
        "agent_version": agent_version,
    }


def test_inventory_upload_refreshes_device_row(db_engine):
    """(a) Upload with agent_version + fresh OS updates the device row
    and stores the snapshot."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    before = _device_row(client, headers)
    assert before["agent_version"] == "0.3.1"
    assert before["attributes"]["os"]["name"] == "macOS <nil>"
    assert before["attributes"]["software"] == 13
    assert before["attributes"]["disks"] == 13

    snap = _upload(client, device_headers, _fresh_payload())
    assert snap["snapshot_id"]

    after = _device_row(client, headers)
    assert after["agent_version"] == "0.3.3"
    assert after["attributes"]["os"] == FRESH_OS
    assert after["attributes"]["os"]["version"] == "26.6.2"
    assert after["attributes"]["software"] == 3
    assert after["attributes"]["disks"] == 2
    assert after["attributes"]["last_inventory_at"].startswith("2026-11-21T15:54:55")
    # "collected" is the enrollment/first-seen timestamp and must NOT
    # move on inventory upload — the enrollment chart buckets on it.
    # Freshness is carried by last_inventory_at, not collected.
    assert after["attributes"]["collected"] == "2026-11-21T09:11:45Z"
    assert datetime.fromisoformat(after["last_checkin_at"]) >= datetime.fromisoformat(before["last_checkin_at"])

    # The snapshot itself is still stored with the fresh payload.
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["os"] == FRESH_OS
    assert len(r.json()["software"]) == 3


def test_heartbeat_with_agent_version_stamps_device(db_engine):
    """(b) Heartbeat carrying {"agent_version": ...} stamps the row."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    r = client.post("/api/v1/devices/heartbeat", headers=device_headers,
                    json={"agent_version": "0.3.3"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    row = _device_row(client, headers)
    assert row["agent_version"] == "0.3.3"
    # Heartbeat alone does not touch inventory-derived fields.
    assert row["attributes"]["os"]["name"] == "macOS <nil>"
    assert row["attributes"]["software"] == 13


def test_heartbeat_without_body_still_works(db_engine):
    """(c) Heartbeat with NO body keeps working exactly as before and
    leaves agent_version untouched (backward compatible with older
    agents)."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    before = _device_row(client, headers)
    r = client.post("/api/v1/devices/heartbeat", headers=device_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    after = _device_row(client, headers)
    assert after["agent_version"] == "0.3.1"
    assert datetime.fromisoformat(after["last_checkin_at"]) >= datetime.fromisoformat(before["last_checkin_at"])


def test_upload_without_agent_version_keeps_existing(db_engine):
    """(d) Upload WITHOUT agent_version leaves the existing
    agent_version untouched, while still refreshing os/counts."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    payload = _fresh_payload()
    del payload["agent_version"]
    _upload(client, device_headers, payload)

    row = _device_row(client, headers)
    assert row["agent_version"] == "0.3.1"
    assert row["attributes"]["os"] == FRESH_OS
    assert row["attributes"]["software"] == 3
    assert row["attributes"]["disks"] == 2


def test_list_devices_returns_refreshed_values(db_engine):
    """(e) The Endpoints table source — list_devices — shows the
    refreshed row after an upload."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}
    _upload(client, device_headers, _fresh_payload(n_apps=5, n_disks=4))

    r = client.get("/api/v1/devices/", headers=headers)
    assert r.status_code == 200, r.text
    rows = [d for d in r.json() if d["device_id"] == "dev-1"]
    assert len(rows) == 1
    row = rows[0]
    assert row["agent_version"] == "0.3.3"
    assert row["attributes"]["os"]["version"] == "26.6.2"
    assert row["attributes"]["software"] == 5
    assert row["attributes"]["disks"] == 4


def test_latest_inventory_returns_agent_version(db_engine):
    """(f) latest_inventory includes agent_version from the device row,
    kept current by upload/heartbeat — no snapshot-table column."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    # Before any upload there is no snapshot; after upload the
    # response carries the stamped version.
    _upload(client, device_headers, _fresh_payload())
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["agent_version"] == "0.3.3"

    # A heartbeat bump is reflected too, without a new snapshot.
    client.post("/api/v1/devices/heartbeat", headers=device_headers,
                json={"agent_version": "0.3.4"})
    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.json()["agent_version"] == "0.3.4"


def test_78_app_upload_refreshes_row_without_duplicates(db_engine):
    """(g) A synthetic 78-app upload (unique bundle ids, real
    versions, 4 disks — the real Mac v0.3.2 snapshot's shape)
    refreshes the row with no duplicates."""
    client = _client(db_engine)
    headers, _ = _auth(db_engine)
    enrolled = _enroll(client, headers)
    device_headers = {"X-Device-Token": enrolled["device_token"]}

    apps = []
    for i in range(78):
        # A few named after real entries in the Mac snapshot; the rest
        # are generated with unique bundle ids and real versions.
        if i == 0:
            apps.append({"bundle_id": "com.apple.Safari", "name": "Safari",
                         "vendor": "Apple", "version": "26.6.2"})
        elif i == 1:
            apps.append({"bundle_id": "com.bambulab.bambu-studio", "name": "Bambu Studio",
                         "vendor": "Bambu Lab", "version": "02.08.02.61"})
        elif i == 2:
            apps.append({"bundle_id": "io.sideloadly.sideloadly", "name": "Sideloadly!",
                         "vendor": "Unknown", "version": "0.60"})
        else:
            apps.append({"bundle_id": f"com.example.app{i:03d}", "name": f"App {i}",
                         "vendor": "Apple", "version": f"1.{i}.0"})
    payload = _fresh_payload(n_apps=0, n_disks=4)
    payload["software"] = apps
    _upload(client, device_headers, payload)

    row = _device_row(client, headers)
    assert row["agent_version"] == "0.3.3"
    assert row["attributes"]["os"] == FRESH_OS
    assert row["attributes"]["software"] == 78
    assert row["attributes"]["disks"] == 4

    r = client.get("/api/v1/devices/dev-1/inventory/latest", headers=headers)
    assert r.status_code == 200, r.text
    stored = r.json()["software"]
    assert len(stored) == 78
    assert len({a["bundle_id"] for a in stored}) == 78
    assert len({a["name"] for a in stored}) == 78
    assert all(a["version"] for a in stored)
    assert all(a["name"] for a in stored)
    assert r.json()["agent_version"] == "0.3.3"
