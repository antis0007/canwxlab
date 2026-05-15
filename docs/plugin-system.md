# Plugin System

Phase 2 implements **manifest discovery and UI state management**, not runtime plugin execution.

## Current Scope

Implemented:

- manifest scanning from `plugins/**/plugin.toml`
- TOML parsing with stdlib `tomllib`
- Pydantic validation of manifests
- malformed manifest reporting
- normalized plugin catalog route: `GET /api/plugins`
- frontend Plugin Manager panel with local enable/disable state

Not implemented yet:

- remote plugin installation
- plugin code execution/runtime sandbox
- WASM/native execution bridge

## Manifest Contract

Example:

```toml
id = "simple_condensation"
name = "Simple Condensation Physics"
version = "0.1.0"
author = "CanWxLab Core"
api_version = "0.1"
plugin_type = "physics"
safety_level = "core"
required_variables = ["temperature", "moisture", "cloud_water"]
produced_variables = ["temperature", "moisture", "cloud_water", "precipitation"]
description = "Core toy physics module."

[config_schema]
type = "object"
```

## Plugin Types

- `source`
- `layer`
- `physics`
- `diagnostic`
- `forecast`

## Safety Levels

- `core`
- `safe_wasm`
- `research_native`
- `unsafe`

## Backend Discovery Behavior

The API returns each plugin with normalized metadata:

- `id`, `name`, `version`, `author`
- `plugin_type`, `safety_level`
- `enabled_default`
- `status`: `installed | disabled | incompatible | error`
- `is_builtin`
- `contributes_layers`
- `contributes_diagnostics`
- `required_variables`, `produced_variables`
- `source_path`

Malformed manifests are skipped and returned in `errors`.

Important: discovery does not execute plugin code.

## Frontend Plugin Manager

The Plugin Manager tab supports:

- listing discovered manifests
- local enable/disable toggle (localStorage only)
- badges (`CORE`, `SAFE`, `RESEARCH`, `UNSAFE`, `BUILT-IN`, `DISABLED`)
- warning text for research/unsafe entries
- disabled placeholder install button:
  - "Plugin installation from remote sources is planned but not enabled yet."

Built-in plugin disabling in UI only affects local rendering state; it does not delete files or alter backend manifests.

## Future Runtime Rules

- diagnostic plugins should stay read-only
- source plugins must preserve attribution/provenance
- unsafe/research execution must never be enabled silently
- wasm/native runtime isolation will be introduced before execution support
