from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ComplianceResult, User
from ..auth import get_current_user
from ._crud import write_routes

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])

@router.get("/")
def list_compliance(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ComplianceResult).filter(ComplianceResult.tenant_id == current_user.tenant_id).all()

# Write side (create / get / update / delete / status) plus stats.
# Previously this router was GET-only with no /stats, so the console
# always showed "No stats yet". A compliance result is assessment
# output, so create requires the device it was assessed on — a missing
# device_id is a 400, not a silent null.
write_routes(router, ComplianceResult, audit_prefix="compliance",
             required=["device_id"], stats=True)
