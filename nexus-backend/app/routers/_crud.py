"""Shared tenant-scoped CRUD for the platform modules.

Every router in this package is built from this helper so all 17 feature
areas behave the same way: tenant isolation on every query, ``status`` as
the workflow field, and free-form detail in ``attributes``.

Create payloads are plain JSON. Known columns are set directly; anything
else lands in ``attributes``. ``title`` and ``name`` are interchangeable —
whichever column the model has gets the value, the other is filled too
when both columns exist, so the console's generic add-box works everywhere.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User


def _columns(model):
    return {c.name: c for c in model.__table__.columns}


def _serialize(row):
    out = {}
    for c in row.__table__.columns:
        v = getattr(row, c.name)
        out[c.name] = str(v) if isinstance(v, uuid.UUID) else v
    return out


def _apply_payload(row, payload: dict):
    cols = _columns(type(row))
    attrs = dict(getattr(row, "attributes", None) or {})
    # title / name interchange
    if "title" in payload and "name" in cols and "title" not in cols:
        payload = {**payload, "name": payload["title"]}
    if "name" in payload and "title" in cols and "name" not in cols:
        payload = {**payload, "title": payload["name"]}
    for key, value in payload.items():
        if key in ("id", "tenant_id", "created_at"):
            continue
        if key in cols:
            setattr(row, key, value)
        elif key == "attributes" and isinstance(value, dict):
            attrs.update(value)
        else:
            attrs[key] = value
    if "attributes" in cols:
        row.attributes = attrs
    # keep title/name in sync when both columns exist
    if "title" in cols and "name" in cols:
        if getattr(row, "title", None) and not getattr(row, "name", None):
            row.name = row.title
        elif getattr(row, "name", None) and not getattr(row, "title", None):
            row.title = row.name
    return row


def crud_router(prefix: str, model, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("/")
    def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        rows = (
            db.query(model)
            .filter(model.tenant_id == current_user.tenant_id)
            .order_by(model.created_at.desc())
            .limit(500)
            .all()
        )
        return [_serialize(r) for r in rows]

    @router.get("/stats")
    def stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        q = db.query(model).filter(model.tenant_id == current_user.tenant_id)
        total = q.count()
        out = {"total": total}
        if "status" in _columns(model):
            for s in ("active", "open", "new", "available", "deployed", "detected", "scheduled"):
                out[s] = q.filter(model.status == s).count()
        return out

    @router.post("/", status_code=201)
    def create_item(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        row = model(tenant_id=current_user.tenant_id)
        _apply_payload(row, payload)
        db.add(row)
        db.commit()
        db.refresh(row)
        return _serialize(row)

    @router.get("/{item_id}")
    def get_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        row = _get_or_404(db, model, item_id, current_user)
        return _serialize(row)

    @router.patch("/{item_id}")
    def update_item(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        row = _get_or_404(db, model, item_id, current_user)
        _apply_payload(row, payload)
        db.commit()
        db.refresh(row)
        return _serialize(row)

    @router.post("/{item_id}/status")
    def set_status(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        row = _get_or_404(db, model, item_id, current_user)
        if "status" not in _columns(model):
            raise HTTPException(status_code=400, detail="This record has no status field")
        row.status = payload.get("status")
        if payload.get("attributes"):
            _apply_payload(row, {"attributes": payload["attributes"]})
        db.commit()
        db.refresh(row)
        return _serialize(row)

    return router


def _get_or_404(db, model, item_id, current_user):
    try:
        uid = uuid.UUID(item_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid id")
    row = (
        db.query(model)
        .filter(model.id == uid, model.tenant_id == current_user.tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row
