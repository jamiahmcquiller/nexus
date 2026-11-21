"""Extended NEXUS models — Endpoint Central-style platform features.

One platform, one tenant-scoped data model. Every table here carries
``tenant_id`` so a tenant can never see another tenant's endpoints, patches,
alerts, or keys. Flexible per-record detail lives in ``attributes`` (JSON);
the named columns are the fields the console filters, sorts, and reports on.

Security note: recovery-key records store only an escrow *reference*
(key id / AD or cloud escrow location). Never store a raw BitLocker /
FileVault recovery key in this database.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Text, Boolean, Integer, Float
from sqlalchemy.dialects.postgresql import UUID

from .database import Base


def _id():
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _tenant():
    return Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)


def _created():
    return Column(DateTime, default=datetime.utcnow)


def _attrs():
    return Column(JSON, default=dict)


# ---------------------------------------------------------------- patching
class PatchDeployment(Base):
    """A patch rollout: test -> approve -> deploy, with pre/post checks."""
    __tablename__ = "patch_deployments"
    id = _id()
    tenant_id = _tenant()
    patch_id = Column(UUID(as_uuid=True), ForeignKey("patches.id"))
    name = Column(String)
    title = Column(String)
    scope = Column(String)  # device group / all devices / testbed
    schedule = Column(String)  # e.g. "Sat 02:00" or ISO datetime
    status = Column(String, default="scheduled")  # scheduled, testing, approved, deploying, deployed, failed, declined
    reboot_option = Column(String)  # none, prompt, force, scheduled
    pre_checks = Column(JSON, default=list)
    post_checks = Column(JSON, default=list)
    test_result = Column(String)  # pass, fail, pending
    attributes = _attrs()
    created_at = _created()


class ThirdPartyApp(Base):
    """Third-party desktop / mobile app in the patch catalogue (1100+ apps)."""
    __tablename__ = "third_party_apps"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    vendor = Column(String)
    version = Column(String)
    platform = Column(String)  # windows, macos, android, ios
    auto_update = Column(Boolean, default=False)
    patch_count = Column(Integer, default=0)
    status = Column(String, default="available")
    attributes = _attrs()
    created_at = _created()


class PatchTest(Base):
    """Testbed result for a patch before it is approved for deployment."""
    __tablename__ = "patch_tests"
    id = _id()
    tenant_id = _tenant()
    patch_id = Column(UUID(as_uuid=True), ForeignKey("patches.id"))
    title = Column(String)
    testbed = Column(String)
    result = Column(String, default="pending")  # pending, pass, fail
    notes = Column(Text)
    status = Column(String, default="pending")
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------- vulnerability ops
class ZeroDayMitigation(Base):
    """Prebuilt, tested mitigation script deployed before a vendor fix ships."""
    __tablename__ = "zero_day_mitigations"
    id = _id()
    tenant_id = _tenant()
    cve_id = Column(String)
    title = Column(String)
    mitigation_script = Column(Text)
    status = Column(String, default="notified")  # notified, mitigated, patched
    attributes = _attrs()
    created_at = _created()


class SecurityConfiguration(Base):
    """Misconfiguration finding in OS / app / browser / firewall / antivirus."""
    __tablename__ = "security_configurations"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    category = Column(String)  # os, application, browser, firewall, antivirus
    benchmark = Column(String)  # CIS, NIST, Cyber Essentials
    severity = Column(String)
    status = Column(String, default="open")  # open, remediated, accepted
    attributes = _attrs()
    created_at = _created()


class WebServerHardening(Base):
    __tablename__ = "web_server_hardening"
    id = _id()
    tenant_id = _tenant()
    title = Column(String)
    host = Column(String)
    finding = Column(Text)
    recommendation = Column(Text)
    severity = Column(String)
    status = Column(String, default="open")
    attributes = _attrs()
    created_at = _created()


class HighRiskSoftware(Base):
    """End-of-life, peer-to-peer, or insecure remote-desktop software."""
    __tablename__ = "high_risk_software"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    software_name = Column(String)
    reason = Column(String)  # end-of-life, peer-to-peer, remote-desktop
    status = Column(String, default="open")  # open, removed, accepted
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------------- EDR
class EndpointTelemetry(Base):
    """Correlated endpoint activity: process, file, network, registry, user."""
    __tablename__ = "endpoint_telemetry"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    event_type = Column(String)  # process, file, network, registry, user
    mitre_tactic = Column(String)
    mitre_technique = Column(String)
    severity = Column(String)
    status = Column(String, default="recorded")
    attributes = _attrs()
    created_at = _created()


class ThreatHunt(Base):
    """Proactive hunt across recorded endpoint activity (30-day lookback)."""
    __tablename__ = "threat_hunts"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    query = Column(Text)
    lookback_days = Column(Integer, default=30)
    findings_count = Column(Integer, default=0)
    status = Column(String, default="scheduled")  # scheduled, running, complete
    attributes = _attrs()
    created_at = _created()


class IncidentResponse(Base):
    """Containment action: isolate, kill process, quarantine, rollback."""
    __tablename__ = "incident_responses"
    id = _id()
    tenant_id = _tenant()
    alert_id = Column(UUID(as_uuid=True), ForeignKey("security_alerts.id"))
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    action = Column(String)  # isolate, kill-process, quarantine, rollback
    status = Column(String, default="pending")  # pending, in-progress, complete, failed
    performed_by = Column(String)
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------- malware & ransomware
class MalwareDetection(Base):
    __tablename__ = "malware_detections"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    name = Column(String)
    detection_layer = Column(String)  # behavior, deep-learning, signature
    mitre_ttp = Column(String)
    severity = Column(String)
    quarantined = Column(Boolean, default=False)
    status = Column(String, default="detected")  # detected, quarantined, remediated, false-positive
    attributes = _attrs()
    created_at = _created()


class RansomwareIncident(Base):
    __tablename__ = "ransomware_incidents"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    behavior_score = Column(Float)
    status = Column(String, default="detected")  # detected, quarantined, recovered, contained
    recovery_point_id = Column(UUID(as_uuid=True))
    attributes = _attrs()
    created_at = _created()


class RecoveryPoint(Base):
    """Incremental VSS shadow-copy backup used for single-click recovery."""
    __tablename__ = "recovery_points"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    snapshot_type = Column(String, default="vss-incremental")
    status = Column(String, default="available")  # available, restoring, restored
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------ browser
class BrowserPolicy(Base):
    __tablename__ = "browser_policies"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    allowed_browsers = Column(JSON, default=list)
    kiosk_mode = Column(Boolean, default=False)
    isolation_enabled = Column(Boolean, default=False)
    java_rules = Column(JSON, default=list)
    router_rules = Column(JSON, default=list)
    status = Column(String, default="active")  # active, draft, disabled
    attributes = _attrs()
    created_at = _created()


class BrowserExtension(Base):
    __tablename__ = "browser_extensions"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    name = Column(String)
    browser = Column(String)
    version = Column(String)
    status = Column(String, default="monitored")  # monitored, allowed, blocked
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------- app control & privilege
class AppControlRule(Base):
    __tablename__ = "app_control_rules"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    rule_type = Column(String)  # allowlist, blocklist
    target = Column(String)  # executable / publisher / path
    scope = Column(String)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class PrivilegeGrant(Base):
    """Role-based, time-based, or just-in-time privilege grant."""
    __tablename__ = "privilege_grants"
    id = _id()
    tenant_id = _tenant()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    app_name = Column(String)
    privilege_type = Column(String)  # role-based, time-based, just-in-time
    expires_at = Column(DateTime)
    approved_by = Column(String)
    status = Column(String, default="active")  # active, expired, revoked
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------- DLP / data
class SensitiveDataFinding(Base):
    __tablename__ = "sensitive_data_findings"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    location = Column(String)
    data_type = Column(String)  # pii, pci, phi, credentials, custom
    classification = Column(String)
    status = Column(String, default="open")  # open, encrypted, remediated, accepted
    attributes = _attrs()
    created_at = _created()


class DlpPolicy(Base):
    __tablename__ = "dlp_policies"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    scope = Column(String)  # at-rest, in-use, in-motion
    action = Column(String)  # block, encrypt, alert, quarantine
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class DlpIncident(Base):
    __tablename__ = "dlp_incidents"
    id = _id()
    tenant_id = _tenant()
    finding_id = Column(UUID(as_uuid=True), ForeignKey("sensitive_data_findings.id"))
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    action_taken = Column(String)
    status = Column(String, default="new")  # new, investigating, contained, resolved
    attributes = _attrs()
    created_at = _created()


class DataContainer(Base):
    """BYOD container: work data separated and encrypted from personal data."""
    __tablename__ = "data_containers"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    owner_type = Column(String)  # corporate, byod
    encrypted = Column(Boolean, default=True)
    status = Column(String, default="active")  # active, wiped
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------ secure private access
class AccessSegment(Base):
    """Private application defined by name, DNS, and port, grouped by team."""
    __tablename__ = "access_segments"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    app_name = Column(String)
    dns = Column(String)
    port = Column(Integer)
    team = Column(String)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class AccessPolicy(Base):
    __tablename__ = "access_policies"
    id = _id()
    tenant_id = _tenant()
    segment_id = Column(UUID(as_uuid=True), ForeignKey("access_segments.id"))
    name = Column(String)
    title = Column(String)
    device_trust_required = Column(Boolean, default=True)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class AccessAudit(Base):
    __tablename__ = "access_audits"
    id = _id()
    tenant_id = _tenant()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    segment_id = Column(UUID(as_uuid=True), ForeignKey("access_segments.id"))
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    decision = Column(String)  # allowed, denied
    status = Column(String, default="logged")
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------------ assets
class Asset(Base):
    __tablename__ = "assets"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    asset_tag = Column(String)
    asset_type = Column(String)  # hardware, software, digital
    manufacturer = Column(String)
    os = Column(String)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class SoftwareLicense(Base):
    __tablename__ = "software_licenses"
    id = _id()
    tenant_id = _tenant()
    title = Column(String)
    software_name = Column(String)
    total_seats = Column(Integer, default=0)
    used_seats = Column(Integer, default=0)
    expiry_date = Column(DateTime)
    status = Column(String, default="active")  # active, expiring, expired, over-used, under-used
    attributes = _attrs()
    created_at = _created()


class Warranty(Base):
    __tablename__ = "warranties"
    id = _id()
    tenant_id = _tenant()
    asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"))
    title = Column(String)
    provider = Column(String)
    expiry_date = Column(DateTime)
    status = Column(String, default="active")  # active, expiring, expired, unknown
    attributes = _attrs()
    created_at = _created()


class Certificate(Base):
    __tablename__ = "certificates"
    id = _id()
    tenant_id = _tenant()
    title = Column(String)
    name = Column(String)
    cert_type = Column(String)  # trust, user-signed
    expiry_date = Column(DateTime)
    status = Column(String, default="active")  # active, expiring, expired, revoked
    attributes = _attrs()
    created_at = _created()


class GeoFence(Base):
    __tablename__ = "geo_fences"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    center = Column(JSON, default=dict)  # {"lat": .., "lng": ..}
    radius_m = Column(Integer, default=0)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class UsbDeviceEvent(Base):
    __tablename__ = "usb_device_events"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    device_name = Column(String)
    action = Column(String)  # allowed, blocked
    status = Column(String, default="logged")
    attributes = _attrs()
    created_at = _created()


class PowerScheme(Base):
    __tablename__ = "power_schemes"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    settings = Column(JSON, default=dict)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


# ---------------------------------------------------------- distribution
class SoftwarePackage(Base):
    """Pre-defined, tested deployment template (MSI / EXE / mobile app)."""
    __tablename__ = "software_packages"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    version = Column(String)
    package_type = Column(String)  # msi, exe, mobile
    template = Column(Boolean, default=False)
    install_switches = Column(String)
    status = Column(String, default="available")
    attributes = _attrs()
    created_at = _created()


class AppDeployment(Base):
    __tablename__ = "app_deployments"
    id = _id()
    tenant_id = _tenant()
    package_id = Column(UUID(as_uuid=True), ForeignKey("software_packages.id"))
    title = Column(String)
    scope = Column(String)  # user-based, device-based, self-service
    status = Column(String, default="scheduled")  # scheduled, deploying, deployed, failed
    attributes = _attrs()
    created_at = _created()


class SoftwareMetering(Base):
    __tablename__ = "software_metering"
    id = _id()
    tenant_id = _tenant()
    package_id = Column(UUID(as_uuid=True), ForeignKey("software_packages.id"))
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    usage_count = Column(Integer, default=0)
    duration_minutes = Column(Integer, default=0)
    status = Column(String, default="logged")
    attributes = _attrs()
    created_at = _created()


# --------------------------------------------------------------------- DEX
class DexTelemetry(Base):
    __tablename__ = "dex_telemetry"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    cpu_percent = Column(Float)
    memory_percent = Column(Float)
    disk_percent = Column(Float)
    app_crashes = Column(Integer, default=0)
    status = Column(String, default="recorded")
    attributes = _attrs()
    created_at = _created()


class DexInsight(Base):
    """Root-cause analysis correlating telemetry across models/apps/configs."""
    __tablename__ = "dex_insights"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    root_cause = Column(Text)
    severity = Column(String)
    status = Column(String, default="open")  # open, investigating, resolved
    attributes = _attrs()
    created_at = _created()


class RemediationWorkflow(Base):
    __tablename__ = "remediation_workflows"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    trigger = Column(String)
    action_script = Column(Text)
    status = Column(String, default="active")  # active, draft, disabled
    attributes = _attrs()
    created_at = _created()


class ExperienceScore(Base):
    __tablename__ = "experience_scores"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    reliability = Column(Float)
    performance = Column(Float)
    responsiveness = Column(Float)
    app_reliability = Column(Float)
    score = Column(Float)
    status = Column(String, default="recorded")
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------- remote access
class RemoteSession(Base):
    __tablename__ = "remote_sessions"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    technician = Column(String)
    session_type = Column(String)  # control, chat, video, collaborative
    recorded = Column(Boolean, default=False)
    status = Column(String, default="active")  # active, ended
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime)
    attributes = _attrs()
    created_at = _created()


class RemoteAnnouncement(Base):
    __tablename__ = "remote_announcements"
    id = _id()
    tenant_id = _tenant()
    title = Column(String)
    message = Column(Text)
    scope = Column(String)  # computer, user, group
    priority = Column(String, default="normal")  # low, normal, high
    status = Column(String, default="sent")  # draft, sent
    attributes = _attrs()
    created_at = _created()


class SystemToolJob(Base):
    __tablename__ = "system_tool_jobs"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    tool = Column(String)  # disk-cleanup, defrag, etc.
    status = Column(String, default="scheduled")  # scheduled, running, complete, failed
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------- imaging
class OsImage(Base):
    __tablename__ = "os_images"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    os_version = Column(String)
    hardware_independent = Column(Boolean, default=True)
    status = Column(String, default="ready")  # ready, building, deprecated
    attributes = _attrs()
    created_at = _created()


class ImagingDeployment(Base):
    __tablename__ = "imaging_deployments"
    id = _id()
    tenant_id = _tenant()
    image_id = Column(UUID(as_uuid=True), ForeignKey("os_images.id"))
    title = Column(String)
    scope = Column(String)
    method = Column(String)  # pxe, usb, iso, standalone, zero-touch
    status = Column(String, default="scheduled")  # scheduled, deploying, deployed, failed
    attributes = _attrs()
    created_at = _created()


class DeploymentTemplate(Base):
    __tablename__ = "deployment_templates"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    role = Column(String)
    image_id = Column(UUID(as_uuid=True), ForeignKey("os_images.id"))
    settings = Column(JSON, default=dict)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------- configuration
class ConfigurationProfile(Base):
    __tablename__ = "configuration_profiles"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    target = Column(String)  # user, computer
    settings = Column(JSON, default=dict)
    status = Column(String, default="published")  # draft, published
    attributes = _attrs()
    created_at = _created()


class ScriptItem(Base):
    __tablename__ = "scripts"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    language = Column(String)  # powershell, python, bash
    content = Column(Text)
    category = Column(String)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class KioskProfile(Base):
    __tablename__ = "kiosk_profiles"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    allowed_apps = Column(JSON, default=list)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------------- MDM
class MobileDevice(Base):
    __tablename__ = "mobile_devices"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(String, unique=True)
    title = Column(String)
    hostname = Column(String)
    platform = Column(String)  # android, ios, ipados, macos, windows, chromeos, tvos
    ownership = Column(String)  # corporate, byod
    enrollment_status = Column(String, default="enrolled")
    compliant = Column(Boolean, default=True)
    status = Column(String, default="enrolled")
    attributes = _attrs()
    created_at = _created()


class MobileProfile(Base):
    __tablename__ = "mobile_profiles"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    platform = Column(String)
    profile_type = Column(String)  # wifi, vpn, passcode, dlp, content
    settings = Column(JSON, default=dict)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class MobileApp(Base):
    __tablename__ = "mobile_apps"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    platform = Column(String)
    version = Column(String)
    status = Column(String, default="available")  # available, deployed, blocked
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------------------- encryption
class EncryptionPolicy(Base):
    __tablename__ = "encryption_policies"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    platform = Column(String)  # bitlocker, filevault
    tpm_required = Column(Boolean, default=True)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class RecoveryKey(Base):
    """Escrow metadata only — see the security note at the top of this file."""
    __tablename__ = "recovery_keys"
    id = _id()
    tenant_id = _tenant()
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    title = Column(String)
    key_type = Column(String)  # bitlocker, filevault
    key_reference = Column(String)  # escrow id, never the key itself
    escrow_location = Column(String)  # active-directory, cloud
    status = Column(String, default="stored")
    attributes = _attrs()
    created_at = _created()


# ---------------------------------------------------------------- servers
class Server(Base):
    __tablename__ = "servers"
    id = _id()
    tenant_id = _tenant()
    hostname = Column(String)
    title = Column(String)
    os = Column(String)
    role = Column(String)
    health_status = Column(String, default="healthy")  # healthy, degraded, down
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


class ServerPatchWindow(Base):
    """Self-service patch window owned by an application owner."""
    __tablename__ = "server_patch_windows"
    id = _id()
    tenant_id = _tenant()
    server_id = Column(UUID(as_uuid=True), ForeignKey("servers.id"))
    title = Column(String)
    owner = Column(String)
    window_start = Column(DateTime)
    window_end = Column(DateTime)
    approval_status = Column(String, default="pending")  # pending, approved, declined
    status = Column(String, default="scheduled")
    attributes = _attrs()
    created_at = _created()


class ServerHealthCheck(Base):
    __tablename__ = "server_health_checks"
    id = _id()
    tenant_id = _tenant()
    server_id = Column(UUID(as_uuid=True), ForeignKey("servers.id"))
    title = Column(String)
    metric = Column(String)  # cpu, memory, disk, service, log
    value = Column(String)
    status = Column(String, default="ok")  # ok, warning, critical
    attributes = _attrs()
    created_at = _created()


# --------------------------------------------------------------- reporting
class Report(Base):
    __tablename__ = "reports"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    report_type = Column(String)  # audit, active-directory, compliance
    standard = Column(String)  # HIPAA, GDPR, CIS, ISO, PCI
    status = Column(String, default="ready")  # draft, ready, generated
    attributes = _attrs()
    created_at = _created()


class ReportTemplate(Base):
    __tablename__ = "report_templates"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    standard = Column(String)
    sections = Column(JSON, default=list)
    status = Column(String, default="active")
    attributes = _attrs()
    created_at = _created()


# --------------------------------------------------------------- scheduler
class SchedulerRun(Base):
    """One pass of the background scheduler: what it did, per tenant.

    A run is tenant-scoped to the tenant whose jobs it processed; a
    worker pass that touches several tenants writes one row per tenant
    (plus one row with tenant_id NULL is never written — the worker
    always groups by tenant). ``summary`` is the same dict the API
    returns from a run-once call.
    """
    __tablename__ = "scheduler_runs"
    id = _id()
    tenant_id = _tenant()
    title = Column(String, default="scheduler run")
    status = Column(String, default="complete")  # complete, partial, failed
    summary = Column(JSON, default=dict)
    attributes = _attrs()
    created_at = _created()


# ------------------------------------------------- GRC (governance, risk & compliance)
# Enterprise GRC workspace (v0.5.0). Every table is tenant-scoped and
# carries is_demo so demo data is always distinguishable from the
# organization's own compliance data. Evidence stores a file
# reference/name only — never file content.
class GrcFramework(Base):
    """A compliance framework / standard the organization tracks."""
    __tablename__ = "grc_frameworks"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    standard = Column(String)  # CIS v8, NIST CSF 2.0, ISO 27001, SOC 2, HIPAA, GDPR, PCI DSS, Cyber Essentials
    version = Column(String)
    owner = Column(String)
    status = Column(String, default="draft")  # active, draft, retired
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcControl(Base):
    """One control inside a framework (e.g. CIS 1.1)."""
    __tablename__ = "grc_controls"
    id = _id()
    tenant_id = _tenant()
    framework_id = Column(UUID(as_uuid=True), ForeignKey("grc_frameworks.id"))
    name = Column(String)
    title = Column(String)
    control_ref = Column(String)  # e.g. CIS 1.1
    category = Column(String)  # domain / category, e.g. Identity, Network, Data
    owner = Column(String)
    status = Column(String, default="not_implemented")  # implemented, partial, not_implemented, not_applicable
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcAssessment(Base):
    """An assessment of a framework over a defined scope."""
    __tablename__ = "grc_assessments"
    id = _id()
    tenant_id = _tenant()
    framework_id = Column(UUID(as_uuid=True), ForeignKey("grc_frameworks.id"))
    name = Column(String)
    title = Column(String)
    scope = Column(String)
    assessor = Column(String)
    due_at = Column(DateTime)
    status = Column(String, default="planned")  # planned, in_progress, complete, draft
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcEvidence(Base):
    """Evidence for a control / framework. attributes hold the file
    reference and file name only — never the file content."""
    __tablename__ = "grc_evidence"
    id = _id()
    tenant_id = _tenant()
    control_id = Column(UUID(as_uuid=True), ForeignKey("grc_controls.id"))
    framework_id = Column(UUID(as_uuid=True), ForeignKey("grc_frameworks.id"))
    name = Column(String)
    title = Column(String)
    evidence_type = Column(String)  # document, screenshot, log, attestation
    uploaded_by = Column(String)
    status = Column(String, default="pending_review")  # pending_review, approved, rejected, expired
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcFinding(Base):
    """A finding against a control / framework, with exception support."""
    __tablename__ = "grc_findings"
    id = _id()
    tenant_id = _tenant()
    control_id = Column(UUID(as_uuid=True), ForeignKey("grc_controls.id"))
    framework_id = Column(UUID(as_uuid=True), ForeignKey("grc_frameworks.id"))
    name = Column(String)
    title = Column(String)
    severity = Column(String)  # critical, high, medium, low
    owner = Column(String)
    status = Column(String, default="open")  # open, in_progress, remediated, accepted, closed
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcRisk(Base):
    """A risk-register entry. Score is likelihood x impact (1-25)."""
    __tablename__ = "grc_risks"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    category = Column(String)
    likelihood = Column(Integer, default=3)  # 1-5
    impact = Column(Integer, default=3)  # 1-5
    owner = Column(String)
    status = Column(String, default="open")  # open, mitigated, accepted, closed
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcRemediation(Base):
    """A remediation task, usually linked to a finding."""
    __tablename__ = "grc_remediations"
    id = _id()
    tenant_id = _tenant()
    finding_id = Column(UUID(as_uuid=True), ForeignKey("grc_findings.id"))
    control_id = Column(UUID(as_uuid=True), ForeignKey("grc_controls.id"))
    name = Column(String)
    title = Column(String)
    owner = Column(String)
    due_at = Column(DateTime)
    status = Column(String, default="planned")  # planned, in_progress, complete, overdue
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcAudit(Base):
    """A scheduled / in-progress / completed audit."""
    __tablename__ = "grc_audits"
    id = _id()
    tenant_id = _tenant()
    framework_id = Column(UUID(as_uuid=True), ForeignKey("grc_frameworks.id"))
    name = Column(String)
    title = Column(String)
    auditor = Column(String)
    scheduled_at = Column(DateTime)
    status = Column(String, default="scheduled")  # scheduled, in_progress, complete, cancelled
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcControlMapping(Base):
    """A control mapped to an equivalent control in another framework."""
    __tablename__ = "grc_control_mappings"
    id = _id()
    tenant_id = _tenant()
    control_id = Column(UUID(as_uuid=True), ForeignKey("grc_controls.id"))
    name = Column(String)
    title = Column(String)
    mapped_framework = Column(String)
    mapped_control_ref = Column(String)
    status = Column(String, default="mapped")  # mapped, gap, unmapped
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


class GrcSetting(Base):
    """A GRC workspace setting (key/value). value is a JSON column."""
    __tablename__ = "grc_settings"
    id = _id()
    tenant_id = _tenant()
    name = Column(String)
    title = Column(String)
    key = Column(String)
    value = Column(JSON, default=dict)
    status = Column(String, default="active")  # active, inactive
    is_demo = Column(Boolean, default=False)
    attributes = _attrs()
    created_at = _created()


ALL_EXTENDED_MODELS = [
    SchedulerRun,
    GrcFramework, GrcControl, GrcAssessment, GrcEvidence, GrcFinding,
    GrcRisk, GrcRemediation, GrcAudit, GrcControlMapping, GrcSetting,
    PatchDeployment, ThirdPartyApp, PatchTest,
    ZeroDayMitigation, SecurityConfiguration, WebServerHardening, HighRiskSoftware,
    EndpointTelemetry, ThreatHunt, IncidentResponse,
    MalwareDetection, RansomwareIncident, RecoveryPoint,
    BrowserPolicy, BrowserExtension,
    AppControlRule, PrivilegeGrant,
    SensitiveDataFinding, DlpPolicy, DlpIncident, DataContainer,
    AccessSegment, AccessPolicy, AccessAudit,
    Asset, SoftwareLicense, Warranty, Certificate, GeoFence, UsbDeviceEvent, PowerScheme,
    SoftwarePackage, AppDeployment, SoftwareMetering,
    DexTelemetry, DexInsight, RemediationWorkflow, ExperienceScore,
    RemoteSession, RemoteAnnouncement, SystemToolJob,
    OsImage, ImagingDeployment, DeploymentTemplate,
    ConfigurationProfile, ScriptItem, KioskProfile,
    MobileDevice, MobileProfile, MobileApp,
    EncryptionPolicy, RecoveryKey,
    Server, ServerPatchWindow, ServerHealthCheck,
    Report, ReportTemplate,
]
