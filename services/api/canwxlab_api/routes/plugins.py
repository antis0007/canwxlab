from fastapi import APIRouter

from canwxlab_api.models import PluginCatalogResponse
from canwxlab_api.plugin_discovery import discover_plugins, find_repo_root

router = APIRouter(prefix="/api/plugins", tags=["plugins"])


@router.get("", response_model=PluginCatalogResponse)
async def list_plugins() -> PluginCatalogResponse:
    repo_root = find_repo_root()
    plugins_root = repo_root / "plugins"
    return discover_plugins(plugins_root)
