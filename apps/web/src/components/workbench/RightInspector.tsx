// PHASE-A-TODO: Add an EvidencePanel slideover component triggered by a
// "Provenance" button on each HeroMetric and inspection value.  The panel
// calls api.evidenceProvenance() and renders:
//   1. Event timeline (valid_from → observed_at → ingested_at)
//   2. Confidence badge + numeric score
//   3. Source adapter + raw pointer
//   4. Conflict list (if any) with competing values
//   5. TruthMode toggle that filters the active reality layer
// PHASE-A-TODO: Add ConfidenceLevel colour coding to StatusBadge so operators
// can distinguish at a glance between confirmed (green) and synthetic (purple).

import { LegendPanel } from "./LegendPanel";
import { StatusBadge } from "./StatusBadge";

import type {
  LayerDefinition,
  LayerDiagnostics,
  RendererFeatureValue,
  LayerRuntimeState,
} from "../../layers/types";
import type { HeroMetric, InspectorWmsRow } from "../../layers/inspection";
import type { PressureSystem } from "../../layers/pressureSystems";
import type { DataSource } from "../../types/weather";
import { parseWmsTimeDimension, resolveWmsTimeForTimeline } from "../../time/wmsTime";
import { formatInZone } from "../../lib/timezone";

interface RightInspectorProps {
  longitude: number | null;
  latitude: number | null;
  values: RendererFeatureValue[];
  /** Big-number metric cards (TEMP / MSLP / WIND / PRECIP / DEW / RH / DENSITY). */
  heroMetrics: HeroMetric[];
  /** Detected synoptic pressure systems from observations. */
  pressureSystems: PressureSystem[];
  /** Top WMS layers contributing to the current view. */
  wmsLayerRows: InspectorWmsRow[];
  activeLayer: LayerDefinition | null;
  sources: DataSource[];
  diagnostics: LayerDiagnostics;
  nearestStation: string | null;
  nearestStationKm: number | null;
  activeAlert: string | null;
  animationFrame: number;
  selectedValidTime: string;
  runtimeState: Record<string, LayerRuntimeState>;
  timeZone: string;
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <summary className="wb-section-header">
      <span>{label}</span>
      {hint ? <span className="wb-section-hint">{hint}</span> : null}
      <span className="wb-section-chevron" aria-hidden="true" />
    </summary>
  );
}

function wmsAvailabilityText(row: InspectorWmsRow): string | null {
  if (row.availability === "before-range") {
    return row.rangeStart
      ? `Requested ${row.requestedTime ?? "historical time"}; earliest available ${row.rangeStart}.`
      : "Requested time is before this layer's available archive.";
  }
  if (row.availability === "after-range") {
    return row.rangeEnd
      ? `Requested ${row.requestedTime ?? "future time"}; latest available ${row.rangeEnd}.`
      : "Requested time is newer than this layer's available data.";
  }
  return null;
}

function HeroMetricCard({ metric }: { metric: HeroMetric }) {
  return (
    <div className={`wb-hero-card wb-hero-${metric.id}`}>
      <div className="wb-hero-label">{metric.label}</div>
      <div className="wb-hero-value">
        <span className="wb-hero-num">{metric.value}</span>
        <span className="wb-hero-unit">{metric.unit}</span>
      </div>
      {metric.caption && <div className="wb-hero-caption">{metric.caption}</div>}
      <div className="wb-hero-status">
        <StatusBadge status={metric.status} />
        {metric.source && <span className="wb-hero-source">{metric.source}</span>}
      </div>
    </div>
  );
}

