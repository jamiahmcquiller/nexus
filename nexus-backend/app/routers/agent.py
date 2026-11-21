"""Endpoints the NEXUS agent calls: enroll once, then check in with its device key."""
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from ..database import get_db
from ..models import Device, DeviceCredential, DeviceInventorySnapshot, EnrollmentToken, Tenant
from .common import audit, now

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])

import os
from pathlib import Path
from fastapi.responses import FileResponse

AGENT_DIST = Path(os.environ.get("NEXUS_AGENT_DIST", Path(__file__).resolve().parents[3] / "agent" / "dist"))
DOWNLOADS = {
    "macos-arm64": "nexus-agent-macos-arm64", "macos-x86_64": "nexus-agent-macos-x86_64",
    "windows": "nexus-agent-windows-amd64.exe", "linux": "nexus-agent-linux-x86_64",
}


@router.get("/download/{platform}")
def download(platform: str):
    """Agent binaries built by agent/build.sh. Public: the binary holds no secrets."""
    name = DOWNLOADS.get(platform)
    path = AGENT_DIST / name if name else None
    if not path or not path.is_file():
        raise HTTPException(404, "That agent build is not available on this server yet. Run agent/build.sh.")
    return FileResponse(path, filename="nexus-agent.exe" if platform == "windows" else "nexus-agent",
                        media_type="application/octet-stream")

TOKEN_TTL = timedelta(days=7)
# Fields the console manages; agent inventory never overwrites them.
CONSOLE_FIELDS = ("department", "warranty", "notes")
INVENTORY_SNAPSHOT_EVERY = timedelta(hours=6)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def issue_enrollment_token(db: Session, tenant_id, created_by: str) -> str:
    # Format kept as nexus-<tenant_uuid>-<random> so existing agents and docs still read it
    token = f"nexus-{tenant_id}-{secrets.token_urlsafe(18)}"
    db.add(EnrollmentToken(tenant_id=tenant_id, token_hash=sha256(token), created_by=created_by,
                           expires_at=now() + TOKEN_TTL))
    return token


def check_enrollment_token(db: Session, token: str) -> EnrollmentToken:
    row = db.query(EnrollmentToken).filter(EnrollmentToken.token_hash == sha256(token or "")).first()
    if not row or row.revoked == "yes":
        raise HTTPException(401, "Enrollment code not recognized. Create a new one in the console.")
    if row.expires_at < now():
        raise HTTPException(401, "Enrollment code has expired. Create a new one in the console.")
    return row


class EnrollIn(BaseModel):
    enrollment_token: str
    device_id: str = Field(min_length=8, max_length=128)
    hostname: str = Field(min_length=1, max_length=255)
    agent_version: str = "0.0.0"
    attributes: dict = {}


def merge_inventory(device: Device, inventory: dict):
    attrs = dict(device.attributes or {})
    for k, v in inventory.items():
        if k not in CONSOLE_FIELDS and v not in (None, "", [], {}):
            attrs[k] = v
    device.attributes = attrs
    flag_modified(device, "attributes")


def snapshot(db: Session, device: Device, inventory: dict):
    db.add(DeviceInventorySnapshot(device_id=device.id, tenant_id=device.tenant_id,
                                   hardware=inventory.get("hardware"), os=inventory.get("os"),
                                   software=inventory.get("software")))


@router.post("/enroll")
def enroll(req: EnrollIn, db: Session = Depends(get_db)):
    tok = check_enrollment_token(db, req.enrollment_token)
    if not db.query(Tenant).filter(Tenant.id == tok.tenant_id).first():
        raise HTTPException(401, "Organization not found")
    device = db.query(Device).filter(Device.device_id == req.device_id).first()
    if device and device.tenant_id != tok.tenant_id:
        raise HTTPException(409, "This device is enrolled in a different organization")
    is_new = device is None
    if is_new:
        device = Device(tenant_id=tok.tenant_id, device_id=req.device_id, attributes={})
        db.add(device)
    device.hostname = req.hostname
    device.agent_version = req.agent_version
    device.enrollment_status = "enrolled"
    device.last_checkin_at = now()
    merge_inventory(device, req.attributes)
    db.flush()
    snapshot(db, device, req.attributes)

    agent_key = secrets.token_urlsafe(32)
    cred = db.query(DeviceCredential).filter(DeviceCredential.device_id == device.id).first()
    if cred:
        cred.key_hash, cred.created_at = sha256(agent_key), now()
    else:
        db.add(DeviceCredential(device_id=device.id, key_hash=sha256(agent_key)))
    tok.uses = str(int(tok.uses or 0) + 1)
    audit(db, None, device.tenant_id, "device.enrolled" if is_new else "device.reenrolled", "device", device.id,
          {"hostname": device.hostname, "os": (req.attributes.get("os") or {}).get("name")})
    db.commit()
    return {"status": "enrolled", "device_uuid": str(device.id), "agent_key": agent_key,
            "checkin_interval_seconds": 300}


def authenticate_agent(db: Session, device_id: str | None, authorization: str | None) -> Device:
    if not device_id or not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing device credentials")
    device = db.query(Device).filter(Device.device_id == device_id).first()
    cred = db.query(DeviceCredential).filter(DeviceCredential.device_id == device.id).first() if device else None
    if not cred or not hmac.compare_digest(cred.key_hash, sha256(authorization[7:].strip())):
        raise HTTPException(401, "Device credentials not recognized. Enroll this device again.")
    cred.last_used_at = now()
    return device


class CheckinIn(BaseModel):
    hostname: str | None = None
    agent_version: str | None = None
    inventory: dict | None = None


@router.post("/checkin")
def checkin(req: CheckinIn, db: Session = Depends(get_db),
            x_device_id: str | None = Header(default=None), authorization: str | None = Header(default=None)):
    device = authenticate_agent(db, x_device_id, authorization)
    was_offline = not device.last_checkin_at or now() - device.last_checkin_at > timedelta(hours=1)
    device.last_checkin_at = now()
    if req.hostname:
        device.hostname = req.hostname
    if req.agent_version:
        device.agent_version = req.agent_version
    if req.inventory:
        merge_inventory(device, req.inventory)
        last = (db.query(DeviceInventorySnapshot).filter(DeviceInventorySnapshot.device_id == device.id)
                .order_by(DeviceInventorySnapshot.collected_at.desc()).first())
        if not last or now() - last.collected_at >= INVENTORY_SNAPSHOT_EVERY:
            snapshot(db, device, req.inventory)
    if was_offline:
        audit(db, None, device.tenant_id, "device.online", "device", device.id, {"hostname": device.hostname})
    db.commit()
    return {"status": "ok", "checkin_interval_seconds": 300, "server_time": now().isoformat() + "Z"}
