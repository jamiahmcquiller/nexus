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
def create_enrollment_token(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Issue an enrollment code. It works for 7 days and can enroll many devices; only its hash is stored."""
    from .agent import issue_enrollment_token, TOKEN_TTL
    token = issue_enrollment_token(db, current_user.tenant_id, current_user.username)
    _audit(db, current_user.tenant_id, "enrollment.code_created", "organization", None,
           {"actor": current_user.username}, actor=current_user.id)
    db.commit()
    return {"enrollment_token": token, "expires_in_days": TOKEN_TTL.days}


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


@router.post("/enroll", include_in_schema=False)
def enroll_device(req: EnrollRequest, db: Session = Depends(get_db)):
    """Legacy path kept for older agents; same checks as /api/v1/agent/enroll."""
    from .agent import enroll as agent_enroll, EnrollIn
    return agent_enroll(EnrollIn(**req.model_dump()), db)
