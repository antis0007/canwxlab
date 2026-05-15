import type { LayerDefinition, LayerRuntimeState } from "../layers/types";

export type BasemapId = "dark" | "light" | "satellite" | "hybrid" | "terrain" | "blue_marble" | "topo_dark";

export interface BasemapOption {
  id: BasemapId;
  label: string;
  preview: string;   // CSS background for swatch
  attribution: string;
}

export const BASEMAP_OPTIONS: BasemapOption[] = [
  { id: "dark",        label: "Dark",        preview: "#0e1320", attribution: "Carto Dark" },
  { id: "light",       label: "Light",       preview: "#e3e7ed", attribution: "Carto Voyager" },
  { id: "satellite",   label: "Satellite",   preview: "#445e3a", attribution: "Esri Imagery" },
  { id: "hybrid",      label: "Hybrid",      preview: "#445e3a", attribution: "Esri + Labels" },
  { id: "terrain",     label: "Terrain",     preview: "#9aa37c", attribution: "OpenTopoMap" },
  { id: "blue_marble", label: "Blue Marble", preview: "#10243a", attribution: "NASA GIBS" },
  { id: "topo_dark",   label: "Topo Dark",   preview: "#1a2230", attribution: "Carto Voyager Dark" },
];

interface LayersPickerProps {
  basemap: BasemapId;
  onSetBasemap: (id: BasemapId) => void;
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  onToggleLayer: (layerId: string) => void;
  onSetLayerOpacity: (layerId: string, opacity: number) => void;
  customStyleConfigured: boolean;
  open: boolean;
  onSetOpen: (open: boolean) => void;
}

const LAYER_CATEGORY_ORDER = ["radar", "satellite", "forecast", "alert", "observation", "simulation"];

function CategorySection({
  title,
  layers,
  runtimeState,
  onToggleLayer,
  onSetLayerOpacity,
}: {
  title: string;
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  onToggleLayer: (id: string) => void;
  onSetLayerOpacity: (id: string, opacity: number) => void;
}) {
  if (layers.length === 0) return null;
  return (
    <div className="layers-picker-section">
      <h4>{title}</h4>
      {layers.map((layer) => {
        const runtime = runtimeState[layer.id];
        const enabled = runtime?.enabled ?? false;
        return (
          <div key={layer.id} className={`layers-picker-row ${enabled ? "is-on" : ""}`}>
            <label className="layers-picker-toggle" title={layer.description ?? layer.title}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => onToggleLayer(layer.id)}
              />
              <span className="layers-picker-name">{layer.title}</span>
              <span className={`wb-badge wb-badge-${layer.status}`}>{layer.status}</span>
            </label>
            {enabled && (
              <input
                type="range"
                className="layers-picker-opacity"
                min={0}
                max={1}
                step={0.05}
                value={runtime?.opacity ?? layer.defaultOpacity}
                onChange={(e) => onSetLayerOpacity(layer.id, Number(e.target.value))}
                title={`Opacity ${Math.round((runtime?.opacity ?? layer.defaultOpacity) * 100)}%`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LayersPicker({
  basemap,
  onSetBasemap,
  layers,
  runtimeState,
  onToggleLayer,
  onSetLayerOpacity,
  customStyleConfigured,
  open,
  onSetOpen,
}: LayersPickerProps) {
  const layersByCategory = LAYER_CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: layers.filter((l) => l.category === cat),
  }));

  return (
    <div className={`layers-picker ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="layers-picker-fab"
        onClick={() => onSetOpen(!open)}
        title={open ? "Hide layers (L)" : "Show layers (L)"}
        aria-expanded={open}
      >
        <span className="layers-picker-fab-icon" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 12 12 17 22 12"></polyline>
            <polyline points="2 17 12 22 22 17"></polyline>
          </svg>
        </span>
        <span className="layers-picker-fab-label">Layers</span>
      </button>

      {open && (
        <div className="layers-picker-panel" role="dialog" aria-label="Map layers">
          <div className="layers-picker-basemaps">
            <h4>Base map</h4>
            <div className="layers-picker-basemap-grid">
              {BASEMAP_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`layers-picker-basemap ${basemap === option.id ? "is-active" : ""}`}
                  onClick={() => onSetBasemap(option.id)}
                  disabled={customStyleConfigured}
                  title={customStyleConfigured ? "Custom VITE_MAP_STYLE_URL is active" : option.attribution}
                >
                  <span className="layers-picker-basemap-swatch" style={{ background: option.preview }} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="layers-picker-divider" />

          {layersByCategory.map(({ category, items }) => (
            <CategorySection
              key={category}
              title={category.charAt(0).toUpperCase() + category.slice(1)}
              layers={items}
              runtimeState={runtimeState}
              onToggleLayer={onToggleLayer}
              onSetLayerOpacity={onSetLayerOpacity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
