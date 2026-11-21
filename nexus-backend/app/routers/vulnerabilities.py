from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Vulnerability, User
from ..auth import get_current_user
from ._crud import _serialize

router = APIRouter(prefix="/api/v1/vulnerabilities", tags=["vulnerabilities"])

@router.get("/")
def list_vulnerabilities(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Vulnerability).filter(Vulnerability.tenant_id == current_user.tenant_id).all()
    return [_serialize(r) for r in rows]

@router.get("/stats")
def vuln_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Vulnerability).filter(Vulnerability.tenant_id == current_user.tenant_id)
    total = q.count()
    return {
        "total": total,
        "open": q.filter(Vulnerability.status == "open").count(),
        "mitigated": q.filter(Vulnerability.status == "mitigated").count(),
        "remediated": q.filter(Vulnerability.status == "remediated").count(),
        "critical": q.filter(Vulnerability.severity == "critical").count(),
    }
