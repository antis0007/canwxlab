from pathlib import Path

from fastapi.testclient import TestClient

from canwxlab_api.main import app
from canwxlab_api.plugin_discovery import discover_plugins

client = TestClient(app)


def test_discover_valid_plugin_manifest(tmp_path: Path) -> None:
    plugins_root = tmp_path / "plugins"
    manifest_dir = plugins_root / "core" / "layers" / "demo"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "plugin.toml").write_text(
        """
id = "demo_layer"
name = "Demo Layer"
version = "0.1.0"
author = "CanWxLab"
api_version = "0.1"
plugin_type = "layer"
safety_level = "core"
required_variables = ["temperature"]
produced_variables = ["demo_layer"]
description = "Demo layer plugin"

[config_schema]
type = "object"
""".strip(),
        encoding="utf-8",
    )

    catalog = discover_plugins(plugins_root)

    assert len(catalog.plugins) == 1
    plugin = catalog.plugins[0]
    assert plugin.id == "demo_layer"
    assert plugin.is_builtin is True
    assert plugin.contributes_layers is True
    assert plugin.status == "installed"
    assert catalog.errors == []


def test_discover_malformed_manifest_is_reported(tmp_path: Path) -> None:
    plugins_root = tmp_path / "plugins"
    manifest_dir = plugins_root / "ext" / "broken"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "plugin.toml").write_text(
        """
id = "broken_plugin"
name = "Broken Plugin"
# missing required fields
""".strip(),
        encoding="utf-8",
    )

    catalog = discover_plugins(plugins_root)

    assert len(catalog.plugins) == 0
    assert len(catalog.errors) == 1
    assert "manifest_validation_error" in catalog.errors[0].error


def test_plugins_route_returns_catalog() -> None:
    response = client.get("/api/plugins")
    assert response.status_code == 200
    payload = response.json()
    assert "plugins" in payload
    assert "errors" in payload
    assert isinstance(payload["plugins"], list)
    assert len(payload["plugins"]) >= 1
