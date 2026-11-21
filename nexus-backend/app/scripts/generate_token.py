# Generate a one-time enrollment token for a tenant
# Usage: python -m app.scripts.generate_token <tenant_id>
import sys
import uuid
from datetime import datetime

if len(sys.argv) < 2:
    print("Usage: python -m app.scripts.generate_token <tenant_uuid>")
    sys.exit(1)

tenant_id = sys.argv[1]
token = f"nexus-{tenant_id}-{uuid.uuid4().hex[:8]}"
print(f"Enrollment token: {token}")
print(f"Valid for tenant: {tenant_id}")
print(f"Generated at: {datetime.utcnow().isoformat()}")
