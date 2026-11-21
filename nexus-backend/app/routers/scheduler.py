"""Scheduler API — inspect and trigger the background worker.

The worker itself runs as a separate process (`python -m app.worker`).
This router is the console's window into it: the last runs, the job
list, and a manual run-once for owners/admins. A manual run uses the
same run_due_jobs() code as the worker, so there is only one
implementation of the state machines.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import User
from ..models_extended import SchedulerRun
from ..scheduler import run_due_jobs
from ._crud import _serialize

router = APIRouter(prefix="/api/v1/scheduler", tags=["scheduler"])

JOBS = [
    {"id": "patch_deployments", "label": "Patch deployments", "description": "Approved, test-passed deployments advance scheduled -> deploying -> deployed."},
    {"id": "threat_hunts", "label": "Threat hunts", "description": "Scheduled hunts start, running hunts complete with a findings count from the lookback window."},
    {"id": "remediation_workflows", "label": "Remediation workflows", "description": "Active DEX workflows resolve open insights matching their trigger."},
    {"id": "app_deployments", "label": "App deployments", "description": "Scheduled -> deploying -> deployed."},
    {"id": "imaging_deployments", "label": "Imaging deployments", "description": "Scheduled -> deploying -> deployed."},
    {"id": "system_tool_jobs", "label": "System tool jobs", "description": "Scheduled -> running -> complete."},
    {"id": "server_patch_windows", "label": "Server patch windows", "description": "Approved windows open -> in-progress -> deployed."},
    {"id": "expiry", "label": "Expiry housekeeping", "description": "Privilege grants expire; licenses, warranties, and certificates expire or become expiring within 30 days."},
]


@router.get("/status")
def scheduler_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    last = (
        db.query(SchedulerRun)
        .filter(SchedulerRun.tenant_id == current_user.tenant_id)
        .order_by(SchedulerRun.created_at.desc())
        .first()
    )
    return {
        "worker": "separate process: python -m app.worker (see docs/scheduler.md)",
        "jobs": JOBS,
        "last_run": _serialize(last) if last else None,
        "last_run_at": last.created_at.isoformat() if last else None,
    }


@router.get("/jobs")
def scheduler_jobs(current_user: User = Depends(get_current_user)):
    return JOBS


@router.get("/runs")
def list_runs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(SchedulerRun)
        .filter(SchedulerRun.tenant_id == current_user.tenant_id)
        .order_by(SchedulerRun.created_at.desc())
        .limit(100)
        .all()
    )
    return [_serialize(r) for r in rows]


@router.get("/runs/stats")
def runs_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(SchedulerRun).filter(SchedulerRun.tenant_id == current_user.tenant_id)
    return {
        "total": q.count(),
        "complete": q.filter(SchedulerRun.status == "complete").count(),
        "partial": q.filter(SchedulerRun.status == "partial").count(),
    }


@router.post("/run-once")
def run_once_endpoint(db: Session = Depends(get_db), current_user: User = Depends(require_role(["owner", "admin"]))):
    """Run one scheduler tick now. Owner/admin only."""
    return run_due_jobs(db)
