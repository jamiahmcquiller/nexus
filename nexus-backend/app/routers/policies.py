from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Policy, User
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/policies", tags=["policies"])

@router.get("/")
def list_policies(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Policy).filter(Policy.tenant_id == current_user.tenant_id).all()
