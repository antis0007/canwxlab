from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class FetchResult:
    payload: Any
    retrieved_at: datetime
    expires_at: datetime
    source_url: str
    attempted_at: datetime
    from_cache: bool
    stale: bool
    live_fetch_succeeded: bool
    error_type: str | None = None
    error_message: str | None = None


class JsonFileCacheClient:
    def __init__(
        self,
        cache_dir: Path,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._cache_dir = cache_dir
        self._timeout_seconds = timeout_seconds
        self._client = client
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    async def fetch_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        ttl_seconds: int = 300,
        allow_stale_on_error: bool = True,
    ) -> FetchResult:
        return await self._fetch(
            url=url,
            params=params,
            ttl_seconds=ttl_seconds,
            allow_stale_on_error=allow_stale_on_error,
            parser=lambda response: response.json(),
        )

    async def fetch_text(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        ttl_seconds: int = 300,
        allow_stale_on_error: bool = True,
    ) -> FetchResult:
        return await self._fetch(
            url=url,
            params=params,
            ttl_seconds=ttl_seconds,
            allow_stale_on_error=allow_stale_on_error,
            parser=lambda response: response.text,
        )

    async def _fetch(
        self,
        url: str,
        params: dict[str, Any] | None,
        ttl_seconds: int,
        allow_stale_on_error: bool,
        parser: Callable[[httpx.Response], Any],
    ) -> FetchResult:
        normalized_params = _normalize_params(params)
        cache_path = self._cache_path(url, normalized_params)
        now = datetime.now(UTC)
        cached_entry = _read_cache_entry(cache_path)

        if cached_entry and cached_entry["expires_at"] > now:
            logger.info(
                "cache_hit",
                extra={
                    "event": "cache_hit",
                    "source_url": url,
                    "cache_key": cache_path.stem,
                },
            )
            return FetchResult(
                payload=cached_entry["payload"],
                retrieved_at=cached_entry["retrieved_at"],
                expires_at=cached_entry["expires_at"],
                source_url=cached_entry["source_url"],
                attempted_at=now,
                from_cache=True,
                stale=False,
                live_fetch_succeeded=False,
            )

        logger.info(
            "cache_miss",
            extra={
                "event": "cache_miss",
                "source_url": url,
                "cache_key": cache_path.stem,
            },
        )

        attempted_at = datetime.now(UTC)
        try:
            payload = await self._request(url, normalized_params, parser)
            retrieved_at = datetime.now(UTC)
            expires_at = retrieved_at + timedelta(seconds=ttl_seconds)
            source_url = _build_source_url(url, normalized_params)
            _write_cache_entry(
                cache_path,
                {
                    "retrieved_at": retrieved_at,
                    "expires_at": expires_at,
                    "source_url": source_url,
                    "payload": payload,
                },
            )
            logger.info(
                "live_fetch_success",
                extra={
                    "event": "live_fetch_success",
                    "source_url": url,
                    "cache_key": cache_path.stem,
                },
            )
            return FetchResult(
                payload=payload,
                retrieved_at=retrieved_at,
                expires_at=expires_at,
                source_url=source_url,
                attempted_at=attempted_at,
                from_cache=False,
                stale=False,
                live_fetch_succeeded=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "live_fetch_failed",
                extra={
                    "event": "live_fetch_failed",
                    "source_url": url,
                    "cache_key": cache_path.stem,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                },
            )
            if cached_entry and allow_stale_on_error:
                logger.info(
                    "stale_cache_used",
                    extra={
                        "event": "stale_cache_used",
                        "source_url": url,
                        "cache_key": cache_path.stem,
                    },
                )
                return FetchResult(
                    payload=cached_entry["payload"],
                    retrieved_at=cached_entry["retrieved_at"],
                    expires_at=cached_entry["expires_at"],
                    source_url=cached_entry["source_url"],
                    attempted_at=attempted_at,
                    from_cache=True,
                    stale=True,
                    live_fetch_succeeded=False,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
            raise

    async def _request(
        self,
        url: str,
        params: dict[str, Any],
        parser: Callable[[httpx.Response], Any],
    ) -> Any:
        if self._client is not None:
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return parser(response)

        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return parser(response)

    def _cache_path(self, url: str, params: dict[str, Any]) -> Path:
        serialized = json.dumps(
            {
                "url": url,
                "params": params,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        cache_key = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        return self._cache_dir / f"{cache_key}.json"


def _normalize_params(params: dict[str, Any] | None) -> dict[str, Any]:
    if not params:
        return {}
    normalized: dict[str, Any] = {}
    for key in sorted(params):
        value = params[key]
        if value is None:
            continue
        normalized[key] = value
    return normalized


def _build_source_url(url: str, params: dict[str, Any]) -> str:
    if not params:
        return url
    query = "&".join(f"{key}={params[key]}" for key in sorted(params))
    return f"{url}?{query}"


def _read_cache_entry(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None

    try:
        return {
            "retrieved_at": datetime.fromisoformat(raw["retrieved_at"]),
            "expires_at": datetime.fromisoformat(raw["expires_at"]),
            "source_url": raw["source_url"],
            "payload": raw["payload"],
        }
    except Exception:  # noqa: BLE001
        return None


def _write_cache_entry(path: Path, entry: dict[str, Any]) -> None:
    serializable = {
        "retrieved_at": entry["retrieved_at"].isoformat(),
        "expires_at": entry["expires_at"].isoformat(),
        "source_url": entry["source_url"],
        "payload": entry["payload"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(serializable, ensure_ascii=True), encoding="utf-8")
