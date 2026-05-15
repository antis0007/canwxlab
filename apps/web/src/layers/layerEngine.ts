import { useCallback, useEffect, useMemo, useState } from "react";

import type { PluginCatalogItem, WeatherLayer } from "../types/weather";

import { colorRamps } from "./colorRamps";
import { builtInPresets } from "./presets";
import { buildLayerDefinitions } from "./registry";
import {
  defaultLayerControls,
  defaultUiPreferences,
  type LayerDefinition,
  type LayerRuntimeState,
  type UiPreferences,
} from "./types";

const STORAGE_KEY_LAYER_STATE = "canwxlab.layerState.v2";
const STORAGE_KEY_LAYER_ORDER = "canwxlab.layerOrder.v2";
const STORAGE_KEY_PLUGIN_ENABLED = "canwxlab.pluginEnabled.v2";
const STORAGE_KEY_UI_PREFS = "canwxlab.uiPrefs.v2";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function defaultRuntimeState(layer: LayerDefinition): LayerRuntimeState {
  return {
    enabled: layer.defaultVisible,
    opacity: layer.defaultOpacity,
    colourRamp: layer.colourRamp,
    zIndex: layer.zIndex,
    controls: { ...defaultLayerControls, ...layer.controls },
    wmsTimePolicy: "global",
  };
}

function normalizeColourRamp(rampId: string): string {
  return colorRamps.some((ramp) => ramp.id === rampId) ? rampId : colorRamps[0].id;
}

function fallbackRuntimeState(): LayerRuntimeState {
  return {
    enabled: false,
    opacity: 0.7,
    colourRamp: "viridis-like",
    zIndex: 0,
    controls: { ...defaultLayerControls },
    wmsTimePolicy: "global",
  };
}

