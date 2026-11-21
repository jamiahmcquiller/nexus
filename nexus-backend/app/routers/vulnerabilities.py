from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Vulnerability, User
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/vulnerabilities", tags=["vulnerabilities"])

@router.get("/")
def list_vulnerabilities(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Vulnerability).filter(Vulnerability.tenant_id == current_user.tenant_id).all()

@router.get("/stats")
def vuln_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Vulnerability).filter(Vulnerability.tenant_id == current_user.tenant_id).count()
    return {"total": total, "open": total, "critical": 0}
