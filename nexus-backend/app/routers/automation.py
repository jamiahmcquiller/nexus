import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Workflow, WorkflowRun, Ticket, Device, DeviceVulnerability, Vulnerability, SoftwareRule, Group, DeviceGroup, User
from ..auth import get_current_user
from .common import audit, now, tenant_devices, warranty_status
from .servicedesk import create_ticket_record, OPEN

router = APIRouter(prefix="/api/v1/workflows", tags=["automation"])

TRIGGERS = {
    "device_offline": "A device has not checked in for a set number of hours",
    "critical_vulnerability": "A device has an open critical vulnerability",
    "low_disk": "A device is below a free disk space threshold",
    "warranty_expiring": "A device's warranty ends within a set number of days",
    "unapproved_software": "A device has software marked unapproved",
}
ACTIONS = {
    "create_ticket": "Open a service desk ticket for each matching device",
    "add_to_group": "Add matching devices to a group",
    "notify": "Record an alert in the activity log",
}


def match_devices(db: Session, tenant_id, trigger: dict) -> list[tuple[Device, str]]:
    """Return (device, reason) for every device that meets the trigger right now."""
    kind = trigger.get("type")
    devices = tenant_devices(db, tenant_id)
    out = []
    if kind == "device_offline":
        hours = float(trigger.get("hours", 24))
        cutoff = now() - timedelta(hours=hours)
        out = [(d, f"No check-in for over {hours:g} hours") for d in devices if not d.last_checkin_at or d.last_checkin_at < cutoff]
    elif kind == "critical_vulnerability":
        rows = (db.query(DeviceVulnerability, Vulnerability).join(Vulnerability, Vulnerability.id == DeviceVulnerability.vulnerability_id)
                .filter(DeviceVulnerability.tenant_id == tenant_id, DeviceVulnerability.status == "open", Vulnerability.severity == "critical").all())
        by_dev: dict = {}
        for f, v in rows:
            by_dev.setdefault(f.device_id, []).append(v.cve_id)
        out = [(d, "Open critical: " + ", ".join(by_dev[d.id][:3])) for d in devices if d.id in by_dev]
    elif kind == "low_disk":
        pct = float(trigger.get("percent", 15))
        for d in devices:
            hw = (d.attributes or {}).get("hardware") or {}
            if hw.get("disk_total_gb") and hw.get("disk_free_gb") is not None:
                free = 100 * hw["disk_free_gb"] / hw["disk_total_gb"]
                if free < pct:
                    out.append((d, f"Only {free:.0f}% disk space free"))
    elif kind == "warranty_expiring":
        days = int(trigger.get("days", 90))
        for d in devices:
            w = warranty_status(d.attributes or {})
            if w["days_left"] is not None and w["days_left"] <= days:
                out.append((d, "Warranty expired" if w["days_left"] < 0 else f"Warranty ends in {w['days_left']} days"))
    elif kind == "unapproved_software":
        banned = {r.name.lower() for r in db.query(SoftwareRule).filter(SoftwareRule.tenant_id == tenant_id, SoftwareRule.status == "unapproved").all()}
        for d in devices:
            hits = [s["name"] for s in (d.attributes or {}).get("software") or [] if s.get("name", "").lower() in banned]
            if hits:
                out.append((d, "Unapproved software: " + ", ".join(hits)))
    return out


