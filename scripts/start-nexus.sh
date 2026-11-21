#!/usr/bin/env bash
# Start the whole NEXUS stack, then check it actually answers.
# Usage: ./scripts/start-nexus.sh
#   --docker   run everything in Docker Compose (recommended in Codespaces)
#   (default)  run Postgres in Docker, API + frontend on the host
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--docker" ]; then
  docker compose -f infra/docker-compose.yml up -d --build
else
  docker compose -f infra/docker-compose.yml up -d postgres redis
  echo "Waiting for Postgres…"
  for _ in $(seq 1 30); do
    docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U nexus >/dev/null 2>&1 && break
    sleep 2
  done
  export PATH="$HOME/.local/bin:$PATH"
  (cd nexus-backend && poetry install --no-root >/dev/null 2>&1 || pip install -q fastapi uvicorn sqlalchemy psycopg[binary] pydantic pydantic-settings python-jose passlib bcrypt==4.0.1 alembic 2>/dev/null || true; poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload >/tmp/nexus-backend.log 2>&1 &) || true
  (cd frontend && npm install >/dev/null 2>&1; npm run dev -- --host 0.0.0.0 >/tmp/nexus-frontend.log 2>&1 &) || true
fi

echo "Waiting for the API at http://localhost:8000/health …"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
    echo "API is up: http://localhost:8000/health"
    echo "Console: http://localhost:5173  (in Codespaces, open the forwarded 5173 port)"
    echo "If login still says the backend is unreachable, check /tmp/nexus-backend.log"
    exit 0
  fi
  sleep 2
done
echo "API did not come up in 60s. Check:"
echo "  docker compose -f infra/docker-compose.yml ps"
echo "  docker compose -f infra/docker-compose.yml logs backend"
echo "  /tmp/nexus-backend.log"
exit 1
