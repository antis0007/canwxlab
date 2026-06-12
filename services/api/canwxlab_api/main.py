import shutil
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from canwxlab_api.config import get_settings
from canwxlab_api.logging_config import configure_logging
from canwxlab_api.routes import (
    aircraft,
    alerts,
    cosmic,
    eccc,
    evidence,
    layers,
    motion,
    observations,
    plugins,
    simulations,
    sources,
    verification,
    weather,
)

# ── Phase A routes ────────────────────────────────────────────────────────
# GET  /api/evidence/{object_id}/provenance  → EvidenceChain
# GET  /api/evidence/{object_id}/history     → list[SpatiotemporalEvent]
# GET  /api/evidence/{object_id}/conflicts   → list[DerivedCellState]
# GET  /api/evidence/cells?h3=...&var=...    → DerivedCellState
# POST /api/events/ingest                    → EventIngestionResult
# GET  /api/events?bbox=...&from=...&to=...  → list[SpatiotemporalEvent]
# ─────────────────────────────────────────────────────────────────────────

configure_logging()
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="CanWxLab weather visualization, simulation, and verification API.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    response = await call_next(request)
    response.headers["x-canwxlab-env"] = settings.env
    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "canwxlab-api",
        "version": "0.1.0",
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.post("/api/admin/clear-cache")
async def clear_cache() -> dict[str, str | bool]:
    cache_path = Path(settings.cache_dir).resolve()
    cwd = Path.cwd().resolve()
    if not cache_path.is_relative_to(cwd):
        raise HTTPException(status_code=400, detail="Refusing to clear cache outside workspace")
    if cache_path.exists():
        shutil.rmtree(cache_path)
    cache_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "cleared": str(cache_path)}


app.include_router(aircraft.router)
app.include_router(sources.router)
app.include_router(layers.router)
app.include_router(observations.router)
app.include_router(alerts.router)
app.include_router(eccc.router)
app.include_router(motion.router)
app.include_router(cosmic.router)
app.include_router(plugins.router)
app.include_router(simulations.router)
app.include_router(verification.router)
app.include_router(evidence.router)
app.include_router(weather.router)
