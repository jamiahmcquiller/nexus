import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Ticket, TicketComment, Device, User
from ..auth import get_current_user
from .common import audit, device_brief, now

router = APIRouter(prefix="/api/v1/tickets", tags=["service desk"])

SLA_HOURS = {"critical": 4, "high": 8, "medium": 24, "low": 72}
PREFIX = {"incident": "INC", "request": "REQ", "change": "CHG"}
OPEN = ("new", "in_progress", "waiting")


def next_number(db: Session, tenant_id, ttype: str) -> str:
    count = db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.type == ttype).count()
    return f"{PREFIX[ttype]}-{1001 + count}"


def create_ticket_record(db: Session, tenant_id, *, type: str, title: str, description: str | None = None,
                         priority: str = "medium", category: str | None = None, requester: str | None = None,
                         device_id=None, source: str = "console", assignee: str | None = None) -> Ticket:
    t = Ticket(tenant_id=tenant_id, number=next_number(db, tenant_id, type), type=type, title=title,
               description=description, priority=priority, category=category, requester=requester,
               device_id=device_id, source=source, assignee=assignee,
               approval="pending" if type in ("request", "change") else None,
               sla_due_at=now() + timedelta(hours=SLA_HOURS.get(priority, 24)))
    db.add(t)
    db.flush()
    return t


def sla_state(t: Ticket) -> str:
    if t.status in ("resolved", "closed"):
        return "met" if t.resolved_at and t.sla_due_at and t.resolved_at <= t.sla_due_at else "breached"
    if not t.sla_due_at:
        return "none"
    left = (t.sla_due_at - now()).total_seconds()
    return "breached" if left < 0 else "at_risk" if left < 2 * 3600 else "on_track"


def ticket_out(t: Ticket, device: Device | None = None) -> dict:
    return {
        "id": str(t.id), "number": t.number, "type": t.type, "title": t.title, "description": t.description,
        "priority": t.priority, "status": t.status, "category": t.category, "requester": t.requester,
        "assignee": t.assignee, "approval": t.approval, "source": t.source,
        "device": device_brief(device) if device else None,
        "sla_due_at": t.sla_due_at, "sla": sla_state(t), "created_at": t.created_at,
        "updated_at": t.updated_at, "resolved_at": t.resolved_at,
    }


@router.get("")
def list_tickets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (db.query(Ticket, Device).outerjoin(Device, Device.id == Ticket.device_id)
            .filter(Ticket.tenant_id == user.tenant_id).order_by(Ticket.created_at.desc()).all())
    return [ticket_out(t, d) for t, d in rows]


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Ticket).filter(Ticket.tenant_id == user.tenant_id).all()
    open_t = [t for t in rows if t.status in OPEN]
    done = [t for t in rows if t.resolved_at]
    met = [t for t in done if sla_state(t) == "met"]
    avg_h = (sum((t.resolved_at - t.created_at).total_seconds() for t in done) / len(done) / 3600) if done else None
    return {
        "open": len(open_t),
        "unassigned": sum(1 for t in open_t if not t.assignee),
        "breached": sum(1 for t in open_t if sla_state(t) == "breached"),
        "awaiting_approval": sum(1 for t in open_t if t.approval == "pending"),
        "by_priority": {p: sum(1 for t in open_t if t.priority == p) for p in SLA_HOURS},
        "sla_met_pct": round(100 * len(met) / len(done), 1) if done else None,
        "avg_resolution_hours": round(avg_h, 1) if avg_h is not None else None,
    }


class TicketCreate(BaseModel):
    type: str = "incident"
    title: str
    description: str | None = None
    priority: str = "medium"
    category: str | None = None
    requester: str | None = None
    device_id: uuid.UUID | None = None
    source: str = "console"


