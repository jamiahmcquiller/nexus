"""Fill an organization with sample devices so the console has something to show.

Usage (from nexus-backend/):
    poetry run python -m app.scripts.seed_demo <username>

Adds ~18 sample Windows endpoints, a few groups, and activity to the organization
that <username> belongs to. Every sample device id starts with "demo-" so it can be
removed later with:
    poetry run python -m app.scripts.seed_demo <username> --remove
"""
import random
import sys
import uuid
from datetime import datetime, timedelta

from ..database import SessionLocal, Base, engine
from ..models import Device, User, Group, DeviceGroup, AuditEvent

Base.metadata.create_all(bind=engine)

DEPARTMENTS = ["Finance", "Human Resources", "IT Services", "Operations", "Sales", "Legal"]
PREFIX = {"Finance": "FIN", "Human Resources": "HR", "IT Services": "IT",
          "Operations": "OPS", "Sales": "SALES", "Legal": "LEGAL"}
MODELS = [
    ("Lenovo", "ThinkPad T14 Gen 4", "Intel Core i7-1365U", 16),
    ("Dell", "Latitude 5440", "Intel Core i5-1345U", 16),
    ("HP", "EliteBook 840 G10", "Intel Core i7-1355U", 32),
    ("Dell", "OptiPlex 7010", "Intel Core i5-13500", 16),
    ("Lenovo", "ThinkCentre M70q", "Intel Core i5-12400T", 8),
    ("Microsoft", "Surface Laptop 5", "Intel Core i7-1265U", 16),
]
OSES = [("Windows 11 Pro", "23H2", "22631"), ("Windows 11 Pro", "24H2", "26100"),
        ("Windows 10 Pro", "22H2", "19045")]
SOFTWARE = [
    ("Google Chrome", "Google LLC", "131.0.6778.86"),
    ("Microsoft Edge", "Microsoft Corporation", "131.0.2903.70"),
    ("Microsoft 365 Apps for business", "Microsoft Corporation", "16.0.18129"),
    ("Microsoft Teams", "Microsoft Corporation", "24295.605"),
    ("Adobe Acrobat Reader", "Adobe Inc.", "24.004.20220"),
    ("Zoom Workplace", "Zoom Video Communications", "6.2.11"),
    ("7-Zip", "Igor Pavlov", "24.08"),
    ("Slack", "Slack Technologies", "4.41.105"),
    ("Mozilla Firefox", "Mozilla", "133.0"),
    ("Notepad++", "Notepad++ Team", "8.7.1"),
    ("QuickBooks Desktop", "Intuit", "34.0"),
    ("Visual Studio Code", "Microsoft Corporation", "1.95.3"),
]
USERS = ["a.johnson", "m.garcia", "d.smith", "k.williams", "t.brown", "j.davis",
         "s.miller", "r.wilson", "l.moore", "c.taylor", "p.anderson", "n.thomas"]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    username = sys.argv[1]
    remove = "--remove" in sys.argv
    db = SessionLocal()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        print(f"No user named '{username}'. Create an organization in the console first.")
        sys.exit(1)
    tid = user.tenant_id

    demo = db.query(Device).filter(Device.tenant_id == tid, Device.device_id.like("demo-%")).all()
    for d in demo:
        db.query(DeviceGroup).filter(DeviceGroup.device_id == d.id).delete()
        db.query(AuditEvent).filter(AuditEvent.entity_id == d.id).delete()
        db.delete(d)
    db.flush()
    if remove:
        db.commit()
        print(f"Removed {len(demo)} sample devices.")
        return

    rng = random.Random(42)
    groups = {}
    for name in ["Finance", "Human Resources", "IT Services", "Executive Laptops", "Remote Workers"]:
        g = db.query(Group).filter(Group.tenant_id == tid, Group.name == name).first()
        if not g:
            g = Group(tenant_id=tid, name=name)
            db.add(g)
            db.flush()
        groups[name] = g

    now = datetime.utcnow()
    count = 0
    for i in range(18):
        dept = DEPARTMENTS[i % len(DEPARTMENTS)]
        maker, model, cpu, ram = MODELS[rng.randrange(len(MODELS))]
        os_name, os_ver, build = OSES[0 if i % 5 else 2] if i % 7 else OSES[1]
        online = i % 6 != 3
        last = now - (timedelta(minutes=rng.randint(1, 40)) if online else timedelta(hours=rng.randint(3, 96)))
        enrolled = now - timedelta(days=rng.randint(2, 60), hours=rng.randint(0, 23))
        hostname = f"{PREFIX[dept]}-{'LT' if 'Book' in model or 'Pad' in model or 'Surface' in model else 'WS'}-{100 + i:03d}"
        sw = rng.sample(SOFTWARE, rng.randint(6, 10))
        disk_total = rng.choice([256, 512, 1024])
        attrs = {
            "department": dept,
            "assigned_user": USERS[i % len(USERS)],
            "serial_number": f"{maker[:2].upper()}{rng.randint(10000000, 99999999)}",
            "manufacturer": maker,
            "model": model,
            "os": {"name": os_name, "version": os_ver, "build": build},
            "hardware": {
                "cpu": cpu, "ram_gb": ram,
                "disk_total_gb": disk_total,
                "disk_free_gb": round(disk_total * rng.uniform(0.15, 0.7)),
            },
            "network": {"ip_address": f"10.20.{i // 10 + 1}.{rng.randint(10, 250)}",
                        "mac_address": ":".join(f"{rng.randint(0, 255):02X}" for _ in range(6))},
            "security": {"bitlocker": rng.random() > 0.15, "firewall": True,
                         "defender": rng.random() > 0.08},
            "software": [{"name": n, "publisher": p, "version": v} for n, p, v in sw],
        }
        d = Device(tenant_id=tid, hostname=hostname, device_id=f"demo-{uuid.uuid4()}",
                   enrollment_status="enrolled", agent_version="0.1.0",
                   last_checkin_at=last, attributes=attrs, created_at=enrolled)
        db.add(d)
        db.flush()
        if dept in groups:
            db.add(DeviceGroup(device_id=d.id, group_id=groups[dept].id))
        if "Book" in model or "Pad" in model or "Surface" in model:
            db.add(DeviceGroup(device_id=d.id, group_id=groups["Remote Workers"].id))
        if model.startswith(("EliteBook", "Surface")):
            db.add(DeviceGroup(device_id=d.id, group_id=groups["Executive Laptops"].id))
        db.add(AuditEvent(tenant_id=tid, action="device.enrolled", entity_type="device",
                          entity_id=d.id, event_metadata={"hostname": hostname}, occurred_at=enrolled))
        if not online:
            db.add(AuditEvent(tenant_id=tid, action="device.stale", entity_type="device",
                              entity_id=d.id, event_metadata={"hostname": hostname},
                              occurred_at=last + timedelta(hours=1)))
        count += 1
    db.commit()
    print(f"Added {count} sample devices to your organization.")


if __name__ == "__main__":
    main()
