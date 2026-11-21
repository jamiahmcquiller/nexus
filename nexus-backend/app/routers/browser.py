"""Browser security.

Trusted-browser restriction, add-on / extension management, kiosk-mode
lockdown, browser isolation for unauthorised sites, Java version rules
per web app, and automatic routing of legacy apps to legacy browsers.
"""
from fastapi import APIRouter

from ..models_extended import BrowserExtension, BrowserPolicy
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/browser/policies", BrowserPolicy, "browser"))
router.include_router(crud_router("/api/v1/browser/extensions", BrowserExtension, "browser"))
