from datetime import datetime, timedelta
from collections import Counter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Device, AuditEvent, User, Group, DeviceGroup, Tenant
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1", tags=["overview"])

ONLINE_WINDOW = timedelta(hours=1)


@router.get("/overview")
def overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tid = current_user.tenant_id
    devices = db.query(Device).filter(Device.tenant_id == tid).all()
    cutoff = datetime.utcnow() - ONLINE_WINDOW
    total = len(devices)
    online = sum(1 for d in devices if d.last_checkin_at and d.last_checkin_at >= cutoff)

    os_counts = Counter(((d.attributes or {}).get("os") or {}).get("name", "Unknown") for d in devices)
    dept_counts = Counter((d.attributes or {}).get("department", "Unassigned") for d in devices)

    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.tenant_id == tid)
        .order_by(AuditEvent.occurred_at.desc())
        .limit(8)
        .all()
    )
    stale = sorted(
        [d for d in devices if not d.last_checkin_at or d.last_checkin_at < cutoff],
        key=lambda d: d.last_checkin_at or datetime.min,
    )[:5]

    return {
        "devices": {"total": total, "online": online, "stale": total - online},
        "by_os": [{"name": k, "count": v} for k, v in os_counts.most_common()],
        "by_department": [{"name": k, "count": v} for k, v in dept_counts.most_common()],
        "recent_activity": [
            {
                "action": e.action,
                "occurred_at": e.occurred_at,
                "metadata": e.event_metadata or {},
            }
            for e in events
        ],
        "attention": [
            {"id": str(d.id), "hostname": d.hostname, "last_checkin_at": d.last_checkin_at}
            for d in stale
        ],
        # Not built yet: these modules report null until they exist.
        "vulnerabilities": None,
        "patch_compliance": None,
    }


@router.get("/organization")
def organization(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    return {
        "name": tenant.name if tenant else "",
        "user": {"username": current_user.username, "role": current_user.role},
    }


class GroupCreate(BaseModel):
    name: str


@router.get("/groups")
def list_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Group, func.count(DeviceGroup.device_id))
        .outerjoin(DeviceGroup, DeviceGroup.group_id == Group.id)
        .filter(Group.tenant_id == current_user.tenant_id)
        .group_by(Group.id)
        .order_by(Group.name)
        .all()
    )
    return [{"id": str(g.id), "name": g.name, "device_count": c, "created_at": g.created_at} for g, c in rows]


@router.post("/groups")
def create_group(req: GroupCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    g = Group(tenant_id=current_user.tenant_id, name=name)
    db.add(g)
    db.flush()
    db.add(AuditEvent(
        tenant_id=current_user.tenant_id, actor_user_id=current_user.id,
        action="group.created", entity_type="group", entity_id=g.id,
        event_metadata={"name": name},
    ))
    db.commit()
    return {"id": str(g.id), "name": g.name, "device_count": 0}
