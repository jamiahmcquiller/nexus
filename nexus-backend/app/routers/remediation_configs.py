"""Vulnerability-driven remediation configurations.

A remediation configuration is a reusable script that addresses a
specific vulnerability (CVE / vulnerability record). Sending one queues
a single agent command through the existing command queue
(POST /api/v1/agent/commands semantics): the endpoint agent runs the
script once as its own user and reports the result on the command
record.

What this is NOT: a native configuration-management engine. There are
no config profiles, no drift detection, and no compliance enforcement —
those are a later phase. A sent command is never presented as a
verified configuration state, and a vulnerability is marked remediated
only through the existing vuln remediate workflow
(POST /api/v1/vulnerabilities/{id}/remediate) when a real result
supports it — never automatically on send.

Endpoints:
  GET    /api/v1/remediation-configurations/            list (any role)
  POST   /api/v1/remediation-configurations/            create (owner/admin/technician)
  GET    /api/v1/remediation-configurations/{id}        get (any role)
  PATCH  /api/v1/remediation-configurations/{id}        update (owner/admin/technician)
  DELETE /api/v1/remediation-configurations/{id}        delete (owner/admin)
  POST   /api/v1/remediation-configurations/{id}/status  status (owner/admin/technician)
  POST   /api/v1/remediation-configurations/{id}/send   send to a device (owner/admin only)
  GET    /api/v1/remediation-configurations/sends       send history, filterable
                                                        by configuration_id,
                                                        vulnerability_id, device_id
  GET    /api/v1/remediation-configurations/{id}/sends  sends for one configuration

The send record (RemediationConfigurationSend) is the linkage:
configuration id + vulnerability id + device id + command id. The
result (exit code / output / succeeded / failed) lives on the linked
AgentCommand and is read from there — the console joins sends to
commands on command_id so the same result shows on the vulnerability
and on the endpoint.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import AuditEvent, Device, User, Vulnerability
from ..models_extended import AgentCommand, RemediationConfiguration, RemediationConfigurationSend
from ._crud import _get_or_404, _serialize, crud_router

router = APIRouter()

SEND_OWNER_ADMIN = require_role(["owner", "admin"])


class SendRequest(BaseModel):
    vulnerability_id: str
    device_id: str
    kind: Optional[str] = None  # shell | powershell; defaults to the configuration's kind


def _parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid {field}")


@router.get("/api/v1/remediation-configurations/sends")
def list_sends(configuration_id: Optional[str] = None,
               vulnerability_id: Optional[str] = None,
               device_id: Optional[str] = None,
               db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    q = db.query(RemediationConfigurationSend).filter(
        RemediationConfigurationSend.tenant_id == current_user.tenant_id)
    if configuration_id:
        q = q.filter(RemediationConfigurationSend.configuration_id == _parse_uuid(configuration_id, "configuration_id"))
    if vulnerability_id:
        q = q.filter(RemediationConfigurationSend.vulnerability_id == _parse_uuid(vulnerability_id, "vulnerability_id"))
    if device_id:
        q = q.filter(RemediationConfigurationSend.device_id == _parse_uuid(device_id, "device_id"))
    return [_serialize(s) for s in q.order_by(RemediationConfigurationSend.created_at.desc()).limit(500).all()]


@router.get("/api/v1/remediation-configurations/{config_id}/sends")
def list_config_sends(config_id: str, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    config = _get_or_404(db, RemediationConfiguration, config_id, current_user)
    rows = (
        db.query(RemediationConfigurationSend)
        .filter(RemediationConfigurationSend.tenant_id == current_user.tenant_id,
                RemediationConfigurationSend.configuration_id == config.id)
        .order_by(RemediationConfigurationSend.created_at.desc())
        .limit(500)
        .all()
    )
    return [_serialize(s) for s in rows]


@router.post("/api/v1/remediation-configurations/{config_id}/send", status_code=201)
def send_configuration(config_id: str, req: SendRequest,
                       db: Session = Depends(get_db),
                       current_user: User = Depends(SEND_OWNER_ADMIN)):
    """Queue a configuration's script as an agent command on one device.

    The vulnerability must exist in this tenant, the device must exist
    in this tenant, and when the vulnerability is linked to a device
    (vulnerability.device_id set) the target must be that device — a
    configuration is only sent to the endpoint(s) the vulnerability
    actually affects. The exact script (configuration.content) is sent
    verbatim as the command; nothing is added or wrapped.
    """
    config = _get_or_404(db, RemediationConfiguration, config_id, current_user)
    vuln = _get_or_404(db, Vulnerability, req.vulnerability_id, current_user)
    device = _get_or_404(db, Device, req.device_id, current_user)
    if vuln.device_id is not None and vuln.device_id != device.id:
        raise HTTPException(
            status_code=400,
            detail="This vulnerability is linked to a different endpoint — "
                   "a configuration is only sent to the endpoint the vulnerability affects",
        )
    if not (config.content or "").strip():
        raise HTTPException(status_code=400, detail="This configuration has no script content to send")
    kind = (req.kind or config.kind or "shell").strip().lower()
    if kind not in ("shell", "powershell"):
        raise HTTPException(status_code=400, detail="kind must be shell or powershell")

    script = config.content.strip()
    cmd = AgentCommand(
        tenant_id=current_user.tenant_id,
        device_id=device.id,
        kind=kind,
        command=script,
        created_by=current_user.id,
        attributes={
            "remediation_configuration_id": str(config.id),
            "vulnerability_id": str(vuln.id),
            "cve_id": vuln.cve_id,
        },
    )
    db.add(cmd)
    db.flush()  # need cmd.id for the send record below
    send = RemediationConfigurationSend(
        tenant_id=current_user.tenant_id,
        configuration_id=config.id,
        vulnerability_id=vuln.id,
        device_id=device.id,
        command_id=cmd.id,
        created_by=current_user.id,
        attributes={"kind": kind, "cve_id": vuln.cve_id},
    )
    db.add(send)
    db.add(AuditEvent(
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        action="remediation_configuration.sent",
        entity_type="remediation_configuration",
        entity_id=config.id,
        event_metadata={
            "title": config.name or config.title,
            "vulnerability_id": str(vuln.id),
            "cve_id": vuln.cve_id,
            "device_id": str(device.id),
            "command_id": str(cmd.id),
            "kind": kind,
        },
    ))
    db.commit()
    db.refresh(send)
    db.refresh(cmd)
    return {"send": _serialize(send), "command": _serialize(cmd)}


# CRUD for the configuration resource itself (create / get / update /
# delete / status) with the standard role gates: create/update/status
# owner+admin+technician, delete owner+admin, reads any authenticated
# role. Registered AFTER the /sends routes above so the literal
# "/sends" path is not swallowed by crud_router's "/{item_id}".
router.include_router(crud_router(
    "/api/v1/remediation-configurations",
    RemediationConfiguration,
    "remediation_configuration",
    audit_prefix="remediation_configuration",
))
