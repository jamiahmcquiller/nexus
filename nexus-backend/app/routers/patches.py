from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Patch, User
from ..auth import get_current_user
from ._crud import _serialize

router = APIRouter(prefix="/api/v1/patches", tags=["patches"])

@router.get("/")
def list_patches(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Patch).filter(Patch.tenant_id == current_user.tenant_id).all()
    return [_serialize(r) for r in rows]

@router.get("/stats")
def patch_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(Patch).filter(Patch.tenant_id == current_user.tenant_id)
    total = q.count()
    return {
        "total": total,
        "available": q.filter(Patch.status == "available").count(),
        "testing": q.filter(Patch.status == "testing").count(),
        "approved": q.filter(Patch.status == "approved").count(),
        "declined": q.filter(Patch.status == "declined").count(),
        "deployed": q.filter(Patch.status == "deployed").count(),
    }
