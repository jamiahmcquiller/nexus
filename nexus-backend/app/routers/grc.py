"""Governance, Risk & Compliance workspace (v0.5.0).

Ten tenant-scoped resources (see docs/grc.md) plus an overview, per-record
history from AuditEvent, workflow transitions, and idempotent demo-data
seeding. Demo rows are always flagged ``is_demo=True`` and are never
mixed up with the organization's own compliance data; clear-demo only
ever deletes demo rows.

History routes live on this router and are registered before the CRUD
sub-routers, so /{resource}/{id}/history can never be swallowed by a
CRUD get-by-id route.
"""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import AuditEvent, ComplianceResult, User
from ..models_extended import (
    GrcAssessment, GrcAudit, GrcControl, GrcControlMapping, GrcEvidence,
    GrcFinding, GrcFramework, GrcRemediation, GrcRisk, GrcSetting,
)
from ._crud import _get_or_404, _serialize, crud_router, WRITE

router = APIRouter(prefix="/api/v1/grc", tags=["grc"])

# plural -> (singular for history entity_type, model, audit prefix)
RESOURCES = {
    "frameworks": ("framework", GrcFramework, "grc_framework"),
    "controls": ("control", GrcControl, "grc_control"),
    "assessments": ("assessment", GrcAssessment, "grc_assessment"),
    "evidence": ("evidence", GrcEvidence, "grc_evidence"),
    "findings": ("finding", GrcFinding, "grc_finding"),
    "risks": ("risk", GrcRisk, "grc_risk"),
    "remediations": ("remediation", GrcRemediation, "grc_remediation"),
    "audits": ("audit", GrcAudit, "grc_audit"),
    "mappings": ("mapping", GrcControlMapping, "grc_mapping"),
    "settings": ("setting", GrcSetting, "grc_setting"),
}

GRC_MODELS = [model for _, model, _ in RESOURCES.values()]


def _parse_dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _audit(db, prefix, action, row, current_user, extra=None):
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


def _transition(db, model, prefix, item_id, current_user, new_status, action):
    row = _get_or_404(db, model, item_id, current_user)
    row.status = new_status
    db.commit()
    db.refresh(row)
    _audit(db, prefix, action, row, current_user, {"status": new_status})
    db.commit()
    return _serialize(row)


def _has_demo(db, tenant_id):
    return any(
        db.query(m).filter(m.tenant_id == tenant_id, m.is_demo.is_(True)).first()
        for m in GRC_MODELS
    )


# ------------------------------------------------------------------ overview
@router.get("/overview")
def grc_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tid = current_user.tenant_id
    fw_q = db.query(GrcFramework).filter(GrcFramework.tenant_id == tid)
    ctrl_q = db.query(GrcControl).filter(GrcControl.tenant_id == tid)
    findings_q = db.query(GrcFinding).filter(GrcFinding.tenant_id == tid)
    open_findings = findings_q.filter(GrcFinding.status == "open").all()

    per_framework = []
    for fw in fw_q.order_by(GrcFramework.name).all():
        fctrl = ctrl_q.filter(GrcControl.framework_id == fw.id)
        total = fctrl.count()
        implemented = fctrl.filter(GrcControl.status == "implemented").count()
        per_framework.append({
            "id": str(fw.id), "name": fw.name, "standard": fw.standard,
            "version": fw.version, "owner": fw.owner, "status": fw.status,
            "is_demo": fw.is_demo,
            "total_controls": total, "implemented_controls": implemented,
            "compliance_pct": round(100 * implemented / total) if total else 0,
        })

    now = datetime.utcnow()
    overdue = sum(
        1 for r in db.query(GrcRemediation).filter(
            GrcRemediation.tenant_id == tid).all()
        if r.status in ("planned", "in_progress", "overdue")
        and _parse_dt(r.due_at) is not None and _parse_dt(r.due_at) < now
    )

    recent = (
        db.query(AuditEvent)
        .filter(AuditEvent.tenant_id == tid,
                AuditEvent.entity_type.startswith("grc_"))
        .order_by(AuditEvent.occurred_at.desc())
        .limit(10)
        .all()
    )
    legacy_q = db.query(ComplianceResult).filter(ComplianceResult.tenant_id == tid)
    return {
        "active_frameworks": fw_q.filter(GrcFramework.status == "active").count(),
        "total_frameworks": fw_q.count(),
        "total_controls": ctrl_q.count(),
        "controls_implemented": ctrl_q.filter(GrcControl.status == "implemented").count(),
        "open_findings": len(open_findings),
        "findings_by_severity": {
            sev: sum(1 for f in open_findings if f.severity == sev)
            for sev in ("critical", "high", "medium", "low")
        },
        "evidence_pending_review": db.query(GrcEvidence).filter(
            GrcEvidence.tenant_id == tid,
            GrcEvidence.status == "pending_review").count(),
        "open_risks": db.query(GrcRisk).filter(
            GrcRisk.tenant_id == tid, GrcRisk.status == "open").count(),
        "overdue_remediations": overdue,
        "has_demo": _has_demo(db, tid),
        "frameworks": per_framework,
        "recent_activity": [_serialize(e) for e in recent],
        "legacy_benchmarks": {
            "total": legacy_q.count(),
            "compliant": legacy_q.filter(ComplianceResult.status == "compliant").count(),
            "non_compliant": legacy_q.filter(ComplianceResult.status == "non_compliant").count(),
        },
    }


