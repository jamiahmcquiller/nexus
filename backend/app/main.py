from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="NEXUS API",
    description="Unified IT Operations & Security Management Platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-backend"}

@app.get("/api/v1/status")
async def status():
    return {"version": "0.1.0", "phase": "MVP - Endpoint Foundation"}
