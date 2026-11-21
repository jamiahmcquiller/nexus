import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from ..database import get_db
from ..models import Device, User
from ..auth import get_current_user
from .common import audit, device_brief, parse_date, tenant_devices, warranty_status

router = APIRouter(prefix="/api/v1/warranty", tags=["warranty"])

COVERAGE = ["Basic hardware", "Next business day onsite", "Premium support", "Accidental damage", "Extended"]


class WarrantyIn(BaseModel):
    provider: str | None = None
    coverage: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    purchase_date: date | None = None
    order_number: str | None = None
    notes: str | None = None


def _row(d: Device) -> dict:
    a = d.attributes or {}
    return {**device_brief(d), "manufacturer": a.get("manufacturer"), "model": a.get("model"),
            "serial_number": a.get("serial_number"), "warranty": warranty_status(a)}


@router.get("")
def list_warranty(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = [_row(d) for d in tenant_devices(db, user.tenant_id)]
    order = {"expired": 0, "expiring": 1, "unknown": 2, "active": 3}
    rows.sort(key=lambda r: (order[r["warranty"]["status"]], r["warranty"]["days_left"] if r["warranty"]["days_left"] is not None else 99999))
    counts = {k: sum(1 for r in rows if r["warranty"]["status"] == k) for k in order}
    return {"summary": counts, "devices": rows, "coverage_options": COVERAGE}


def _apply(d: Device, w: dict, source: str):
    a = dict(d.attributes or {})
    cur = dict(a.get("warranty") or {})
    for k, v in w.items():
        if v is not None:
            cur[k] = v.isoformat() if isinstance(v, date) else v
    cur["source"] = source
    a["warranty"] = cur
    d.attributes = a
    flag_modified(d, "attributes")


@router.put("/{device_id}")
def set_warranty(device_id: uuid.UUID, req: WarrantyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.query(Device).filter(Device.id == device_id, Device.tenant_id == user.tenant_id).first()
    if not d:
        raise HTTPException(404, "Device not found")
    if req.start_date and req.end_date and req.end_date < req.start_date:
        raise HTTPException(400, "End date is before start date")
    _apply(d, req.model_dump(), "manual")
    audit(db, user, user.tenant_id, "warranty.updated", "device", d.id, {"hostname": d.hostname, "end_date": str(req.end_date)})
    db.commit()
    return _row(d)


class ImportRow(BaseModel):
    serial_number: str | None = None
    hostname: str | None = None
    provider: str | None = None
    coverage: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class ImportRequest(BaseModel):
    rows: list[ImportRow]


@router.post("/import")
def import_warranty(req: ImportRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Bulk update from a spreadsheet: rows are matched to devices by serial number, then hostname."""
    devices = tenant_devices(db, user.tenant_id)
    by_serial = {((d.attributes or {}).get("serial_number") or "").lower(): d for d in devices}
    by_host = {(d.hostname or "").lower(): d for d in devices}
    updated, unmatched, invalid = 0, [], []
    for r in req.rows:
        d = by_serial.get((r.serial_number or "").strip().lower()) or by_host.get((r.hostname or "").strip().lower())
        ident = r.serial_number or r.hostname or "(blank)"
        if not d:
            unmatched.append(ident)
            continue
        end, start = parse_date(r.end_date), parse_date(r.start_date)
        if r.end_date and not end:
            invalid.append(ident)
            continue
        _apply(d, {"provider": r.provider, "coverage": r.coverage, "start_date": start, "end_date": end}, "import")
        updated += 1
    audit(db, user, user.tenant_id, "warranty.imported", "device", None, {"updated": updated, "unmatched": len(unmatched)})
    db.commit()
    return {"updated": updated, "unmatched": unmatched, "invalid": invalid}
