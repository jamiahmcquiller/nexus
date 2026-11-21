"""Vulnerability remediation.

Continual vulnerability intelligence and prioritisation, zero-day
mitigation scripts deployed before vendor fixes, security-configuration
management (CIS / NIST / Cyber Essentials), web-server hardening, and
high-risk software audit (end-of-life, peer-to-peer, insecure RDP).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User, Vulnerability
from ..models_extended import HighRiskSoftware, SecurityConfiguration, WebServerHardening, ZeroDayMitigation
from ._crud import _get_or_404, _serialize, crud_router, WRITE

router = APIRouter()
router.include_router(crud_router("/api/v1/zero-day-mitigations", ZeroDayMitigation, "vulnerabilities"))
router.include_router(crud_router("/api/v1/security-configurations", SecurityConfiguration, "vulnerabilities"))
router.include_router(crud_router("/api/v1/web-server-hardening", WebServerHardening, "vulnerabilities"))
router.include_router(crud_router("/api/v1/high-risk-software", HighRiskSoftware, "vulnerabilities"))


@router.post("/api/v1/vulnerabilities/{vuln_id}/mitigate")
def mitigate_vulnerability(vuln_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    vuln = _get_or_404(db, Vulnerability, vuln_id, current_user)
    vuln.status = "mitigated"
    mitigation = ZeroDayMitigation(
        tenant_id=current_user.tenant_id, cve_id=vuln.cve_id, title=vuln.title,
        mitigation_script=payload.get("mitigation_script"), status="mitigated",
    )
    db.add(mitigation)
    db.commit()
    return {"vulnerability": _serialize(vuln), "mitigation": _serialize(mitigation)}


@router.post("/api/v1/vulnerabilities/{vuln_id}/remediate")
def remediate_vulnerability(vuln_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    vuln = _get_or_404(db, Vulnerability, vuln_id, current_user)
    vuln.status = "remediated"
    db.commit()
    return _serialize(vuln)