# ------------------------------------------------------------------ history
@router.get("/{resource}/{item_id}/history")
def grc_history(resource: str, item_id: str,
                db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    if resource not in RESOURCES:
        raise HTTPException(status_code=404, detail="Unknown GRC resource")
    singular, _, _ = RESOURCES[resource]
    try:
        uid = uuid.UUID(item_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid id")
    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.tenant_id == current_user.tenant_id,
                AuditEvent.entity_type == f"grc_{singular}",
                AuditEvent.entity_id == uid)
        .order_by(AuditEvent.occurred_at.desc())
        .limit(50)
        .all()
    )
    return [_serialize(e) for e in rows]


# -------------------------------------------------------------- demo data
@router.post("/seed-demo")
def seed_demo(db: Session = Depends(get_db),
              current_user: User = Depends(require_role(["owner", "admin"]))):
    tid = current_user.tenant_id
    if _has_demo(db, tid):
        return {"seeded": False, "reason": "demo data already exists"}
    now = datetime.utcnow()

    def fw(name, standard, version):
        row = GrcFramework(tenant_id=tid, name=name, title=name, standard=standard,
                           version=version, owner="GRC Team", status="active",
                           is_demo=True, attributes={"description": f"Demo {standard} framework"})
        db.add(row)
        return row

    cis = fw("CIS Controls v8", "CIS v8", "8.0")
    nist = fw("NIST Cybersecurity Framework", "NIST CSF 2.0", "2.0")
    iso = fw("ISO/IEC 27001", "ISO 27001", "2022")
    db.flush()

    control_specs = [
        (cis, "CIS 1.1", "Inventory & Control of Enterprise Assets", "Asset Management", "implemented"),
        (cis, "CIS 3.3", "Configure Data Access Control Lists", "Data Protection", "implemented"),
        (cis, "CIS 4.1", "Establish and Maintain a Secure Configuration Process", "Secure Configuration", "partial"),
        (cis, "CIS 5.4", "Restrict Administrator Privileges to Dedicated Accounts", "Access Control", "not_implemented"),
        (nist, "GV.OC-01", "Organizational Context Is Understood", "Govern", "implemented"),
        (nist, "PR.AC-01", "Identities and Credentials Are Managed", "Protect", "implemented"),
        (nist, "PR.AC-03", "Remote Access Is Managed", "Protect", "partial"),
        (nist, "DE.CM-01", "Networks and Systems Are Monitored", "Detect", "not_implemented"),
        (iso, "A.5.1", "Policies for Information Security", "Organizational", "implemented"),
        (iso, "A.5.15", "Access Control", "Access Control", "implemented"),
        (iso, "A.8.2", "Privileged Access Rights", "Access Control", "partial"),
        (iso, "A.8.13", "Backup of Information", "Technology", "implemented"),
    ]
    controls = []
    for framework, ref, title, category, status in control_specs:
        row = GrcControl(tenant_id=tid, framework_id=framework.id, name=title,
                         title=title, control_ref=ref, category=category,
                         owner="GRC Team", status=status, is_demo=True)
        db.add(row)
        controls.append(row)
    db.flush()

    db.add(GrcAssessment(tenant_id=tid, framework_id=cis.id, name="CIS v8 Q4 Assessment",
                         title="CIS v8 Q4 Assessment", scope="All endpoints",
                         assessor="Internal Audit", due_at=now + timedelta(days=30),
                         status="in_progress", is_demo=True))
    db.add(GrcAssessment(tenant_id=tid, framework_id=iso.id, name="ISO 27001 Annual Assessment",
                         title="ISO 27001 Annual Assessment", scope="ISMS scope",
                         assessor="External Auditor", due_at=now + timedelta(days=60),
                         status="planned", is_demo=True))
    for i, (ctrl, etype, status) in enumerate([
        (controls[0], "document", "approved"),
        (controls[1], "screenshot", "approved"),
        (controls[3], "log", "pending_review"),
        (controls[5], "attestation", "approved"),
        (controls[7], "document", "pending_review"),
        (controls[10], "log", "approved"),
    ]):
        db.add(GrcEvidence(tenant_id=tid, control_id=ctrl.id, framework_id=ctrl.framework_id,
                           name=f"Demo evidence {i + 1}", title=f"Demo evidence {i + 1}",
                           evidence_type=etype, uploaded_by="demo-uploader",
                           status=status, is_demo=True,
                           attributes={"file_name": f"demo-evidence-{i + 1}.pdf",
                                       "file_reference": f"demo/evidence-{i + 1}.pdf"}))
    finding_specs = [
        (controls[3], "Dedicated admin accounts not enforced", "critical", "open", False),
        (controls[7], "No continuous network monitoring", "high", "open", False),
        (controls[2], "Secure configuration process undocumented", "medium", "in_progress", False),
        (controls[10], "Privileged access review overdue", "high", "open", False),
        (controls[6], "Remote access without MFA for one vendor", "low", "accepted", True),
    ]
    findings = []
    for ctrl, title, severity, status, exception in finding_specs:
        row = GrcFinding(tenant_id=tid, control_id=ctrl.id, framework_id=ctrl.framework_id,
                         name=title, title=title, severity=severity, owner="GRC Team",
                         status=status, is_demo=True,
                         attributes={"exception": exception,
                                     "exception_expiry": "2027-03-01" if exception else None})
        db.add(row)
        findings.append(row)
    db.flush()
    for title, cat, likelihood, impact, status in [
        ("Ransomware via unpatched endpoint", "Malware", 4, 5, "open"),
        ("Insider data exfiltration", "Data Loss", 3, 4, "open"),
        ("Third-party vendor breach", "Supply Chain", 2, 4, "mitigated"),
        ("Cloud misconfiguration exposure", "Cloud", 3, 3, "accepted"),
    ]:
        db.add(GrcRisk(tenant_id=tid, name=title, title=title, category=cat,
                       likelihood=likelihood, impact=impact, owner="GRC Team",
                       status=status, is_demo=True))
    db.add(GrcRemediation(tenant_id=tid, finding_id=findings[0].id, control_id=controls[3].id,
                          name="Enforce dedicated admin accounts", title="Enforce dedicated admin accounts",
                          owner="IT Operations", due_at=now - timedelta(days=5),
                          status="in_progress", is_demo=True))
    db.add(GrcRemediation(tenant_id=tid, finding_id=findings[1].id, control_id=controls[7].id,
                          name="Deploy network monitoring", title="Deploy network monitoring",
                          owner="Security Operations", due_at=now + timedelta(days=14),
                          status="planned", is_demo=True))
    db.add(GrcRemediation(tenant_id=tid, finding_id=findings[2].id, control_id=controls[2].id,
                          name="Document secure configuration process", title="Document secure configuration process",
                          owner="GRC Team", due_at=now + timedelta(days=7),
                          status="in_progress", is_demo=True))
    db.add(GrcAudit(tenant_id=tid, framework_id=cis.id, name="CIS v8 Internal Audit",
                    title="CIS v8 Internal Audit", auditor="Internal Audit",
                    scheduled_at=now + timedelta(days=21), status="scheduled", is_demo=True))
    db.add(GrcAudit(tenant_id=tid, framework_id=iso.id, name="ISO 27001 Surveillance Audit",
                    title="ISO 27001 Surveillance Audit", auditor="External Auditor",
                    scheduled_at=now + timedelta(days=45), status="in_progress", is_demo=True))
    for ctrl, mapped_fw, mapped_ref, status in [
        (controls[0], "NIST CSF 2.0", "GV.OC-01", "mapped"),
        (controls[5], "ISO 27001", "A.5.15", "mapped"),
        (controls[7], "ISO 27001", "A.8.16", "gap"),
    ]:
        db.add(GrcControlMapping(tenant_id=tid, control_id=ctrl.id,
                                 name=f"{ctrl.control_ref} -> {mapped_fw} {mapped_ref}",
                                 title=f"{ctrl.control_ref} -> {mapped_fw} {mapped_ref}",
                                 mapped_framework=mapped_fw, mapped_control_ref=mapped_ref,
                                 status=status, is_demo=True))
    for key, value in [
        ("review_cadence", "quarterly"),
        ("evidence_retention", "7 years"),
        ("risk_appetite", "moderate"),
    ]:
        db.add(GrcSetting(tenant_id=tid, name=key, title=key, key=key, value=value,
                          status="active", is_demo=True))
    db.commit()
    _audit(db, "grc_framework", "demo_seeded", cis, current_user,
           {"frameworks": 3, "controls": 12})
    db.commit()
    return {"seeded": True, "frameworks": 3, "controls": 12, "assessments": 2,
            "evidence": 6, "findings": 5, "risks": 4, "remediations": 3,
            "audits": 2, "mappings": 3, "settings": 3}


