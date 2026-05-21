"""OpenSky Network ADS-B adapter.

Fetches live aircraft position state vectors from the OpenSky Network REST API.
No API key required for anonymous access (rate-limited to ~10 req/min, 1-min
position staleness). With credentials the rate limit relaxes to 100 req/min
and data freshness improves to 10 s.

API ref: https://openskynetwork.github.io/opensky-api/rest.html
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OPENSKY_BASE = "https://opensky-network.org/api"
# Anonymous: 1-minute cache avoids hammering the rate limit.
# Authenticated: could drop to 15 s, but we stay conservative.
CACHE_TTL_SECONDS = 60

# State vector field indices from the OpenSky /states/all response.
# https://openskynetwork.github.io/opensky-api/rest.html#response
_F_ICAO24 = 0
_F_CALLSIGN = 1
_F_ORIGIN_COUNTRY = 2
_F_TIME_POSITION = 3  # Unix timestamp of last position update
_F_LAST_CONTACT = 4   # Unix timestamp of last any message
_F_LONGITUDE = 5
_F_LATITUDE = 6
_F_BARO_ALTITUDE = 7  # metres (barometric)
_F_ON_GROUND = 8
_F_VELOCITY = 9       # m/s ground speed
_F_TRUE_TRACK = 10    # degrees clockwise from north
_F_VERTICAL_RATE = 11 # m/s positive=climbing
_F_SENSORS = 12
_F_GEO_ALTITUDE = 13  # metres (geometric/GPS)
_F_SQUAWK = 14
_F_SPI = 15
_F_POSITION_SOURCE = 16  # 0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM


class AircraftPosition:
    """Parsed ADS-B state vector for a single aircraft."""

    __slots__ = (
        "icao24",
        "callsign",
        "origin_country",
        "longitude",
        "latitude",
        "baro_altitude_m",
        "geo_altitude_m",
        "velocity_ms",
        "heading_deg",
        "vertical_rate_ms",
        "squawk",
        "on_ground",
        "position_source",
        "observed_at",
        "last_contact_at",
    )

    def __init__(self, state: list[Any]) -> None:
        self.icao24: str = str(state[_F_ICAO24] or "")
        self.callsign: str = (state[_F_CALLSIGN] or "").strip()
        self.origin_country: str = str(state[_F_ORIGIN_COUNTRY] or "")
        self.longitude: float | None = _to_float(state[_F_LONGITUDE])
        self.latitude: float | None = _to_float(state[_F_LATITUDE])
        self.baro_altitude_m: float | None = _to_float(state[_F_BARO_ALTITUDE])
        self.geo_altitude_m: float | None = _to_float(state[_F_GEO_ALTITUDE])
        self.velocity_ms: float | None = _to_float(state[_F_VELOCITY])
        self.heading_deg: float | None = _to_float(state[_F_TRUE_TRACK])
        self.vertical_rate_ms: float | None = _to_float(state[_F_VERTICAL_RATE])
        self.squawk: str | None = str(state[_F_SQUAWK]) if state[_F_SQUAWK] else None
        self.on_ground: bool = bool(state[_F_ON_GROUND])
        self.position_source: int = int(state[_F_POSITION_SOURCE] or 0)
        t_pos = state[_F_TIME_POSITION]
        self.observed_at: datetime | None = (
            datetime.fromtimestamp(t_pos, tz=UTC) if t_pos else None
        )
        t_contact = state[_F_LAST_CONTACT]
        self.last_contact_at: datetime | None = (
            datetime.fromtimestamp(t_contact, tz=UTC) if t_contact else None
        )

    def to_geojson_feature(self) -> dict[str, Any]:
        if self.longitude is None or self.latitude is None:
            return {}
        velocity_kmh = round(self.velocity_ms * 3.6, 1) if self.velocity_ms is not None else None
        return {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [self.longitude, self.latitude],
            },
            "properties": {
                "icao24": self.icao24,
                "callsign": self.callsign,
                "origin_country": self.origin_country,
                "baro_altitude_m": self.baro_altitude_m,
                "geo_altitude_m": self.geo_altitude_m,
                "velocity_ms": self.velocity_ms,
                "velocity_kmh": velocity_kmh,
                "heading_deg": self.heading_deg,
                "vertical_rate_ms": self.vertical_rate_ms,
                "squawk": self.squawk,
                "on_ground": self.on_ground,
                "position_source": _source_label(self.position_source),
                "observed_at": self.observed_at.isoformat() if self.observed_at else None,
                "last_contact_at": self.last_contact_at.isoformat() if self.last_contact_at else None,
            },
        }


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _source_label(code: int) -> str:
    return {0: "ADS-B", 1: "ASTERIX", 2: "MLAT", 3: "FLARM"}.get(code, "unknown")


class OpenSkyAdsbAdapter:
    """Fetches live aircraft positions from OpenSky Network.

    Pass ``username`` and ``password`` for authenticated access (higher rate
    limits and fresher data). Leave both ``None`` for anonymous access.
    """

    def __init__(
        self,
        username: str | None = None,
        password: str | None = None,
        timeout_s: float = 10.0,
    ) -> None:
        self._auth = (username, password) if username and password else None
        self._timeout = timeout_s
        self._cache: dict[str, Any] = {}  # simple in-process TTL cache
        self._cache_ts: float = 0.0

    async def fetch_positions(
        self,
        bbox: tuple[float, float, float, float] | None = None,
    ) -> dict[str, Any]:
        """Return a GeoJSON FeatureCollection of current aircraft positions.

        Args:
            bbox: (min_lon, min_lat, max_lon, max_lat) to filter spatially.
                  OpenSky accepts this as lamin/lomin/lamax/lomax parameters.
                  Pass None for global coverage (large response, use sparingly).
        """
        import time
        now = time.monotonic()
        cache_key = str(bbox)
        if cache_key in self._cache and (now - self._cache_ts) < CACHE_TTL_SECONDS:
            return self._cache[cache_key]

        params: dict[str, Any] = {}
        if bbox is not None:
            min_lon, min_lat, max_lon, max_lat = bbox
            params = {
                "lamin": min_lat,
                "lomin": min_lon,
                "lamax": max_lat,
                "lomax": max_lon,
            }

        url = f"{OPENSKY_BASE}/states/all"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                kwargs: dict[str, Any] = {"params": params}
                if self._auth:
                    kwargs["auth"] = self._auth
                response = await client.get(url, **kwargs)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("OpenSky HTTP %s: %s", exc.response.status_code, url)
            return _empty_collection()
        except Exception as exc:
            logger.warning("OpenSky fetch failed: %s", exc)
            return _empty_collection()

        states = data.get("states") or []
        features = []
        for state in states:
            if not isinstance(state, list) or len(state) < 17:
                continue
            aircraft = AircraftPosition(state)
            # Skip aircraft without a valid position.
            if aircraft.longitude is None or aircraft.latitude is None:
                continue
            feature = aircraft.to_geojson_feature()
            if feature:
                features.append(feature)

        result: dict[str, Any] = {
            "type": "FeatureCollection",
            "features": features,
            "fetched_at": datetime.now(UTC).isoformat(),
            "aircraft_count": len(features),
            "source": "opensky-network.org",
            "attribution": "The OpenSky Network, https://www.opensky-network.org",
            "license_url": "https://opensky-network.org/about/terms-of-use",
        }
        self._cache[cache_key] = result
        self._cache_ts = now
        return result


def _empty_collection() -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [],
        "fetched_at": datetime.now(UTC).isoformat(),
        "aircraft_count": 0,
        "source": "opensky-network.org",
        "attribution": "The OpenSky Network, https://www.opensky-network.org",
        "license_url": "https://opensky-network.org/about/terms-of-use",
        "error": "fetch_failed",
    }
