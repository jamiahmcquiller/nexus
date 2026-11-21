"""Database + settings.

Secrets are never defaulted to a working value in this file:
- DATABASE_URL must be set (environment or a .env file). If it is
  missing the app fails closed at import with a clear error instead
  of silently connecting to a dev database.
- SECRET_KEY must be set for production use. If it is missing, an
  ephemeral random key is generated and a loud warning is printed:
  the app still runs, but every JWT issued before a restart stops
  validating, because the signing key did not survive the restart.
  Set SECRET_KEY in the environment (or infra/.env for docker compose)
  to keep sign-ins working across restarts.
"""
import secrets
import sys
import warnings

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from pydantic_settings import BaseSettings

_MISSING_SECRET_WARNING = (
    "SECRET_KEY is not set — using an ephemeral random key. "
    "Sign-ins will stop working after a restart. "
    "Set SECRET_KEY in the environment or in infra/.env."
)


class Settings(BaseSettings):
    database_url: str | None = None
    secret_key: str | None = None
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    class Config:
        env_file = ".env"


settings = Settings()

if not settings.database_url:
    raise RuntimeError(
        "DATABASE_URL is not set. Set it in the environment, in a .env file, "
        "or in infra/.env (see infra/.env.example) before starting the backend."
    )

if not settings.secret_key:
    settings.secret_key = secrets.token_urlsafe(32)
    warnings.warn(_MISSING_SECRET_WARNING, stacklevel=2)
    print(f"WARNING: {_MISSING_SECRET_WARNING}", file=sys.stderr)

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_is_demo_columns(engine_to_check=None):
    """Add the is_demo flag to existing tables that predate it.

    create_all only creates missing tables — it never alters an existing
    one. The demo seed added is_demo to the platform models, so a database
    created before that change has tables without the column, and every
    list query would fail with "column ... is_demo does not exist".
    This runs on boot (see app.main), is idempotent, and only touches
    tables whose model declares is_demo.
    """
    from sqlalchemy import inspect, text

    eng = engine_to_check or engine
    insp = inspect(eng)
    with eng.begin() as conn:
        for table in Base.metadata.tables.values():
            if "is_demo" not in table.c:
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            if "is_demo" in existing:
                continue
            if eng.dialect.name == "postgresql":
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN is_demo BOOLEAN DEFAULT FALSE'))
            else:
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN is_demo BOOLEAN DEFAULT 0'))
