"""Mobile Device Management.

Corporate-owned and personal devices across Android, iOS, iPadOS,
macOS, Windows, ChromeOS, and tvOS from the same console: enrollment
& inventory, profile & policy management, app & content management,
mobile security & BYOD data protection, kiosk & rugged-device
management, and remote troubleshooting.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..models_extended import MobileApp, MobileDevice, MobileProfile
from ._crud import _get_or_404, _serialize, crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/mdm/devices", MobileDevice, "mdm"))
router.include_router(crud_router("/api/v1/mdm/profiles", MobileProfile, "mdm"))
router.include_router(crud_router("/api/v1/mdm/apps", MobileApp, "mdm"))


@router.post("/api/v1/mdm/devices/{device_id}/wipe")
def wipe_mobile_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = _get_or_404(db, MobileDevice, device_id, current_user)
    device.status = "wiped"
    device.enrollment_status = "wiped"
    db.commit()
    return _serialize(device)


@router.post("/api/v1/mdm/devices/{device_id}/lock")
def lock_mobile_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = _get_or_404(db, MobileDevice, device_id, current_user)
    device.status = "locked"
    db.commit()
    return _serialize(device)
