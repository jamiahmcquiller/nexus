"""OS imaging & deployment.

Online / offline imaging, zero-touch deployment (PXE / USB / ISO),
work-from-home standalone deployment, hardware-independent images,
customised deployment templates per role / department, and user-profile
migration as part of image creation.
"""
from fastapi import APIRouter

from ..models_extended import DeploymentTemplate, ImagingDeployment, OsImage
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/imaging/images", OsImage, "imaging"))
router.include_router(crud_router("/api/v1/imaging/deployments", ImagingDeployment, "imaging"))
router.include_router(crud_router("/api/v1/imaging/templates", DeploymentTemplate, "imaging"))
