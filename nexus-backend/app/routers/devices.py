import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import Device, DeviceInventorySnapshot, AuditEvent, User
from ..models_extended import AgentCommand, EnrollmentToken
from ..auth import get_current_user, require_role
from ._crud import write_routes

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])

class DeviceOut(BaseModel):
    id: uuid.UUID
    hostname: Optional[str]
    device_id: str
    enrollment_status: str
    agent_version: Optional[str]
    last_checkin_at: Optional[datetime]
    is_demo: bool = False
    created_at: Optional[datetime] = None
    attributes: dict

    class Config:
        from_attributes = True

class EnrollRequest(BaseModel):
    enrollment_token: str
    hostname: str
    device_id: str
    agent_version: str = "0.1.0"
    attributes: dict = {}

@router.get("/", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    devices = db.query(Device).filter(Device.tenant_id == current_user.tenant_id).all()
    return devices

@router.get("/stats")
def device_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Device).filter(Device.tenant_id == current_user.tenant_id).count()
    recent = datetime.utcnow() - timedelta(hours=1)
    online = db.query(Device).filter(
        Device.tenant_id == current_user.tenant_id,
        Device.last_checkin_at >= recent
    ).count()
    return {"total": total, "online": online, "stale": total - online}

def _hash_token(token: str) -> str:
    """SHA-256 of a credential. Only hashes are ever stored."""
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_device(request: Request, db: Session = Depends(get_db)) -> Device:
    """Authenticate an endpoint agent by its per-device credential.

    The agent sends the device token issued at enrollment in the
    X-Device-Token header. Enrollment tokens do NOT authenticate here:
    they are spent at enrollment and can never heartbeat, upload
    inventory, or poll for commands.
    """
    token = request.headers.get("X-Device-Token")
    if not token:
        raise HTTPException(status_code=401, detail="X-Device-Token header required")
    device = db.query(Device).filter(
        Device.device_token_hash == _hash_token(token)
    ).first()
    if not device:
        raise HTTPException(status_code=401, detail="Invalid device token")
    return device


class EnrollmentTokenCreate(BaseModel):
    label: str = ""
    expires_hours: int = 72


