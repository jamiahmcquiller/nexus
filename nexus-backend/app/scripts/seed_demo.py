"""Fill an organization with sample data so every NEXUS module has something to show.

Usage (from nexus-backend/):
    poetry run python -m app.scripts.seed_demo <username>
    poetry run python -m app.scripts.seed_demo <username> --remove

Adds 18 sample Windows endpoints (with warranty data), groups, vulnerability findings,
patches and deployments, software rules, service desk tickets, automation workflows,
compliance evidence, and a risk register to the organization <username> belongs to.

Every sample device id starts with "demo-". --remove deletes the sample devices and
everything attached to them (findings, patch status, tickets). Organization-level
setup (workflows, policies, risks, software rules) is kept, since it is reusable.

Vulnerability and patch records reference real public CVE and KB identifiers so the
screens look realistic, but which devices are affected is made up.
"""
import random
import sys
import uuid
from datetime import datetime, timedelta, date

from ..database import SessionLocal, Base, engine
from ..models import (Device, User, Group, DeviceGroup, AuditEvent, Vulnerability, DeviceVulnerability,
                      Patch, DevicePatch, PatchDeployment, DeploymentPolicy, SoftwareRule, Ticket,
                      TicketComment, Workflow, ControlStatus, Risk)

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
WARRANTY_PLANS = {
    "Dell": ("Dell", "ProSupport Next business day onsite"),
    "Lenovo": ("Lenovo", "Premier Support"),
    "HP": ("HP", "HP Care Pack Next business day onsite"),
    "Microsoft": ("Microsoft", "Microsoft Complete for Business"),
}
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
UNAPPROVED = [("uTorrent", "BitTorrent Inc.", "3.6.0"), ("AnyDesk", "AnyDesk Software GmbH", "8.1.0")]
USERS = ["a.johnson", "m.garcia", "d.smith", "k.williams", "t.brown", "j.davis",
         "s.miller", "r.wilson", "l.moore", "c.taylor", "p.anderson", "n.thomas"]

# (cve, title, severity, cvss, epss, exploited, product, vulnerable_version, fixed, published, description)
VULNS = [
    ("CVE-2024-38063", "Windows TCP/IP remote code execution (IPv6)", "critical", 9.8, 0.05, False, "Windows", None, "Nov 2024 cumulative update", "2024-08-13",
     "Specially crafted IPv6 packets can let a remote attacker run code on an unpatched Windows device."),
    ("CVE-2024-30088", "Windows Kernel elevation of privilege", "high", 7.0, 0.32, True, "Windows", None, "Nov 2024 cumulative update", "2024-06-11",
     "A race condition in the Windows kernel lets a local attacker gain SYSTEM privileges."),
    ("CVE-2024-49039", "Windows Task Scheduler elevation of privilege", "high", 8.8, 0.21, True, "Windows", None, "Nov 2024 cumulative update", "2024-11-12",
     "A low-privileged app can escalate its privileges through Task Scheduler."),
    ("CVE-2024-43451", "NTLM hash disclosure spoofing", "medium", 6.5, 0.18, True, "Windows", None, "Nov 2024 cumulative update", "2024-11-12",
     "Minimal interaction with a malicious file can expose a user's NTLMv2 hash."),
    ("CVE-2024-21412", "Internet Shortcut files security feature bypass", "high", 8.1, 0.44, True, "Windows", None, "Nov 2024 cumulative update", "2024-02-13",
     "Crafted shortcut files can bypass SmartScreen warnings."),
    ("CVE-2024-4947", "Google Chrome V8 type confusion", "high", 8.8, 0.37, True, "Google Chrome", "125.0.6422.60", "125.0.6422.112", "2024-05-22",
     "A crafted web page can corrupt memory in Chrome's JavaScript engine."),
    ("CVE-2024-9680", "Firefox animation timeline use-after-free", "critical", 9.8, 0.55, True, "Mozilla Firefox", "131.0", "131.0.2", "2024-10-09",
     "Attackers can run code in the content process through animation timelines."),
    ("CVE-2024-11477", "7-Zip Zstandard decompression code execution", "high", 7.8, 0.08, False, "7-Zip", "24.06", "24.07", "2024-11-22",
     "Opening a crafted archive can let an attacker run code."),
    ("CVE-2025-0411", "7-Zip Mark-of-the-Web bypass", "high", 7.0, 0.29, True, "7-Zip", "24.08", "24.09", "2025-01-25",
     "Files extracted from crafted archives lose Windows' downloaded-from-internet protection."),
    ("CVE-2024-41869", "Adobe Acrobat Reader use-after-free", "critical", 7.8, 0.12, False, "Adobe Acrobat Reader", "24.002.21005", "24.003.20112", "2024-09-13",
     "Opening a malicious PDF can let an attacker run code."),
    ("CVE-2024-24691", "Zoom desktop client improper input validation", "critical", 9.6, 0.04, False, "Zoom Workplace", "5.16.2", "5.16.5", "2024-02-14",
     "An unauthenticated user may escalate privileges over the network."),
    ("CVE-2023-40031", "Notepad++ heap buffer overflow", "medium", 5.5, 0.02, False, "Notepad++", "8.5.6", "8.5.7", "2023-08-25",
     "Opening a crafted file can crash the editor or corrupt memory."),
]

