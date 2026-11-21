import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ControlStatus, Risk, AuditEvent, DeviceVulnerability, Vulnerability, SoftwareRule, User
from ..auth import get_current_user
from .common import audit, now, tenant_devices, warranty_status
from .patches import compliance_pct

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])

# Control catalog. "auto" controls are evaluated live from NEXUS data; "manual" controls
# are tracked with an owner, status, and evidence notes.
# References: CIS Critical Security Controls v8 safeguards and NIST CSF 1.1 subcategories.
CONTROLS = [
    {"key": "asset_inventory", "title": "Maintain an accurate asset inventory", "category": "Asset management",
     "cis": "1.1", "nist": "ID.AM-1", "mode": "auto", "detail": "Every enrolled device has checked in within 7 days."},
    {"key": "software_inventory", "title": "Address unauthorized software", "category": "Asset management",
     "cis": "2.3", "nist": "ID.AM-2", "mode": "auto", "detail": "No device runs software marked unapproved."},
    {"key": "disk_encryption", "title": "Encrypt data on end-user devices", "category": "Data protection",
     "cis": "3.6", "nist": "PR.DS-1", "mode": "auto", "detail": "BitLocker is enabled on every device."},
    {"key": "firewall", "title": "Host-based firewall on end-user devices", "category": "Secure configuration",
     "cis": "4.5", "nist": "PR.AC-5", "mode": "auto", "detail": "Windows Firewall is on for every device."},
    {"key": "antimalware", "title": "Deploy and maintain anti-malware software", "category": "Malware defense",
     "cis": "10.1", "nist": "DE.CM-4", "mode": "auto", "detail": "Microsoft Defender is active on every device."},
    {"key": "patching", "title": "Perform automated operating system patch management", "category": "Vulnerability management",
     "cis": "7.3", "nist": "PR.IP-12", "mode": "auto", "detail": "At least 95% of approved patches are installed."},
    {"key": "critical_vulns", "title": "Remediate critical vulnerabilities promptly", "category": "Vulnerability management",
     "cis": "7.7", "nist": "RS.MI-3", "mode": "auto", "detail": "No critical vulnerability stays open longer than 15 days."},
    {"key": "audit_logging", "title": "Collect audit logs", "category": "Logging & monitoring",
     "cis": "8.2", "nist": "PR.PT-1", "mode": "auto", "detail": "Administrative actions in NEXUS are recorded in the audit log."},
    {"key": "hardware_support", "title": "Keep hardware under vendor support", "category": "Asset management",
     "cis": None, "nist": None, "mode": "auto", "detail": "Every device has an active warranty (internal policy)."},
    {"key": "account_inventory", "title": "Maintain an inventory of accounts and review access", "category": "Access control",
     "cis": "5.1", "nist": "PR.AC-1", "mode": "manual", "detail": "User and admin accounts are listed and reviewed quarterly."},
    {"key": "mfa_admin", "title": "Require MFA for administrative access", "category": "Access control",
     "cis": "6.5", "nist": "PR.AC-7", "mode": "manual", "detail": "All administrator accounts use multi-factor authentication."},
    {"key": "backups", "title": "Perform automated backups", "category": "Data recovery",
     "cis": "11.2", "nist": "PR.IP-4", "mode": "manual", "detail": "Critical data is backed up automatically and restores are tested."},
    {"key": "awareness", "title": "Security awareness training program", "category": "People",
     "cis": "14.1", "nist": "PR.AT-1", "mode": "manual", "detail": "Staff complete security awareness training each year."},
    {"key": "ir_plan", "title": "Incident response process", "category": "Incident response",
     "cis": "17.4", "nist": "RS.RP-1", "mode": "manual", "detail": "A written incident response plan exists and is tested."},
]


def _ratio(passing: int, total: int) -> tuple[str, float]:
    if total == 0:
        return "not_started", 0.0
    pct = round(100 * passing / total, 1)
    return ("passing" if passing == total else "failing"), pct


