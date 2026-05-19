import { Fragment, useState, useMemo, useRef, useCallback } from "react";
import { StatusBadge } from "./StatusBadge";

import { colorRamps } from "../../layers/colorRamps";
import { builtInPresets } from "../../layers/presets";
import type { LayerCategory, LayerDefinition, LayerRuntimeState, UiPreferences } from "../../layers/types";
import type { DataSource, PluginCatalogItem, VerificationMetric, SimulationRun, WeatherLayer } from "../../types/weather";
import type { DiffOverlayPayload } from "../../layers/renderers/diffBitmap";
import type { CameraState } from "../../layers/types";
import { MapControlsPanel } from "./MapControlsPanel";
import { WmsBrowser } from "./WmsBrowser";
import { SimulationControlPanel } from "./SimulationControlPanel";
import { DiffPanel } from "./DiffPanel";
import { ConsolePanel } from "./ConsolePanel";

interface LeftSidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  onToggleLayer: (layerId: string) => void;
  onSetLayerOpacity: (layerId: string, value: number) => void;
  onSetLayerRamp: (layerId: string, ramp: string) => void;
  onSetLayerControl: (
    layerId: string,
    control: keyof LayerRuntimeState["controls"],
    value: number | string,
  ) => void;
  onMoveLayer: (layerId: string, direction: "up" | "down") => void;
  onReorderLayer: (layerId: string, targetIndex: number) => void;
  onResetLayer: (layerId: string) => void;
  plugins: PluginCatalogItem[];
  pluginEnabled: Record<string, boolean>;
  onSetPluginEnabled: (pluginId: string, enabled: boolean) => void;
  sources: DataSource[];
  simulationRun: SimulationRun | null;
  isRunningSimulation: boolean;
  onRunSimulation: () => void;
  metrics: VerificationMetric[];
  uiPreferences: UiPreferences;
  onSetUiPreferences: (next: UiPreferences) => void;
  onAddDynamicLayer?: (layer: WeatherLayer) => void;
  cameraState: CameraState;
  onCameraTarget: (state: CameraState) => void;
  onSetWmsTimePolicy?: (layerId: string, policy: "timeline" | "latest" | "fixed", fixedTime?: number) => void;
  onApplyPreset?: (presetId: string) => void;
  onDiffOverlay?: (payload: DiffOverlayPayload | null) => void;
}

// ── Nav rail tab definitions ──────────────────────────────────────────────────
// Inline SVGs sized to a 16-px grid, 1.5-px strokes. Consistent stroke-based
// geometric style — workstation/GIS-console look, no native font glyphs.

interface NavTab {
  id: string;
  icon: JSX.Element;
  label: string;
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV_TABS: NavTab[] = [
  {
    id: "layers",
    label: "Layers",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Z" />
        <path d="M2.5 8 8 10.5 13.5 8" />
        <path d="M2.5 11 8 13.5 13.5 11" />
      </svg>
    ),
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" />
        <rect x="9" y="2.5" width="4.5" height="4.5" />
        <rect x="2.5" y="9" width="4.5" height="4.5" />
        <rect x="9" y="9" width="4.5" height="4.5" />
      </svg>
    ),
  },
  {
    id: "sources",
    label: "Sources",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2.5 5c0-1.4 2.5-2.5 5.5-2.5s5.5 1.1 5.5 2.5-2.5 2.5-5.5 2.5S2.5 6.4 2.5 5Z" />
        <path d="M2.5 5v6c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V5" />
        <path d="M2.5 8c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5" />
      </svg>
    ),
  },
  {
    id: "wms",
    label: "WMS Browser",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11" />
        <path d="M8 2.5c1.8 2 2.7 4 2.7 5.5s-.9 3.5-2.7 5.5c-1.8-2-2.7-4-2.7-5.5S6.2 4.5 8 2.5Z" />
      </svg>
    ),
  },
  {
    id: "camera",
    label: "Camera",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2.5 5.5h2.2L6 4h4l1.3 1.5h2.2v7.5h-11V5.5Z" />
        <circle cx="8" cy="9.25" r="2.25" />
      </svg>
    ),
  },
  {
    id: "simulation",
    label: "Simulation",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M5.5 3.5v9l7-4.5-7-4.5Z" />
      </svg>
    ),
  },
  {
    id: "verification",
    label: "Verification",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 10.5c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0" transform="translate(-0.25 -1.5)" />
        <path d="M2 10.5c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0" transform="translate(-0.25 1.5)" />
      </svg>
    ),
  },
  {
    id: "console",
    label: "Console",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2" y="3" width="12" height="10" rx="0.5" />
        <path d="M4.5 6.5 6.5 8 4.5 9.5" />
        <path d="M8 10h3.5" />
      </svg>
    ),
  },
  {
    id: "customize",
    label: "Preferences",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4" />
      </svg>
    ),
  },
];

