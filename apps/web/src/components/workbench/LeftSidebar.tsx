import { PanelTabs, type PanelTab } from "./PanelTabs";
import { StatusBadge } from "./StatusBadge";

import { colorRamps } from "../../layers/colorRamps";
import type { LayerDefinition, LayerRuntimeState, UiPreferences } from "../../layers/types";
import type { DataSource, PluginCatalogItem, VerificationMetric, SimulationRun, WeatherLayer } from "../../types/weather";
import type { CameraState } from "../../layers/types";
import { MapControlsPanel } from "./MapControlsPanel";
import { WmsBrowser } from "./WmsBrowser";
import { SimulationControlPanel } from "./SimulationControlPanel";
import { DiffPanel } from "./DiffPanel";

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
}

const tabs: PanelTab[] = [
  { id: "layers", label: "Layers" },
  { id: "plugins", label: "Plugin Manager" },
  { id: "sources", label: "Sources" },
  { id: "wms", label: "WMS Browser" },
  { id: "camera", label: "Camera" },
  { id: "simulation", label: "Simulation" },
  { id: "verification", label: "Verification" },
  { id: "customize", label: "Preferences" },
];

function renderLayerTab(props: LeftSidebarProps) {
  return (
    <div className="wb-scroll-panel">
      {props.layers.map((layer) => {
        const state = props.runtimeState[layer.id];
        if (!state) return null;
        return (
          <article key={layer.id} className="wb-layer-card">
            <div className="wb-row-between">
              <label className="wb-layer-toggle">
                <input
                  type="checkbox"
                  checked={state.enabled}
                  onChange={() => props.onToggleLayer(layer.id)}
                  disabled={layer.status === "unavailable"}
                />
                <span>{layer.title}</span>
              </label>
              <StatusBadge status={layer.status} />
            </div>
            <p className="wb-muted">{layer.description}</p>
            <div className="wb-chip-row">
              <span className="wb-chip">{layer.category}</span>
              <span className="wb-chip">{layer.rendererType}</span>
              <span className="wb-chip">{layer.capabilities.supportsGlobe ? "globe" : "map-only"}</span>
              {layer.isExperimental && <StatusBadge status="experimental" label="EXPERIMENTAL" />}
            </div>
            <label>
              Opacity {Math.round(state.opacity * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={state.opacity}
                onChange={(event) => props.onSetLayerOpacity(layer.id, Number(event.target.value))}
              />
            </label>
            <label>
              Colour Ramp
              <select
                value={state.colourRamp}
                onChange={(event) => props.onSetLayerRamp(layer.id, event.target.value)}
              >
                {colorRamps.map((ramp) => (
                  <option key={ramp.id} value={ramp.id}>{ramp.label}</option>
                ))}
              </select>
              <span className="wb-ramp-preview" style={{ background: colorRamps.find((r) => r.id === state.colourRamp)?.cssGradient }} />
            </label>
            <details className="wb-layer-controls">
              <summary>Advanced Controls</summary>
              <div className="wb-layer-controls-grid">
                <label>
                  Min
                  <input
                    type="number"
                    value={state.controls.min}
                    onChange={(event) => props.onSetLayerControl(layer.id, "min", Number(event.target.value))}
                  />
                </label>
                <label>
                  Max
                  <input
                    type="number"
                    value={state.controls.max}
                    onChange={(event) => props.onSetLayerControl(layer.id, "max", Number(event.target.value))}
                  />
                </label>
                <label>
                  Smoothing
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={state.controls.smoothing}
                    onChange={(event) => props.onSetLayerControl(layer.id, "smoothing", Number(event.target.value))}
                  />
                </label>
                <label>
                  Particle Count
                  <input
                    type="number"
                    min={100}
                    max={8000}
                    step={100}
                    value={state.controls.particleCount}
                    onChange={(event) => props.onSetLayerControl(layer.id, "particleCount", Number(event.target.value))}
                  />
                </label>
                <label>
                  Wind Scale
                  <input
                    type="number"
                    min={0.1}
                    max={4}
                    step={0.1}
                    value={state.controls.windScale}
                    onChange={(event) => props.onSetLayerControl(layer.id, "windScale", Number(event.target.value))}
                  />
                </label>
                <label>
                  Precip Intensity
                  <input
                    type="number"
                    min={0.1}
                    max={4}
                    step={0.1}
                    value={state.controls.precipitationIntensity}
                    onChange={(event) => props.onSetLayerControl(layer.id, "precipitationIntensity", Number(event.target.value))}
                  />
                </label>
                <label>
                  Cloud Opacity
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={state.controls.cloudOpacity}
                    onChange={(event) => props.onSetLayerControl(layer.id, "cloudOpacity", Number(event.target.value))}
                  />
                </label>
                <label>
                  Contour Interval
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    value={state.controls.contourInterval}
                    onChange={(event) => props.onSetLayerControl(layer.id, "contourInterval", Number(event.target.value))}
                  />
                </label>
                <label>
                  Blend Mode
                  <select
                    value={state.controls.blendMode}
                    onChange={(event) => props.onSetLayerControl(layer.id, "blendMode", event.target.value)}
                  >
                    <option value="normal">normal</option>
                    <option value="additive">additive</option>
                    <option value="multiply">multiply</option>
                    <option value="screen">screen</option>
                  </select>
                </label>
              </div>
            </details>
            <div className="wb-row-between">
              <button type="button" onClick={() => props.onMoveLayer(layer.id, "up")}>Up</button>
              <button type="button" onClick={() => props.onMoveLayer(layer.id, "down")}>Down</button>
              <button type="button" onClick={() => props.onResetLayer(layer.id)}>Reset</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function safetyBadgeLabel(level: PluginCatalogItem["safety_level"]): string {
  if (level === "core") return "CORE";
  if (level === "safe_wasm") return "SAFE";
  if (level === "research_native") return "RESEARCH";
  return "UNSAFE";
}

function renderPluginTab(props: LeftSidebarProps) {
  return (
    <div className="wb-scroll-panel">
      {props.plugins.map((plugin) => {
        const enabled = props.pluginEnabled[plugin.id] ?? plugin.enabled_default;
        return (
          <article key={plugin.id} className="wb-layer-card">
            <div className="wb-row-between">
              <strong>{plugin.name}</strong>
              <StatusBadge status={plugin.status === "installed" ? "live" : "unavailable"} label={plugin.status.toUpperCase()} />
            </div>
            <p className="wb-muted">{plugin.description}</p>
            <div className="wb-chip-row">
              {plugin.is_builtin && <span className="wb-chip">BUILT-IN</span>}
              <span className="wb-chip">{plugin.plugin_type.toUpperCase()}</span>
              <span className="wb-chip">{safetyBadgeLabel(plugin.safety_level)}</span>
              {(!enabled) && <span className="wb-chip">DISABLED</span>}
            </div>
            <label className="wb-inline-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => props.onSetPluginEnabled(plugin.id, event.target.checked)}
              />
              Enable plugin manifest
            </label>
            {plugin.safety_level === "unsafe" || plugin.safety_level === "research_native" ? (
              <p className="wb-warning">Research/unsafe plugin: execution runtime is disabled in this phase.</p>
            ) : null}
          </article>
        );
      })}
      <button type="button" disabled title="Plugin installation from remote sources is planned but not enabled yet.">
        Install Plugin (Planned)
      </button>
      <p className="wb-muted">Plugin installation from remote sources is planned but not enabled yet.</p>
    </div>
  );
}

function renderSourceTab(props: LeftSidebarProps) {
  return (
    <div className="wb-scroll-panel">
      {props.sources.map((source) => (
        <article key={source.source_id} className="wb-layer-card">
          <div className="wb-row-between">
            <strong>{source.name}</strong>
            <StatusBadge status={source.status} />
          </div>
          <p className="wb-muted">{source.message || source.description}</p>
          <p className="wb-muted">Last success: {source.last_successful_fetch ? new Date(source.last_successful_fetch).toLocaleString() : "n/a"}</p>
          <p className="wb-muted">Last attempt: {source.last_attempted_fetch ? new Date(source.last_attempted_fetch).toLocaleString() : "n/a"}</p>
          <small>{source.attribution}</small>
        </article>
      ))}
    </div>
  );
}

function renderSimulationTab(props: LeftSidebarProps) {
  return (
    <SimulationControlPanel
      simulationRun={props.simulationRun}
      isRunning={props.isRunningSimulation}
      onRun={props.onRunSimulation}
    />
  );
}

function renderVerificationTab(props: LeftSidebarProps) {
  return <DiffPanel metrics={props.metrics} />;
}

function renderCustomizationTab(props: LeftSidebarProps) {
  const preferences = props.uiPreferences;
  return (
    <div className="wb-scroll-panel">
      <label className="wb-inline-toggle">
        <input
          type="checkbox"
          checked={preferences.compactMode}
          onChange={(event) => props.onSetUiPreferences({ ...preferences, compactMode: event.target.checked })}
        />
        Compact mode
      </label>

      <label>
        Theme
        <select
          value={preferences.theme}
          onChange={(event) => props.onSetUiPreferences({ ...preferences, theme: event.target.value as UiPreferences["theme"] })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </label>

      <label>
        Accent
        <input
          type="color"
          value={preferences.accentColor}
          onChange={(event) => props.onSetUiPreferences({ ...preferences, accentColor: event.target.value })}
        />
      </label>

      <label>
        Map background
        <select
          value={preferences.mapBackgroundStyle}
          onChange={(event) =>
            props.onSetUiPreferences({
              ...preferences,
              mapBackgroundStyle: event.target.value as UiPreferences["mapBackgroundStyle"],
            })
          }
        >
          <option value="default">Default</option>
          <option value="muted">Muted</option>
          <option value="high-contrast">High Contrast</option>
        </select>
      </label>

      <label>
        Temperature Unit
        <select
          value={preferences.units.temperature}
          onChange={(event) =>
            props.onSetUiPreferences({
              ...preferences,
              units: { ...preferences.units, temperature: event.target.value as UiPreferences["units"]["temperature"] },
            })
          }
        >
          <option value="C">C</option>
          <option value="F">F</option>
          <option value="K">K</option>
        </select>
      </label>

      <label>
        Wind Unit
        <select
          value={preferences.units.wind}
          onChange={(event) =>
            props.onSetUiPreferences({
              ...preferences,
              units: { ...preferences.units, wind: event.target.value as UiPreferences["units"]["wind"] },
            })
          }
        >
          <option value="m/s">m/s</option>
          <option value="km/h">km/h</option>
          <option value="knots">knots</option>
        </select>
      </label>

      <label>
        Pressure Unit
        <select
          value={preferences.units.pressure}
          onChange={(event) =>
            props.onSetUiPreferences({
              ...preferences,
              units: { ...preferences.units, pressure: event.target.value as UiPreferences["units"]["pressure"] },
            })
          }
        >
          <option value="hPa">hPa</option>
          <option value="Pa">Pa</option>
        </select>
      </label>

      <label>
        Precipitation Unit
        <select
          value={preferences.units.precipitation}
          onChange={(event) =>
            props.onSetUiPreferences({
              ...preferences,
              units: {
                ...preferences.units,
                precipitation: event.target.value as UiPreferences["units"]["precipitation"],
              },
            })
          }
        >
          <option value="mm">mm</option>
          <option value="in">in</option>
        </select>
      </label>
    </div>
  );
}

export function LeftSidebar(props: LeftSidebarProps) {
  return (
    <aside className="wb-left-panel">
      <PanelTabs tabs={tabs} activeTab={props.activeTab} onChange={props.onTabChange} />
      {props.activeTab === "layers" && renderLayerTab(props)}
      {props.activeTab === "plugins" && renderPluginTab(props)}
      {props.activeTab === "sources" && renderSourceTab(props)}
      {props.activeTab === "wms" && props.onAddDynamicLayer && <WmsBrowser onAddLayer={props.onAddDynamicLayer} />}
      {props.activeTab === "camera" && <MapControlsPanel cameraState={props.cameraState} onCameraTarget={props.onCameraTarget} />}
      {props.activeTab === "simulation" && renderSimulationTab(props)}
      {props.activeTab === "verification" && renderVerificationTab(props)}
      {props.activeTab === "customize" && renderCustomizationTab(props)}
    </aside>
  );
}