def evaluate(db: Session, tenant_id) -> dict:
    devices = tenant_devices(db, tenant_id)
    n = len(devices)
    res: dict = {}
    sec = lambda d, k: ((d.attributes or {}).get("security") or {}).get(k)
    week = now() - timedelta(days=7)
    for key, check in [
        ("asset_inventory", lambda d: bool(d.last_checkin_at and d.last_checkin_at >= week)),
        ("disk_encryption", lambda d: sec(d, "bitlocker") is True),
        ("firewall", lambda d: sec(d, "firewall") is True),
        ("antimalware", lambda d: sec(d, "defender") is True),
        ("hardware_support", lambda d: warranty_status(d.attributes or {})["status"] in ("active", "expiring")),
    ]:
        ok = [d for d in devices if check(d)]
        status, pct = _ratio(len(ok), n)
        res[key] = {"status": status, "score": pct, "evidence": f"{len(ok)} of {n} devices compliant",
                    "failing_devices": [d.hostname for d in devices if not check(d)][:25]}
    banned = {r.name.lower() for r in db.query(SoftwareRule).filter(SoftwareRule.tenant_id == tenant_id, SoftwareRule.status == "unapproved").all()}
    bad = [d for d in devices if any(s.get("name", "").lower() in banned for s in (d.attributes or {}).get("software") or [])]
    status, pct = _ratio(n - len(bad), n)
    res["software_inventory"] = {"status": status, "score": pct, "evidence": f"{len(bad)} devices with unapproved software",
                                 "failing_devices": [d.hostname for d in bad][:25]}
    pc = compliance_pct(db, tenant_id)
    res["patching"] = {"status": "not_started" if pc is None else ("passing" if pc >= 95 else "failing"),
                       "score": pc or 0, "evidence": "No approved patches yet" if pc is None else f"{pc}% of approved patches installed",
                       "failing_devices": []}
    old = now() - timedelta(days=15)
    stale = (db.query(DeviceVulnerability).join(Vulnerability, Vulnerability.id == DeviceVulnerability.vulnerability_id)
             .filter(DeviceVulnerability.tenant_id == tenant_id, DeviceVulnerability.status == "open",
                     Vulnerability.severity == "critical", DeviceVulnerability.first_detected < old).count())
    res["critical_vulns"] = {"status": "passing" if stale == 0 else "failing", "score": 100 if stale == 0 else 0,
                             "evidence": f"{stale} critical findings open longer than 15 days", "failing_devices": []}
    logs = db.query(AuditEvent).filter(AuditEvent.tenant_id == tenant_id).count()
    res["audit_logging"] = {"status": "passing", "score": 100, "evidence": f"{logs} events recorded", "failing_devices": []}
    return res


