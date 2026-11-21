import uuid
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Patch, DevicePatch, PatchDeployment, DeploymentPolicy, Device, DeviceGroup, User
from ..auth import get_current_user
from .common import audit, is_online, now, tenant_devices

router = APIRouter(prefix="/api/v1/patches", tags=["patches"])


def _counts(rows: list[DevicePatch]) -> dict:
    c = {"missing": 0, "installed": 0, "failed": 0}
    for r in rows:
        c[r.status] = c.get(r.status, 0) + 1
    return c


def compliance_pct(db: Session, tenant_id, device_ids: set | None = None) -> float | None:
    """Share of approved patches installed across devices (None if nothing is approved yet)."""
    q = (db.query(DevicePatch).join(Patch, Patch.id == DevicePatch.patch_id)
         .filter(DevicePatch.tenant_id == tenant_id, Patch.approval == "approved"))
    rows = [r for r in q.all() if device_ids is None or r.device_id in device_ids]
    if not rows:
        return None
    return round(100 * sum(1 for r in rows if r.status == "installed") / len(rows), 1)


@router.get("")
def list_patches(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    patches = db.query(Patch).filter(Patch.tenant_id == user.tenant_id).order_by(Patch.release_date.desc()).all()
    rows = db.query(DevicePatch).filter(DevicePatch.tenant_id == user.tenant_id).all()
    by_patch = defaultdict(list)
    for r in rows:
        by_patch[r.patch_id].append(r)
    return [{
        "id": str(p.id), "kb_id": p.kb_id, "title": p.title, "product": p.product,
        "classification": p.classification, "severity": p.severity, "release_date": p.release_date,
        "size_mb": p.size_mb, "approval": p.approval, "approved_by": p.approved_by, "approved_at": p.approved_at,
        **_counts(by_patch[p.id]),
    } for p in patches]


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tid = user.tenant_id
    patches = db.query(Patch).filter(Patch.tenant_id == tid).all()
    rows = db.query(DevicePatch).filter(DevicePatch.tenant_id == tid).all()
    approved = {p.id for p in patches if p.approval == "approved"}
    missing_by_device = defaultdict(int)
    for r in rows:
        if r.patch_id in approved and r.status != "installed":
            missing_by_device[r.device_id] += 1
    devices = tenant_devices(db, tid)
    return {
        "compliance": compliance_pct(db, tid),
        "pending_approval": sum(1 for p in patches if p.approval == "pending"),
        "approved": len(approved),
        "failed_installs": sum(1 for r in rows if r.status == "failed"),
        "missing_installs": sum(1 for r in rows if r.patch_id in approved and r.status == "missing"),
        "devices_fully_patched": sum(1 for d in devices if missing_by_device.get(d.id, 0) == 0),
        "devices_total": len(devices),
        "scheduled_deployments": db.query(PatchDeployment).filter(
            PatchDeployment.tenant_id == tid, PatchDeployment.status == "scheduled").count(),
    }


class ApprovalUpdate(BaseModel):
    approval: str


@router.post("/{patch_id}/approval")
def set_approval(patch_id: uuid.UUID, req: ApprovalUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if req.approval not in ("pending", "approved", "declined"):
        raise HTTPException(400, "Approval must be pending, approved, or declined")
    p = db.query(Patch).filter(Patch.id == patch_id, Patch.tenant_id == user.tenant_id).first()
    if not p:
        raise HTTPException(404, "Patch not found")
    p.approval = req.approval
    p.approved_by = user.username if req.approval != "pending" else None
    p.approved_at = now() if req.approval != "pending" else None
    audit(db, user, user.tenant_id, f"patch.{req.approval}", "patch", p.id, {"name": p.kb_id})
    db.commit()
    return {"approval": p.approval}


@router.get("/device/{device_id}")
def device_patches(device_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (db.query(DevicePatch, Patch).join(Patch, Patch.id == DevicePatch.patch_id)
            .filter(DevicePatch.tenant_id == user.tenant_id, DevicePatch.device_id == device_id).all())
    return [{"id": str(p.id), "kb_id": p.kb_id, "title": p.title, "severity": p.severity,
             "approval": p.approval, "status": r.status, "updated_at": r.updated_at} for r, p in rows]


# --- Deployments ----------------------------------------------------------
class DeploymentCreate(BaseModel):
    name: str
    patch_ids: list[str]
    target: dict = {"type": "all"}
    scheduled_for: datetime | None = None


def _target_devices(db: Session, tenant_id, target: dict) -> list[Device]:
    devices = tenant_devices(db, tenant_id)
    if target.get("type") == "group" and target.get("group_id"):
        ids = {r.device_id for r in db.query(DeviceGroup).filter(DeviceGroup.group_id == uuid.UUID(target["group_id"])).all()}
        devices = [d for d in devices if d.id in ids]
    return devices


def _deployment_out(d: PatchDeployment) -> dict:
    return {"id": str(d.id), "name": d.name, "status": d.status, "scheduled_for": d.scheduled_for,
            "patch_count": len(d.patch_ids or []), "target": d.target, "results": d.results or {},
            "created_by": d.created_by, "created_at": d.created_at, "completed_at": d.completed_at}


@router.get("/deployments")
def list_deployments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(PatchDeployment).filter(PatchDeployment.tenant_id == user.tenant_id).order_by(PatchDeployment.created_at.desc()).all()
    return [_deployment_out(d) for d in rows]


@router.post("/deployments")
def create_deployment(req: DeploymentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not req.patch_ids:
        raise HTTPException(400, "Choose at least one patch")
    d = PatchDeployment(tenant_id=user.tenant_id, name=req.name.strip() or "Patch deployment",
                        patch_ids=req.patch_ids, target=req.target, scheduled_for=req.scheduled_for or now(),
                        created_by=user.username, results={})
    db.add(d)
    db.flush()
    audit(db, user, user.tenant_id, "deployment.scheduled", "deployment", d.id, {"name": d.name})
    db.commit()
    return _deployment_out(d)


@router.post("/deployments/{dep_id}/run")
def run_deployment(dep_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Run a deployment now. Online devices install the patches; offline devices stay pending
    until they next check in. (Until the agent can install patches, installs are simulated.)"""
    d = db.query(PatchDeployment).filter(PatchDeployment.id == dep_id, PatchDeployment.tenant_id == user.tenant_id).first()
    if not d:
        raise HTTPException(404, "Deployment not found")
    devices = _target_devices(db, user.tenant_id, d.target or {})
    patch_ids = [uuid.UUID(p) for p in d.patch_ids or []]
    ok = pending = failed = 0
    for dev in devices:
        for pid in patch_ids:
            row = db.query(DevicePatch).filter(DevicePatch.device_id == dev.id, DevicePatch.patch_id == pid).first()
            if not row or row.status == "installed":
                continue
            if not is_online(dev):
                pending += 1
                continue
            disk = ((dev.attributes or {}).get("hardware") or {}).get("disk_free_gb", 100)
            row.status = "failed" if disk is not None and disk < 20 else "installed"
            row.updated_at = now()
            ok += row.status == "installed"
            failed += row.status == "failed"
    d.results = {"succeeded": ok, "failed": failed, "pending": pending, "devices": len(devices)}
    d.status = "failed" if failed and not ok else "completed"
    d.completed_at = now()
    audit(db, user, user.tenant_id, "deployment.completed", "deployment", d.id, {"name": d.name, **d.results})
    db.commit()
    return _deployment_out(d)


# --- Policies -------------------------------------------------------------
class PolicyCreate(BaseModel):
    name: str
    description: str | None = None
    rules: dict = {}


@router.get("/policies")
def list_policies(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(DeploymentPolicy).filter(DeploymentPolicy.tenant_id == user.tenant_id).order_by(DeploymentPolicy.created_at).all()
    return [{"id": str(p.id), "name": p.name, "description": p.description, "rules": p.rules or {},
             "enabled": p.enabled == "yes", "created_at": p.created_at} for p in rows]


@router.post("/policies")
def create_policy(req: PolicyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = DeploymentPolicy(tenant_id=user.tenant_id, name=req.name, description=req.description, rules=req.rules)
    db.add(p)
    db.flush()
    audit(db, user, user.tenant_id, "policy.created", "policy", p.id, {"name": p.name})
    db.commit()
    return {"id": str(p.id)}


@router.post("/policies/{policy_id}/toggle")
def toggle_policy(policy_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.query(DeploymentPolicy).filter(DeploymentPolicy.id == policy_id, DeploymentPolicy.tenant_id == user.tenant_id).first()
    if not p:
        raise HTTPException(404, "Policy not found")
    p.enabled = "no" if p.enabled == "yes" else "yes"
    audit(db, user, user.tenant_id, "policy.updated", "policy", p.id, {"name": p.name, "enabled": p.enabled})
    db.commit()
    return {"enabled": p.enabled == "yes"}
