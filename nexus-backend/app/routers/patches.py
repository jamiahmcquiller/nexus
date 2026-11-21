from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Patch, User
from ..auth import get_current_user

router = APIRouter(prefix="/api/v1/patches", tags=["patches"])

@router.get("/")
def list_patches(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Patch).filter(Patch.tenant_id == current_user.tenant_id).all()

@router.get("/stats")
def patch_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(Patch).filter(Patch.tenant_id == current_user.tenant_id).count()
    return {"total": total, "available": total, "deployed": 0}
