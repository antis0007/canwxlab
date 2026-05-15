interface TimeSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function TimeSlider({ value, onChange }: TimeSliderProps) {
  const label = value === 0 ? "Now" : value > 0 ? `+${value}h` : `${value}h`;
  return (
    <section className="panel-section compact-section">
      <div className="section-heading">
        <span>Timeline</span>
        <small>{label}</small>
      </div>
      <input
        className="timeline"
        type="range"
        min="-24"
        max="48"
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="timeline-labels">
        <span>-24h</span>
        <span>Observed now</span>
        <span>+48h</span>
      </div>
    </section>
  );
}
