"""Platform-wide demo data for the NULL redesign preview.

Seeds realistic-looking rows across the IT Operations and Security
Operations workspaces so the redesigned home screens have something to
render on a fresh tenant. Modeled on the GRC demo seed
(``app/routers/grc.py``): owner/admin only, idempotent, every row
tenant-scoped and flagged ``is_demo=True``, and clear-demo deletes
only demo rows.

HONESTY — these rows are SAMPLE data, not live telemetry:
- The frontend must label any surface showing them "Sample data".
- Never present them as real endpoints, real patch state, or real
  detections, and never claim compliance from framework configuration.
- Vulnerability rows use only real, well-known CVE IDs with their
  published CVSS scores. No CVE ID or score is invented here; the
  severity is derived from the published score (>=9.0 critical,
  7.0-8.9 high, 4.0-6.9 medium, <4.0 low). That is why this set has
  no low-severity row — the famous-CVE set is naturally critical/high.
- Patch KB numbers and malware family names are illustrative sample
  labels, not records of real vendor releases or real detections.
- No user login accounts are seeded. The real enrolled Mac
  (device_id ``darwin-ac913e0958751651``) is never flagged demo, never
  modified, and never deleted by either endpoint.
- RECONCILIATION — every number the two home screens show is derived
  from these rows, so the seed's splits are pinned by
  ``tests/test_demo_seed.py::test_seed_counts_reconcile_with_home_screens``
  (deployment outcomes deployed 12 / failed 6 / scheduled 3 /
  approved 3 / deploying 3 / declined 3 = 30; patch compliance
  57/102 = 56%; device health online 30 / attention 12 / offline 12 /
  degraded 6; open vulns 21 = critical 15 / high 5 / medium 1; and the
  incident / malware / DLP / server splits). Change a cycle only if
  you update that test's expected numbers too.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import require_role
from ..database import get_db
from ..models import (
    AuditEvent, Device, Patch, Policy, User, Vulnerability,
)
from ..models_extended import (
    IncidentResponse, MalwareDetection, PatchDeployment,
    SensitiveDataFinding, Server,
)

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])

# The real enrolled Mac — never seeded over, never flagged demo,
# never deleted. The seed only ever creates device_ids starting
# with "demo-", so this guard is belt-and-braces.
PROTECTED_DEVICE_ID = "darwin-ac913e0958751651"

# Children first (FK targets last) so clear-demo never trips a FK.
DEMO_MODELS = [
    ("patch_deployments", PatchDeployment),
    ("vulnerabilities", Vulnerability),
    ("incidents", IncidentResponse),
    ("malware_detections", MalwareDetection),
    ("dlp_findings", SensitiveDataFinding),
    ("patches", Patch),
    ("policies", Policy),
    ("devices", Device),
    ("servers", Server),
]

DEPARTMENTS = ["Finance", "Engineering", "HR", "Operations", "Security"]
DEVICE_GROUPS = ["HQ-Desktops", "Remote-Laptops", "Lab-Workstations", "Exec-Devices"]
# (prefix, os name, os version, platform) — platform matches the
# agent's inventory shape (darwin/windows/linux) so the OS
# distribution chart can group seeded devices instead of "Unknown".
OS_CHOICES = [
    ("WS", "Windows 11", "23H2", "windows"),
    ("MB", "macOS", "15 Sequoia", "darwin"),
    ("WS", "Windows 11", "24H2", "windows"),
    ("LT", "Ubuntu", "24.04 LTS", "linux"),
    ("MB", "macOS", "14 Sonoma", "darwin"),
]


def _has_demo(db, tenant_id):
    return any(
        db.query(m).filter(m.tenant_id == tenant_id, m.is_demo.is_(True)).first()
        for _, m in DEMO_MODELS
    )


def _counts(db, tenant_id):
    return {
        name: db.query(m).filter(
            m.tenant_id == tenant_id, m.is_demo.is_(True)).count()
        for name, m in DEMO_MODELS
    }


def _audit(db, action, current_user, counts):
    db.add(AuditEvent(
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        action=f"demo.{action}",
        entity_type="demo",
        entity_id=None,
        event_metadata={"counts": counts, "is_demo": True},
    ))


# ------------------------------------------------------------------ devices
# HEALTH BUCKETS — the IT Ops home derives these from
# enrollment_status + last_checkin_at (same 1h / 24h thresholds as
# /api/v1/devices/stats), so the seed assigns check-in ages by
# ENROLLED ordinal, not raw index: the 6 suspended devices must never
# steal a slot from the fresh half, or "online" would read 28 instead
# of the intended 30. Resulting demo-only split (verified in
# tests/test_demo_seed.py::test_seed_counts_reconcile_with_home_screens):
#   online 30 (checked in 0–58 min ago) · attention 12 (2–20 h ago)
#   offline 12 (25 h–5.6 d ago) · degraded 6 (suspended) = 60.
# The attributes.health label uses the same four bucket names.
def _checkin_age_min(enrolled_ordinal, suspended, index):
    if suspended:
        # Suspended devices are "degraded" whatever their check-in, so
        # give them a stale one (2–6 days) for realism; it feeds no KPI.
        return 2 * 24 * 60 + (index * 53) % (4 * 24 * 60)
    if enrolled_ordinal < 30:
        return enrolled_ordinal * 2
    if enrolled_ordinal < 42:
        return 120 + (enrolled_ordinal - 30) * 100
    return 1500 + (enrolled_ordinal - 42) * 600


def _seed_devices(db, tid, now):
    devices = []
    enrolled_ordinal = 0
    for i in range(60):
        dept = DEPARTMENTS[i % len(DEPARTMENTS)]
        group = DEVICE_GROUPS[i % len(DEVICE_GROUPS)]
        prefix, os_name, os_ver, platform = OS_CHOICES[i % len(OS_CHOICES)]
        dept_code = dept[:3].upper()
        seq = (i // len(DEPARTMENTS)) + 1
        hostname = f"{prefix}-{dept_code}-{seq:03d}"
        enrollment = "suspended" if i % 10 == 9 else "enrolled"
        suspended = enrollment == "suspended"
        if not suspended:
            ordinal = enrolled_ordinal
            enrolled_ordinal += 1
        else:
            ordinal = None
        age_min = _checkin_age_min(ordinal, suspended, i)
        checkin = now - timedelta(minutes=age_min)
        if suspended:
            health = "degraded"
        elif age_min <= 60:
            health = "online"
        elif age_min <= 24 * 60:
            health = "attention"
        else:
            health = "offline"
        row = Device(
            tenant_id=tid,
            hostname=hostname,
            device_id=f"demo-{hostname.lower()}",
            enrollment_status=enrollment,
            agent_version="0.3.1",
            last_checkin_at=checkin,
            is_demo=True,
            created_at=now - timedelta(days=age_min // (24 * 60) + 30),
            attributes={
                "department": dept,
                "device_group": group,
                # OS as an object (same shape the agent reports), so the
                # OS distribution chart groups by platform.
                "os": {"platform": platform, "name": os_name, "version": os_ver},
                "health": health,
                # Enrollment spread: the IT Ops enrollment chart buckets
                # on attributes.collected (the RFC3339 timestamp the
                # agent sends at enrollment), so stagger first-seen
                # dates across the past five weeks — 12 devices per
                # weekly bucket in the 30d view — instead of stamping
                # every row with the same day. (+1 keeps ages off exact
                # bucket boundaries.) The "Z" suffix marks it as UTC.
                "collected": (now - timedelta(days=(i % 5) * 7 + (i % 3) + 1)).isoformat() + "Z",
                "is_demo": True,
            },
        )
        db.add(row)
        devices.append(row)
    db.flush()
    return devices


# ------------------------------------------------------------------ servers
SERVER_SPECS = [
    ("SRV-DC-01", "Windows Server 2022", "Domain Controller", "healthy"),
    ("SRV-FILE-01", "Windows Server 2022", "File Server", "healthy"),
    ("SRV-DB-01", "Windows Server 2019", "Database Server", "degraded"),
    ("SRV-WEB-01", "Ubuntu Server 22.04", "Web Server", "healthy"),
    ("SRV-WEB-02", "Ubuntu Server 22.04", "Web Server", "healthy"),
    ("SRV-BKP-01", "Red Hat Enterprise Linux 9", "Backup Server", "degraded"),
    ("SRV-APP-01", "Windows Server 2022", "Application Server", "healthy"),
    # One server down so the server panel and the attention queue
    # exercise all three health states: 5 healthy / 2 degraded / 1 down.
    ("SRV-PRINT-01", "Windows Server 2019", "Print Server", "down"),
]


def _seed_servers(db, tid, now):
    rows = []
    for hostname, os_name, role, health in SERVER_SPECS:
        row = Server(
            tenant_id=tid, hostname=hostname, title=hostname, os=os_name,
            role=role, health_status=health, status="active", is_demo=True,
            created_at=now - timedelta(days=90),
            attributes={"is_demo": True},
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


# ------------------------------------------------------------------ patches
# (vendor, title template, product). KB numbers are illustrative sample
# labels, not records of real vendor releases.
PATCH_TITLES = [
    ("Microsoft", "Cumulative Update for Windows 11", "Windows 11"),
    ("Microsoft", "Security Update for Microsoft Office", "Microsoft Office"),
    ("Microsoft", "Cumulative Update for .NET Framework", ".NET Framework"),
    ("Microsoft", "Security Update for Microsoft Edge", "Microsoft Edge"),
    ("Microsoft", "Windows Malicious Software Removal Tool", "Windows"),
    ("Microsoft", "Servicing Stack Update for Windows 11", "Windows 11"),
    ("Microsoft", "Security Update for SQL Server", "SQL Server"),
    ("Adobe", "Security Update for Adobe Acrobat Reader", "Adobe Acrobat Reader"),
    ("Adobe", "Security Update for Adobe Flash Player", "Adobe Flash Player"),
    ("Google", "Google Chrome Stable Channel Update", "Google Chrome"),
    ("Google", "Google Drive for Desktop Update", "Google Drive"),
    ("Mozilla", "Mozilla Firefox Security Update", "Mozilla Firefox"),
    ("Mozilla", "Mozilla Thunderbird Security Update", "Mozilla Thunderbird"),
    ("Zoom", "Zoom Workplace Client Update", "Zoom"),
    ("Slack", "Slack Desktop Client Update", "Slack"),
    ("Apple", "Security Update for iTunes", "iTunes"),
    ("Apple", "Safari Security Update", "Safari"),
    ("Oracle", "Java SE Critical Patch Update", "Java"),
    ("Oracle", "VirtualBox Maintenance Release", "VirtualBox"),
    ("Microsoft", "Definition Update for Microsoft Defender", "Microsoft Defender"),
    ("Microsoft", "Security Update for Visual Studio", "Visual Studio"),
    ("Microsoft", "Cumulative Update for Exchange Server", "Exchange Server"),
    ("Adobe", "Security Update for Adobe Creative Cloud", "Adobe Creative Cloud"),
    ("Google", "ChromeOS Flex Update", "ChromeOS"),
]
# Patch statuses — every value here MUST be one of the model's five
# (available / testing / approved / declined / deployed). There is no
# "failed" patch status: the old cycle used it for 9 rows and the IT
# Ops compliance formula (deployed / deployed+available+testing+
# approved) silently dropped them, so 9 of 120 patches appeared in no
# KPI at all. Resulting split (verified in test_demo_seed.py):
#   deployed 57 · approved 18 · available 18 · testing 9 · declined 18
#   = 120. Compliance = 57 / (57+18+18+9) = 56%; pending = 45.
PATCH_STATUSES = (
    ["deployed"] * 6 + ["approved"] * 2 + ["available"] * 2
    + ["testing", "declined", "declined"]
)
PATCH_SEVERITIES = ["critical", "important", "important", "moderate", "low"]


def _seed_patches(db, tid, now):
    patches = []
    for i in range(120):
        vendor, title, product = PATCH_TITLES[i % len(PATCH_TITLES)]
        # Version years are illustrative only and never in the future:
        # cycle the seed year and the two years before it.
        year = now.year - 2 + ((i // len(PATCH_TITLES)) % 3)
        version = f"{year}.{1 + (i % 12):02d}"
        row = Patch(
            tenant_id=tid,
            title=f"{title} {version}",
            kb_id=f"KB50{30000 + i * 7}",
            severity=PATCH_SEVERITIES[i % len(PATCH_SEVERITIES)],
            status=PATCH_STATUSES[i % len(PATCH_STATUSES)],
            product=product,
            is_demo=True,
            created_at=now - timedelta(days=(i * 37) % 90),
            attributes={"vendor": vendor, "version": version, "is_demo": True},
        )
        db.add(row)
        patches.append(row)
    db.flush()
    return patches


def _seed_deployments(db, tid, now, patches):
    # Deployment pipeline — every row carries one of the documented
    # PatchDeployment statuses, and the IT Ops pipeline panel renders
    # a stage for each, so all 30 rows are visible: deployed 12 /
    # failed 6 / scheduled 3 / approved 3 / deploying 3 / declined 3
    # = 30. (An earlier version collapsed everything to terminal
    # outcomes because the old outcomes chart rendered only
    # Deployed/Failed bars; the pipeline panel renders every stage,
    # so the in-flight stages are real again.) The failed count also
    # feeds the "Failed deployments" KPI and the attention queue.
    statuses = (
        ["deployed"] * 12
        + ["failed"] * 6
        + ["scheduled", "approved", "deploying"] * 3
        + ["declined"] * 3
    )
    test_results = ["pass", "pass", "pass", "fail", "pending"]
    rows = []
    for i in range(30):
        patch = patches[i % len(patches)]
        group = DEVICE_GROUPS[i % len(DEVICE_GROUPS)]
        row = PatchDeployment(
            tenant_id=tid,
            patch_id=patch.id,
            name=f"Deploy {patch.title}",
            title=f"Deploy {patch.title}",
            scope=group,
            schedule="Sat 02:00",
            status=statuses[i % len(statuses)],
            reboot_option="prompt",
            test_result=test_results[i % len(test_results)],
            is_demo=True,
            # Spread over the past 30 days so trend charts have data.
            created_at=now - timedelta(days=i, hours=(i * 5) % 24),
            attributes={"is_demo": True},
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


# ------------------------------------------------------------ vulnerabilities
# REAL well-known CVEs with their published CVSS scores only. Never
# fabricate a CVE ID or a score. (cve_id, title, cvss_score)
CVE_SPECS = [
    ("CVE-2021-44228", "Apache Log4j2 remote code execution (Log4Shell)", "10.0"),
    ("CVE-2020-1472", "Netlogon elevation of privilege (Zerologon)", "10.0"),
    ("CVE-2020-1350", "Windows DNS Server remote code execution (SIGRed)", "10.0"),
    ("CVE-2019-11510", "Pulse Connect Secure arbitrary file disclosure", "10.0"),
    ("CVE-2024-3400", "PAN-OS GlobalProtect command injection", "10.0"),
    ("CVE-2023-20198", "Cisco IOS XE web UI privilege escalation", "10.0"),
    ("CVE-2020-0796", "SMBv3 remote code execution (SMBGhost)", "10.0"),
    ("CVE-2023-23397", "Microsoft Outlook elevation of privilege", "9.8"),
    ("CVE-2021-26855", "Microsoft Exchange Server SSRF", "9.8"),
    ("CVE-2019-0708", "Remote Desktop Services remote code execution (BlueKeep)", "9.8"),
    ("CVE-2022-22965", "Spring Framework remote code execution (Spring4Shell)", "9.8"),
    ("CVE-2021-21972", "VMware vCenter Server remote code execution", "9.8"),
    ("CVE-2019-19781", "Citrix ADC path traversal / remote code execution", "9.8"),
    ("CVE-2020-5902", "F5 BIG-IP TMUI remote code execution", "9.8"),
    ("CVE-2021-26084", "Atlassian Confluence OGNL injection", "9.8"),
    ("CVE-2022-1388", "F5 BIG-IP iControl REST authentication bypass", "9.8"),
    ("CVE-2023-34362", "MOVEit Transfer SQL injection", "9.8"),
    ("CVE-2022-47966", "Zoho ManageEngine remote code execution", "9.8"),
    ("CVE-2022-26134", "Atlassian Confluence OGNL injection", "9.8"),
    ("CVE-2018-13379", "Fortinet FortiOS SSL VPN path traversal", "9.8"),
    ("CVE-2023-21716", "Microsoft Word remote code execution", "9.8"),
    ("CVE-2024-21413", "Microsoft Outlook remote code execution", "9.8"),
    ("CVE-2023-22515", "Atlassian Confluence broken access control", "9.8"),
    ("CVE-2020-14882", "Oracle WebLogic Server remote code execution", "9.8"),
    ("CVE-2019-2725", "Oracle WebLogic Server deserialization RCE", "9.8"),
    ("CVE-2020-17530", "Apache Struts OGNL injection", "9.8"),
    ("CVE-2022-42889", "Apache Commons Text remote code execution (Text4Shell)", "9.8"),
    ("CVE-2023-22518", "Atlassian Confluence improper authorization", "9.1"),
    ("CVE-2021-45046", "Apache Log4j2 denial of service / incomplete fix", "9.0"),
    ("CVE-2023-4966", "Citrix NetScaler session hijacking (Citrix Bleed)", "9.4"),
    ("CVE-2021-34527", "Windows Print Spooler remote code execution (PrintNightmare)", "8.8"),
    ("CVE-2023-4863", "libwebp heap buffer overflow", "8.8"),
    ("CVE-2021-40444", "Microsoft MSHTML remote code execution", "8.8"),
    ("CVE-2021-1675", "Windows Print Spooler elevation of privilege", "8.8"),
    ("CVE-2017-0144", "SMBv1 remote code execution (EternalBlue)", "8.1"),
    ("CVE-2020-0601", "Windows CryptoAPI spoofing", "8.1"),
    ("CVE-2024-21893", "Ivanti Connect Secure server-side request forgery", "8.2"),
    ("CVE-2023-36884", "Microsoft Office remote code execution", "8.3"),
    ("CVE-2022-2294", "Google Chrome WebRTC heap buffer overflow", "6.8"),
    ("CVE-2023-20593", "AMD Zenbleed information disclosure", "6.5"),
]
# Resulting splits (verified in test_demo_seed.py — change the cycles
# only if you update the test's expected numbers too):
#   severity: 30 critical / 8 high / 2 medium (from the published CVSS
#     scores; no low — the famous-CVE set has none below 6.5)
#   status: open 21 (critical 15 / high 5 / medium 1 — the SecOps
#     donut) · mitigated 7 · remediated 6 · accepted 6 = 40.
#   Open + mitigated + remediated + accepted accounts for every row;
#   the SecOps KPI shows open 21 with "6 remediated" in its sublabel.
VULN_STATUSES = ["open", "open", "open", "mitigated", "remediated", "accepted"]
VULN_OWNERS = ["IT Operations", "Security Operations", "Patch Team", "Infrastructure"]


def _severity_for(cvss):
    score = float(cvss)
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    return "low"


def _seed_vulnerabilities(db, tid, now, devices):
    rows = []
    for i, (cve_id, title, cvss) in enumerate(CVE_SPECS):
        device = devices[i % len(devices)]
        status = VULN_STATUSES[i % len(VULN_STATUSES)]
        row = Vulnerability(
            tenant_id=tid,
            cve_id=cve_id,
            title=title,
            severity=_severity_for(cvss),
            cvss_score=cvss,
            status=status,
            device_id=device.id,
            is_demo=True,
            detected_at=now - timedelta(days=(i * 3) % 30),
            attributes={
                "owner": VULN_OWNERS[i % len(VULN_OWNERS)],
                "due_at": (now + timedelta(days=7 + (i % 21))).date().isoformat(),
                "remediation": (
                    "Apply the vendor patch for this CVE and verify the "
                    "affected service is updated; re-scan after patching."
                ),
                "is_demo": True,
            },
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


# ------------------------------------------------------- EDR / malware / DLP
# Incident outcomes (verified in test_demo_seed.py): active 5
# (pending 2 + in-progress 3) · complete 6 · failed 1 = 12, which is
# exactly the SecOps incident bars (Open / Resolved / Failed).
INCIDENT_SPECS = [
    ("Isolate host after suspicious PowerShell", "isolate", "complete"),
    ("Kill malicious process on finance workstation", "kill-process", "complete"),
    ("Quarantine suspicious binary on engineering laptop", "quarantine", "complete"),
    ("Rollback registry changes from suspicious installer", "rollback", "complete"),
    ("Isolate host with beaconing traffic", "isolate", "in-progress"),
    ("Kill process spawning encoded payloads", "kill-process", "in-progress"),
    ("Quarantine credential-dumping tool", "quarantine", "pending"),
    ("Isolate host after lateral movement attempt", "isolate", "pending"),
    ("Rollback unauthorized scheduled task", "rollback", "failed"),
    ("Kill process injecting into explorer.exe", "kill-process", "complete"),
    ("Quarantine suspicious macro dropper", "quarantine", "complete"),
    ("Isolate host with ransomware-like file activity", "isolate", "in-progress"),
]

MALWARE_NAMES = [
    ("Emotet", "behavior"), ("TrickBot", "behavior"), ("Cobalt Strike beacon", "behavior"),
    ("QakBot", "signature"), ("RedLine Stealer", "deep-learning"),
    ("Lumma Stealer", "deep-learning"), ("Agent Tesla", "signature"),
    ("FormBook", "signature"), ("Lokibot", "signature"), ("Raccoon Stealer", "deep-learning"),
    ("Vidar", "deep-learning"), ("SocGholish", "behavior"), ("IcedID", "behavior"),
    ("Dridex", "signature"), ("Ursnif", "behavior"), ("Zloader", "signature"),
    ("Bumblebee", "behavior"), ("LockBit", "behavior"), ("BlackCat/ALPHV", "behavior"),
    ("Conti", "behavior"),
]
# Malware split (verified in test_demo_seed.py): 5 each of detected /
# quarantined / remediated / false-positive = 20. The SecOps KPI shows
# detected 5 with "10 quarantined" (quarantined flag is set exactly
# for the quarantined + remediated rows); all 5 detected rows are
# critical severity, so the risk posture is Elevated on that driver
# alone. False positives count toward the 20 total, as the KPI states.
MALWARE_STATUSES = ["detected", "quarantined", "remediated", "false-positive"]

DLP_SPECS = [
    ("Unencrypted spreadsheet with customer SSNs", "pii", "Confidential"),
    ("Credit card numbers in shared folder", "pci", "Restricted"),
    ("Patient records on unencrypted laptop", "phi", "Restricted"),
    ("API keys in source code repository", "credentials", "Confidential"),
    ("Employee salary data in email attachment", "pii", "Internal"),
    ("Payment card data in log files", "pci", "Restricted"),
    ("Health insurance details in shared drive", "phi", "Confidential"),
    ("Service account passwords in wiki page", "credentials", "Restricted"),
    ("Customer email list exported to USB", "pii", "Confidential"),
    ("Cardholder data in database backup", "pci", "Restricted"),
    ("Clinical trial data on personal device", "phi", "Confidential"),
    ("Database credentials in config file", "credentials", "Restricted"),
    ("Vendor bank details in shared mailbox", "pii", "Internal"),
    ("Passport scans in HR folder", "pii", "Confidential"),
    ("Custom pattern: internal project codenames", "custom", "Internal"),
]
# DLP split (verified in test_demo_seed.py): open 6 · encrypted 3 ·
# remediated 3 · accepted 3 = 15. The SecOps KPI shows open 6 with
# "6 closed" (remediated + encrypted); the 3 accepted findings are
# neither open nor closed and are accounted for in the 15 total.
DLP_STATUSES = ["open", "open", "encrypted", "remediated", "accepted"]


def _seed_incidents(db, tid, now, devices):
    rows = []
    for i, (title, action, status) in enumerate(INCIDENT_SPECS):
        row = IncidentResponse(
            tenant_id=tid,
            device_id=devices[(i * 5) % len(devices)].id,
            title=title, action=action, status=status,
            performed_by="SOC Analyst",
            is_demo=True,
            created_at=now - timedelta(days=(i * 2) % 14),
            attributes={"is_demo": True},
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def _seed_malware(db, tid, now, devices):
    rows = []
    for i, (name, layer) in enumerate(MALWARE_NAMES):
        status = MALWARE_STATUSES[i % len(MALWARE_STATUSES)]
        row = MalwareDetection(
            tenant_id=tid,
            device_id=devices[(i * 3) % len(devices)].id,
            title=f"{name} detected",
            name=name,
            detection_layer=layer,
            mitre_ttp="T1059.001" if layer == "behavior" else "T1204.002",
            severity=["critical", "high", "high", "medium"][i % 4],
            quarantined=status in ("quarantined", "remediated"),
            status=status,
            is_demo=True,
            created_at=now - timedelta(days=(i * 2) % 21),
            attributes={"is_demo": True},
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def _seed_dlp(db, tid, now, devices):
    rows = []
    for i, (title, data_type, classification) in enumerate(DLP_SPECS):
        row = SensitiveDataFinding(
            tenant_id=tid,
            device_id=devices[(i * 4) % len(devices)].id,
            title=title,
            location=f"\\\\SRV-FILE-01\\share-{i + 1:02d}",
            data_type=data_type,
            classification=classification,
            status=DLP_STATUSES[i % len(DLP_STATUSES)],
            is_demo=True,
            created_at=now - timedelta(days=(i * 2) % 21),
            attributes={"is_demo": True},
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


# ------------------------------------------------------------------ policies
# NOTE: the Policy model is a policy *definition* (name, policy_type,
# status, definition) — there is no violation record type in the
# platform. These demo rows are the policies themselves, with the
# sample violation counts/examples carried in attributes so the
# preview can show policy-violation context without inventing a
# model that does not exist.
POLICY_SPECS = [
    ("Mandatory Patching — Critical Within 7 Days", "patch", "active", 4,
     "3 endpoints missed the 7-day critical patch window"),
    ("CIS Benchmark — Windows Workstations", "compliance", "active", 6,
     "Local admin group has 2 unauthorized members"),
    ("Application Allowlist — Finance", "app_control", "active", 2,
     "Unapproved remote-access tool launched twice"),
    ("BitLocker Encryption Required", "encryption", "active", 5,
     "5 endpoints report encryption not enforced"),
    ("Browser Extension Blocklist", "browser", "active", 3,
     "Blocked extension attempted install on 3 hosts"),
    ("MDM Passcode Policy — Mobile", "mdm", "active", 1,
     "1 BYOD device below minimum passcode length"),
    ("Patch Testing Before Production", "patch", "active", 2,
     "2 patches deployed without testbed sign-off"),
    ("CIS Benchmark — Servers", "compliance", "draft", 0,
     "No violations recorded yet (draft policy)"),
    ("Application Blocklist — Peer-to-Peer", "app_control", "active", 3,
     "Peer-to-peer client detected on 3 hosts"),
    ("FileVault Encryption Required — macOS", "encryption", "active", 2,
     "2 Macs report FileVault disabled"),
]


def _seed_policies(db, tid, now):
    rows = []
    for name, ptype, status, violations, example in POLICY_SPECS:
        row = Policy(
            tenant_id=tid,
            name=name,
            policy_type=ptype,
            status=status,
            definition={
                "enforcement": "enforce",
                "scope": "all devices",
                "sample_violation_count": violations,
                "sample_violation_example": example,
            },
            is_demo=True,
            created_at=now - timedelta(days=120),
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


# ------------------------------------------------------------------ endpoints
@router.post("/seed")
def seed_demo(db: Session = Depends(get_db),
              current_user: User = Depends(require_role(["owner", "admin"]))):
    tid = current_user.tenant_id
    if _has_demo(db, tid):
        counts = _counts(db, tid)
        return {"seeded": False, "reason": "demo data already exists",
                "counts": counts, **counts}
    now_utc = datetime.now(timezone.utc)
    # Timestamps are computed from a timezone-aware UTC instant, then
    # stored naive: every DateTime column in the platform is TIMESTAMP
    # WITHOUT TIME ZONE and every model default is datetime.utcnow, so
    # stored values are UTC wall-clock by convention. (Verified: storing
    # a tz-aware datetime through SQLAlchemy/SQLite silently strips the
    # offset, and on Postgres the cast would depend on the session
    # TimeZone — so an aware value buys nothing and risks shifting the
    # 1h "online" bucket on the live database.) The API therefore
    # serializes zoneless UTC, and both home screens treat zoneless
    # values as UTC (their parseDate appends "Z") so they render in
    # the viewer's local time; attributes.collected carries an
    # explicit "Z" suffix because it is a plain string.
    now = now_utc.replace(tzinfo=None)

    # The seed only ever creates device_ids starting with "demo-", so
    # the real Mac (darwin-ac913e0958751651) can never be overwritten
    # or flagged demo; clear-demo only deletes is_demo rows, so it
    # survives that too.
    devices = _seed_devices(db, tid, now)
    _seed_servers(db, tid, now)
    patches = _seed_patches(db, tid, now)
    _seed_deployments(db, tid, now, patches)
    _seed_vulnerabilities(db, tid, now, devices)
    _seed_incidents(db, tid, now, devices)
    _seed_malware(db, tid, now, devices)
    _seed_dlp(db, tid, now, devices)
    _seed_policies(db, tid, now)
    db.commit()

    counts = _counts(db, tid)
    _audit(db, "seeded", current_user, counts)
    db.commit()
    return {"seeded": True, "is_demo": True,
            "label": "Sample data — not live telemetry",
            "counts": counts, **counts}


@router.post("/clear-demo")
def clear_demo(db: Session = Depends(get_db),
               current_user: User = Depends(require_role(["owner", "admin"]))):
    tid = current_user.tenant_id
    deleted = {}
    # Children first so FKs never block the delete. Only is_demo rows,
    # only in the models this seed writes — GRC demo rows have their
    # own clear-demo and are never touched here, and real rows (like
    # the enrolled Mac, is_demo=False) always survive.
    for name, model in DEMO_MODELS:
        rows = db.query(model).filter(
            model.tenant_id == tid, model.is_demo.is_(True)).all()
        deleted[name] = len(rows)
        for row in rows:
            db.delete(row)
    db.commit()
    _audit(db, "cleared", current_user, deleted)
    db.commit()
    return {"cleared": True, "deleted": deleted}
