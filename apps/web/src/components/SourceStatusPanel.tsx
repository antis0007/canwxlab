import type { DataSource } from "../types/weather";

interface SourceStatusPanelProps {
  sources: DataSource[];
  apiError: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

function formatTime(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function SourceStatusPanel({ sources, apiError, onRefresh, isRefreshing }: SourceStatusPanelProps) {
  return (
    <section className="panel-section compact-section">
      <div className="section-heading">
        <span>Source Health</span>
        <div className="source-actions">
          <small>{apiError ? "fallback" : "api"}</small>
          <button type="button" className="ghost-button" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {apiError && <p className="warning-text">API unavailable: using local fallback metadata.</p>}
      <div className="source-list">
        {sources.map((source) => (
          <article key={source.source_id} className="source-card">
            <div>
              <strong>{source.name}</strong>
              <em className={`status-pill status-${source.status}`}>{source.status}</em>
            </div>
            <p>{source.description}</p>
            {source.message && <p className="muted">{source.message}</p>}
            <dl className="metadata-grid">
              <div><dt>Adapter</dt><dd>{source.adapter}</dd></div>
              <div><dt>Last success</dt><dd>{formatTime(source.last_successful_fetch)}</dd></div>
              <div><dt>Last attempt</dt><dd>{formatTime(source.last_attempted_fetch)}</dd></div>
              <div><dt>Expires</dt><dd>{formatTime(source.expires_at)}</dd></div>
            </dl>
            <small>{source.attribution}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
