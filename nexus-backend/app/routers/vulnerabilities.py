import uuid
from collections import Counter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Vulnerability, DeviceVulnerability, Device, User
from ..auth import get_current_user
from .common import audit, device_brief, now, SEVERITY_ORDER

router = APIRouter(prefix="/api/v1/vulnerabilities", tags=["vulnerabilities"])


def risk_score(v: Vulnerability, affected: int) -> float:
    """Prioritize beyond raw CVSS: exploitation in the wild, exploit likelihood, and spread."""
    cvss = float((v.cvss or {}).get("score") or 0)
    epss = float((v.epss or {}).get("score") or 0)
    score = cvss * 6 + epss * 20 + (15 if v.known_exploited == "yes" else 0) + min(affected, 20)
    return round(min(score, 100), 1)


def _vuln_out(v: Vulnerability, findings: list[DeviceVulnerability]) -> dict:
    open_f = [f for f in findings if f.status == "open"]
    return {
        "id": str(v.id), "cve_id": v.cve_id, "title": v.title, "description": v.description,
        "severity": v.severity, "cvss": (v.cvss or {}).get("score"), "cvss_vector": (v.cvss or {}).get("vector"),
        "epss": (v.epss or {}).get("score"), "known_exploited": v.known_exploited == "yes",
        "product": v.product, "fixed_version": v.fixed_version, "published_at": v.published_at,
        "affected_open": len(open_f), "affected_total": len(findings),
        "remediated": sum(1 for f in findings if f.status == "remediated"),
        "accepted": sum(1 for f in findings if f.status == "accepted"),
        "first_detected": min((f.first_detected for f in findings if f.first_detected), default=None),
        "risk_score": risk_score(v, len(open_f)),
    }


@router.get("")
def list_vulnerabilities(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    vulns = db.query(Vulnerability).filter(Vulnerability.tenant_id == user.tenant_id).all()
    findings = db.query(DeviceVulnerability).filter(DeviceVulnerability.tenant_id == user.tenant_id).all()
    by_vuln: dict = {}
    for f in findings:
        by_vuln.setdefault(f.vulnerability_id, []).append(f)
    out = [_vuln_out(v, by_vuln.get(v.id, [])) for v in vulns]
    return sorted(out, key=lambda x: (-x["affected_open"] > 0, -x["risk_score"]))


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tid = user.tenant_id
    rows = (
        db.query(DeviceVulnerability, Vulnerability)
        .join(Vulnerability, Vulnerability.id == DeviceVulnerability.vulnerability_id)
        .filter(DeviceVulnerability.tenant_id == tid)
        .all()
    )
    open_rows = [(f, v) for f, v in rows if f.status == "open"]
    sev = Counter(v.severity for _, v in open_rows)
    remediated = [f for f, _ in rows if f.status == "remediated" and f.resolved_at and f.first_detected]
    mttr = (sum((f.resolved_at - f.first_detected).total_seconds() for f in remediated) / len(remediated) / 86400) if remediated else None
    thirty = now().timestamp() - 30 * 86400
    return {
        "open_findings": len(open_rows),
        "by_severity": {s: sev.get(s, 0) for s in ["critical", "high", "medium", "low"]},
        "affected_devices": len({f.device_id for f, _ in open_rows}),
        "known_exploited_open": sum(1 for _, v in open_rows if v.known_exploited == "yes"),
        "remediated_30d": sum(1 for f in remediated if f.resolved_at.timestamp() >= thirty),
        "mean_days_to_remediate": round(mttr, 1) if mttr is not None else None,
        "unique_vulnerabilities": len({v.id for _, v in open_rows}),
    }


@router.get("/device/{device_id}")
def device_vulnerabilities(device_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(DeviceVulnerability, Vulnerability)
        .join(Vulnerability, Vulnerability.id == DeviceVulnerability.vulnerability_id)
        .filter(DeviceVulnerability.tenant_id == user.tenant_id, DeviceVulnerability.device_id == device_id)
        .all()
    )
    out = [{
        "id": str(v.id), "cve_id": v.cve_id, "title": v.title, "severity": v.severity,
        "cvss": (v.cvss or {}).get("score"), "known_exploited": v.known_exploited == "yes",
        "product": v.product, "fixed_version": v.fixed_version,
        "status": f.status, "first_detected": f.first_detected, "resolved_at": f.resolved_at,
    } for f, v in rows]
    return sorted(out, key=lambda x: (x["status"] != "open", SEVERITY_ORDER.get(x["severity"], 9)))


@router.get("/{vuln_id}")
def get_vulnerability(vuln_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = db.query(Vulnerability).filter(Vulnerability.id == vuln_id, Vulnerability.tenant_id == user.tenant_id).first()
    if not v:
        raise HTTPException(404, "Vulnerability not found")
    rows = (
        db.query(DeviceVulnerability, Device)
        .join(Device, Device.id == DeviceVulnerability.device_id)
        .filter(DeviceVulnerability.vulnerability_id == v.id, DeviceVulnerability.tenant_id == user.tenant_id)
        .all()
    )
    out = _vuln_out(v, [f for f, _ in rows])
    out["devices"] = [{**device_brief(d), "status": f.status, "first_detected": f.first_detected,
                       "resolved_at": f.resolved_at, "note": f.note} for f, d in rows]
    return out


class FindingUpdate(BaseModel):
    status: str
    note: str | None = None


@router.post("/{vuln_id}/devices/{device_id}")
def update_finding(vuln_id: uuid.UUID, device_id: uuid.UUID, req: FindingUpdate,
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if req.status not in ("open", "remediated", "accepted"):
        raise HTTPException(400, "Status must be open, remediated, or accepted")
    f = db.query(DeviceVulnerability).filter(
        DeviceVulnerability.vulnerability_id == vuln_id, DeviceVulnerability.device_id == device_id,
        DeviceVulnerability.tenant_id == user.tenant_id).first()
    if not f:
        raise HTTPException(404, "Finding not found")
    f.status = req.status
    f.note = req.note or f.note
    f.resolved_at = now() if req.status != "open" else None
    audit(db, user, user.tenant_id, f"vulnerability.{req.status}", "device", device_id, {"vulnerability_id": str(vuln_id)})
    db.commit()
    return {"status": f.status}
