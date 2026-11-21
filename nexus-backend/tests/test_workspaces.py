"""Workspace authorization tests — run against in-memory SQLite.

Covers the rule behind the two administrator workspaces: one sign-in
authorizes both workspaces for owner/admin, one workspace each for
technician (IT Operations) and auditor (Security Operations), and
none for an unknown role. The HTTP check mounts only the auth router
with an overridden DB session, so it needs no Postgres and never
imports app.main (which connects to the database at import time).

Run:  cd nexus-backend && python -m pytest tests/test_workspaces.py
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import models
from app.auth import create_access_token
from app.routers.auth import router as auth_router, workspaces_for_role


@pytest.fixture()
def db_engine():
    # StaticPool + check_same_thread=False: TestClient serves requests
    # on another thread, and it must see the same in-memory database
    # the test wrote the user to. A fresh session is created per
    # request (a Session is not thread-safe to share).
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _make_user(db_engine, role):
    session = sessionmaker(bind=db_engine)()
    tenant = models.Tenant(id=uuid.uuid4(), name="Test Tenant")
    session.add(tenant)
    session.commit()
    user = models.User(
        id=uuid.uuid4(), tenant_id=tenant.id, username=f"user-{role}",
        hashed_password="x", role=role,
    )
    session.add(user)
    session.commit()
    user_id, tenant_id = user.id, user.tenant_id
    username = user.username
    session.close()
    return {"id": user_id, "tenant_id": tenant_id, "username": username}


def _client(db_engine):
    app = FastAPI()
    app.include_router(auth_router)

    def override_get_db():
        session = sessionmaker(bind=db_engine)()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_workspaces_for_role():
    assert workspaces_for_role("owner") == ["operations", "security"]
    assert workspaces_for_role("admin") == ["operations", "security"]
    assert workspaces_for_role("technician") == ["operations"]
    assert workspaces_for_role("auditor") == ["security"]
    assert workspaces_for_role("unknown-role") == []
    assert workspaces_for_role("") == []


@pytest.mark.parametrize("role,expected", [
    ("owner", ["operations", "security"]),
    ("admin", ["operations", "security"]),
    ("technician", ["operations"]),
    ("auditor", ["security"]),
])
def test_workspaces_endpoint_returns_role_workspaces(db_engine, role, expected):
    user = _make_user(db_engine, role)
    token = create_access_token({"sub": str(user["id"]), "tenant_id": str(user["tenant_id"])})
    res = _client(db_engine).get(
        "/api/v1/auth/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["workspaces"] == expected
    assert body["role"] == role
    assert body["username"] == user["username"]


def test_workspaces_endpoint_requires_auth(db_engine):
    res = _client(db_engine).get("/api/v1/auth/workspaces")
    assert res.status_code == 401


def test_me_includes_workspaces(db_engine):
    user = _make_user(db_engine, "admin")
    token = create_access_token({"sub": str(user["id"]), "tenant_id": str(user["tenant_id"])})
    res = _client(db_engine).get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["workspaces"] == ["operations", "security"]
