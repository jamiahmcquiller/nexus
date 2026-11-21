"""Patch & update management.

Automated patching (scan -> test -> approve -> deploy), user-centric
deployment policies with pre/post checks and reboot options, third-party
patching, and selective decline of problematic patches.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Patch, User
from ..models_extended import PatchDeployment, PatchTest, ThirdPartyApp
from ._crud import _get_or_404, _serialize, crud_router, WRITE, DELETE

router = APIRouter()
router.include_router(crud_router("/api/v1/patch-deployments", PatchDeployment, "patching"))
router.include_router(crud_router("/api/v1/third-party-apps", ThirdPartyApp, "patching"))
router.include_router(crud_router("/api/v1/patch-tests", PatchTest, "patching"))


@router.post("/api/v1/patches/{patch_id}/test")
def test_patch(patch_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    patch = _get_or_404(db, Patch, patch_id, current_user)
    patch.status = "testing"
    test = PatchTest(tenant_id=current_user.tenant_id, patch_id=patch.id,
                     title=patch.title, testbed=payload.get("testbed", "testbed"),
                     result="pending", notes=payload.get("notes"))
    db.add(test)
    db.commit()
    return {"patch": _serialize(patch), "test": _serialize(test)}


@router.post("/api/v1/patches/{patch_id}/approve")
def approve_patch(patch_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    patch = _get_or_404(db, Patch, patch_id, current_user)
    patch.status = "approved"
    db.commit()
    return _serialize(patch)


@router.post("/api/v1/patches/{patch_id}/decline")
def decline_patch(patch_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    patch = _get_or_404(db, Patch, patch_id, current_user)
    patch.status = "declined"
    attrs = dict(patch.attributes or {})
    attrs["decline_reason"] = payload.get("reason")
    attrs["decline_duration"] = payload.get("duration", "permanent")  # temporary | permanent
    patch.attributes = attrs
    db.commit()
    return _serialize(patch)


@router.post("/api/v1/patches/{patch_id}/deploy")
def deploy_patch(patch_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(DELETE)):
    patch = _get_or_404(db, Patch, patch_id, current_user)
    patch.status = "deployed"
    deployment = PatchDeployment(
        tenant_id=current_user.tenant_id, patch_id=patch.id, title=patch.title,
        scope=payload.get("scope", "all-devices"), schedule=payload.get("schedule"),
        reboot_option=payload.get("reboot_option", "prompt"),
        pre_checks=payload.get("pre_checks", []), post_checks=payload.get("post_checks", []),
        status="deploying",
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    return {"patch": _serialize(patch), "deployment": _serialize(deployment)}