// ── Layer category metadata ───────────────────────────────────────────────────

const CATEGORY_META: Record<LayerCategory, { label: string; order: number }> = {
  base:         { label: "Base",         order: 0 },
  forecast:     { label: "Forecast",     order: 1 },
  radar:        { label: "Radar",        order: 2 },
  satellite:    { label: "Satellite",    order: 3 },
  observation:  { label: "Observations", order: 4 },
  alert:        { label: "Alerts",       order: 5 },
  simulation:   { label: "Simulation",   order: 6 },
  diagnostic:   { label: "Diagnostics",  order: 7 },
  plugin:       { label: "Plugins",      order: 8 },
  experimental: { label: "Experimental", order: 9 },
};

// ── Layer row component (compact) ─────────────────────────────────────────────

interface LayerRowProps {
  layer: LayerDefinition;
  state: LayerRuntimeState;
  isExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onSetOpacity: (v: number) => void;
  onSetRamp: (r: string) => void;
  onSetControl: (control: keyof LayerRuntimeState["controls"], value: number | string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReset: () => void;
  onSetWmsTimePolicy?: (policy: "timeline" | "latest" | "fixed", fixedTime?: number) => void;
}

function LayerRow({
  layer,
  state,
  isExpanded,
  onToggle,
  onExpand,
  onSetOpacity,
  onSetRamp,
  onSetControl,
  onMoveUp,
  onMoveDown,
  onReset,
  onSetWmsTimePolicy,
}: LayerRowProps) {
  const rampDef = colorRamps.find((r) => r.id === state.colourRamp);

  return (
    <>
      <div className={`wb-layer-row${isExpanded ? " is-expanded" : ""}`}>
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={onToggle}
          disabled={layer.status === "unavailable"}
          title={layer.title}
        />
        <span className={`wb-layer-name ${state.enabled ? "is-enabled" : "is-disabled"}`} title={layer.title}>
          {layer.title}
        </span>
        {layer.status !== "live" && (
          <StatusBadge status={layer.status} />
        )}
        <input
          type="range"
          className="wb-layer-opacity-mini"
          min={0}
          max={1}
          step={0.05}
          value={state.opacity}
          onChange={(e) => onSetOpacity(Number(e.target.value))}
          title={`Opacity: ${Math.round(state.opacity * 100)}%`}
        />
        <button
          type="button"
          className={`wb-layer-expand-btn${isExpanded ? " open" : ""}`}
          onClick={onExpand}
          title={isExpanded ? "Collapse" : "Expand controls"}
        >
          {isExpanded ? "▲" : "▼"}
        </button>
      </div>

      {isExpanded && (
        <div className="wb-layer-details">
          {/* Description */}
          {layer.description && (
            <p className="wb-muted" style={{ margin: "0 0 3px" }}>{layer.description}</p>
          )}

          {/* Opacity */}
          <div className="wb-detail-row">
            <span className="wb-detail-label">Opacity</span>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={state.opacity}
              onChange={(e) => onSetOpacity(Number(e.target.value))}
            />
            <span style={{ fontSize: 10, color: "var(--wb-muted)", width: 28, textAlign: "right", flexShrink: 0 }}>
              {Math.round(state.opacity * 100)}%
            </span>
          </div>

          {/* Colour ramp */}
          {layer.capabilities.supportsCustomColorRamp && (
            <div className="wb-detail-row">
              <span className="wb-detail-label">Ramp</span>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <select
                  value={state.colourRamp}
                  onChange={(e) => onSetRamp(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {colorRamps.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                {rampDef?.cssGradient && (
                  <span className="wb-ramp-preview" style={{ background: rampDef.cssGradient }} />
                )}
              </div>
            </div>
          )}

          {/* Advanced controls */}
          <details className="wb-advanced-details">
            <summary className="wb-advanced-summary">Advanced Controls</summary>
            <div className="wb-advanced-grid">
              <label>Min<input type="number" value={state.controls.min} onChange={(e) => onSetControl("min", Number(e.target.value))} /></label>
              <label>Max<input type="number" value={state.controls.max} onChange={(e) => onSetControl("max", Number(e.target.value))} /></label>
              <label>Smooth<input type="range" min={0} max={1} step={0.05} value={state.controls.smoothing} onChange={(e) => onSetControl("smoothing", Number(e.target.value))} /></label>
              <label>Particles<input type="number" min={100} max={8000} step={100} value={state.controls.particleCount} onChange={(e) => onSetControl("particleCount", Number(e.target.value))} /></label>
              <label>Wind ×<input type="number" min={0.1} max={4} step={0.1} value={state.controls.windScale} onChange={(e) => onSetControl("windScale", Number(e.target.value))} /></label>
              <label>Precip ×<input type="number" min={0.1} max={4} step={0.1} value={state.controls.precipitationIntensity} onChange={(e) => onSetControl("precipitationIntensity", Number(e.target.value))} /></label>
              <label>Cloud α<input type="range" min={0} max={1} step={0.05} value={state.controls.cloudOpacity} onChange={(e) => onSetControl("cloudOpacity", Number(e.target.value))} /></label>
              <label>Contour<input type="number" min={1} max={20} step={1} value={state.controls.contourInterval} onChange={(e) => onSetControl("contourInterval", Number(e.target.value))} /></label>
              <label style={{ gridColumn: "1 / -1" }}>
                Blend
                <select value={state.controls.blendMode} onChange={(e) => onSetControl("blendMode", e.target.value)}>
                  <option value="normal">normal</option>
                  <option value="add">add</option>
                  <option value="screen">screen</option>
                  <option value="multiply">multiply</option>
                  <option value="max">max</option>
                  <option value="alpha">alpha</option>
                </select>
              </label>
              {layer.category === "satellite" && (
                <label style={{ gridColumn: "1 / -1" }}>
                  Edge Blur {(state.controls.edgeBlur ?? 0).toFixed(1)}px
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={state.controls.edgeBlur ?? 0}
                    onChange={(e) => onSetControl("edgeBlur", Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          </details>

          {/* WMS time policy */}
          {layer.serviceType === "wms" && !!layer.metadata?.time_extent && onSetWmsTimePolicy && (
            <details className="wb-advanced-details">
              <summary className="wb-advanced-summary">WMS Time Policy</summary>
              <div className="wb-advanced-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Policy
                  <select
                    value={state.wmsTimePolicy === "global" ? "latest" : state.wmsTimePolicy ?? "latest"}
                    onChange={(e) => onSetWmsTimePolicy(e.target.value as any, state.wmsFixedTime)}
                  >
                    <option value="latest">Latest Available</option>
                    <option value="timeline">Global Timeline</option>
                    <option value="fixed">Fixed Time</option>
                  </select>
                </label>
                {state.wmsTimePolicy === "fixed" && (
                  <label style={{ gridColumn: "1 / -1" }}>
                    Fixed (ms)
                    <input
                      type="number"
                      value={state.wmsFixedTime ?? Date.now()}
                      onChange={(e) => onSetWmsTimePolicy("fixed", Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="wb-detail-actions">
            <button type="button" onClick={onMoveUp} title="Move layer up">↑</button>
            <button type="button" onClick={onMoveDown} title="Move layer down">↓</button>
            <button type="button" onClick={onReset} title="Reset to defaults">Reset</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Active stack (drag-and-drop reorder, in-stack toggle) ──────────────────────

const CAT_COLORS: Record<string, string> = {
  radar: "#ff6b6b", forecast: "#4ecdc4", satellite: "#45b7d1",
  observation: "#96ceb4", alert: "#ffd93d", simulation: "#a855f7",
  diagnostic: "#6b7280", base: "#374151", plugin: "#ec4899",
  experimental: "#f97316",
};

interface ActiveStackProps {
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  onToggleLayer: (id: string) => void;
  onMoveLayer: (id: string, direction: "up" | "down") => void;
  onReorderLayer: (id: string, targetIndex: number) => void;
}

function ActiveStack({ layers, runtimeState, onToggleLayer, onMoveLayer, onReorderLayer }: ActiveStackProps) {
  const dragIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeStack = useMemo(
    () => layers.filter((layer) => runtimeState[layer.id]?.enabled).slice().reverse(),
    [layers, runtimeState],
  );

  const onDragStart = useCallback((e: React.DragEvent, layerId: string) => {
    dragIdRef.current = layerId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", layerId);
    (e.currentTarget as HTMLElement).classList.add("wb-dragging");
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add("wb-drag-over");
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("wb-drag-over");
  }, []);

  const onDrop = useCallback((e: React.DragEvent, visualIndex: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("wb-drag-over");
    const draggedId = dragIdRef.current;
    if (!draggedId) return;
    // visualIndex is top-first; layerOrder is bottom-first
    const orderIndex = activeStack.length - 1 - visualIndex;
    onReorderLayer(draggedId, orderIndex);
  }, [activeStack.length, onReorderLayer]);

  const onDragEnd = useCallback((e: React.DragEvent) => {
    dragIdRef.current = null;
    (e.currentTarget as HTMLElement).classList.remove("wb-dragging");
    containerRef.current?.querySelectorAll(".wb-drag-over").forEach((el) => el.classList.remove("wb-drag-over"));
  }, []);

  const catColor = (cat: string): string => CAT_COLORS[cat] ?? "var(--wb-muted)";

  if (activeStack.length === 0) return null;

  return (
    <div className="wb-layer-stack" aria-label="Active layer stack" ref={containerRef}>
      <div className="wb-layer-stack-head">
        <span>Active stack</span>
        <small>drag to reorder · top first</small>
      </div>
      <div className="wb-layer-stack-scroll">
        {activeStack.map((layer, visualIndex) => {
          const state = runtimeState[layer.id];
          if (!state) return null;
          const isTop = visualIndex === 0;
          const isBottom = visualIndex === activeStack.length - 1;
          return (
            <div
              key={`stack-${layer.id}`}
              className="wb-layer-stack-row"
              draggable
              onDragStart={(e) => onDragStart(e, layer.id)}
              onDragOver={onDragOver}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, visualIndex)}
              onDragEnd={onDragEnd}
            >
              <span className="wb-stack-grip" aria-hidden="true" />
              <input
                type="checkbox"
                className="wb-stack-toggle"
                checked={state.enabled}
                onChange={() => onToggleLayer(layer.id)}
                title={`Toggle ${layer.title}`}
              />
              <span className="wb-stack-dot" style={{ backgroundColor: catColor(layer.category) }} />
              <span className="wb-layer-stack-index">{activeStack.length - visualIndex}</span>
              <span className="wb-layer-stack-name" title={layer.title}>{layer.title}</span>
              <button type="button" className="wb-stack-btn" onClick={() => onMoveLayer(layer.id, "up")} title="Move toward top" disabled={isTop}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2v6M2 5l3-3 3 3"/></svg>
              </button>
              <button type="button" className="wb-stack-btn" onClick={() => onMoveLayer(layer.id, "down")} title="Move toward basemap" disabled={isBottom}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 8v-6M2 5l3 3 3-3"/></svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Layer tab ─────────────────────────────────────────────────────────────────

interface LayerTabProps {
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  onToggleLayer: (id: string) => void;
  onSetLayerOpacity: (id: string, v: number) => void;
  onSetLayerRamp: (id: string, r: string) => void;
  onSetLayerControl: (id: string, c: keyof LayerRuntimeState["controls"], v: number | string) => void;
  onMoveLayer: (id: string, d: "up" | "down") => void;
  onReorderLayer: (id: string, targetIndex: number) => void;
  onResetLayer: (id: string) => void;
  onApplyPreset?: (id: string) => void;
  onSetWmsTimePolicy?: (layerId: string, policy: "timeline" | "latest" | "fixed", fixedTime?: number) => void;
}

function LayerTab({
  layers,
  runtimeState,
  onToggleLayer,
  onSetLayerOpacity,
  onSetLayerRamp,
  onSetLayerControl,
  onMoveLayer,
  onReorderLayer,
  onResetLayer,
  onApplyPreset,
  onSetWmsTimePolicy,
}: LayerTabProps) {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());

  const toggleGroup = (cat: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleLayerExpand = (id: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredLayers = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? layers.filter((l) => l.title.toLowerCase().includes(q) || l.category.includes(q))
      : layers;
  }, [layers, search]);

  // Group by category, sorted by category order then zIndex
  const groups = useMemo(() => {
    const map = new Map<LayerCategory, LayerDefinition[]>();
    for (const layer of filteredLayers) {
      const cat = layer.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(layer);
    }
    return [...map.entries()].sort(
      ([a], [b]) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99),
    );
  }, [filteredLayers]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Search */}
      <div className="wb-layer-search">
        <input
          type="search"
          placeholder="Filter layers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Presets */}
      {builtInPresets.length > 0 && (
        <div className="wb-presets-bar">
          <span style={{ fontSize: 9, color: "var(--wb-muted)", alignSelf: "center", marginRight: 2, letterSpacing: "0.06em", textTransform: "uppercase" }}>Preset</span>
          {builtInPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onApplyPreset?.(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <ActiveStack
        layers={layers}
        runtimeState={runtimeState}
        onToggleLayer={onToggleLayer}
        onMoveLayer={onMoveLayer}
        onReorderLayer={onReorderLayer}
      />

      {/* Layer groups */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ flex: 1 }}>
          {groups.map(([cat, catLayers]) => {
            const meta = CATEGORY_META[cat] ?? { label: cat, order: 99 };
            const isCollapsed = collapsedGroups.has(cat);
            return (
              <div key={cat} className="wb-layer-group">
                <div
                  className="wb-layer-group-header"
                  onClick={() => toggleGroup(cat)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleGroup(cat)}
                >
                  <span className={`wb-group-chevron${isCollapsed ? "" : " open"}`}>▶</span>
                  <span className="wb-group-label">{meta.label}</span>
                  <span className="wb-group-count">{catLayers.length}</span>
                </div>
                {!isCollapsed && catLayers.map((layer) => {
                  const state = runtimeState[layer.id];
                  if (!state) return null;
                  return (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      state={state}
                      isExpanded={expandedLayers.has(layer.id)}
                      onToggle={() => onToggleLayer(layer.id)}
                      onExpand={() => toggleLayerExpand(layer.id)}
                      onSetOpacity={(v) => onSetLayerOpacity(layer.id, v)}
                      onSetRamp={(r) => onSetLayerRamp(layer.id, r)}
                      onSetControl={(c, v) => onSetLayerControl(layer.id, c, v)}
                      onMoveUp={() => onMoveLayer(layer.id, "up")}
                      onMoveDown={() => onMoveLayer(layer.id, "down")}
                      onReset={() => onResetLayer(layer.id)}
                      onSetWmsTimePolicy={
                        onSetWmsTimePolicy
                          ? (policy, fixedTime) => onSetWmsTimePolicy(layer.id, policy, fixedTime)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            );
          })}
          {groups.length === 0 && (
            <p className="wb-muted" style={{ padding: "12px 8px" }}>No layers match "{search}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plugin tab ────────────────────────────────────────────────────────────────

function PluginTab({ plugins, pluginEnabled, onSetPluginEnabled }: Pick<LeftSidebarProps, "plugins" | "pluginEnabled" | "onSetPluginEnabled">) {
  return (
    <div className="wb-scroll-panel">
      {plugins.length === 0 && (
        <p className="wb-muted">No plugins discovered.</p>
      )}
      {plugins.map((plugin) => {
        const enabled = pluginEnabled[plugin.id] ?? plugin.enabled_default;
        return (
          <div key={plugin.id} className="wb-panel-block">
            <div className="wb-row-between">
              <strong style={{ fontSize: 11 }}>{plugin.name}</strong>
              <StatusBadge status={plugin.status === "installed" ? "live" : "unavailable"} label={plugin.status.toUpperCase()} />
            </div>
            <p className="wb-muted" style={{ margin: "3px 0" }}>{plugin.description}</p>
            <div className="wb-chip-row">
              {plugin.is_builtin && <span className="wb-chip">BUILT-IN</span>}
              <span className="wb-chip">{plugin.plugin_type}</span>
              <span className="wb-chip">{plugin.safety_level}</span>
            </div>
            <label className="wb-inline-toggle" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onSetPluginEnabled(plugin.id, e.target.checked)}
              />
              Enable
            </label>
            {(plugin.safety_level === "unsafe" || plugin.safety_level === "research_native") && (
              <p className="wb-warning" style={{ marginTop: 3 }}>Runtime execution disabled in this build.</p>
            )}
          </div>
        );
      })}
      <div style={{ padding: "6px 0" }}>
        <button type="button" disabled title="Plugin installation planned">Install Plugin (Planned)</button>
      </div>
    </div>
  );
}

// ── Sources tab ───────────────────────────────────────────────────────────────

function SourceTab({ sources }: Pick<LeftSidebarProps, "sources">) {
  return (
    <div className="wb-scroll-panel">
      {sources.map((source) => (
        <div key={source.source_id} className="wb-panel-block">
          <div className="wb-row-between">
            <strong style={{ fontSize: 11 }}>{source.name}</strong>
            <StatusBadge status={source.status} />
          </div>
          <p className="wb-muted" style={{ margin: "3px 0" }}>{source.message || source.description}</p>
          <p className="wb-muted">Last OK: {source.last_successful_fetch ? new Date(source.last_successful_fetch).toLocaleTimeString() : "—"}</p>
          {source.attribution && <p className="wb-muted" style={{ marginTop: 2 }}>{source.attribution}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Preferences tab ───────────────────────────────────────────────────────────

function PreferencesTab({ uiPreferences, onSetUiPreferences }: Pick<LeftSidebarProps, "uiPreferences" | "onSetUiPreferences">) {
  const prefs = uiPreferences;
  const set = (patch: Partial<typeof prefs>) => onSetUiPreferences({ ...prefs, ...patch });

  return (
    <div className="wb-scroll-panel">
      <div className="wb-panel-block">
        <strong style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--wb-muted)" }}>Display</strong>
        <label className="wb-inline-toggle" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={prefs.compactMode} onChange={(e) => set({ compactMode: e.target.checked })} />
          Compact mode
        </label>
        <label className="wb-inline-toggle" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={prefs.photorealisticGlobe ?? false} onChange={(e) => set({ photorealisticGlobe: e.target.checked })} />
          Experimental space backdrop
        </label>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            Theme
            <select value={prefs.theme} onChange={(e) => set({ theme: e.target.value as typeof prefs.theme })} style={{ flex: 1 }}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            Accent
            <input type="color" value={prefs.accentColor} onChange={(e) => set({ accentColor: e.target.value })} style={{ width: 36, padding: "1px 2px" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            Map style
            <select value={prefs.mapBackgroundStyle} onChange={(e) => set({ mapBackgroundStyle: e.target.value as typeof prefs.mapBackgroundStyle })} style={{ flex: 1 }}>
              <option value="default">Default</option>
              <option value="muted">Muted</option>
              <option value="high-contrast">High Contrast</option>
            </select>
          </label>
        </div>
      </div>

      <div className="wb-panel-block">
        <strong style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--wb-muted)" }}>Units</strong>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          {(
            [
              { key: "temperature" as const, label: "Temperature", opts: ["C", "F", "K"] },
              { key: "wind" as const,        label: "Wind",        opts: ["m/s", "km/h", "knots"] },
              { key: "pressure" as const,    label: "Pressure",    opts: ["hPa", "Pa"] },
              { key: "precipitation" as const, label: "Precip",    opts: ["mm", "in"] },
            ] as const
          ).map(({ key, label, opts }) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              {label}
              <select
                value={prefs.units[key]}
                onChange={(e) => set({ units: { ...prefs.units, [key]: e.target.value } })}
                style={{ flex: 1 }}
              >
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

const TAB_TITLES: Record<string, string> = {
  layers:       "Layers",
  plugins:      "Plugin Manager",
  sources:      "Data Sources",
  wms:          "WMS Browser",
  camera:       "Camera & Navigation",
  simulation:   "Simulation",
  verification: "Verification",
  console:      "Console",
  customize:    "Preferences",
};

export function LeftSidebar(props: LeftSidebarProps) {
  return (
    <aside className="wb-left-panel">
      {/* Vertical nav rail */}
      <nav className="wb-nav-rail" aria-label="Panel navigation">
        {NAV_TABS.map((tab, idx) => {
          const isActive = props.activeTab === tab.id;
          // Small divider before the last group
          const addDivider = idx === NAV_TABS.length - 2;
          return (
            <Fragment key={tab.id}>
              {addDivider && <div className="wb-nav-divider" />}
              <button
                type="button"
                className={`wb-nav-btn${isActive ? " active" : ""}`}
                onClick={() => props.onTabChange(tab.id)}
                data-label={tab.label}
                title={tab.label}
                aria-pressed={isActive}
              >
                {tab.icon}
              </button>
            </Fragment>
          );
        })}
      </nav>

      {/* Panel content */}
      <div className="wb-panel-content">
        <div className="wb-panel-title">{TAB_TITLES[props.activeTab] ?? props.activeTab}</div>

        {props.activeTab === "layers" && (
          <LayerTab
            layers={props.layers}
            runtimeState={props.runtimeState}
            onToggleLayer={props.onToggleLayer}
            onSetLayerOpacity={props.onSetLayerOpacity}
            onSetLayerRamp={props.onSetLayerRamp}
            onSetLayerControl={props.onSetLayerControl}
            onMoveLayer={props.onMoveLayer}
            onReorderLayer={props.onReorderLayer}
            onResetLayer={props.onResetLayer}
            onApplyPreset={props.onApplyPreset}
            onSetWmsTimePolicy={props.onSetWmsTimePolicy}
          />
        )}

        {props.activeTab === "plugins" && (
          <PluginTab
            plugins={props.plugins}
            pluginEnabled={props.pluginEnabled}
            onSetPluginEnabled={props.onSetPluginEnabled}
          />
        )}

        {props.activeTab === "sources" && (
          <SourceTab sources={props.sources} />
        )}

        {props.activeTab === "wms" && props.onAddDynamicLayer && (
          <WmsBrowser onAddLayer={props.onAddDynamicLayer} />
        )}

        {props.activeTab === "camera" && (
          <MapControlsPanel cameraState={props.cameraState} onCameraTarget={props.onCameraTarget} />
        )}

        {props.activeTab === "simulation" && (
          <SimulationControlPanel
            simulationRun={props.simulationRun}
            isRunning={props.isRunningSimulation}
            onRun={props.onRunSimulation}
          />
        )}

        {props.activeTab === "verification" && (
          <DiffPanel metrics={props.metrics} onDiffOverlay={props.onDiffOverlay} />
        )}

        {props.activeTab === "console" && <ConsolePanel />}

        {props.activeTab === "customize" && (
          <PreferencesTab
            uiPreferences={props.uiPreferences}
            onSetUiPreferences={props.onSetUiPreferences}
          />
        )}
      </div>
    </aside>
  );
}