@router.get("/controls")
def controls(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    auto = evaluate(db, user.tenant_id)
    manual = {c.control_key: c for c in db.query(ControlStatus).filter(ControlStatus.tenant_id == user.tenant_id).all()}
    out = []
    for c in CONTROLS:
        m = manual.get(c["key"])
        if c["mode"] == "auto":
            row = {**c, **auto.get(c["key"], {}), "owner": m.owner if m else None, "notes": m.evidence if m else None}
        else:
            row = {**c, "status": m.status if m else "not_started", "score": 100 if m and m.status == "passing" else 0,
                   "evidence": m.evidence if m else None, "owner": m.owner if m else None,
                   "updated_at": m.updated_at if m else None, "failing_devices": []}
        out.append(row)
    return out


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = controls(db, user)
    passing = sum(1 for r in rows if r["status"] == "passing")
    fw = lambda k: [r for r in rows if r.get(k)]
    risks = db.query(Risk).filter(Risk.tenant_id == user.tenant_id, Risk.status.in_(("open", "mitigating"))).all()
    return {
        "passing": passing, "total": len(rows), "score": round(100 * passing / len(rows), 1),
        "frameworks": [
            {"name": "CIS Controls v8", "passing": sum(1 for r in fw("cis") if r["status"] == "passing"), "total": len(fw("cis"))},
            {"name": "NIST CSF", "passing": sum(1 for r in fw("nist") if r["status"] == "passing"), "total": len(fw("nist"))},
        ],
        "open_risks": len(risks),
        "high_risks": sum(1 for r in risks if int(r.likelihood) * int(r.impact) >= 15),
    }


class ControlUpdate(BaseModel):
    status: str | None = None
    owner: str | None = None
    evidence: str | None = None


@router.patch("/controls/{key}")
def update_control(key: str, req: ControlUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = next((c for c in CONTROLS if c["key"] == key), None)
    if not c:
        raise HTTPException(404, "Control not found")
    if req.status and (c["mode"] == "auto" or req.status not in ("passing", "failing", "in_progress", "not_started")):
        raise HTTPException(400, "Status can only be set on manual controls")
    row = db.query(ControlStatus).filter(ControlStatus.tenant_id == user.tenant_id, ControlStatus.control_key == key).first()
    if not row:
        row = ControlStatus(tenant_id=user.tenant_id, control_key=key)
        db.add(row)
    if req.status:
        row.status = req.status
    if req.owner is not None:
        row.owner = req.owner or None
    if req.evidence is not None:
        row.evidence = req.evidence or None
    row.updated_at = now()
    audit(db, user, user.tenant_id, "control.updated", "control", None, {"name": c["title"], "status": row.status})
    db.commit()
    return {"ok": True}


# --- Risk register --------------------------------------------------------
class RiskIn(BaseModel):
    title: str | None = None
    description: str | None = None
    likelihood: int | None = None
    impact: int | None = None
    owner: str | None = None
    status: str | None = None
    treatment: str | None = None


def risk_out(r: Risk) -> dict:
    score = int(r.likelihood) * int(r.impact)
    return {"id": str(r.id), "title": r.title, "description": r.description, "likelihood": int(r.likelihood),
            "impact": int(r.impact), "score": score, "level": "high" if score >= 15 else "medium" if score >= 8 else "low",
            "owner": r.owner, "status": r.status, "treatment": r.treatment, "updated_at": r.updated_at}


@router.get("/risks")
def list_risks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Risk).filter(Risk.tenant_id == user.tenant_id).all()
    return sorted([risk_out(r) for r in rows], key=lambda r: (r["status"] == "closed", -r["score"]))


@router.post("/risks")
def create_risk(req: RiskIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not req.title or not req.title.strip():
        raise HTTPException(400, "A title is required")
    r = Risk(tenant_id=user.tenant_id, title=req.title.strip(), description=req.description,
             likelihood=str(min(max(req.likelihood or 3, 1), 5)), impact=str(min(max(req.impact or 3, 1), 5)),
             owner=req.owner, status=req.status or "open", treatment=req.treatment)
    db.add(r)
    db.flush()
    audit(db, user, user.tenant_id, "risk.created", "risk", r.id, {"name": r.title})
    db.commit()
    return risk_out(r)


@router.patch("/risks/{risk_id}")
def update_risk(risk_id: uuid.UUID, req: RiskIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id == user.tenant_id).first()
    if not r:
        raise HTTPException(404, "Risk not found")
    for f in ("title", "description", "owner", "treatment"):
        if getattr(req, f) is not None:
            setattr(r, f, getattr(req, f))
    if req.status:
        if req.status not in ("open", "mitigating", "accepted", "closed"):
            raise HTTPException(400, "Unknown status")
        r.status = req.status
    if req.likelihood:
        r.likelihood = str(min(max(req.likelihood, 1), 5))
    if req.impact:
        r.impact = str(min(max(req.impact, 1), 5))
    r.updated_at = now()
    audit(db, user, user.tenant_id, "risk.updated", "risk", r.id, {"name": r.title, "status": r.status})
    db.commit()
    return risk_out(r)


@router.get("/audit-log")
def audit_log(limit: int = 200, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (db.query(AuditEvent).filter(AuditEvent.tenant_id == user.tenant_id)
            .order_by(AuditEvent.occurred_at.desc()).limit(min(limit, 1000)).all())
    users = {u.id: u.username for u in db.query(User).filter(User.tenant_id == user.tenant_id).all()}
    return [{"action": e.action, "entity_type": e.entity_type, "entity_id": str(e.entity_id) if e.entity_id else None,
             "actor": users.get(e.actor_user_id) or (e.event_metadata or {}).get("actor") or "System",
             "metadata": e.event_metadata or {}, "occurred_at": e.occurred_at} for e in rows]
