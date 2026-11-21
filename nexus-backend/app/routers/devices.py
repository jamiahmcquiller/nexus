from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import uuid
from ..database import get_db
from ..models import Device, AuditEvent, User
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
