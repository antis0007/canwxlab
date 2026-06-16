"""End-to-end test of the interp manifest/frame routes with a stub model.

No GPU: a linear-average interpolator is injected via the model boundary, and
the WMS frame fetch is monkeypatched, so the full synthesize→cache→serve path
is exercised deterministically.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi import Response
from fastapi.testclient import TestClient

import canwxlab_api.routes.interp as interp_route
from canwxlab_api import frame_interp
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.main import app


class _LinearAverage:
    def midpoint(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return ((a.astype(np.float32) + b.astype(np.float32)) / 2.0).astype(np.uint8)


def _make_png(value: int, size: int = 16) -> bytes:
    return frame_interp.rgb_to_png(np.full((size, size, 3), value, dtype=np.uint8))


def test_manifest_and_frame_roundtrip(tmp_path: Path, monkeypatch) -> None:
    frame_interp.set_interpolator_factory(lambda: _LinearAverage())

    async def fake_wms(*, time: str, **_kwargs):
        # Two distinct keyframes so interpolation is observable.
        value = 0 if time.endswith("00:00:00Z") else 200
        return Response(content=_make_png(value), media_type="image/png", status_code=200)

    monkeypatch.setattr(interp_route, "get_wms_image", fake_wms)

    class _Settings:
        cache_dir = str(tmp_path)

    monkeypatch.setattr(interp_route, "get_settings", lambda: _Settings())
    app.dependency_overrides[get_source_adapter] = lambda: object()

    try:
        client = TestClient(app)
        params = {
            "layer": "ir", "bbox": "0,0,1,1",
            "t0": "2026-06-14T00:00:00Z", "t1": "2026-06-14T00:10:00Z",
            "size": "64", "depth": "2",
        }
        manifest = client.get("/api/v1/interp/manifest", params=params).json()
        assert manifest["available"] is True
        assert [f["frac"] for f in manifest["frames"]] == [0.25, 0.5, 0.75]
        # Midpoint time is exactly between the keyframes.
        mid = next(f for f in manifest["frames"] if f["frac"] == 0.5)
        assert mid["tMs"] == (manifest["t0Ms"] + manifest["t1Ms"]) // 2

        r = client.get("/api/v1/interp/frame", params={**params, "frac": "0.5"})
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        # 0.5 between value 0 and 200 → ~100.
        px = frame_interp.png_to_rgb(r.content)
        assert abs(int(px[0, 0, 0]) - 100) <= 1
    finally:
        app.dependency_overrides.clear()
        frame_interp.set_interpolator_factory(None)


def test_manifest_degrades_when_model_unavailable(tmp_path: Path, monkeypatch) -> None:
    frame_interp.set_interpolator_factory(None)  # back to default (no backend)

    class _Settings:
        cache_dir = str(tmp_path)

    monkeypatch.setattr(interp_route, "get_settings", lambda: _Settings())
    app.dependency_overrides[get_source_adapter] = lambda: object()
    try:
        client = TestClient(app)
        manifest = client.get("/api/v1/interp/manifest", params={
            "layer": "ir", "bbox": "0,0,1,1",
            "t0": "2026-06-14T00:00:00Z", "t1": "2026-06-14T00:10:00Z",
            "size": "64", "depth": "2",
        }).json()
        assert manifest["available"] is False
        assert "reason" in manifest
    finally:
        app.dependency_overrides.clear()
