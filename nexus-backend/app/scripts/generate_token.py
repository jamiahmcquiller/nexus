# Generate a one-time enrollment token for a tenant and store it.
# Usage: python -m app.scripts.generate_token <tenant_uuid> [label] [expires_hours]
#
# Only the SHA-256 hash is stored. The plaintext token is printed once,
# here, and never stored or logged anywhere else. The token enrolls
# exactly one device, then it is spent; enrolling issues that device
# its own long-lived credential. Expired or used tokens are rejected.
import hashlib
import secrets
import sys
import uuid
from datetime import datetime, timedelta

from ..database import SessionLocal
from ..models import Tenant
from ..models_extended import EnrollmentToken

if len(sys.argv) < 2:
    print("Usage: python -m app.scripts.generate_token <tenant_uuid> [label] [expires_hours]")
    sys.exit(1)

try:
    tenant_id = uuid.UUID(sys.argv[1])
except ValueError:
    print(f"Not a tenant UUID: {sys.argv[1]}")
    sys.exit(1)

label = sys.argv[2] if len(sys.argv) > 2 else ""
try:
    expires_hours = int(sys.argv[3]) if len(sys.argv) > 3 else 72
except ValueError:
    print(f"expires_hours must be a number: {sys.argv[3]}")
    sys.exit(1)

db = SessionLocal()
try:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        print(f"No tenant with id {tenant_id}")
        sys.exit(1)
    token = f"nexus-{tenant_id}-{secrets.token_hex(4)}"
    row = EnrollmentToken(
        tenant_id=tenant_id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        label=label or None,
        expires_at=datetime.utcnow() + timedelta(hours=expires_hours),
    )
    db.add(row)
    db.commit()
    print(f"Enrollment token: {token}")
    print(f"Valid for tenant: {tenant_id} ({tenant.name})")
    print(f"Expires at: {row.expires_at.isoformat()} UTC")
    print("One use only — enrolling spends it and issues the device its own credential.")
finally:
    db.close()
