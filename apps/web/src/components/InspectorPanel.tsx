import type { InspectorState } from "../types/weather";

// PHASE-A-TODO: Add a "View Provenance" button to each value row that calls
// api.evidenceProvenance() and opens an EvidencePanel slideover.  The panel
// renders the full EvidenceChain: event timeline, confidence, conflicts.
// PHASE-A-TODO: Add a ConfidenceLevel badge next to each value (color-coded:
// confirmed=green, estimated=yellow, conflicting=red, synthetic=purple).
// PHASE-A-TODO: Add a TruthMode toggle (observed / predicted / historical)
// so operators can filter which reality layer they're inspecting.

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