export function useLayerEngine(input: {
  backendLayers: WeatherLayer[];
  plugins: PluginCatalogItem[];
}) {
  const [pluginEnabled, setPluginEnabled] = useState<Record<string, boolean>>(() =>
    readJson<Record<string, boolean>>(STORAGE_KEY_PLUGIN_ENABLED, {})
  );
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() =>
    readJson<UiPreferences>(STORAGE_KEY_UI_PREFS, defaultUiPreferences)
  );

  const definitions = useMemo(
    () =>
      buildLayerDefinitions({
        backendLayers: input.backendLayers,
        plugins: input.plugins,
        pluginEnabled,
      }),
    [input.backendLayers, input.plugins, pluginEnabled]
  );

  const [runtimeState, setRuntimeState] = useState<Record<string, LayerRuntimeState>>(() =>
    readJson<Record<string, LayerRuntimeState>>(STORAGE_KEY_LAYER_STATE, {})
  );
  const [layerOrder, setLayerOrder] = useState<string[]>(() =>
    readJson<string[]>(STORAGE_KEY_LAYER_ORDER, [])
  );

  useEffect(() => {
    setRuntimeState((current) => {
      const next: Record<string, LayerRuntimeState> = {};
      definitions.forEach((layer) => {
        const existing = current[layer.id];
        next[layer.id] = existing
          ? {
              ...existing,
              colourRamp: normalizeColourRamp(existing.colourRamp),
              controls: { ...defaultLayerControls, ...existing.controls },
            }
          : defaultRuntimeState(layer);
      });
      return next;
    });

    setLayerOrder((current) => {
      const validIds = new Set(definitions.map((definition) => definition.id));
      const cleaned = current.filter((id) => validIds.has(id));
      const missing = definitions
        .map((definition) => definition.id)
        .filter((id) => !cleaned.includes(id));
      return [...cleaned, ...missing];
    });
  }, [definitions]);

  useEffect(() => {
    writeJson(STORAGE_KEY_LAYER_STATE, runtimeState);
  }, [runtimeState]);

  useEffect(() => {
    writeJson(STORAGE_KEY_LAYER_ORDER, layerOrder);
  }, [layerOrder]);

  useEffect(() => {
    writeJson(STORAGE_KEY_PLUGIN_ENABLED, pluginEnabled);
  }, [pluginEnabled]);

  useEffect(() => {
    writeJson(STORAGE_KEY_UI_PREFS, uiPreferences);
  }, [uiPreferences]);

  const orderedLayers = useMemo(() => {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    return layerOrder.map((id) => byId.get(id)).filter((value): value is LayerDefinition => Boolean(value));
  }, [definitions, layerOrder]);

  const activeLayers = useMemo(
    () =>
      orderedLayers.filter((layer) => runtimeState[layer.id]?.enabled).sort((a, b) => {
        const zA = runtimeState[a.id]?.zIndex ?? a.zIndex;
        const zB = runtimeState[b.id]?.zIndex ?? b.zIndex;
        return zA - zB;
      }),
    [orderedLayers, runtimeState]
  );

  const toggleLayer = useCallback((layerId: string) => {
    setRuntimeState((current) => ({
      ...current,
      [layerId]: {
        ...(current[layerId] ?? fallbackRuntimeState()),
        enabled: !(current[layerId]?.enabled ?? false),
      },
    }));
  }, []);

  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setRuntimeState((current) => ({
      ...current,
      [layerId]: {
        ...(current[layerId] ?? {
          ...fallbackRuntimeState(),
          opacity,
        }),
        opacity,
      },
    }));
  }, []);

  const setLayerRamp = useCallback((layerId: string, colourRamp: string) => {
    setRuntimeState((current) => ({
      ...current,
      [layerId]: {
        ...(current[layerId] ?? {
          ...fallbackRuntimeState(),
          colourRamp,
        }),
        colourRamp: normalizeColourRamp(colourRamp),
      },
    }));
  }, []);

  const setLayerControl = useCallback(
    (layerId: string, control: keyof LayerRuntimeState["controls"], value: number | string) => {
      setRuntimeState((current) => {
        const existing = current[layerId] ?? {
          ...fallbackRuntimeState(),
        };
        return {
          ...current,
          [layerId]: {
            ...existing,
            controls: {
              ...existing.controls,
              [control]: value,
            },
          },
        };
      });
    },
    []
  );

  const setWmsTimePolicy = useCallback((layerId: string, policy: "global" | "latest" | "fixed", fixedTime?: number) => {
    setRuntimeState((current) => ({
      ...current,
      [layerId]: {
        ...(current[layerId] ?? fallbackRuntimeState()),
        wmsTimePolicy: policy,
        wmsFixedTime: fixedTime,
      },
    }));
  }, []);

  const resetLayer = useCallback(
    (layerId: string) => {
      const definition = definitions.find((item) => item.id === layerId);
      if (!definition) return;
      setRuntimeState((current) => ({
        ...current,
        [layerId]: defaultRuntimeState(definition),
      }));
    },
    [definitions]
  );

  const moveLayer = useCallback((layerId: string, direction: "up" | "down") => {
    setLayerOrder((current) => {
      const index = current.indexOf(layerId);
      if (index < 0) return current;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const setPluginEnabledState = useCallback((pluginId: string, enabled: boolean) => {
    setPluginEnabled((current) => ({ ...current, [pluginId]: enabled }));
  }, []);

  const resetAllLayers = useCallback(() => {
    setRuntimeState(
      Object.fromEntries(definitions.map((definition) => [definition.id, defaultRuntimeState(definition)]))
    );
    setLayerOrder(definitions.map((definition) => definition.id));
  }, [definitions]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = builtInPresets.find(p => p.id === presetId);
    if (!preset) return;
    
    setRuntimeState(current => {
      const next = { ...current };
      definitions.forEach(def => {
        const isPresetLayer = preset.layers.includes(def.id) || 
                              preset.layers.some(p => def.id.includes(p)); // rough matching for dynamic layers
        if (!next[def.id]) {
          next[def.id] = { ...fallbackRuntimeState() };
        }
        next[def.id] = { ...next[def.id], enabled: isPresetLayer };
      });
      return next;
    });
  }, [definitions]);

  return {
    definitions,
    orderedLayers,
    activeLayers,
    runtimeState,
    layerOrder,
    toggleLayer,
    setLayerOpacity,
    setLayerRamp,
    setLayerControl,
    setWmsTimePolicy,
    moveLayer,
    resetLayer,
    resetAllLayers,
    applyPreset,
    pluginEnabled,
    setPluginEnabledState,
    uiPreferences,
    setUiPreferences,
  };
}
