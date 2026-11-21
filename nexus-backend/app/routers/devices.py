from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import uuid
from ..database import get_db
from ..models import Device, DeviceInventorySnapshot, AuditEvent, User
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])

class DeviceOut(BaseModel):
    id: uuid.UUID
    hostname: Optional[str]
    device_id: str
    enrollment_status: str
    agent_version: Optional[str]
    last_checkin_at: Optional[datetime]
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

@router.post("/enroll")
def enroll_device(req: EnrollRequest, db: Session = Depends(get_db)):
    # MVP: simple token check (in production validate against stored one-time tokens)
    if not req.enrollment_token.startswith("nexus-"):
        raise HTTPException(status_code=400, detail="Invalid enrollment token")
    # Extract tenant from token format: nexus-<tenant_uuid>-<random>
    try:
        tenant_id = uuid.UUID(req.enrollment_token[len("nexus-"):][:36])
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed enrollment token")

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
        device.hostname = req.hostname
        device.agent_version = req.agent_version
        device.attributes = req.attributes
        device.last_checkin_at = datetime.utcnow()
    db.commit()
    return {"status": "enrolled", "device_id": device.device_id}

@router.post("/heartbeat")
def heartbeat(device_id: str, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.last_checkin_at = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


class InventoryUpload(BaseModel):
    enrollment_token: str
    hardware: dict = {}
    os: dict = {}
    software: list = []
    collected_at: Optional[datetime] = None


def _tenant_from_token(token: str) -> uuid.UUID:
    """Parse the tenant UUID out of a nexus-<tenant_uuid>-<random> token."""
    if not token.startswith("nexus-"):
        raise HTTPException(status_code=400, detail="Invalid enrollment token")
    try:
        return uuid.UUID(token[len("nexus-"):][:36])
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed enrollment token")


@router.post("/{device_id}/inventory")
def upload_inventory(device_id: str, req: InventoryUpload, db: Session = Depends(get_db)):
    """Store one inventory snapshot from the endpoint agent.

    The agent authenticates with the same enrollment token it enrolled
    with; the token's tenant must match the device's tenant, so one
    tenant's agent can never write inventory for another tenant's
    device. Only the snapshot's hardware/OS/software payloads are
    stored — never file contents.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if _tenant_from_token(req.enrollment_token) != device.tenant_id:
        raise HTTPException(status_code=403, detail="Enrollment token does not match this device's organization")
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
