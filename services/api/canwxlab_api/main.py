from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from canwxlab_api.config import get_settings
from canwxlab_api.logging_config import configure_logging
from canwxlab_api.routes import (
    alerts,
    eccc,
    layers,
    observations,
    plugins,
    simulations,
    sources,
    verification,
)

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


app.include_router(sources.router)
app.include_router(layers.router)
app.include_router(observations.router)
app.include_router(alerts.router)
app.include_router(eccc.router)
app.include_router(plugins.router)
app.include_router(simulations.router)
app.include_router(verification.router)
