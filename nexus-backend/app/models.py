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


# ---------------------------------------------------------------------------
# Phase 2: Vulnerability management
# ---------------------------------------------------------------------------
class Vulnerability(Base):
    __tablename__ = "vulnerabilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    cve_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    severity = Column(String, nullable=False)  # critical, high, medium, low
    cvss = Column(JSON)  # {"score": 9.8, "vector": "..."}
    epss = Column(JSON)  # {"score": 0.42}
    known_exploited = Column(String, default="no")  # yes/no
    product = Column(String)  # affected software or OS component
    fixed_version = Column(String)
    published_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_vulns_tenant_cve", "tenant_id", "cve_id", unique=True),)


class DeviceVulnerability(Base):
    __tablename__ = "device_vulnerabilities"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False)
    vulnerability_id = Column(UUID(as_uuid=True), ForeignKey("vulnerabilities.id"), nullable=False)
    status = Column(String, default="open")  # open, remediated, accepted
    first_detected = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime)
    note = Column(Text)
    __table_args__ = (Index("ix_devvuln_tenant_status", "tenant_id", "status"),)


# ---------------------------------------------------------------------------
# Phase 3: Patch management, software
# ---------------------------------------------------------------------------
class Patch(Base):
    __tablename__ = "patches"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    kb_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    product = Column(String)
    classification = Column(String)  # security, critical, feature, driver
    severity = Column(String)  # critical, important, moderate, low
    release_date = Column(DateTime)
    size_mb = Column(String)
    approval = Column(String, default="pending")  # pending, approved, declined
    approved_by = Column(String)
    approved_at = Column(DateTime)


class DevicePatch(Base):
    __tablename__ = "device_patches"
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), primary_key=True)
    patch_id = Column(UUID(as_uuid=True), ForeignKey("patches.id"), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    status = Column(String, default="missing")  # missing, installed, failed
    updated_at = Column(DateTime, default=datetime.utcnow)


class PatchDeployment(Base):
    __tablename__ = "patch_deployments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, default="scheduled")  # scheduled, running, completed, failed
    scheduled_for = Column(DateTime)
    patch_ids = Column(JSON, default=list)
    target = Column(JSON, default=dict)  # {"type": "all"} | {"type": "group", "group_id": ...}
    results = Column(JSON, default=dict)  # {"succeeded": n, "failed": n, "pending": n}
    created_by = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)


class DeploymentPolicy(Base):
    __tablename__ = "deployment_policies"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    rules = Column(JSON, default=dict)  # {"auto_approve": ["critical"], "window": "Sun 02:00-05:00", "reboot": "prompt"}
    enabled = Column(String, default="yes")
    created_at = Column(DateTime, default=datetime.utcnow)


class SoftwareRule(Base):
    __tablename__ = "software_rules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # approved, unapproved
    note = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_swrule_tenant_name", "tenant_id", "name", unique=True),)


# ---------------------------------------------------------------------------
# Phase 4: Service desk, automation, compliance
# ---------------------------------------------------------------------------
class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    number = Column(String, nullable=False)
    type = Column(String, nullable=False)  # incident, request, change
    title = Column(String, nullable=False)
    description = Column(Text)
    priority = Column(String, default="medium")  # critical, high, medium, low
    status = Column(String, default="new")  # new, in_progress, waiting, resolved, closed
    category = Column(String)
    requester = Column(String)
    assignee = Column(String)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"))
    approval = Column(String)  # for requests/changes: pending, approved, rejected
    source = Column(String, default="console")  # console, portal, automation
    sla_due_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime)
    __table_args__ = (Index("ix_tickets_tenant_status", "tenant_id", "status"),)


class TicketComment(Base):
    __tablename__ = "ticket_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("tickets.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    author = Column(String)
    body = Column(Text, nullable=False)
    internal = Column(String, default="no")
    created_at = Column(DateTime, default=datetime.utcnow)


class Workflow(Base):
    __tablename__ = "workflows"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    trigger = Column(JSON, nullable=False)  # {"type": "device_offline", "hours": 24}
    action = Column(JSON, nullable=False)  # {"type": "create_ticket", "priority": "high"}
    enabled = Column(String, default="yes")
    schedule = Column(String)  # human label, e.g. "Every hour"
    last_run_at = Column(DateTime)
    run_count = Column(String, default="0")
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflows.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    status = Column(String)  # succeeded, failed, no_matches
    matched = Column(String, default="0")
    actions_taken = Column(String, default="0")
    detail = Column(JSON)
    started_at = Column(DateTime, default=datetime.utcnow)


class ControlStatus(Base):
    """Manual status/evidence for a compliance control (automatic controls are computed live)."""
    __tablename__ = "control_status"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    control_key = Column(String, nullable=False)
    status = Column(String, default="not_started")  # passing, failing, in_progress, not_started
    owner = Column(String)
    evidence = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (Index("ix_control_tenant_key", "tenant_id", "control_key", unique=True),)


class Risk(Base):
    __tablename__ = "risks"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    likelihood = Column(String, default="3")  # 1-5
    impact = Column(String, default="3")  # 1-5
    owner = Column(String)
    status = Column(String, default="open")  # open, mitigating, accepted, closed
    treatment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