@router.post("/clear-demo")
def clear_demo(db: Session = Depends(get_db),
               current_user: User = Depends(require_role(["owner", "admin"]))):
    tid = current_user.tenant_id
    deleted = {}
    # Children first so FKs never block the delete.
    for plural, (_, model, _) in reversed(list(RESOURCES.items())):
        rows = db.query(model).filter(
            model.tenant_id == tid, model.is_demo.is_(True)).all()
        deleted[plural] = len(rows)
        for row in rows:
            db.delete(row)
    db.commit()
    return {"cleared": True, "deleted": deleted}


# ---------------------------------------------------------------- workflows
@router.post("/assessments/{item_id}/start")
def start_assessment(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcAssessment, "grc_assessment", item_id, current_user, "in_progress", "started")


@router.post("/assessments/{item_id}/complete")
def complete_assessment(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcAssessment, "grc_assessment", item_id, current_user, "complete", "completed")


@router.post("/evidence/{item_id}/approve")
def approve_evidence(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcEvidence, "grc_evidence", item_id, current_user, "approved", "approved")


@router.post("/evidence/{item_id}/reject")
def reject_evidence(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcEvidence, "grc_evidence", item_id, current_user, "rejected", "rejected")


@router.post("/findings/{item_id}/remediate")
def remediate_finding(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcFinding, "grc_finding", item_id, current_user, "remediated", "remediated")


