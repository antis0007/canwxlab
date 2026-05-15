import type { InspectorState } from "../types/weather";

interface InspectorPanelProps {
  inspector: InspectorState | null;
}

export function InspectorPanel({ inspector }: InspectorPanelProps) {
  return (
    <section className="panel-section compact-section">
      <div className="section-heading">
        <span>Map Inspector</span>
        <small>click map</small>
      </div>
      {inspector ? (
        <div className="inspector">
          <div className="coordinate-readout">
            <strong>{inspector.latitude.toFixed(4)}</strong>
            <strong>{inspector.longitude.toFixed(4)}</strong>
          </div>
          {inspector.values.map((item) => (
            <div className="value-row" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value} {item.unit}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Click anywhere on the map to inspect mock layer values.</p>
      )}
    </section>
  );
}
