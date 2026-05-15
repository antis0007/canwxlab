from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import ValidationError

from canwxlab_api.models import (
    PluginCatalogItem,
    PluginCatalogResponse,
    PluginDiscoveryError,
    PluginInstallStatus,
    PluginManifest,
    PluginType,
    SafetyLevel,
)


def find_repo_root(start: Path | None = None) -> Path:
    cursor = (start or Path(__file__)).resolve()
    if cursor.is_file():
        cursor = cursor.parent

    for candidate in (cursor, *cursor.parents):
        if (candidate / "plugins").is_dir() and (candidate / "services").is_dir():
            return candidate

    # Fallback for local/unit contexts where the folder structure is incomplete.
    return Path(__file__).resolve().parents[3]


def discover_plugins(plugins_root: Path) -> PluginCatalogResponse:
    plugins: list[PluginCatalogItem] = []
    errors: list[PluginDiscoveryError] = []

    if not plugins_root.exists():
        errors.append(
            PluginDiscoveryError(
                source_path=str(plugins_root),
                error="plugins directory not found",
            )
        )
        return PluginCatalogResponse(plugins=plugins, errors=errors)

    manifest_paths = sorted(plugins_root.rglob("plugin.toml"))

    for manifest_path in manifest_paths:
        relative_path = _relative_to_repo(manifest_path)
        try:
            payload = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            errors.append(
                PluginDiscoveryError(
                    source_path=relative_path,
                    error=f"toml_parse_error: {type(exc).__name__}: {exc}",
                )
            )
            continue

        try:
            manifest = PluginManifest.model_validate(payload)
        except ValidationError as exc:
            errors.append(
                PluginDiscoveryError(
                    source_path=relative_path,
                    error=f"manifest_validation_error: {exc.errors()}",
                )
            )
            continue

        status = _status_from_manifest(manifest)
        plugins.append(
            PluginCatalogItem(
                **manifest.model_dump(),
                enabled_default=manifest.safety_level in {SafetyLevel.core, SafetyLevel.safe_wasm},
                source_path=relative_path,
                status=status,
                is_builtin=_is_builtin(manifest_path, plugins_root),
                contributes_layers=_contributes_layers(manifest),
                contributes_diagnostics=(manifest.plugin_type == PluginType.diagnostic),
            )
        )

    return PluginCatalogResponse(plugins=plugins, errors=errors)


def _status_from_manifest(manifest: PluginManifest) -> PluginInstallStatus:
    if manifest.api_version != "0.1":
        return PluginInstallStatus.incompatible
    if manifest.safety_level == SafetyLevel.unsafe:
        return PluginInstallStatus.disabled
    return PluginInstallStatus.installed


def _contributes_layers(manifest: PluginManifest) -> bool:
    if manifest.plugin_type == PluginType.layer:
        return True
    produced = {value.lower() for value in manifest.produced_variables}
    return any("layer" in value or "visual" in value for value in produced)


def _is_builtin(manifest_path: Path, plugins_root: Path) -> bool:
    try:
        relative = manifest_path.relative_to(plugins_root)
    except ValueError:
        return False
    return relative.parts[0].lower() == "core"


def _relative_to_repo(path: Path) -> str:
    repo_root = find_repo_root(path)
    try:
        return str(path.resolve().relative_to(repo_root)).replace("\\", "/")
    except ValueError:
        return str(path.resolve())
