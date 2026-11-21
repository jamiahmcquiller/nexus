"""Helpers shared by the module routers."""
from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from ..models import AuditEvent, Device, User

ONLINE_WINDOW = timedelta(hours=1)
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def now() -> datetime:
    return datetime.utcnow()


def audit(db: Session, user: User | None, tenant_id, action: str, entity_type: str, entity_id=None, meta: dict | None = None):
    db.add(AuditEvent(
        tenant_id=tenant_id,
        actor_user_id=user.id if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        event_metadata={**(meta or {}), **({"actor": user.username} if user else {})},
    ))


def tenant_devices(db: Session, tenant_id) -> list[Device]:
    return db.query(Device).filter(Device.tenant_id == tenant_id).all()


def is_online(d: Device) -> bool:
    return bool(d.last_checkin_at and d.last_checkin_at >= now() - ONLINE_WINDOW)


def device_brief(d: Device) -> dict:
    a = d.attributes or {}
    return {
        "id": str(d.id),
        "hostname": d.hostname,
        "department": a.get("department"),
        "assigned_user": a.get("assigned_user"),
        "os": (a.get("os") or {}).get("name"),
        "online": is_online(d),
        "last_checkin_at": d.last_checkin_at,
    }


def parse_date(value) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def warranty_status(attrs: dict) -> dict:
    """Classify a device's warranty: active, expiring (within 90 days), expired, or unknown."""
    w = (attrs or {}).get("warranty") or {}
    end = parse_date(w.get("end_date"))
    if not end:
        return {"status": "unknown", "days_left": None, **w}
    days = (end - date.today()).days
    status = "expired" if days < 0 else "expiring" if days <= 90 else "active"
    return {"status": status, "days_left": days, **w}