@router.post("")
def create_ticket(req: TicketCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if req.type not in PREFIX:
        raise HTTPException(400, "Type must be incident, request, or change")
    if req.priority not in SLA_HOURS:
        raise HTTPException(400, "Priority must be critical, high, medium, or low")
    if not req.title.strip():
        raise HTTPException(400, "A title is required")
    if req.device_id and not db.query(Device).filter(Device.id == req.device_id, Device.tenant_id == user.tenant_id).first():
        raise HTTPException(400, "Unknown device")
    t = create_ticket_record(db, user.tenant_id, type=req.type, title=req.title.strip(), description=req.description,
                             priority=req.priority, category=req.category, requester=req.requester or user.username,
                             device_id=req.device_id, source=req.source if req.source in ("console", "portal") else "console")
    audit(db, user, user.tenant_id, "ticket.created", "ticket", t.id, {"number": t.number, "title": t.title})
    db.commit()
    return ticket_out(t)


@router.get("/{ticket_id}")
def get_ticket(ticket_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == user.tenant_id).first()
    if not t:
        raise HTTPException(404, "Ticket not found")
    device = db.query(Device).filter(Device.id == t.device_id).first() if t.device_id else None
    comments = (db.query(TicketComment).filter(TicketComment.ticket_id == t.id)
                .order_by(TicketComment.created_at).all())
    out = ticket_out(t, device)
    out["comments"] = [{"author": c.author, "body": c.body, "internal": c.internal == "yes", "created_at": c.created_at} for c in comments]
    return out


class TicketUpdate(BaseModel):
    status: str | None = None
    priority: str | None = None
    assignee: str | None = None
    approval: str | None = None


@router.patch("/{ticket_id}")
def update_ticket(ticket_id: uuid.UUID, req: TicketUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == user.tenant_id).first()
    if not t:
        raise HTTPException(404, "Ticket not found")
    changes = {}
    if req.status and req.status != t.status:
        if req.status not in (*OPEN, "resolved", "closed"):
            raise HTTPException(400, "Unknown status")
        changes["status"] = [t.status, req.status]
        t.status = req.status
        t.resolved_at = now() if req.status in ("resolved", "closed") else None
    if req.priority and req.priority != t.priority:
        if req.priority not in SLA_HOURS:
            raise HTTPException(400, "Unknown priority")
        changes["priority"] = [t.priority, req.priority]
        t.priority = req.priority
        t.sla_due_at = t.created_at + timedelta(hours=SLA_HOURS[req.priority])
    if req.assignee is not None and req.assignee != t.assignee:
        changes["assignee"] = [t.assignee, req.assignee or None]
        t.assignee = req.assignee or None
    if req.approval and req.approval != t.approval:
        if req.approval not in ("approved", "rejected", "pending"):
            raise HTTPException(400, "Unknown approval")
        changes["approval"] = [t.approval, req.approval]
        t.approval = req.approval
    t.updated_at = now()
    if changes:
        db.add(TicketComment(ticket_id=t.id, tenant_id=t.tenant_id, author="NEXUS", internal="yes",
                             body="; ".join(f"{k} changed from {a or 'none'} to {b or 'none'}" for k, (a, b) in changes.items())
                             + f" by {user.username}"))
        audit(db, user, user.tenant_id, "ticket.updated", "ticket", t.id, {"number": t.number, **{k: v[1] for k, v in changes.items()}})
    db.commit()
    return ticket_out(t)


class CommentCreate(BaseModel):
    body: str
    internal: bool = False


@router.post("/{ticket_id}/comments")
def add_comment(ticket_id: uuid.UUID, req: CommentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == user.tenant_id).first()
    if not t:
        raise HTTPException(404, "Ticket not found")
    if not req.body.strip():
        raise HTTPException(400, "Comment is empty")
    db.add(TicketComment(ticket_id=t.id, tenant_id=t.tenant_id, author=user.username, body=req.body.strip(),
                         internal="yes" if req.internal else "no"))
    t.updated_at = now()
    db.commit()
    return {"ok": True}
