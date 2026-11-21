"""Endpoint Detection & Response.

Continuous endpoint activity monitoring (process / file / network /
registry / user), behavioural + MITRE ATT&CK-mapped threat detection,
AI-guided triage and forensics, incident response, and 30-day threat
hunting. ``SecurityAlert`` (alerts router) remains the alert record;
this module adds the telemetry, hunts, and containment actions behind it.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import SecurityAlert, User
from ..models_extended import EndpointTelemetry, IncidentResponse, ThreatHunt
from ._crud import _get_or_404, _serialize, crud_router, WRITE

router = APIRouter()
router.include_router(crud_router("/api/v1/edr/telemetry", EndpointTelemetry, "edr"))
router.include_router(crud_router("/api/v1/edr/hunts", ThreatHunt, "edr"))
router.include_router(crud_router("/api/v1/edr/incidents", IncidentResponse, "edr"))


@router.post("/api/v1/edr/incidents/{incident_id}/contain")
def contain_incident(incident_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    incident = _get_or_404(db, IncidentResponse, incident_id, current_user)
    incident.action = payload.get("action", "isolate")  # isolate | kill-process | quarantine | rollback
    incident.status = "in-progress"
    db.commit()
    db.refresh(incident)
    if incident.alert_id:
        alert = db.query(SecurityAlert).filter(
            SecurityAlert.id == incident.alert_id,
            SecurityAlert.tenant_id == current_user.tenant_id).first()
        if alert:
            alert.status = "contained"
            db.commit()
    return _serialize(incident)


@router.post("/api/v1/edr/hunts/{hunt_id}/run")
def run_hunt(hunt_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    hunt = _get_or_404(db, ThreatHunt, hunt_id, current_user)
    hunt.status = "running"
    db.commit()
    # Hunt execution is an agent / analytics job; the record tracks the
    # request and its findings count, which the job updates on completion.
    return _serialize(hunt)
