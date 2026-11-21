import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Text, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from .database import Base

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    username = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="technician")  # owner, admin, technician, auditor
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_users_tenant_username", "tenant_id", "username", unique=True),)

class Device(Base):
    __tablename__ = "devices"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    hostname = Column(String)
    device_id = Column(String, unique=True, nullable=False)  # stable platform identifier
    enrollment_status = Column(String, default="enrolled")
    agent_version = Column(String)
    last_checkin_at = Column(DateTime)
    # SHA-256 of the per-device credential issued at enrollment. The
    # plaintext token is shown to the agent once and never stored.
    device_token_hash = Column(String, nullable=True)
    attributes = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        Index("ix_devices_tenant_checkin", "tenant_id", "last_checkin_at"),
        Index("ix_devices_tenant_hostname", "tenant_id", "hostname"),
    )

class DeviceInventorySnapshot(Base):
    __tablename__ = "device_inventory_snapshots"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    hardware = Column(JSON)
    os = Column(JSON)
    software = Column(JSON)
    collected_at = Column(DateTime, default=datetime.utcnow)

class Group(Base):
    __tablename__ = "groups"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class DeviceGroup(Base):
    __tablename__ = "device_groups"
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), primary_key=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id"), primary_key=True)

class Patch(Base):
    __tablename__ = "patches"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    kb_id = Column(String)
    severity = Column(String)  # critical, important, moderate, low
    status = Column(String, default="available")  # available, testing, approved, declined, deployed
    product = Column(String)
    attributes = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

class Vulnerability(Base):
    __tablename__ = "vulnerabilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    cve_id = Column(String)
    title = Column(String, nullable=False)
    severity = Column(String)
    cvss_score = Column(String)
    status = Column(String, default="open")  # open, mitigated, remediated, accepted
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    attributes = Column(JSON, default=dict)
    detected_at = Column(DateTime, default=datetime.utcnow)

class SecurityAlert(Base):
    __tablename__ = "security_alerts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    severity = Column(String)
    category = Column(String)  # edr, malware, ransomware, dlp, browser
    status = Column(String, default="new")  # new, investigating, contained, resolved
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    attributes = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

class Policy(Base):
    __tablename__ = "policies"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    policy_type = Column(String, nullable=False)  # patch, compliance, app_control, encryption, browser, mdm
    status = Column(String, default="draft")
    definition = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

class ComplianceResult(Base):
    __tablename__ = "compliance_results"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False)
    benchmark = Column(String)  # CIS, NIST, Cyber Essentials
    score = Column(String)
    status = Column(String)  # compliant, non_compliant
    findings = Column(JSON, default=list)
    assessed_at = Column(DateTime, default=datetime.utcnow)

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    action = Column(String, nullable=False)
    entity_type = Column(String)
    entity_id = Column(UUID(as_uuid=True))
    event_metadata = Column(JSON)
    occurred_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_audit_tenant_time", "tenant_id", "occurred_at"),)
