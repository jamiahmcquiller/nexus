"""Configuration management.

User- and computer-based system configurations, profile management,
kiosk management, and a script repository (custom scripts and
pre-built templates).
"""
from fastapi import APIRouter

from ..models_extended import ConfigurationProfile, KioskProfile, ScriptItem
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/config/profiles", ConfigurationProfile, "config"))
router.include_router(crud_router("/api/v1/config/scripts", ScriptItem, "config"))
router.include_router(crud_router("/api/v1/config/kiosk", KioskProfile, "config"))
