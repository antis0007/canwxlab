import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { WeatherLayer, WmsCapabilityLayerSummary } from "../../types/weather";

interface WmsBrowserProps {
  onAddLayer: (layer: WeatherLayer) => void;
}

export function WmsBrowser({ onAddLayer }: WmsBrowserProps) {
  const [layers, setLayers] = useState<WmsCapabilityLayerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

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

  const handleAddLayer = useCallback(async (layerName: string) => {
    // Generate a temporary WeatherLayer representing this WMS layer
    const newLayer: WeatherLayer = {
      layer_id: `wms_${layerName}`,
      name: layerName,
      title: layerName,
      kind: "raster",
      variable: "wms_layer",
      unit: "none",
      source_id: "eccc_geomet_wms",
      status: "live",
      adapter: "eccc_geomet",
      service_type: "wms",
      attribution: "ECCC",
      description: `WMS layer ${layerName}`,
      default_opacity: 0.8,
      color_ramps: [],
      styles: [],
      wms_base_url: "https://geo.weather.gc.ca/geomet",
      wms_layer_name: layerName,
      time_dimension_supported: layers.find(l => l.layer_name === layerName)?.has_time_dimension || false,
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
      legend_url: null,
      min_zoom: null,
      max_zoom: null,
      update_frequency_hint: null,
      message: ""
    };
    onAddLayer(newLayer);
  }, [layers, onAddLayer]);

  const filteredLayers = layers.filter(
    (l) =>
      l.layer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.title && l.title.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="wb-scroll-panel">
      <h3>WMS Browser</h3>
      <input
        type="text"
        placeholder="Search WMS layers..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="wb-input"
        style={{ width: "100%", marginBottom: "8px" }}
      />
      {loading && <p>Loading WMS capabilities...</p>}
      {error && <p className="wb-warning">Error: {error}</p>}
      <div style={{ display: "grid", gap: "8px" }}>
        {filteredLayers.map((layer) => (
          <div key={layer.layer_name} className="wb-panel-block">
            <div className="wb-row-between">
              <strong>{layer.title || layer.layer_name}</strong>
              <button onClick={() => handleAddLayer(layer.layer_name)}>Add</button>
            </div>
            <div className="wb-muted" style={{ fontSize: "0.7rem", marginTop: "4px" }}>
              {layer.layer_name}
            </div>
            {layer.has_time_dimension && (
              <div className="wb-chip" style={{ display: "inline-block", marginTop: "4px" }}>Time enabled</div>
            )}
          </div>
        ))}
        {!loading && filteredLayers.length === 0 && <p className="wb-muted">No layers found.</p>}
      </div>
    </div>
  );
}
