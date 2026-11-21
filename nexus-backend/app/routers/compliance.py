from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ComplianceResult, User
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])

@router.get("/")
def list_compliance(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ComplianceResult).filter(ComplianceResult.tenant_id == current_user.tenant_id).all()