@router.post("/enrollment-tokens", status_code=201)
def issue_enrollment_token(req: EnrollmentTokenCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(require_role(["owner", "admin"]))):
    """Issue a one-time enrollment token for this organization.

    The plaintext token is returned once, here, and never stored —
    only its hash is kept. It enrolls exactly one device, then it is
    spent. Hand it to the person installing the agent, not to the
    agent itself beyond that one enrollment.
    """
    token = f"nexus-{current_user.tenant_id}-{secrets.token_hex(4)}"
    row = EnrollmentToken(
        tenant_id=current_user.tenant_id,
        token_hash=_hash_token(token),
        label=req.label or None,
        expires_at=datetime.utcnow() + timedelta(hours=req.expires_hours),
        created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": str(row.id),
        "token": token,
        "label": row.label,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


@router.post("/enroll")
def enroll_device(req: EnrollRequest, db: Session = Depends(get_db)):
    """Enroll a device with a one-time stored enrollment token.

    The token must exist in the database, be unexpired, and unused.
    Enrolling spends it and issues the device its own long-lived
    credential (device_token), returned once in this response — the
    agent stores it and sends it as X-Device-Token from then on.
    Re-enrolling an existing device with a fresh token rotates its
    device credential.
    """
    token = db.query(EnrollmentToken).filter(
        EnrollmentToken.token_hash == _hash_token(req.enrollment_token)
    ).first()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid enrollment token")
    if token.used_at is not None:
        raise HTTPException(status_code=400, detail="Enrollment token already used")
    if token.expires_at and token.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Enrollment token expired")
    tenant_id = token.tenant_id

    device = db.query(Device).filter(Device.device_id == req.device_id).first()
    if not device:
        device = Device(
            tenant_id=tenant_id,
            hostname=req.hostname,
            device_id=req.device_id,
            agent_version=req.agent_version,
            attributes=req.attributes,
            last_checkin_at=datetime.utcnow(),
        )
        db.add(device)
    else:
        if device.tenant_id != tenant_id:
            raise HTTPException(status_code=403, detail="Device belongs to another organization")
        device.hostname = req.hostname
        device.agent_version = req.agent_version
        device.attributes = req.attributes
        device.last_checkin_at = datetime.utcnow()
    device_token = "dev-" + secrets.token_hex(16)
    device.device_token_hash = _hash_token(device_token)
    token.used_at = datetime.utcnow()
    token.used_device_id = device.id
    db.commit()
    return {"status": "enrolled", "device_id": device.device_id, "device_token": device_token}

@router.post("/heartbeat")
def heartbeat(device: Device = Depends(get_current_device), db: Session = Depends(get_db)):
    """Heartbeat from an enrolled agent. Authenticated by the device's
    own credential (X-Device-Token) — an enrollment token or a JWT
    does not authenticate here."""
    device.last_checkin_at = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


class InventoryUpload(BaseModel):
    hardware: dict = {}
    os: dict = {}
    software: list = []
    collected_at: Optional[datetime] = None


@router.post("/{device_id}/inventory")
def upload_inventory(device_id: str, req: InventoryUpload,
                     device: Device = Depends(get_current_device),
                     db: Session = Depends(get_db)):
    """Store one inventory snapshot from the endpoint agent.

    The agent authenticates with its own device credential
    (X-Device-Token), and the path device must be the authenticated
    device, so one tenant's agent can never write inventory for
    another device. Only the snapshot's hardware/OS/software payloads
    are stored — never file contents.
    """
    if device.device_id != device_id:
        raise HTTPException(status_code=403, detail="Device token does not match this device")
    snapshot = DeviceInventorySnapshot(
        device_id=device.id,
        tenant_id=device.tenant_id,
        hardware=req.hardware,
        os=req.os,
        software=req.software,
        collected_at=req.collected_at or datetime.utcnow(),
    )
    db.add(snapshot)
    device.last_checkin_at = datetime.utcnow()
    attrs = dict(device.attributes or {})
    attrs["last_inventory_at"] = (req.collected_at or datetime.utcnow()).isoformat()
    device.attributes = attrs
    db.commit()
    db.refresh(snapshot)
    return {"status": "ok", "snapshot_id": str(snapshot.id)}


@router.get("/{device_id}/inventory/latest")
def latest_inventory(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Newest inventory snapshot for one of the caller's own devices."""
    device = db.query(Device).filter(
        Device.device_id == device_id,
        Device.tenant_id == current_user.tenant_id,
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    snapshot = (
        db.query(DeviceInventorySnapshot)
        .filter(DeviceInventorySnapshot.device_id == device.id)
        .order_by(DeviceInventorySnapshot.collected_at.desc())
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="No inventory collected for this device yet")
    return {
        "id": str(snapshot.id),
        "device_id": device.device_id,
        "hostname": device.hostname,
        "tenant_id": str(snapshot.tenant_id),
        "hardware": snapshot.hardware,
        "os": snapshot.os,
        "software": snapshot.software,
        "collected_at": snapshot.collected_at.isoformat() if snapshot.collected_at else None,
    }


def _manual_device_create(row, merged):
    """Fill the columns the console's generic Add box does not send.

    The Add box sends title/name only; a manually added device needs a
    stable device_id and a hostname, so invent the first and derive
    the second from the title when the payload did not provide one.
    """
    if not row.device_id:
        row.device_id = "manual-" + uuid.uuid4().hex[:12]
    if not row.hostname:
        row.hostname = merged.get("title") or merged.get("name") or row.device_id


def _manual_device_delete(db, row):
    """Remove a device's snapshots and queued commands before the row
    goes, so no orphaned rows reference a deleted device."""
    db.query(DeviceInventorySnapshot).filter(
        DeviceInventorySnapshot.device_id == row.id
    ).delete(synchronize_session=False)
    db.query(AgentCommand).filter(
        (AgentCommand.device_id == row.id)
        | (AgentCommand.target_device_id == row.id)
        | (AgentCommand.claimed_by_device_id == row.id)
    ).delete(synchronize_session=False)


# Write side (create / get / update / delete / status) for the devices
# module. The status action maps onto enrollment_status, and only the
# enrolled / suspended / decommissioned values are accepted.
# Registered last, so the specific routes above (/enroll, /heartbeat,
# /{device_id}/inventory, /{device_id}/inventory/latest, /stats) keep
# matching first.
write_routes(
    router, Device,
    audit_prefix="device",
    status_column="enrollment_status",
    status_values=["enrolled", "suspended", "decommissioned"],
    on_create=_manual_device_create,
    on_delete=_manual_device_delete,
)
