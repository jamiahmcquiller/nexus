"""Runs enabled automation workflows on their schedule while the API is up.

Schedules are matched by label: anything starting with "Every hour" runs hourly,
"Daily" every 24 hours, "Weekly" every 7 days. "Manual only" never runs on its own.
"""
import asyncio
import logging
from datetime import timedelta
from .database import SessionLocal
from .models import Workflow
from .routers.automation import run_workflow
from .routers.common import now

log = logging.getLogger("nexus.scheduler")
CHECK_EVERY_SECONDS = 300


def interval_for(schedule: str | None) -> timedelta | None:
    s = (schedule or "").lower()
    if s.startswith("every hour"):
        return timedelta(hours=1)
    if s.startswith("daily"):
        return timedelta(days=1)
    if s.startswith("weekly"):
        return timedelta(days=7)
    return None


def run_due_workflows() -> int:
    db = SessionLocal()
    ran = 0
    try:
        for wf in db.query(Workflow).filter(Workflow.enabled == "yes").all():
            every = interval_for(wf.schedule)
            if every and (not wf.last_run_at or now() - wf.last_run_at >= every):
                run_workflow(db, wf, None)
                db.commit()
                ran += 1
    except Exception:  # never let a bad workflow stop the loop
        db.rollback()
        log.exception("Scheduled workflow run failed")
    finally:
        db.close()
    return ran


async def scheduler_loop():
    while True:
        await asyncio.sleep(CHECK_EVERY_SECONDS)
        ran = await asyncio.to_thread(run_due_workflows)
        if ran:
            log.info("Ran %d scheduled workflows", ran)