export function RightInspector({
  longitude,
  latitude,
  values,
  heroMetrics,
  pressureSystems,
  wmsLayerRows,
  activeLayer,
  sources,
  diagnostics,
  nearestStation,
  nearestStationKm,
  activeAlert,
  animationFrame,
  selectedValidTime,
  runtimeState,
  timeZone,
}: RightInspectorProps) {
  const activeSource = activeLayer
    ? sources.find((s) => s.source_id === activeLayer.sourceId)
    : null;

  const validTimeMs = new Date(selectedValidTime).getTime();
  const fmtClock = (ms: number) => formatInZone(ms, { timeZone, withSeconds: true });
  const hasCursor = longitude !== null && latitude !== null;
  const hasHero = heroMetrics.length > 0;

  return (
    <aside className="wb-right-panel">
      {/* Hero: at-a-glance meteorology */}
      <section className="wb-inspector-hero">
        <header className="wb-hero-header">
          <div className="wb-hero-timestamp">
            <span className="wb-hero-timestamp-tz">{timeZone}</span>
            <span className="wb-hero-timestamp-clock">{fmtClock(validTimeMs)}</span>
          </div>
          <div className="wb-hero-frame">Frame {animationFrame + 1}</div>
        </header>

        {hasCursor ? (
          <div className="wb-hero-location">
            <div className="wb-hero-coords">
              {latitude!.toFixed(4)} deg, {longitude!.toFixed(4)} deg
            </div>
            {nearestStation && (
              <div className="wb-hero-station">
                Nearest: {nearestStation}
                {nearestStationKm != null && (
                  <span className="wb-hero-station-distance"> - {nearestStationKm.toFixed(0)} km</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="wb-hero-empty">Click the map to inspect a point.</div>
        )}

        {activeAlert && (
          <div className="wb-hero-alert" role="alert">
            <span className="wb-hero-alert-icon">!</span>
            <span className="wb-hero-alert-text">{activeAlert}</span>
          </div>
        )}

        {hasHero ? (
          <div className="wb-hero-grid">
            {heroMetrics.map((metric) => (
              <HeroMetricCard key={metric.id} metric={metric} />
            ))}
          </div>
        ) : hasCursor ? (
          <div className="wb-hero-empty wb-hero-empty-noobs">
            No live station observation near this point. Enable live observations
            or inspect closer to a station.
          </div>
        ) : null}
      </section>

      {/* Pressure systems */}
      {pressureSystems.length > 0 && (
        <details className="wb-section">
          <SectionHeader
            label="Pressure systems"
            hint={`${pressureSystems.length} detected`}
          />
          <div className="wb-section-body wb-pressure-body">
            <table className="wb-pressure-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>MSLP</th>
                  <th>Contrast</th>
                  <th>Station</th>
                </tr>
              </thead>
              <tbody>
                {pressureSystems.slice(0, 8).map((system) => (
                  <tr key={`${system.kind}-${system.stationId}`} className={`wb-pressure-row wb-pressure-${system.kind}`}>
                    <td className="wb-pressure-kind">
                      <span className={`wb-pressure-glyph wb-pressure-glyph-${system.kind}`}>{system.kind}</span>
                    </td>
                    <td>{system.pressureHpa.toFixed(1)} hPa</td>
                    <td>{system.contrastHpa.toFixed(1)}</td>
                    <td title={`${system.stationName} (${system.stationId})`}>
                      {system.stationName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="wb-muted wb-pressure-note">
              Local-extrema detection on station MSLP within 800 km. Strong systems first.
            </p>
          </div>
        </details>
      )}

      {/* Analysis rows (microphysics, layer stack, …) */}
      {values.length > 0 && (
        <details className="wb-section">
          <SectionHeader label="Analysis" hint={`${values.length} row${values.length === 1 ? "" : "s"}`} />
          <div className="wb-section-body">
            <ul className="wb-analysis-list">
              {values.map((value) => (
                <li key={value.label}>
                  <div className="wb-analysis-label">
                    {value.label}
                    {value.unit && <span className="wb-analysis-unit">{value.unit}</span>}
                  </div>
                  <div className="wb-analysis-value">{value.value}</div>
                  <div className="wb-analysis-status"><StatusBadge status={value.status} /></div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* WMS layers */}
      {wmsLayerRows.length > 0 && (
        <details className="wb-section" open>
          <SectionHeader label="WMS in view" hint={`top ${wmsLayerRows.length}`} />
          <div className="wb-section-body">
            <ul className="wb-wms-list">
              {wmsLayerRows.map((row) => {
                const availability = wmsAvailabilityText(row);
                return (
                  <li key={row.title}>
                    <div className="wb-wms-title">{row.title}</div>
                    <div className="wb-wms-meta">
                      <span>{row.timePolicy}</span>
                      <span>-</span>
                      <span>{row.resolvedTime ?? "latest"}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    {availability && <div className="wb-wms-warning">{availability}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}

      {/* Legend */}
      <details className="wb-section">
        <SectionHeader label="Legend" />
        <div className="wb-section-body">
          {activeLayer ? (
            <LegendPanel activeLayer={activeLayer} />
          ) : (
            <p className="wb-muted" style={{ margin: 0 }}>No active layer selected.</p>
          )}
        </div>
      </details>

      {/* Sources */}
      <details className="wb-section">
        <SectionHeader label="Sources" hint={`${sources.length}`} />
        <div className="wb-section-body">
          {activeLayer && (
            <p className="wb-muted" style={{ margin: "0 0 6px" }}>
              Active: {activeSource?.name ?? activeLayer.sourceId}
              {activeSource?.retrieved_at
                ? ` - ${fmtClock(new Date(activeSource.retrieved_at).getTime())}`
                : ""}
            </p>
          )}
          <div className="wb-source-list">
            {sources.map((source) => (
              <div key={source.source_id} className="wb-source-row">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name}</span>
                <StatusBadge status={source.status} />
              </div>
            ))}
          </div>
          {activeLayer?.wmsLayerName && (
            <div style={{ marginTop: 6, fontSize: 10 }}>
              <p className="wb-muted" style={{ margin: "2px 0", wordBreak: "break-all" }}>Layer: {activeLayer.wmsLayerName}</p>
              {!!activeLayer.metadata?.time_extent && (
                <p className="wb-muted" style={{ margin: "2px 0" }}>
                  Time: {resolveWmsTimeForTimeline(
                    validTimeMs,
                    parseWmsTimeDimension(activeLayer.metadata.time_extent as string),
                    runtimeState[activeLayer.id]?.wmsTimePolicy === "global"
                      ? "timeline"
                      : runtimeState[activeLayer.id]?.wmsTimePolicy ?? "timeline",
                    runtimeState[activeLayer.id]?.wmsFixedTime,
                  ) || "--"}
                </p>
              )}
            </div>
          )}
        </div>
      </details>

      {/* Diagnostics */}
      <details className="wb-section">
        <SectionHeader label="Diagnostics" />
        <div className="wb-section-body">
          <ul className="wb-diag-list">
            <li><span>FPS</span><strong>{diagnostics.fps.toFixed(1)}</strong></li>
            <li><span>Layers</span><strong>{diagnostics.activeLayerCount}</strong></li>
            <li><span>Animated</span><strong>{diagnostics.animatedLayerCount}</strong></li>
            <li><span>Deck</span><strong>{diagnostics.deckLayerCount}</strong></li>
            <li><span>Mode</span><strong>{diagnostics.rendererKind ?? diagnostics.mapMode}</strong></li>
            <li><span>WMS Pending</span><strong>{diagnostics.pendingRasterFrames ?? 0}</strong></li>
            <li><span>WMS Promoted</span><strong>{diagnostics.promotedRasterFrames ?? 0}</strong></li>
            <li><span>WMS Failed</span><strong>{diagnostics.failedRasterFrames ?? 0}</strong></li>
            <li>
              <span>Refresh</span>
              <strong>{diagnostics.lastDataRefreshAt ? fmtClock(new Date(diagnostics.lastDataRefreshAt).getTime()) : "--"}</strong>
            </li>
          </ul>
          {diagnostics.lastSourceError && (
            <p className="wb-warning" style={{ margin: "6px 0 0" }}>{diagnostics.lastSourceError}</p>
          )}
          {diagnostics.warnings.length > 0 && (
            <ul className="wb-warnings">
              {diagnostics.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      </details>
    </aside>
  );
}
