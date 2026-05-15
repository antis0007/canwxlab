import { CameraState } from "../../layers/types";

interface MapControlsPanelProps {
  cameraState: CameraState;
  onCameraTarget: (state: CameraState) => void;
}

const PRESETS: Record<string, CameraState> = {
  "Canada": { longitude: -97, latitude: 57, zoom: 3, bearing: 0, pitch: 0 },
  "North America": { longitude: -100, latitude: 45, zoom: 2.5, bearing: 0, pitch: 0 },
  "World": { longitude: 0, latitude: 20, zoom: 1, bearing: 0, pitch: 0 },
  "Arctic": { longitude: -100, latitude: 75, zoom: 3, bearing: 0, pitch: 0 },
  "Prairies": { longitude: -105, latitude: 51, zoom: 5, bearing: 0, pitch: 0 },
  "Rockies": { longitude: -115, latitude: 51, zoom: 5, bearing: 0, pitch: 0 },
  "Great Lakes": { longitude: -82, latitude: 45, zoom: 5, bearing: 0, pitch: 0 },
  "Atlantic Canada": { longitude: -62, latitude: 47, zoom: 5, bearing: 0, pitch: 0 },
};

export function MapControlsPanel({ cameraState, onCameraTarget }: MapControlsPanelProps) {
  return (
    <div className="wb-scroll-panel">
      <article className="wb-layer-card">
        <strong>Camera State</strong>
        <div className="wb-value-grid" style={{ marginTop: "8px" }}>
          <div><span>Lon</span><strong>{cameraState.longitude.toFixed(2)}</strong></div>
          <div><span>Lat</span><strong>{cameraState.latitude.toFixed(2)}</strong></div>
          <div><span>Zoom</span><strong>{cameraState.zoom.toFixed(1)}</strong></div>
          <div><span>Bearing</span><strong>{cameraState.bearing.toFixed(1)}°</strong></div>
          <div><span>Pitch</span><strong>{cameraState.pitch.toFixed(1)}°</strong></div>
        </div>
        <div className="wb-row-between" style={{ marginTop: "8px" }}>
          <button onClick={() => onCameraTarget({ ...cameraState, bearing: 0 })}>Reset North</button>
          <button onClick={() => onCameraTarget({ ...cameraState, pitch: 0 })}>Reset Pitch</button>
        </div>
      </article>

      <article className="wb-layer-card">
        <strong>Region Presets</strong>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "8px" }}>
          {Object.entries(PRESETS).map(([name, state]) => (
            <button key={name} onClick={() => onCameraTarget(state)}>{name}</button>
          ))}
          <button disabled title="Not implemented">User Location</button>
        </div>
      </article>
    </div>
  );
}
