from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CanWxLab API"
    env: str = "development"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    data_mode: Literal["mock", "live", "hybrid"] = "hybrid"
    enable_live_eccc: bool = False
    eccc_ogc_api_base: str = "https://api.weather.gc.ca"
    eccc_wms_base: str = "https://geo.weather.gc.ca/geomet"
    http_timeout_seconds: float = 10.0
    cache_ttl_seconds: int = 300
    cache_dir: str = ".canwxlab/cache"

    model_config = SettingsConfigDict(
        env_prefix="CANWXLAB_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
