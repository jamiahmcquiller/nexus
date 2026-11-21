"""Application control & privilege management.

Allowlist / blocklist, application privilege management, global child
process control, admin-rights removal (least privilege), just-in-time
access, conditional access, and per-app VPN. ``Policy`` (policies
router) can also carry an ``app_control`` definition; these tables are
the enforceable rules and grants behind it.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..models_extended import AppControlRule, PrivilegeGrant
from ._crud import _get_or_404, _serialize, crud_router, DELETE

router = APIRouter()
router.include_router(crud_router("/api/v1/app-control/rules", AppControlRule, "app-control"))
router.include_router(crud_router("/api/v1/app-control/privilege-grants", PrivilegeGrant, "app-control"))


@router.post("/api/v1/app-control/privilege-grants/{grant_id}/revoke")
def revoke_grant(grant_id: str, db: Session = Depends(get_db), current_user: User = Depends(DELETE)):
    grant = _get_or_404(db, PrivilegeGrant, grant_id, current_user)
    grant.status = "revoked"
    db.commit()
    return _serialize(grant)
