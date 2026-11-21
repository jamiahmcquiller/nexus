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
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import AuditEvent, User

# Write tiers, applied to every crud_router resource and documented in
# docs/security.md. Reads stay open to any authenticated role.
# - create / update / status: owner, admin, technician (auditor is read-only)
# - delete: owner, admin only (destructive)
WRITE = require_role(["admin", "technician"])
DELETE = require_role(["owner", "admin"])


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
    # JSON payloads carry foreign keys as UUID strings; the postgresql
    # UUID columns expect uuid.UUID objects (on SQLite a plain string
    # fails at flush with "'str' object has no attribute 'hex'").
    # Coerce valid UUID strings for UUID-typed columns only — every
    # other value passes through exactly as before.
    coerced = {}
    for key, value in payload.items():
        if (
            isinstance(value, str)
            and key in cols
            and isinstance(cols[key].type, PG_UUID)
        ):
            try:
                value = uuid.UUID(value)
            except ValueError:
                pass
        coerced[key] = value
    payload = coerced
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


def _audit(db, prefix: str, action: str, row, current_user, extra: dict | None = None):
    """Write one AuditEvent. No-op when prefix is None (default)."""
    if not prefix:
        return
    meta = {"title": getattr(row, "name", None) or getattr(row, "title", None)}
    if extra:
        meta.update(extra)
    db.add(AuditEvent(
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        action=f"{prefix}.{action}",
        entity_type=prefix,
        entity_id=row.id,
        event_metadata=meta,
    ))


def crud_router(prefix: str, model, tag: str, audit_prefix: str | None = None) -> APIRouter:
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
    def create_item(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        row = model(tenant_id=current_user.tenant_id)
        _apply_payload(row, payload)
        db.add(row)
        db.commit()
        db.refresh(row)
        if audit_prefix:
            _audit(db, audit_prefix, "created", row, current_user)
            db.commit()
        return _serialize(row)

    @router.get("/{item_id}")
    def get_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        row = _get_or_404(db, model, item_id, current_user)
        return _serialize(row)

    @router.patch("/{item_id}")
    def update_item(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        row = _get_or_404(db, model, item_id, current_user)
        _apply_payload(row, payload)
        db.commit()
        db.refresh(row)
        return _serialize(row)

    @router.delete("/{item_id}")
    def delete_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(DELETE)):
        row = _get_or_404(db, model, item_id, current_user)
        if audit_prefix:
            _audit(db, audit_prefix, "deleted", row, current_user)
        db.delete(row)
        db.commit()
        return {"deleted": str(row.id)}

    @router.post("/{item_id}/status")
    def set_status(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        row = _get_or_404(db, model, item_id, current_user)
        if "status" not in _columns(model):
            raise HTTPException(status_code=400, detail="This record has no status field")
        row.status = payload.get("status")
        if payload.get("attributes"):
            _apply_payload(row, {"attributes": payload["attributes"]})
        db.commit()
        db.refresh(row)
        if audit_prefix:
            _audit(db, audit_prefix, "status_changed", row, current_user,
                   {"status": row.status})
            db.commit()
        return _serialize(row)

    return router


def write_routes(router: APIRouter, model, audit_prefix: str | None = None,
                 defaults: dict | None = None, required: list[str] | None = None,
                 status_column: str = "status",
                 status_values: list[str] | None = None,
                 on_delete=None, on_create=None, stats: bool = False) -> None:
    """Add the write side (create / get / update / delete / status) to a
    router that already defines its own list + stats endpoints.

    Used by the modules whose routers predate crud_router (patches,
    vulnerabilities, alerts, policies, compliance, devices). `defaults`
    fills required columns the console's generic Add box does not send
    (e.g. a policy's policy_type); `required` rejects a create that is
    missing a field no default can invent (e.g. a compliance result's
    device_id) with a 400 instead of a database error. `status_column`
    lets devices map the generic status action onto enrollment_status.
    `on_delete`, when given, runs before the row is deleted (devices use
    it to remove that device's snapshots and queued commands).
    """
    defaults = defaults or {}
    required = required or []

    if stats:
        @router.get("/stats")
        def stats_endpoint(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
            q = db.query(model).filter(model.tenant_id == current_user.tenant_id)
            total = q.count()
            out = {"total": total}
            if "status" in _columns(model):
                for s in ("active", "open", "new", "available", "deployed", "detected", "scheduled"):
                    out[s] = q.filter(model.status == s).count()
            return out

    @router.post("/", status_code=201)
    def create_item(payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        merged = {**defaults, **payload}
        missing = [f for f in required if not merged.get(f)]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing required field(s): {', '.join(missing)}")
        row = model(tenant_id=current_user.tenant_id)
        _apply_payload(row, merged)
        if on_create:
            on_create(row, merged)
        db.add(row)
        db.commit()
        db.refresh(row)
        if audit_prefix:
            _audit(db, audit_prefix, "created", row, current_user)
            db.commit()
        return _serialize(row)

    @router.get("/{item_id}")
    def get_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
        return _serialize(_get_or_404(db, model, item_id, current_user))

    @router.patch("/{item_id}")
    def update_item(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        row = _get_or_404(db, model, item_id, current_user)
        _apply_payload(row, payload)
        db.commit()
        db.refresh(row)
        return _serialize(row)

    @router.delete("/{item_id}")
    def delete_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(DELETE)):
        row = _get_or_404(db, model, item_id, current_user)
        if on_delete:
            on_delete(db, row)
        if audit_prefix:
            _audit(db, audit_prefix, "deleted", row, current_user)
        db.delete(row)
        db.commit()
        return {"deleted": str(row.id)}

    @router.post("/{item_id}/status")
    def set_status(item_id: str, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
        row = _get_or_404(db, model, item_id, current_user)
        if status_column not in _columns(model):
            raise HTTPException(status_code=400, detail="This record has no status field")
        if status_values is not None and payload.get("status") not in status_values:
            raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(status_values)}")
        setattr(row, status_column, payload.get("status"))
        if payload.get("attributes"):
            _apply_payload(row, {"attributes": payload["attributes"]})
        db.commit()
        db.refresh(row)
        if audit_prefix:
            _audit(db, audit_prefix, "status_changed", row, current_user,
                   {"status": getattr(row, status_column)})
            db.commit()
        return _serialize(row)


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
