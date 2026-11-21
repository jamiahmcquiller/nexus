"""Server management.

Full server lifecycle (provisioning to decommissioning), unified
multi-OS caching for updates / patches / software, self-service patch
control for application owners within maintenance windows, multi-level
patch approvals, remote monitoring & maintenance, and vulnerability
detection with out-of-the-box CIS Benchmark policies.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..models_extended import Server, ServerHealthCheck, ServerPatchWindow
from ._crud import _get_or_404, _serialize, crud_router, WRITE

router = APIRouter()
# NOTE: sub-routers first — see assets.py. /api/v1/servers/{item_id}
# would otherwise swallow /api/v1/servers/patch-windows/.
router.include_router(crud_router("/api/v1/servers/patch-windows", ServerPatchWindow, "servers"))
router.include_router(crud_router("/api/v1/servers/health-checks", ServerHealthCheck, "servers"))
router.include_router(crud_router("/api/v1/servers", Server, "servers"))


@router.post("/api/v1/servers/patch-windows/{window_id}/approve")
def approve_patch_window(window_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    window = _get_or_404(db, ServerPatchWindow, window_id, current_user)
    window.approval_status = "approved"
    db.commit()
    return _serialize(window)
