"""Asset management.

Live hardware / software / digital-asset inventory, license and
warranty tracking, certificate management, geo-fencing, power
management, and USB / peripheral control.
"""
from fastapi import APIRouter

from ..models_extended import Asset, Certificate, GeoFence, PowerScheme, SoftwareLicense, UsbDeviceEvent, Warranty
from ._crud import crud_router

router = APIRouter()
# NOTE: sub-routers first. FastAPI matches routes in registration order,
# so /api/v1/assets/licenses/ must be registered before the parent
# /api/v1/assets/{item_id} route, or "licenses" would be read as an id.
router.include_router(crud_router("/api/v1/assets/licenses", SoftwareLicense, "assets"))
router.include_router(crud_router("/api/v1/assets/warranties", Warranty, "assets"))
router.include_router(crud_router("/api/v1/assets/certificates", Certificate, "assets"))
router.include_router(crud_router("/api/v1/assets/geo-fences", GeoFence, "assets"))
router.include_router(crud_router("/api/v1/assets/usb-events", UsbDeviceEvent, "assets"))
router.include_router(crud_router("/api/v1/assets/power-schemes", PowerScheme, "assets"))
router.include_router(crud_router("/api/v1/assets", Asset, "assets"))
