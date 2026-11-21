from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import secrets
import uuid
from ..database import get_db
from ..models import Device, AuditEvent, User, Group, DeviceGroup
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])

ONLINE_WINDOW = timedelta(hours=1)


class DeviceOut(BaseModel):
    id: uuid.UUID
    hostname: Optional[str]
    device_id: str
    enrollment_status: str
    agent_version: Optional[str]
    last_checkin_at: Optional[datetime]
    created_at: Optional[datetime] = None
    attributes: dict

    class Config:
        from_attributes = True


class DeviceDetail(DeviceOut):
    groups: list[str] = []


class EnrollRequest(BaseModel):
    enrollment_token: str
    hostname: str
    device_id: str
    agent_version: str = "0.1.0"
    attributes: dict = {}


def _audit(db: Session, tenant_id, action: str, entity_type: str, entity_id, meta: dict, actor=None):
    db.add(AuditEvent(
        tenant_id=tenant_id,
        actor_user_id=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        event_metadata=meta,
    ))


@router.get("/", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(Device)
        .filter(Device.tenant_id == current_user.tenant_id)
        .order_by(Device.hostname)
        .all()
    )


@router.get("/stats")
def device_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Device).filter(Device.tenant_id == current_user.tenant_id).count()
    recent = datetime.utcnow() - ONLINE_WINDOW
    online = db.query(Device).filter(
        Device.tenant_id == current_user.tenant_id,
        Device.last_checkin_at >= recent
    ).count()
    return {"total": total, "online": online, "stale": total - online}


@router.post("/enrollment-token")
def create_enrollment_token(current_user: User = Depends(get_current_user)):
    # MVP format, kept compatible with the agent: nexus-<tenant_uuid>-<random>.
    # TODO(security): store hashed one-time tokens with expiry and issue per-device credentials.
    token = f"nexus-{current_user.tenant_id}-{secrets.token_hex(8)}"
    return {
        "enrollment_token": token,
        "install_command": f'nexus-agent.exe --server https://YOUR-NEXUS-ADDRESS --token {token}',
    }


@router.get("/{device_uuid}", response_model=DeviceDetail)
def get_device(device_uuid: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = db.query(Device).filter(
        Device.id == device_uuid, Device.tenant_id == current_user.tenant_id
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    group_names = [
        g.name for g in db.query(Group)
        .join(DeviceGroup, DeviceGroup.group_id == Group.id)
        .filter(DeviceGroup.device_id == device.id, Group.tenant_id == current_user.tenant_id)
        .all()
    ]
    out = DeviceDetail.model_validate(device)
    out.groups = group_names
    return out


@router.get("/{device_uuid}/activity")
def device_activity(device_uuid: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.tenant_id == current_user.tenant_id, AuditEvent.entity_id == device_uuid)
        .order_by(AuditEvent.occurred_at.desc())
        .limit(50)
        .all()
    )
    return [
        {"action": e.action, "occurred_at": e.occurred_at, "metadata": e.event_metadata or {}}
        for e in events
    ]


@router.post("/enroll")
def enroll_device(req: EnrollRequest, db: Session = Depends(get_db)):
    # MVP: simple token check (in production validate against stored one-time tokens)
    if not req.enrollment_token.startswith("nexus-"):
        raise HTTPException(status_code=400, detail="Invalid enrollment token")
    # Extract tenant from token format: nexus-<tenant_uuid>-<random>
    try:
        # The tenant UUID itself contains dashes, so take the 36 characters after "nexus-"
        tenant_id = uuid.UUID(req.enrollment_token[len("nexus-"):][:36])
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed enrollment token")

    device = db.query(Device).filter(Device.device_id == req.device_id).first()
    is_new = device is None
    if is_new:
        device = Device(
            tenant_id=tenant_id,
            hostname=req.hostname,
            device_id=req.device_id,
            agent_version=req.agent_version,
            attributes=req.attributes,
            last_checkin_at=datetime.utcnow(),
        )
        db.add(device)
        db.flush()
    else:
        device.hostname = req.hostname
        device.agent_version = req.agent_version
        device.attributes = req.attributes
        device.last_checkin_at = datetime.utcnow()
    _audit(db, device.tenant_id, "device.enrolled" if is_new else "device.reenrolled",
           "device", device.id, {"hostname": req.hostname})
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
