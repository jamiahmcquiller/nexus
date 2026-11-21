"""Secure Private Access (zero-trust, VPN replacement).

Application-level access: users reach only authorised private
applications, on trusted devices, through encrypted tunnels — the
corporate network itself is never exposed. Segments are defined by
app name / DNS / port and grouped by team; every access is audited.
"""
from fastapi import APIRouter

from ..models_extended import AccessAudit, AccessPolicy, AccessSegment
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/access/segments", AccessSegment, "access"))
router.include_router(crud_router("/api/v1/access/policies", AccessPolicy, "access"))
router.include_router(crud_router("/api/v1/access/audit", AccessAudit, "access"))
