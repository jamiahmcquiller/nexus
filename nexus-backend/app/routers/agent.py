"""Agent command queue: remote execution + Wake-on-LAN.

The backend only queues commands — it never executes anything itself.
An enrolled endpoint agent polls for pending commands with its
enrollment token, runs them as its own user, and reports the result.

Security model:
- Creating a command (or waking a device) requires a signed-in
  owner/admin JWT. Every creation writes an AuditEvent naming the user.
- The agent authenticates with the enrollment token; the token's tenant
  must match the command's tenant, and a command addressed to a specific
  device is only visible to that device (device_id null = any online
  agent in the tenant may claim it, which is how Wake-on-LAN works:
  the sender is whichever agent is on the target's LAN).
- Results are stored on the command record (output truncated to 100 KB),
  so the queue itself is the audit trail.
- The agent enforces its own execution timeout and runs nothing
  interactively. Interactive remote desktop / screen sharing is NOT
  part of this channel; live sessions are recorded separately in
  RemoteSession and need a relay, which is a later phase.
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Device, DeviceInventorySnapshot, AuditEvent, User
from ..models_extended import AgentCommand
from .devices import _tenant_from_token
from ._crud import _get_or_404, _serialize

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])

MAX_RESULT_CHARS = 100_000
_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")


def _audit(db, tenant_id, user_id, action, entity_id, metadata):
    db.add(AuditEvent(
        tenant_id=tenant_id, actor_user_id=user_id, action=action,
        entity_type="agent_command", entity_id=entity_id,
        event_metadata=metadata,
    ))


class CommandCreate(BaseModel):
    device_id: Optional[str] = None  # null = any online agent in the tenant
    kind: str = "shell"  # shell, powershell, wol
    command: str


class CommandComplete(BaseModel):
    exit_code: Optional[int] = None
    result: str = ""


@router.post("/commands", status_code=201)
def create_command(req: CommandCreate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_role(["owner", "admin"]))):
    if req.kind not in ("shell", "powershell", "wol"):
        raise HTTPException(status_code=400, detail="kind must be shell, powershell, or wol")
    if not req.command.strip():
        raise HTTPException(status_code=400, detail="command is required")
    if req.kind == "wol" and not _MAC_RE.match(req.command.strip()):
        raise HTTPException(status_code=400, detail="wol command must be a MAC address (AA:BB:CC:DD:EE:FF)")
    device = None
    if req.device_id:
        device = _get_or_404(db, Device, req.device_id, current_user)
    cmd = AgentCommand(
        tenant_id=current_user.tenant_id,
        device_id=device.id if device else None,
        kind=req.kind, command=req.command.strip(),
        created_by=current_user.id,
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    _audit(db, current_user.tenant_id, current_user.id, "agent.command_created",
           cmd.id, {"kind": req.kind, "device_id": str(device.id) if device else None,
                    "command_preview": req.command.strip()[:200]})
    db.commit()
    return _serialize(cmd)


@router.get("/commands")
def list_commands(status: Optional[str] = None, device_id: Optional[str] = None,
                  db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    q = db.query(AgentCommand).filter(AgentCommand.tenant_id == current_user.tenant_id)
    if status:
        q = q.filter(AgentCommand.status == status)
    if device_id:
        q = q.filter(AgentCommand.device_id == uuid.UUID(device_id))
    return [_serialize(c) for c in q.order_by(AgentCommand.created_at.desc()).limit(200).all()]


def _agent_tenant(token: Optional[str]) -> uuid.UUID:
    if not token:
        raise HTTPException(status_code=401, detail="enrollment token required")
    return _tenant_from_token(token)


@router.get("/commands/next")
def next_command(device_id: str, enrollment_token: Optional[str] = None,
                 db: Session = Depends(get_db)):
    """Oldest pending command for this device, or any tenant-wide command.

    Claims the command in the same request so two agents cannot run it.
    Returns 204 with no body when nothing is pending.
    """
    tenant_id = _agent_tenant(enrollment_token)
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device or device.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Device not found")
    # Stale claims (agent died mid-run) go back to pending after 10 minutes.
    stale_at = datetime.utcnow() - timedelta(minutes=10)
    db.query(AgentCommand).filter(
        AgentCommand.tenant_id == tenant_id,
        AgentCommand.status == "claimed",
        AgentCommand.claimed_at < stale_at,
    ).update({"status": "pending", "claimed_by_device_id": None, "claimed_at": None},
             synchronize_session=False)
    cmd = (
        db.query(AgentCommand)
        .filter(AgentCommand.tenant_id == tenant_id, AgentCommand.status == "pending")
        .filter((AgentCommand.device_id == device.id) | (AgentCommand.device_id.is_(None)))
        .order_by(AgentCommand.created_at.asc())
        .first()
    )
    if not cmd:
        db.commit()
        return Response(status_code=204)
    cmd.status = "claimed"
    cmd.claimed_by_device_id = device.id
    cmd.claimed_at = datetime.utcnow()
    db.commit()
    db.refresh(cmd)
    return _serialize(cmd)


@router.get("/commands/{command_id}")
def get_command(command_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    # Registered after /commands/next on purpose: FastAPI matches routes
    # in order, and "next" must not be swallowed as a {command_id}.
    return _serialize(_get_or_404(db, AgentCommand, command_id, current_user))


@router.post("/commands/{command_id}/complete")
def complete_command(command_id: str, req: CommandComplete,
                     enrollment_token: Optional[str] = None,
                     db: Session = Depends(get_db)):
    tenant_id = _agent_tenant(enrollment_token)
    cmd = db.query(AgentCommand).filter(
        AgentCommand.id == uuid.UUID(command_id),
        AgentCommand.tenant_id == tenant_id,
    ).first()
    if not cmd:
        raise HTTPException(status_code=404, detail="Command not found")
    if cmd.status in ("succeeded", "failed"):
        return _serialize(cmd)  # idempotent: a retried completion is a no-op
    cmd.status = "succeeded" if (req.exit_code in (None, 0)) else "failed"
    cmd.exit_code = req.exit_code
    cmd.result = (req.result or "")[:MAX_RESULT_CHARS]
    cmd.completed_at = datetime.utcnow()
    db.commit()
    return _serialize(cmd)


class WakeRequest(BaseModel):
    executor_device_id: Optional[str] = None  # a specific online agent on that LAN; null = any


@router.post("/devices/{device_id}/wake", status_code=201)
def wake_device(device_id: str, req: WakeRequest = WakeRequest(),
                db: Session = Depends(get_db),
                current_user: User = Depends(require_role(["owner", "admin"]))):
    """Queue a Wake-on-LAN magic packet for an offline device.

    The backend cannot reach the device's LAN, so it queues a `wol`
    command: the first online agent in the organization claims it and
    sends the magic packet on its own LAN. The target's MAC comes from
    its latest inventory snapshot (or its stored attributes).
    """
    target = _get_or_404(db, Device, device_id, current_user)
    mac = None
    snapshot = (
        db.query(DeviceInventorySnapshot)
        .filter(DeviceInventorySnapshot.device_id == target.id)
        .order_by(DeviceInventorySnapshot.collected_at.desc())
        .first()
    )
    if snapshot and isinstance(snapshot.hardware, dict):
        for iface in (snapshot.hardware.get("network") or []):
            if isinstance(iface, dict) and iface.get("mac"):
                mac = iface["mac"]
                break
    if not mac and isinstance(target.attributes, dict):
        mac = target.attributes.get("mac")
    if not mac or not _MAC_RE.match(str(mac)):
        raise HTTPException(
            status_code=409,
            detail="No MAC address known for this device — run the agent on it once while it is awake so its inventory is collected",
        )
    executor = None
    if req.executor_device_id:
        executor = _get_or_404(db, Device, req.executor_device_id, current_user)
    cmd = AgentCommand(
        tenant_id=current_user.tenant_id,
        device_id=executor.id if executor else None,
        target_device_id=target.id,
        kind="wol", command=str(mac),
        created_by=current_user.id,
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    _audit(db, current_user.tenant_id, current_user.id, "agent.wake_queued",
           cmd.id, {"target_device_id": str(target.id), "mac": str(mac)})
    db.commit()
    return _serialize(cmd)
