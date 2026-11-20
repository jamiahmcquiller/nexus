# Architecture Decision Record: Tenant Isolation

**Status:** Proposed  
**Date:** 2026-11-20

## Context

NEXUS is a multi-tenant B2B SaaS platform. Cross-tenant data leakage is an existential risk.

## Decision

1. Every tenant-owned record carries `tenant_id` (UUID).
2. Application layer derives `tenant_id` exclusively from the authenticated user's JWT / session. Never trust client-supplied tenant IDs.
3. PostgreSQL Row-Level Security (RLS) policies are enabled on all tenant-scoped tables as a defense-in-depth measure.
4. All queries are scoped with an explicit tenant filter in the ORM / repository layer.
5. Negative tests that attempt cross-tenant access are required in CI.

## Consequences

- Slightly more complex queries and middleware.
- Strong isolation guarantees even if application code has a bug.
- Easier compliance and audit evidence later.

## Alternatives Considered

- Separate database per tenant: higher operational cost, rejected for MVP.
- Application-only filtering: insufficient; RLS provides a hard backstop.
