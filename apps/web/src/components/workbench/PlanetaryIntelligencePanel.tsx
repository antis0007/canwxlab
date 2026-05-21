import { useMemo, useState } from "react";

import type { CameraState } from "../../layers/types";
import {
  buildPlanetaryQuery,
  buildPlanetaryViewPlan,
  PLANETARY_SAMPLE_CLAIMS,
  PLANETARY_SAMPLE_DIFFS,
  PLANETARY_SAMPLE_EVENTS,
} from "../../lib/planetaryCatalog";
import type {
  ArchiveSummary,
  PlanetaryTimelineState,
  PlanetaryViewIntent,
  SourceContractView,
} from "../../types/planetary";
import { StatusBadge } from "./StatusBadge";

interface PlanetaryIntelligencePanelProps {
  cameraState: CameraState;
  selectedValidTime: string;
  activeLayerCount: number;
  timelineState: PlanetaryTimelineState;
  sourceContracts: SourceContractView[];
  archiveSummary: ArchiveSummary;
}

const INTENT_OPTIONS: Array<{ id: PlanetaryViewIntent; label: string }> = [
  { id: "situational-awareness", label: "Situational" },
  { id: "weather", label: "Weather" },
  { id: "transport-risk", label: "Transport Risk" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "environment", label: "Environment" },
  { id: "news", label: "News" },
  { id: "science", label: "Science" },
  { id: "all", label: "All" },
];

