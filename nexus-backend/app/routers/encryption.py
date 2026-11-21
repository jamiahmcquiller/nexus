"""Disk encryption management.

Centralised BitLocker / FileVault / TPM control, granular policy
deployment to custom groups, automatic encryption at scale, secure
recovery-key escrow, blind-spot detection, and automated compliance
reporting. Recovery-key records hold escrow references only — never
a raw key (see models_extended.py).
"""
from fastapi import APIRouter

from ..models_extended import EncryptionPolicy, RecoveryKey
from ._crud import crud_router

router = APIRouter()
router.include_router(crud_router("/api/v1/encryption/policies", EncryptionPolicy, "encryption"))
router.include_router(crud_router("/api/v1/encryption/recovery-keys", RecoveryKey, "encryption"))
