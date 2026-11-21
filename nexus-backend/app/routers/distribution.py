"""Application distribution.

Remote MSI / EXE / mobile-app distribution from pre-defined, tested
templates, a central software repository, over-the-air mobile updates,
software metering, a self-service portal, and an enterprise app
catalogue of organisation-approved applications.
"""
from fastapi import APIRouter

from ..models_extended import AppDeployment, SoftwareMetering, SoftwarePackage
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/distribution/packages", SoftwarePackage, "distribution"))
router.include_router(crud_router("/api/v1/distribution/deployments", AppDeployment, "distribution"))
router.include_router(crud_router("/api/v1/distribution/metering", SoftwareMetering, "distribution"))
