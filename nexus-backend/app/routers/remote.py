"""Remote access & troubleshooting.

Remote control, recorded sessions (supervision / audit), system tools
(disk cleanup, defragmentation), on-screen announcements, multi-
technician collaborative troubleshooting, and cross-channel user
interaction (text, call, video).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..models_extended import RemoteAnnouncement, RemoteSession, SystemToolJob
from ._crud import _get_or_404, _serialize, crud_router, WRITE

router = APIRouter()
router.include_router(crud_router("/api/v1/remote/sessions", RemoteSession, "remote"))
router.include_router(crud_router("/api/v1/remote/announcements", RemoteAnnouncement, "remote"))
router.include_router(crud_router("/api/v1/remote/system-tools", SystemToolJob, "remote"))


@router.post("/api/v1/remote/sessions/{session_id}/end")
def end_session(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    from datetime import datetime
    session = _get_or_404(db, RemoteSession, session_id, current_user)
    session.status = "ended"
    session.ended_at = datetime.utcnow()
    db.commit()
    return _serialize(session)
