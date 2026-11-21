"""Digital Employee Experience (DEX).

Endpoint telemetry (CPU / memory / GPU / disk / app crashes) turned
into experience scores and benchmarks, root-cause analysis, and
automated detection-to-resolution remediation workflows.
"""
from fastapi import APIRouter

from ..models_extended import DexInsight, DexTelemetry, ExperienceScore, RemediationWorkflow
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/dex/telemetry", DexTelemetry, "dex"))
router.include_router(crud_router("/api/v1/dex/insights", DexInsight, "dex"))
router.include_router(crud_router("/api/v1/dex/workflows", RemediationWorkflow, "dex"))
router.include_router(crud_router("/api/v1/dex/experience-scores", ExperienceScore, "dex"))