# (kb, title, product, classification, severity, release, size_mb, approval)
PATCHES = [
    ("KB5046617", "2024-11 Cumulative Update for Windows 11 Version 23H2", "Windows 11", "security", "critical", "2024-11-12", "742", "approved"),
    ("KB5046613", "2024-11 Cumulative Update for Windows 10 Version 22H2", "Windows 10", "security", "critical", "2024-11-12", "688", "approved"),
    ("KB5046740", "2024-11 Preview Update for Windows 11 Version 24H2", "Windows 11", "feature", "moderate", "2024-11-21", "512", "pending"),
    ("KB4052623", "Microsoft Defender Antivirus platform update", "Microsoft Defender", "security", "important", "2024-11-05", "64", "approved"),
    ("CHROME-131.0.6778.86", "Google Chrome 131.0.6778.86", "Google Chrome", "security", "important", "2024-11-19", "112", "approved"),
    ("FIREFOX-133.0", "Mozilla Firefox 133.0", "Mozilla Firefox", "security", "critical", "2024-11-26", "61", "approved"),
    ("ACROBAT-24.004.20220", "Adobe Acrobat Reader 24.004.20220", "Adobe Acrobat Reader", "security", "important", "2024-11-12", "410", "approved"),
    ("7ZIP-24.09", "7-Zip 24.09", "7-Zip", "security", "important", "2024-11-29", "2", "pending"),
    ("ZOOM-6.2.11", "Zoom Workplace 6.2.11", "Zoom Workplace", "security", "moderate", "2024-11-12", "98", "pending"),
    ("NPP-8.7.1", "Notepad++ 8.7.1", "Notepad++", "feature", "low", "2024-10-29", "5", "declined"),
]


