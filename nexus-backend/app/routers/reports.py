from collections import Counter, defaultdict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import DeviceVulnerability, Vulnerability, DevicePatch, Patch, Ticket, User
from ..auth import get_current_user
from .common import is_online, tenant_devices, warranty_status
from .servicedesk import sla_state

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("")
def reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    tid = user.tenant_id
    devices = tenant_devices(db, tid)
    by_id = {d.id: d for d in devices}
    attr = lambda d, k, default="Unassigned": (d.attributes or {}).get(k) or default

    # Inventory
    inventory = {
        "total": len(devices), "online": sum(1 for d in devices if is_online(d)),
        "by_department": Counter(attr(d, "department") for d in devices).most_common(),
        "by_os": Counter(((d.attributes or {}).get("os") or {}).get("name", "Unknown") for d in devices).most_common(),
        "by_manufacturer": Counter(attr(d, "manufacturer", "Unknown") for d in devices).most_common(),
    }

    # Vulnerabilities by department and the most exposed devices
    findings = (db.query(DeviceVulnerability, Vulnerability).join(Vulnerability, Vulnerability.id == DeviceVulnerability.vulnerability_id)
                .filter(DeviceVulnerability.tenant_id == tid, DeviceVulnerability.status == "open").all())
    dept_sev = defaultdict(Counter)
    dev_count = Counter()
    for f, v in findings:
        d = by_id.get(f.device_id)
        if d:
            dept_sev[attr(d, "department")][v.severity] += 1
            dev_count[d.id] += 1
    vulns = {
        "by_department": [{"name": k, **{s: c.get(s, 0) for s in ("critical", "high", "medium", "low")}} for k, c in sorted(dept_sev.items())],
        "top_devices": [{"id": str(k), "hostname": by_id[k].hostname, "department": attr(by_id[k], "department"), "open": n}
                        for k, n in dev_count.most_common(8)],
    }

    # Patch compliance by department (approved patches only)
    rows = (db.query(DevicePatch).join(Patch, Patch.id == DevicePatch.patch_id)
            .filter(DevicePatch.tenant_id == tid, Patch.approval == "approved").all())
    dept_p = defaultdict(lambda: [0, 0])
    for r in rows:
        d = by_id.get(r.device_id)
        if d:
            dept_p[attr(d, "department")][1] += 1
            dept_p[attr(d, "department")][0] += r.status == "installed"
    patches = [{"name": k, "compliance": round(100 * a / t, 1) if t else None} for k, (a, t) in sorted(dept_p.items())]

    # Service desk
    tickets = db.query(Ticket).filter(Ticket.tenant_id == tid).all()
    done = [t for t in tickets if t.resolved_at]
    service = {
        "by_status": Counter(t.status for t in tickets).most_common(),
        "by_type": Counter(t.type for t in tickets).most_common(),
        "by_category": Counter(t.category or "General" for t in tickets).most_common(6),
        "sla_met_pct": round(100 * sum(1 for t in done if sla_state(t) == "met") / len(done), 1) if done else None,
    }

    # Warranty
    ws = [warranty_status(d.attributes or {}) for d in devices]
    warranty = {
        "by_status": {k: sum(1 for w in ws if w["status"] == k) for k in ("active", "expiring", "expired", "unknown")},
        "by_provider": Counter(w.get("provider") or "Unknown" for w in ws).most_common(),
    }
    return {"inventory": inventory, "vulnerabilities": vulns, "patches": patches, "service_desk": service, "warranty": warranty}
