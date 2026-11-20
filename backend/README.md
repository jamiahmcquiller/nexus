# NEXUS Backend

FastAPI application serving the admin console APIs and agent ingestion endpoints.

## Local Setup

```bash
poetry install
poetry run uvicorn app.main:app --reload --port 8000
```

Requires PostgreSQL (see `../infra/docker-compose.yml`).
