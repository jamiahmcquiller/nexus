from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import SecurityAlert, User
from ..auth import get_current_user
from ._crud import write_routes

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

@router.get("/")
def list_alerts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(SecurityAlert).filter(SecurityAlert.tenant_id == current_user.tenant_id).all()

@router.get("/stats")
def alert_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(SecurityAlert).filter(SecurityAlert.tenant_id == current_user.tenant_id).count()
    return {"total": total, "new": total, "contained": 0}

# Write side (create / get / update / delete / status). Previously this
# router was GET-only, so the console's Add button hit a 405 and its
# status dropdown hit a 404.
write_routes(router, SecurityAlert, audit_prefix="alert",
             defaults={"title": "Untitled alert", "status": "new"})
