import type { LayerDefinition } from "../../layers/types";

interface LegendPanelProps {
  activeLayer: LayerDefinition | null;
}

export function LegendPanel({ activeLayer }: LegendPanelProps) {
  if (!activeLayer) {
    return <p className="wb-muted">Select a layer to inspect its legend.</p>;
  }
  const legendUrl = typeof activeLayer.metadata?.legend_url === "string"
    ? activeLayer.metadata.legend_url
    : null;
  const isServerRendered = activeLayer.serviceType === "wms" || activeLayer.serviceType === "wmts";

  return (
    <section className="wb-legend-panel">
      <div className="wb-row-between">
        <strong>{activeLayer.legend.title}</strong>
        {activeLayer.legend.unit && <small>{activeLayer.legend.unit}</small>}
      </div>
      {isServerRendered && legendUrl ? (
        <img className="wb-legend-image" src={legendUrl} alt={`${activeLayer.title} legend`} loading="lazy" />
      ) : isServerRendered ? (
        <p className="wb-muted">Server legend unavailable for this layer.</p>
      ) : (
        <>
          <div className="wb-legend-gradient" style={{ background: activeLayer.legend.gradient }} />
          <div className="wb-legend-stops">
            {activeLayer.legend.stops.map((stop) => (
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
