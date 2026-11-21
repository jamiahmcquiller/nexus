"""Data security / DLP.

Sensitive-data discovery & classification, data-leak prevention at
rest / in use / in motion, BYOD containerization, remote de-provisioning
wipe, file tracing & mirroring, and BitLocker / FileVault encryption
policies (see also the encryption router for key escrow).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..models_extended import DataContainer, DlpIncident, DlpPolicy, SensitiveDataFinding
from ._crud import _get_or_404, _serialize, crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/dlp/findings", SensitiveDataFinding, "dlp"))
router.include_router(crud_router("/api/v1/dlp/policies", DlpPolicy, "dlp"))
router.include_router(crud_router("/api/v1/dlp/incidents", DlpIncident, "dlp"))
router.include_router(crud_router("/api/v1/dlp/containers", DataContainer, "dlp"))


@router.post("/api/v1/dlp/containers/{container_id}/wipe")
def wipe_container(container_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    container = _get_or_404(db, DataContainer, container_id, current_user)
    container.status = "wiped"
    db.commit()
    return _serialize(container)
