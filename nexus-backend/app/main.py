from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from . import models  # noqa: F401  (registers core tables)
from . import models_extended  # noqa: F401  (registers platform tables)
from .routers import (
    auth, devices, patches, vulnerabilities, alerts, policies, compliance,
    patching, vulnops, edr, malware, browser, appcontrol, dlp, access,
    assets, distribution, dex, remote, imaging, configmgmt, mdm,
    encryption, servers, reporting, scheduler,
)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="NEXUS API",
    description="Unified IT Operations & Security Management Platform",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core
app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(patches.router)
app.include_router(vulnerabilities.router)
app.include_router(alerts.router)
app.include_router(policies.router)
app.include_router(compliance.router)

# Endpoint Central-style platform modules — one platform, one tenant model
app.include_router(patching.router)
app.include_router(vulnops.router)
app.include_router(edr.router)
app.include_router(malware.router)
app.include_router(browser.router)
app.include_router(appcontrol.router)
app.include_router(dlp.router)
app.include_router(access.router)
app.include_router(assets.router)
app.include_router(distribution.router)
app.include_router(dex.router)
app.include_router(remote.router)
app.include_router(imaging.router)
app.include_router(configmgmt.router)
app.include_router(mdm.router)
app.include_router(encryption.router)
app.include_router(servers.router)
app.include_router(reporting.router)
app.include_router(scheduler.router)

@app.get("/")
async def root():
    return {
        "service": "NEXUS API",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
        "api": "/api/v1"
    }

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-backend"}

@app.get("/api/v1/status")
async def status():
    return {
        "version": "0.3.0",
        "phase": "Platform + scheduler — patch, vulnerability, EDR, malware, ransomware, browser, app control, DLP, secure access, assets, distribution, DEX, remote, imaging, config, MDM, encryption, servers, reporting, scheduler",
        "modules": [
            "patching", "vulnerabilities", "edr", "malware", "ransomware",
            "browser", "app-control", "dlp", "access", "assets",
            "distribution", "dex", "remote", "imaging", "config",
            "mdm", "encryption", "servers", "reporting", "scheduler",
        ],
    }
