"""Reporting & auditing.

Audit-ready report templates, Active Directory reports (users,
computers, groups, OUs, domains), and compliance reporting for
HIPAA, GDPR, CIS, ISO, and PCI. Compliance results themselves live
in the compliance router; this module is the report catalogue.
"""
from fastapi import APIRouter

from ..models_extended import Report, ReportTemplate
from ._crud import crud_router

router = APIRouter()
# NOTE: templates first — see assets.py. /api/v1/reports/{item_id}
# would otherwise swallow /api/v1/reports/templates/.
router.include_router(crud_router("/api/v1/reports/templates", ReportTemplate, "reporting"))
router.include_router(crud_router("/api/v1/reports", Report, "reporting"))
