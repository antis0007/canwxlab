import { useCallback, useEffect, useState, useMemo } from "react";
import { api } from "../../lib/api";
import { WeatherLayer, WmsCapabilityLayerSummary } from "../../types/weather";

interface WmsBrowserProps {
  onAddLayer: (layer: WeatherLayer) => void;
}

const CATEGORIES = ["radar", "satellite", "model", "precipitation", "temperature", "wind", "cloud", "alert"];

export function WmsBrowser({ onAddLayer }: WmsBrowserProps) {
  const [layers, setLayers] = useState<WmsCapabilityLayerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("");
  const [hasTime, setHasTime] = useState(false);
  const [hasLegend, setHasLegend] = useState(false);
  const [isQueryable, setIsQueryable] = useState(false);

  useEffect(() => {
    async function fetchLayers() {
      setLoading(true);
      try {
        const result = await api.wmsLayers();
        setLayers(result);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchLayers();
  }, []);

  const handleAddLayer = useCallback(async (layerInfo: WmsCapabilityLayerSummary) => {
    const newLayer: WeatherLayer = {
      layer_id: `wms_${layerInfo.layer_name}`,
      name: layerInfo.title || layerInfo.layer_name,
      title: layerInfo.title || layerInfo.layer_name,
      kind: "raster",
      variable: "wms_layer",
      unit: "none",
      source_id: "eccc_geomet_wms",
      status: "live",
      adapter: "eccc_geomet",
      service_type: "wms",
      attribution: "ECCC",
      description: layerInfo.abstract || `WMS layer ${layerInfo.layer_name}`,
      default_opacity: 0.8,
      color_ramps: [],
      styles: layerInfo.styles || [],
      wms_base_url: "https://geo.weather.gc.ca/geomet",
      wms_layer_name: layerInfo.layer_name,
      time_dimension_supported: layerInfo.has_time_dimension,
      legend_url: layerInfo.legend_url,
      metadata: {},
      is_live: true,
      is_experimental: false,
      last_updated: null,
      last_successful_fetch: null,
      last_attempted_fetch: null,
      retrieved_at: null,
      expires_at: null,
      license_url: null,
      homepage_url: null,
      error_type: null,
      min_zoom: null,
      max_zoom: null,
      update_frequency_hint: null,
      message: ""
    };
    onAddLayer(newLayer);
  }, [onAddLayer]);

  const filteredLayers = useMemo(() => {
    return layers.filter((l) => {
      const text = `${l.layer_name} ${l.title || ""} ${l.abstract || ""}`.toLowerCase();
      if (searchTerm && !text.includes(searchTerm.toLowerCase())) return false;
      if (category && !text.includes(category)) return false;
      if (hasTime && !l.has_time_dimension) return false;
      if (hasLegend && !l.legend_url) return false;
      if (isQueryable && !l.queryable) return false;
      return true;
    });
  }, [layers, searchTerm, category, hasTime, hasLegend, isQueryable]);

  const copyUrl = (layerName: string) => {
    const url = `https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetMap&layers=${layerName}&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="wb-scroll-panel">
      <h3>WMS Browser</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search WMS layers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="wb-input"
        />
        <select value={category} onChange={e => setCategory(e.target.value)} className="wb-select">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <label className="wb-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="checkbox" checked={hasTime} onChange={e => setHasTime(e.target.checked)} />
            Has Time
          </label>
          <label className="wb-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="checkbox" checked={hasLegend} onChange={e => setHasLegend(e.target.checked)} />
            Has Legend
          </label>
          <label className="wb-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="checkbox" checked={isQueryable} onChange={e => setIsQueryable(e.target.checked)} />
            Queryable
          </label>
        </div>
      </div>

      {loading && <p>Loading WMS capabilities...</p>}
      {error && <p className="wb-warning">Error: {error}</p>}
      
      <div style={{ display: "grid", gap: "8px" }}>
        {filteredLayers.map((layer) => (
          <div key={layer.layer_name} className="wb-panel-block">
            <div className="wb-row-between">
              <strong>{layer.title || layer.layer_name}</strong>
            </div>
            <div className="wb-muted" style={{ fontSize: "0.75rem", marginTop: "4px", wordBreak: 'break-all' }}>
              {layer.layer_name}
            </div>
            {layer.abstract && (
              <div className="wb-muted" style={{ fontSize: "0.75rem", marginTop: "4px" }}>
                {layer.abstract.substring(0, 100)}{layer.abstract.length > 100 ? '...' : ''}
              </div>
            )}
            
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
              {layer.has_time_dimension && <span className="wb-chip">Time</span>}
              {layer.legend_url && <span className="wb-chip">Legend</span>}
              {layer.queryable && <span className="wb-chip">Queryable</span>}
            </div>
            
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button onClick={() => handleAddLayer(layer)} className="wb-button wb-button-primary">Add as Layer</button>
              <button onClick={() => copyUrl(layer.layer_name)} className="wb-button">Copy URL</button>
            </div>
          </div>
        ))}
        {!loading && filteredLayers.length === 0 && <p className="wb-muted">No layers found.</p>}
      </div>
    </div>
  );
}