def run_workflow(db: Session, wf: Workflow, user: User | None) -> WorkflowRun:
    matches = match_devices(db, wf.tenant_id, wf.trigger or {})
    action = wf.action or {}
    taken = 0
    details = []
    for d, reason in matches:
        if action.get("type") == "create_ticket":
            title = f"{wf.name}: {d.hostname}"
            exists = db.query(Ticket).filter(Ticket.tenant_id == wf.tenant_id, Ticket.device_id == d.id,
                                             Ticket.title == title, Ticket.status.in_(OPEN)).first()
            if exists:
                details.append({"device": d.hostname, "result": f"Already open as {exists.number}"})
                continue
            t = create_ticket_record(db, wf.tenant_id, type="incident", title=title, description=reason,
                                     priority=action.get("priority", "medium"), category=action.get("category", "Automation"),
                                     requester="NEXUS Automation", device_id=d.id, source="automation")
            details.append({"device": d.hostname, "result": f"Opened {t.number}"})
            taken += 1
        elif action.get("type") == "add_to_group" and action.get("group_id"):
            gid = uuid.UUID(action["group_id"])
            if not db.query(DeviceGroup).filter(DeviceGroup.device_id == d.id, DeviceGroup.group_id == gid).first():
                db.add(DeviceGroup(device_id=d.id, group_id=gid))
                taken += 1
                details.append({"device": d.hostname, "result": "Added to group"})
            else:
                details.append({"device": d.hostname, "result": "Already in group"})
        else:
            details.append({"device": d.hostname, "result": reason})
            taken += 1
    run = WorkflowRun(workflow_id=wf.id, tenant_id=wf.tenant_id, status="succeeded" if matches else "no_matches",
                      matched=str(len(matches)), actions_taken=str(taken), detail={"items": details})
    db.add(run)
    wf.last_run_at = now()
    wf.run_count = str(int(wf.run_count or 0) + 1)
    audit(db, user, wf.tenant_id, "workflow.ran", "workflow", wf.id, {"name": wf.name, "matched": len(matches), "actions": taken})
    return run


def wf_out(db: Session, w: Workflow) -> dict:
    last = (db.query(WorkflowRun).filter(WorkflowRun.workflow_id == w.id).order_by(WorkflowRun.started_at.desc()).first())
    return {"id": str(w.id), "name": w.name, "description": w.description, "trigger": w.trigger, "action": w.action,
            "enabled": w.enabled == "yes", "schedule": w.schedule, "last_run_at": w.last_run_at,
            "run_count": int(w.run_count or 0),
            "last_run": {"status": last.status, "matched": int(last.matched), "actions_taken": int(last.actions_taken)} if last else None}


@router.get("/catalog")
def catalog():
    return {"triggers": TRIGGERS, "actions": ACTIONS}


@router.get("")
def list_workflows(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Workflow).filter(Workflow.tenant_id == user.tenant_id).order_by(Workflow.created_at).all()
    return [wf_out(db, w) for w in rows]


class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    trigger: dict
    action: dict
    schedule: str | None = "Every hour"


@router.post("")
def create_workflow(req: WorkflowCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if req.trigger.get("type") not in TRIGGERS or req.action.get("type") not in ACTIONS:
        raise HTTPException(400, "Unknown trigger or action")
    if req.action.get("type") == "add_to_group" and not db.query(Group).filter(
            Group.tenant_id == user.tenant_id, Group.id == uuid.UUID(req.action.get("group_id", str(uuid.uuid4())))).first():
        raise HTTPException(400, "Choose a group")
    w = Workflow(tenant_id=user.tenant_id, name=req.name.strip() or "Untitled workflow", description=req.description,
                 trigger=req.trigger, action=req.action, schedule=req.schedule)
    db.add(w)
    db.flush()
    audit(db, user, user.tenant_id, "workflow.created", "workflow", w.id, {"name": w.name})
    db.commit()
    return wf_out(db, w)


@router.post("/{wf_id}/toggle")
def toggle(wf_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    w = db.query(Workflow).filter(Workflow.id == wf_id, Workflow.tenant_id == user.tenant_id).first()
    if not w:
        raise HTTPException(404, "Workflow not found")
    w.enabled = "no" if w.enabled == "yes" else "yes"
    audit(db, user, user.tenant_id, "workflow.updated", "workflow", w.id, {"name": w.name, "enabled": w.enabled})
    db.commit()
    return wf_out(db, w)


@router.post("/{wf_id}/run")
def run_now(wf_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    w = db.query(Workflow).filter(Workflow.id == wf_id, Workflow.tenant_id == user.tenant_id).first()
    if not w:
        raise HTTPException(404, "Workflow not found")
    run = run_workflow(db, w, user)
    db.commit()
    return {"status": run.status, "matched": int(run.matched), "actions_taken": int(run.actions_taken), "detail": run.detail}


@router.get("/{wf_id}/runs")
def runs(wf_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (db.query(WorkflowRun).filter(WorkflowRun.workflow_id == wf_id, WorkflowRun.tenant_id == user.tenant_id)
            .order_by(WorkflowRun.started_at.desc()).limit(20).all())
    return [{"status": r.status, "matched": int(r.matched), "actions_taken": int(r.actions_taken),
             "detail": r.detail, "started_at": r.started_at} for r in rows]
