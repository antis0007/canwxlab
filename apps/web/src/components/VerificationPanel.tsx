import type { VerificationMetric } from "../types/weather";

interface VerificationPanelProps {
  metrics: VerificationMetric[];
}

export function VerificationPanel({ metrics }: VerificationPanelProps) {
  return (
    <section className="panel-section compact-section">
      <div className="section-heading">
        <span>Verification</span>
        <small>simulation</small>
      </div>
      {metrics.length === 0 ? (
        <p className="muted">No verification metrics loaded yet.</p>
      ) : (
        <div className="metric-list">
          {metrics.map((metric) => (
            <article key={metric.metric_id} className="metric-card">
              <strong>{metric.model_name}</strong>
              <div className="metric-grid">
                <span>MAE <b>{metric.mae}</b></span>
                <span>RMSE <b>{metric.rmse}</b></span>
                <span>Bias <b>{metric.bias}</b></span>
              </div>
              <small>{metric.variable}, +{metric.lead_time_hours}h, n={metric.sample_count}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
