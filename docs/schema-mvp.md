# Initial Database Schema (MVP)

PostgreSQL. All tenant-scoped tables include `tenant_id UUID NOT NULL`.

## Core Tables

### tenants
- id UUID PK
- name TEXT
- created_at TIMESTAMPTZ

### users
- id UUID PK
- tenant_id UUID FK
- email TEXT UNIQUE per tenant
- role TEXT (owner, admin, technician, auditor)
- created_at TIMESTAMPTZ

### devices
- id UUID PK
- tenant_id UUID FK
- hostname TEXT
- device_id TEXT UNIQUE (stable platform identifier)
- enrollment_status TEXT
- agent_version TEXT
- last_checkin_at TIMESTAMPTZ
- attributes JSONB
- created_at, updated_at

### device_inventory_snapshots
- id UUID PK
- device_id UUID FK
- tenant_id UUID
- hardware JSONB
- os JSONB
- software JSONB
- collected_at TIMESTAMPTZ

### groups
- id UUID PK
- tenant_id UUID
- name TEXT
- created_at

### device_groups
- device_id UUID
- group_id UUID
- PRIMARY KEY (device_id, group_id)

### audit_events
- id UUID PK
- tenant_id UUID
- actor_user_id UUID
- action TEXT
- entity_type TEXT
- entity_id UUID
- metadata JSONB
- occurred_at TIMESTAMPTZ

## Indexes

- devices(tenant_id, last_checkin_at)
- devices(tenant_id, hostname)
- audit_events(tenant_id, occurred_at)

## Notes

- Use JSONB for flexible inventory attributes.
- Enable RLS policies on all tables above.
- Inventory is append-only snapshots; current state is derived or denormalized on the device record for fast listing.
