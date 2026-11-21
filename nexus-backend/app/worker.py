"""NEXUS scheduler worker.

Runs the background scheduler in a loop. No new dependencies — the
standard library only.

Usage:
    python -m app.worker            # loop forever, tick every 60s
    python -m app.worker --once     # one tick, then exit (cron / CI)
    python -m app.worker --interval 30

Environment:
    SCHEDULER_INTERVAL_SECONDS  default tick interval (default 60)
    DATABASE_URL                same as the API (see app/database.py)

Run it as a separate process from the API so a worker crash cannot
take the API down, and so only one worker runs at a time in a
deployment (two workers would both advance the same records — the
one-step-per-tick design makes that harmless, but it would double
the AuditEvents). In Docker Compose, see infra/docker-compose.yml.
"""
import argparse
import logging
import signal
import sys
import time

from .database import SessionLocal
from .scheduler import run_due_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("nexus.worker")

_stop = False


def _handle_signal(signum, frame):
    global _stop
    log.info("received signal %s, stopping after this tick", signum)
    _stop = True


def tick_once() -> dict:
    db = SessionLocal()
    try:
        summary = run_due_jobs(db)
        log.info("scheduler tick: %s", summary)
        return summary
    finally:
        db.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="NEXUS scheduler worker")
    parser.add_argument("--once", action="store_true", help="run one tick and exit")
    parser.add_argument("--interval", type=int, default=None,
                        help="seconds between ticks (overrides SCHEDULER_INTERVAL_SECONDS)")
    args = parser.parse_args(argv)

    import os
    interval = args.interval or int(os.environ.get("SCHEDULER_INTERVAL_SECONDS", "60"))
    if interval < 5:
        parser.error("--interval must be at least 5 seconds")

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    if args.once:
        tick_once()
        return 0

    log.info("nexus worker started, tick every %ss", interval)
    while not _stop:
        try:
            tick_once()
        except Exception:
            log.exception("scheduler tick failed; will retry next tick")
        for _ in range(interval):
            if _stop:
                break
            time.sleep(1)
    log.info("nexus worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