def remove_demo(db, tid):
    demo = db.query(Device).filter(Device.tenant_id == tid, Device.device_id.like("demo-%")).all()
    ids = [d.id for d in demo]
    if ids:
        tids = [t.id for t in db.query(Ticket.id).filter(Ticket.device_id.in_(ids)).all()]
        if tids:
            db.query(TicketComment).filter(TicketComment.ticket_id.in_(tids)).delete(synchronize_session=False)
            db.query(Ticket).filter(Ticket.id.in_(tids)).delete(synchronize_session=False)
        db.query(DeviceVulnerability).filter(DeviceVulnerability.device_id.in_(ids)).delete(synchronize_session=False)
        db.query(DevicePatch).filter(DevicePatch.device_id.in_(ids)).delete(synchronize_session=False)
        db.query(DeviceGroup).filter(DeviceGroup.device_id.in_(ids)).delete(synchronize_session=False)
        db.query(AuditEvent).filter(AuditEvent.entity_id.in_(ids)).delete(synchronize_session=False)
        db.flush()
        db.query(Device).filter(Device.id.in_(ids)).delete(synchronize_session=False)
    db.flush()
    # Vulnerabilities and patches that no device references any more
    for v in db.query(Vulnerability).filter(Vulnerability.tenant_id == tid).all():
        if not db.query(DeviceVulnerability).filter(DeviceVulnerability.vulnerability_id == v.id).first():
            db.query(Vulnerability).filter(Vulnerability.id == v.id).delete(synchronize_session=False)
    for p in db.query(Patch).filter(Patch.tenant_id == tid).all():
        if not db.query(DevicePatch).filter(DevicePatch.patch_id == p.id).first():
            db.query(Patch).filter(Patch.id == p.id).delete(synchronize_session=False)
    db.query(PatchDeployment).filter(PatchDeployment.tenant_id == tid, PatchDeployment.created_by == "NEXUS sample data").delete()
    db.flush()
    return len(demo)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    username = sys.argv[1]
    db = SessionLocal()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        print(f"No user named '{username}'. Create an organization in the console first.")
        sys.exit(1)
    tid = user.tenant_id
    removed = remove_demo(db, tid)
    if "--remove" in sys.argv:
        db.commit()
        print(f"Removed {removed} sample devices and their findings, patch status, and tickets.")
        return

    rng = random.Random(42)
    now = datetime.utcnow()
    today = date.today()

    # --- Groups ------------------------------------------------------------
    groups = {}
    for name in ["Finance", "Human Resources", "IT Services", "Executive Laptops", "Remote Workers"]:
        g = db.query(Group).filter(Group.tenant_id == tid, Group.name == name).first()
        if not g:
            g = Group(tenant_id=tid, name=name)
            db.add(g)
            db.flush()
        groups[name] = g

    # --- Devices (with warranty) -------------------------------------------
    devices = []
    for i in range(18):
        dept = DEPARTMENTS[i % len(DEPARTMENTS)]
        maker, model, cpu, ram = MODELS[rng.randrange(len(MODELS))]
        os_name, os_ver, build = OSES[0 if i % 5 else 2] if i % 7 else OSES[1]
        online = i % 6 != 3
        last = now - (timedelta(minutes=rng.randint(1, 40)) if online else timedelta(hours=rng.randint(30, 96)))
        enrolled = now - timedelta(days=rng.randint(2, 60), hours=rng.randint(0, 23))
        laptop = any(k in model for k in ("Book", "Pad", "Surface"))
        hostname = f"{PREFIX[dept]}-{'LT' if laptop else 'WS'}-{100 + i:03d}"
        sw = rng.sample(SOFTWARE, rng.randint(6, 10))
        if i in (4, 11):
            sw.append(UNAPPROVED[0])
        if i == 15:
            sw.append(UNAPPROVED[1])
        disk_total = rng.choice([256, 512, 1024])
        free_pct = 0.08 if i in (5, 13) else rng.uniform(0.2, 0.7)
        # Three-year warranties: a few expired or ending soon, one with no record
        purchase = today - timedelta(days=rng.randint(120, 1000))
        if i in (2, 9):
            purchase = today - timedelta(days=3 * 365 + rng.randint(20, 200))
        if i in (6, 14, 17):
            purchase = today - timedelta(days=3 * 365 - rng.randint(15, 80))
        provider, coverage = WARRANTY_PLANS[maker]
        attrs = {
            "department": dept,
            "assigned_user": USERS[i % len(USERS)],
            "serial_number": f"{maker[:2].upper()}{rng.randint(10000000, 99999999)}",
            "manufacturer": maker,
            "model": model,
            "os": {"name": os_name, "version": os_ver, "build": build},
            "hardware": {"cpu": cpu, "ram_gb": ram, "disk_total_gb": disk_total,
                         "disk_free_gb": round(disk_total * free_pct)},
            "network": {"ip_address": f"10.20.{i // 10 + 1}.{rng.randint(10, 250)}",
                        "mac_address": ":".join(f"{rng.randint(0, 255):02X}" for _ in range(6))},
            "security": {"bitlocker": rng.random() > 0.15, "firewall": i != 8, "defender": rng.random() > 0.08},
            "software": [{"name": n, "publisher": p, "version": v} for n, p, v in sw],
        }
        if i != 10:
            attrs["warranty"] = {
                "provider": provider, "coverage": coverage, "purchase_date": purchase.isoformat(),
                "start_date": purchase.isoformat(), "end_date": (purchase + timedelta(days=3 * 365)).isoformat(),
                "order_number": f"PO-{rng.randint(40000, 49999)}", "source": "sample",
            }
        d = Device(tenant_id=tid, hostname=hostname, device_id=f"demo-{uuid.uuid4()}",
                   enrollment_status="enrolled", agent_version="0.1.0",
                   last_checkin_at=last, attributes=attrs, created_at=enrolled)
        db.add(d)
        db.flush()
        devices.append(d)
        if dept in groups:
            db.add(DeviceGroup(device_id=d.id, group_id=groups[dept].id))
        if laptop:
            db.add(DeviceGroup(device_id=d.id, group_id=groups["Remote Workers"].id))
        if model.startswith(("EliteBook", "Surface")):
            db.add(DeviceGroup(device_id=d.id, group_id=groups["Executive Laptops"].id))
        db.add(AuditEvent(tenant_id=tid, action="device.enrolled", entity_type="device",
                          entity_id=d.id, event_metadata={"hostname": hostname}, occurred_at=enrolled))
        if not online:
            db.add(AuditEvent(tenant_id=tid, action="device.stale", entity_type="device",
                              entity_id=d.id, event_metadata={"hostname": hostname},
                              occurred_at=last + timedelta(hours=1)))

    # --- Vulnerabilities ---------------------------------------------------
    vuln_rows = {}
    for cve, title, sev, cvss, epss, kev, product, vuln_ver, fixed, pub, desc in VULNS:
        v = db.query(Vulnerability).filter(Vulnerability.tenant_id == tid, Vulnerability.cve_id == cve).first()
        if not v:
            v = Vulnerability(tenant_id=tid, cve_id=cve, title=title, description=desc, severity=sev,
                              cvss={"score": cvss}, epss={"score": epss}, known_exploited="yes" if kev else "no",
                              product=product, fixed_version=fixed, published_at=datetime.fromisoformat(pub))
            db.add(v)
            db.flush()
        vuln_rows[cve] = (v, product, vuln_ver)
    for d in devices:
        a = dict(d.attributes)
        a["software"] = [dict(s) for s in a["software"]]
        names = {s["name"]: s for s in a["software"]}
        win10 = a["os"]["name"].startswith("Windows 10")
        for cve, (v, product, vuln_ver) in vuln_rows.items():
            if product == "Windows":
                hit = win10 or (a["os"]["version"] == "23H2" and rng.random() < 0.45)
            else:
                hit = product in names and rng.random() < 0.4
                if hit:
                    names[product]["version"] = vuln_ver  # the device runs the vulnerable build
            if not hit:
                continue
            detected = now - timedelta(days=rng.randint(1, 40))
            r = rng.random()
            status = "remediated" if r < 0.25 else "accepted" if r < 0.3 else "open"
            db.add(DeviceVulnerability(tenant_id=tid, device_id=d.id, vulnerability_id=v.id, status=status,
                                       first_detected=detected,
                                       resolved_at=detected + timedelta(days=rng.randint(1, 12)) if status != "open" else None,
                                       note="Compensating control: app runs in restricted mode" if status == "accepted" else None))
        d.attributes = a

    # --- Patches -----------------------------------------------------------
    patch_rows = []
    for kb, title, product, cls, sev, rel, size, approval in PATCHES:
        p = db.query(Patch).filter(Patch.tenant_id == tid, Patch.kb_id == kb).first()
        if not p:
            p = Patch(tenant_id=tid, kb_id=kb, title=title, product=product, classification=cls, severity=sev,
                      release_date=datetime.fromisoformat(rel), size_mb=size, approval=approval,
                      approved_by=user.username if approval != "pending" else None,
                      approved_at=now - timedelta(days=3) if approval != "pending" else None)
            db.add(p)
            db.flush()
        patch_rows.append(p)
    for d in devices:
        a = d.attributes
        names = {s["name"] for s in a["software"]}
        online = d.last_checkin_at >= now - timedelta(hours=1)
        for p in patch_rows:
            applies = (p.product == "Windows 11" and a["os"]["name"].startswith("Windows 11")) or \
                      (p.product == "Windows 10" and a["os"]["name"].startswith("Windows 10")) or \
                      p.product == "Microsoft Defender" or p.product in names
            if p.kb_id == "KB5046740" and a["os"]["version"] != "24H2":
                applies = False
            if not applies:
                continue
            r = rng.random()
            status = "installed" if (p.approval == "approved" and online and r < 0.85) else "failed" if r > 0.95 else "missing"
            db.add(DevicePatch(device_id=d.id, patch_id=p.id, tenant_id=tid, status=status,
                               updated_at=now - timedelta(days=rng.randint(0, 6))))
    approved_ids = [str(p.id) for p in patch_rows if p.approval == "approved"]
    db.add(PatchDeployment(tenant_id=tid, name="November security updates", status="completed",
                           scheduled_for=now - timedelta(days=5), patch_ids=approved_ids[:2], target={"type": "all"},
                           results={"succeeded": 14, "failed": 1, "pending": 3, "devices": 18},
                           created_by="NEXUS sample data", created_at=now - timedelta(days=6), completed_at=now - timedelta(days=5)))
    db.add(PatchDeployment(tenant_id=tid, name="Browser updates", status="completed",
                           scheduled_for=now - timedelta(days=2), patch_ids=approved_ids[3:6], target={"type": "all"},
                           results={"succeeded": 21, "failed": 0, "pending": 2, "devices": 18},
                           created_by="NEXUS sample data", created_at=now - timedelta(days=3), completed_at=now - timedelta(days=2)))
    days_to_sunday = (6 - now.weekday()) % 7 or 7
    db.add(PatchDeployment(tenant_id=tid, name="Weekend maintenance window", status="scheduled",
                           scheduled_for=(now + timedelta(days=days_to_sunday)).replace(hour=7, minute=0, second=0, microsecond=0),
                           patch_ids=approved_ids, target={"type": "all"}, results={},
                           created_by="NEXUS sample data", created_at=now - timedelta(hours=5)))
    if not db.query(DeploymentPolicy).filter(DeploymentPolicy.tenant_id == tid).first():
        for name, desc, rules in [
            ("Critical security updates", "Install critical Windows and Defender updates in the weekend window.",
             {"auto_approve": ["critical"], "window": "Sundays 2:00 to 5:00 AM", "reboot": "Prompt user, force after 24 hours", "target": "All devices"}),
            ("Third-party applications", "Browsers, PDF readers, and archive tools.",
             {"auto_approve": ["critical", "important"], "window": "Wednesdays 12:00 to 1:00 PM", "reboot": "Not required", "target": "All devices"}),
            ("Executive laptops", "Delay non-critical updates one week to limit disruption.",
             {"auto_approve": ["critical"], "deferral_days": 7, "window": "Saturdays 10:00 PM to 2:00 AM", "reboot": "Prompt user", "target": "Executive Laptops"}),
        ]:
            db.add(DeploymentPolicy(tenant_id=tid, name=name, description=desc, rules=rules))

    # --- Software rules ----------------------------------------------------
    for name, status, note in [
        ("Google Chrome", "approved", "Standard browser"), ("Microsoft Edge", "approved", None),
        ("Microsoft 365 Apps for business", "approved", None), ("Microsoft Teams", "approved", None),
        ("Adobe Acrobat Reader", "approved", None), ("Zoom Workplace", "approved", None), ("Slack", "approved", None),
        ("uTorrent", "unapproved", "Peer-to-peer file sharing is not allowed"),
        ("AnyDesk", "unapproved", "Use the approved remote support tool instead"),
    ]:
        if not db.query(SoftwareRule).filter(SoftwareRule.tenant_id == tid, SoftwareRule.name == name).first():
            db.add(SoftwareRule(tenant_id=tid, name=name, status=status, note=note))

    # --- Service desk ------------------------------------------------------
    from ..routers.servicedesk import create_ticket_record, SLA_HOURS
    sample_tickets = [
        ("incident", "Laptop will not connect to VPN", "high", "Network", "in_progress", 2, 30, None),
        ("incident", "Outlook keeps asking for password", "medium", "Email", "new", 5, 3, None),
        ("incident", "Printer on 3rd floor offline", "low", "Printing", "waiting", 8, 50, None),
        ("incident", "Blue screen after update", "critical", "Hardware", "in_progress", 13, 1, None),
        ("incident", "Cannot open shared Finance drive", "high", "Access", "resolved", 0, 40, 5),
        ("incident", "Teams audio cutting out", "medium", "Collaboration", "resolved", 7, 70, 20),
        ("incident", "Suspicious email reported", "high", "Security", "resolved", 3, 26, 2),
        ("request", "New hire laptop setup for Sales", "medium", "Onboarding", "in_progress", 4, 20, None),
        ("request", "Install Visual Studio Code", "low", "Software", "new", 11, 4, None),
        ("request", "Access to QuickBooks for new accountant", "medium", "Access", "new", 0, 9, None),
        ("request", "Replacement charger", "low", "Hardware", "closed", 6, 120, 30),
        ("change", "Upgrade Finance workstations to Windows 11 24H2", "medium", "Change", "new", 0, 12, None),
        ("change", "Enable BitLocker on remaining devices", "high", "Security", "in_progress", 9, 48, None),
    ]
    assignees = [user.username, "j.davis", None]
    for idx, (ttype, title, prio, cat, status, dev_i, age_h, res_h) in enumerate(sample_tickets):
        d = devices[dev_i % len(devices)]
        who = d.attributes["assigned_user"]
        t = create_ticket_record(db, tid, type=ttype, title=title, priority=prio, category=cat, requester=who,
                                 device_id=d.id, source="portal" if ttype == "request" else "console",
                                 assignee=assignees[idx % 3] if status != "new" else None,
                                 description=f"Reported by {who} on {d.hostname}.")
        t.created_at = now - timedelta(hours=age_h)
        t.updated_at = t.created_at
        t.sla_due_at = t.created_at + timedelta(hours=SLA_HOURS[prio])
        t.status = status
        if res_h is not None:
            t.resolved_at = t.created_at + timedelta(hours=res_h)
        if ttype in ("request", "change"):
            t.approval = "approved" if status in ("in_progress", "closed") else "pending"
        db.add(TicketComment(ticket_id=t.id, tenant_id=tid, author=who,
                             body="Thanks, let me know if you need anything else from me.",
                             created_at=t.created_at + timedelta(minutes=20)))
        if status != "new":
            db.add(TicketComment(ticket_id=t.id, tenant_id=tid, author=t.assignee or user.username,
                                 body="Looking into this now.", created_at=t.created_at + timedelta(minutes=50)))

    # --- Automation --------------------------------------------------------
    db.flush()
    if not db.query(Workflow).filter(Workflow.tenant_id == tid).first():
        for name, desc, trigger, action, sched in [
            ("Offline device follow-up", "Open a ticket when a device stops checking in for a day.",
             {"type": "device_offline", "hours": 24}, {"type": "create_ticket", "priority": "high", "category": "Hardware"}, "Every hour"),
            ("Critical vulnerability response", "Open a critical ticket for any device with an open critical vulnerability.",
             {"type": "critical_vulnerability"}, {"type": "create_ticket", "priority": "critical", "category": "Security"}, "Every hour"),
            ("Low disk space", "Flag devices with less than 15% free disk space.",
             {"type": "low_disk", "percent": 15}, {"type": "create_ticket", "priority": "medium", "category": "Hardware"}, "Daily at 6:00 AM"),
            ("Warranty renewal reminder", "Alert when a warranty ends within 60 days.",
             {"type": "warranty_expiring", "days": 60}, {"type": "notify"}, "Weekly on Monday"),
            ("Unapproved software watch", "Alert when unapproved software is found.",
             {"type": "unapproved_software"}, {"type": "notify"}, "Daily at 7:00 AM"),
        ]:
            # The critical-vulnerability workflow starts off so the sample queue stays readable; turn it on to try it.
            db.add(Workflow(tenant_id=tid, name=name, description=desc, trigger=trigger, action=action, schedule=sched,
                            enabled="no" if trigger["type"] == "critical_vulnerability" else "yes"))
        db.flush()
    from ..routers.automation import run_workflow
    for w in db.query(Workflow).filter(Workflow.tenant_id == tid, Workflow.enabled == "yes").all():
        run_workflow(db, w, None)

    # --- Compliance --------------------------------------------------------
    for key, status, owner, evidence in [
        ("account_inventory", "passing", user.username, "Quarterly access review completed; export stored in the IT shared drive."),
        ("mfa_admin", "in_progress", "j.davis", "MFA enforced for 4 of 6 administrators. Remaining two scheduled."),
        ("backups", "passing", "j.davis", "Nightly backups to cloud storage. Restore test passed last month."),
        ("awareness", "failing", user.username, "Annual training overdue for 9 staff members."),
        ("ir_plan", "not_started", None, None),
    ]:
        if not db.query(ControlStatus).filter(ControlStatus.tenant_id == tid, ControlStatus.control_key == key).first():
            db.add(ControlStatus(tenant_id=tid, control_key=key, status=status, owner=owner, evidence=evidence))
    if not db.query(Risk).filter(Risk.tenant_id == tid).first():
        for title, desc, lik, imp, owner, status, treat in [
            ("Ransomware through phishing email", "Staff click a malicious link and ransomware spreads to shared drives.", 4, 5, user.username, "mitigating",
             "Awareness training, email filtering, offline backups."),
            ("Lost or stolen laptop with client data", "An unencrypted laptop leaves the office.", 3, 4, "j.davis", "mitigating",
             "Enforce BitLocker on every device (change in progress)."),
            ("Hardware failure on out-of-warranty devices", "Devices past warranty fail with no vendor support.", 3, 3, "j.davis", "open",
             "Budget replacements for devices past warranty."),
            ("Unpatched third-party software", "Browsers and PDF readers fall behind on security updates.", 3, 4, user.username, "mitigating",
             "Weekly third-party patch policy."),
            ("Single administrator for key systems", "Only one person can manage critical systems.", 2, 4, user.username, "accepted",
             "Documented runbooks; second admin to be trained next quarter."),
        ]:
            db.add(Risk(tenant_id=tid, title=title, description=desc, likelihood=str(lik), impact=str(imp),
                        owner=owner, status=status, treatment=treat))

    db.commit()
    print(f"Added {len(devices)} sample devices with warranty, vulnerability, patch, ticket, automation, and compliance data.")


if __name__ == "__main__":
    main()
