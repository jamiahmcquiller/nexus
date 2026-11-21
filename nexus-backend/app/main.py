from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .routers import auth, devices, patches, vulnerabilities, alerts, policies, compliance

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="NEXUS API",
    description="Unified IT Operations & Security Management Platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(patches.router)
app.include_router(vulnerabilities.router)
app.include_router(alerts.router)
app.include_router(policies.router)
app.include_router(compliance.router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-backend"}

@app.get("/api/v1/status")
async def status():
    return {"version": "0.1.0", "phase": "MVP - Endpoint Foundation"}