@router.post("/findings/{item_id}/accept")
def accept_finding(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcFinding, "grc_finding", item_id, current_user, "accepted", "accepted")


@router.post("/risks/{item_id}/accept")
def accept_risk(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcRisk, "grc_risk", item_id, current_user, "accepted", "accepted")


@router.post("/risks/{item_id}/mitigate")
def mitigate_risk(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcRisk, "grc_risk", item_id, current_user, "mitigated", "mitigated")


@router.post("/remediations/{item_id}/complete")
def complete_remediation(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcRemediation, "grc_remediation", item_id, current_user, "complete", "completed")


@router.post("/audits/{item_id}/complete")
def complete_audit(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcAudit, "grc_audit", item_id, current_user, "complete", "completed")


@router.post("/frameworks/{item_id}/activate")
def activate_framework(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcFramework, "grc_framework", item_id, current_user, "active", "activated")


@router.post("/frameworks/{item_id}/retire")
def retire_framework(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(WRITE)):
    return _transition(db, GrcFramework, "grc_framework", item_id, current_user, "retired", "retired")


# --------------------------------------------------------------------- CRUD
# Included last: history / overview / workflow routes above take
# precedence, and each CRUD router's own sub-routes are ordered
# internally (stats before {item_id}).
for _plural, (_singular, _model, _audit_prefix) in RESOURCES.items():
    router.include_router(
        crud_router(f"/{_plural}", _model, "grc", audit_prefix=_audit_prefix))
