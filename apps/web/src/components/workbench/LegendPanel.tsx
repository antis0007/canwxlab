import { resolveRamp } from "../../layers/colorRamps";
import { legendFromRamp } from "../../layers/legends";
import type { LayerDefinition, LayerRuntimeState } from "../../layers/types";

interface LegendPanelProps {
  activeLayer: LayerDefinition | null;
  runtimeState?: Record<string, LayerRuntimeState>;
}

export function LegendPanel({ activeLayer, runtimeState }: LegendPanelProps) {
  if (!activeLayer) {
    return <p className="wb-muted">Select a layer to inspect its legend.</p>;
  }
  const legendUrl = typeof activeLayer.metadata?.legend_url === "string"
    ? activeLayer.metadata.legend_url
    : null;
  const isServerRendered = activeLayer.serviceType === "wms" || activeLayer.serviceType === "wmts";
  const runtimeRampId = runtimeState?.[activeLayer.id]?.colourRamp ?? activeLayer.colourRamp;
  const runtimeRamp = resolveRamp(runtimeRampId);
  const clientLegend = activeLayer.capabilities.supportsCustomColorRamp
    ? legendFromRamp(activeLayer.legend.title, activeLayer.legend.unit ?? activeLayer.unit, runtimeRamp.id)
    : activeLayer.legend;

  return (
    <section className="wb-legend-panel">
      <div className="wb-row-between">
        <strong>{clientLegend.title}</strong>
        {clientLegend.unit && <small>{clientLegend.unit}</small>}
      </div>
      {isServerRendered && legendUrl ? (
        <img className="wb-legend-image" src={legendUrl} alt={`${activeLayer.title} legend`} loading="lazy" />
      ) : isServerRendered ? (
        <p className="wb-muted">Server legend unavailable for this layer.</p>
      ) : (
        <>
          <div className="wb-legend-gradient" style={{ background: clientLegend.gradient }} />
          <div className="wb-legend-stops">
            {clientLegend.stops.map((stop) => (
              <div key={`${activeLayer.id}-${stop.label}`} className="wb-legend-stop">
                <span className="wb-legend-dot" style={{ backgroundColor: stop.color }} />
                <span>{stop.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
