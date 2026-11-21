from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import SoftwareRule, User
from ..auth import get_current_user
from .common import audit, device_brief, tenant_devices

router = APIRouter(prefix="/api/v1/software", tags=["software"])


@router.get("")
def software_inventory(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every application seen across the fleet, with versions, install counts, and approval status."""
    rules = {r.name.lower(): r for r in db.query(SoftwareRule).filter(SoftwareRule.tenant_id == user.tenant_id).all()}
    apps: dict = {}
    for d in tenant_devices(db, user.tenant_id):
        for s in (d.attributes or {}).get("software") or []:
            key = s.get("name", "").strip()
            if not key:
                continue
            a = apps.setdefault(key.lower(), {"name": key, "publisher": s.get("publisher"), "versions": defaultdict(int), "devices": []})
            a["versions"][s.get("version") or "Unknown"] += 1
            a["devices"].append({**device_brief(d), "version": s.get("version")})
    out = []
    for k, a in apps.items():
        rule = rules.get(k)
        versions = sorted(a["versions"].items(), key=lambda x: -x[1])
        out.append({
            "name": a["name"], "publisher": a["publisher"], "installs": len(a["devices"]),
            "versions": [{"version": v, "count": c} for v, c in versions],
            "status": rule.status if rule else "unreviewed", "note": rule.note if rule else None,
            "devices": a["devices"],
        })
    return sorted(out, key=lambda x: (-x["installs"], x["name"]))


class RuleUpdate(BaseModel):
    name: str
    status: str
    note: str | None = None


@router.post("/rules")
def set_rule(req: RuleUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if req.status not in ("approved", "unapproved", "unreviewed"):
        raise HTTPException(400, "Status must be approved, unapproved, or unreviewed")
    rule = (db.query(SoftwareRule).filter(SoftwareRule.tenant_id == user.tenant_id)
            .filter(SoftwareRule.name.ilike(req.name)).first())
    if req.status == "unreviewed":
        if rule:
            db.delete(rule)
    elif rule:
        rule.status, rule.note = req.status, req.note
    else:
        db.add(SoftwareRule(tenant_id=user.tenant_id, name=req.name, status=req.status, note=req.note))
    audit(db, user, user.tenant_id, f"software.{req.status}", "software", None, {"name": req.name})
    db.commit()
    return {"status": req.status}
