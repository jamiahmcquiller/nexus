from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Policy, User
from ..auth import get_current_user
from ._crud import write_routes

router = APIRouter(prefix="/api/v1/policies", tags=["policies"])

@router.get("/")
def list_policies(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Policy).filter(Policy.tenant_id == current_user.tenant_id).all()

# Write side (create / get / update / delete / status) plus stats.
# Previously this router was GET-only with no /stats, so the console's
# Add button hit a 405, its status dropdown hit a 404, and the page
# always showed "No stats yet".
write_routes(router, Policy, audit_prefix="policy",
             defaults={"name": "Untitled policy", "policy_type": "custom"},
             stats=True)