function formatSeconds(seconds?: number): string {
  if (!seconds) return "--";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatBytes(value: number | null): string {
  if (value === null) return "unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function SourceContractRow({ source }: { source: SourceContractView }) {
  return (
    <div className="wb-planetary-source-row">
      <div className="wb-row-between">
        <strong>{source.name}</strong>
        <StatusBadge status={source.runtimeStatus} />
      </div>
      <div className="wb-planetary-source-meta">
        <span>{source.category}</span>
        <span>{source.auth}</span>
        <span>{source.licenseLabel}</span>
        <span>stale {formatSeconds(source.staleAfterSeconds)}</span>
      </div>
      <div className="wb-planetary-contract-grid">
        <span>Trust</span>
        <strong>{source.trustTier}/5</strong>
        <span>Retain</span>
        <strong>{source.retentionAllowed === "unknown" ? "Unknown" : source.retentionAllowed ? "Yes" : "No"}</strong>
        <span>Cost gate</span>
        <strong>{source.requiresCostApproval ? "Required" : "None"}</strong>
        <span>Cache first</span>
        <strong>{source.cacheBeforeUse ? "Yes" : "No"}</strong>
      </div>
    </div>
  );
}

export function PlanetaryIntelligencePanel({
  cameraState,
  selectedValidTime,
  activeLayerCount,
  timelineState,
  sourceContracts,
  archiveSummary,
}: PlanetaryIntelligencePanelProps) {
  const [intent, setIntent] = useState<PlanetaryViewIntent>("situational-awareness");
  const [minConfidence, setMinConfidence] = useState(0.6);
  const [includePredictions, setIncludePredictions] = useState(true);
  const [includeUnverifiedReports, setIncludeUnverifiedReports] = useState(false);

  const query = useMemo(
    () => buildPlanetaryQuery({
      cameraState,
      selectedTime: selectedValidTime,
      intent,
      minConfidence,
      includePredictions,
      includeUnverifiedReports,
    }),
    [cameraState, includePredictions, includeUnverifiedReports, intent, minConfidence, selectedValidTime],
  );

  const viewPlan = useMemo(
    () => buildPlanetaryViewPlan({
      query,
      sourceContracts,
      activeLayerCount,
    }),
    [activeLayerCount, query, sourceContracts],
  );

  const requiredSourceSet = useMemo(() => new Set(viewPlan.requiredSources), [viewPlan.requiredSources]);
  const relevantSources = sourceContracts.filter((source) => requiredSourceSet.has(source.id));
  const suppressedClaims = PLANETARY_SAMPLE_CLAIMS.filter((claim) => claim.confidence < minConfidence || !includeUnverifiedReports);
  const visibleEvents = PLANETARY_SAMPLE_EVENTS.filter((event) => event.confidence >= minConfidence);
  const statusCounts = sourceContracts.reduce<Record<string, number>>((acc, source) => {
    acc[source.runtimeStatus] = (acc[source.runtimeStatus] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="wb-scroll-panel wb-planetary-panel">
      <div className="wb-panel-block wb-planetary-query">
        <strong className="wb-planetary-kicker">Planetary query</strong>
        <label>
          Intent
          <select value={intent} onChange={(event) => setIntent(event.target.value as PlanetaryViewIntent)}>
            {INTENT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Minimum confidence {Math.round(minConfidence * 100)}%
          <input
            type="range"
            min={0.1}
            max={0.95}
            step={0.05}
            value={minConfidence}
            onChange={(event) => setMinConfidence(Number(event.target.value))}
          />
        </label>
        <label className="wb-inline-toggle">
          <input
            type="checkbox"
            checked={includePredictions}
            onChange={(event) => setIncludePredictions(event.target.checked)}
          />
          Predictions
        </label>
        <label className="wb-inline-toggle">
          <input
            type="checkbox"
            checked={includeUnverifiedReports}
            onChange={(event) => setIncludeUnverifiedReports(event.target.checked)}
          />
          Unverified reports
        </label>
      </div>

      <div className="wb-planetary-stat-grid">
        <div>
          <span>Sources</span>
          <strong>{viewPlan.requiredSources.length}</strong>
        </div>
        <div>
          <span>Events</span>
          <strong>{visibleEvents.length}</strong>
        </div>
        <div>
          <span>Layers</span>
          <strong>{activeLayerCount}</strong>
        </div>
        <div>
          <span>Latency</span>
          <strong>{query.maxLatencyMs}ms</strong>
        </div>
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">Timeline state</strong>
        <div className="wb-planetary-plan-list">
          <span>Mode</span><strong>{timelineState.mode.toUpperCase()}</strong>
          <span>Tracking live</span><strong>{timelineState.isTrackingLive ? "Yes" : "No"}</strong>
          <span>Forecast</span><strong>{timelineState.forecastEnabled ? "Unlocked" : "Locked"}</strong>
          <span>Selected</span><strong>{new Date(timelineState.selectedTimeMs).toLocaleTimeString()}</strong>
          <span>Live</span><strong>{new Date(timelineState.liveTimeMs).toLocaleTimeString()}</strong>
        </div>
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">Local archive</strong>
        <div className="wb-planetary-plan-list">
          <span>Assets</span><strong>{archiveSummary.assetCount}</strong>
          <span>Approx bytes</span><strong>{formatBytes(archiveSummary.approximateBytes)}</strong>
          <span>Allowed</span><strong>{archiveSummary.allowedCount}</strong>
          <span>Restricted</span><strong>{archiveSummary.restrictedCount}</strong>
          <span>Unknown</span><strong>{archiveSummary.unknownCount}</strong>
          <span>Last archived</span><strong>{archiveSummary.lastArchivedAt ? new Date(archiveSummary.lastArchivedAt).toLocaleTimeString() : "--"}</strong>
        </div>
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">View plan</strong>
        <div className="wb-planetary-plan-list">
          <span>Vector tiles</span><strong>{viewPlan.vectorTiles.length}</strong>
          <span>Raster tiles</span><strong>{viewPlan.rasterTiles.length}</strong>
          <span>Entities</span><strong>{viewPlan.entityBatches.length}</strong>
          <span>Events</span><strong>{viewPlan.eventBatches.length}</strong>
          <span>Timeseries</span><strong>{viewPlan.timeseries.length}</strong>
          <span>Documents</span><strong>{viewPlan.documentSnippets.length}</strong>
        </div>
        <div className="wb-chip-row" style={{ marginTop: 7 }}>
          {viewPlan.dataClasses.map((item) => (
            <span key={item} className="wb-chip">{item}</span>
          ))}
        </div>
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">Query bounds</strong>
        <div className="wb-planetary-bounds">
          <span>Lon</span>
          <strong>{query.bbox[0].toFixed(2)} to {query.bbox[2].toFixed(2)}</strong>
          <span>Lat</span>
          <strong>{query.bbox[1].toFixed(2)} to {query.bbox[3].toFixed(2)}</strong>
          <span>Time</span>
          <strong>{new Date(query.timeRange.start).toLocaleDateString()} to {new Date(query.timeRange.end).toLocaleDateString()}</strong>
        </div>
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">Source contracts</strong>
        <div className="wb-chip-row" style={{ marginBottom: 7 }}>
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="wb-chip">{status}: {count}</span>
          ))}
        </div>
        {relevantSources.map((source) => (
          <SourceContractRow key={source.id} source={source} />
        ))}
      </div>

      <div className="wb-panel-block">
        <strong className="wb-planetary-kicker">Demo system signals</strong>
        <div className="wb-planetary-diff-list">
          {PLANETARY_SAMPLE_DIFFS.map((diff) => (
            <div key={diff.id} className="wb-planetary-diff-row">
              <span>{diff.changeType}</span>
              <strong>{Math.round(diff.significance * 100)}%</strong>
              <p>{diff.before ?? "none"} {"->"} {diff.after ?? "none"}</p>
            </div>
          ))}
        </div>
      </div>

      {(viewPlan.warnings.length > 0 || suppressedClaims.length > 0) && (
        <div className="wb-panel-block">
          <strong className="wb-planetary-kicker">Quality gates</strong>
          {viewPlan.warnings.map((warning) => (
            <p key={warning} className="wb-warning">{warning}</p>
          ))}
          {suppressedClaims.length > 0 && (
            <p className="wb-muted" style={{ margin: "5px 0 0" }}>
              {suppressedClaims.length} claim{suppressedClaims.length === 1 ? "" : "s"} suppressed by confidence/report policy.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
