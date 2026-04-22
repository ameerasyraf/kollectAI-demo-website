import Icon from "./Icon.jsx";

function toneLabel(tone) {
  if (tone === "good") return "Ready";
  if (tone === "warn") return "Attention";
  if (tone === "bad") return "Offline";
  return "Checking";
}

export default function StatusPanel({ title = "System Status", items = [] }) {
  return (
    <section className="status-panel" aria-label={title}>
      <div className="status-panel-header">
        <span>{title}</span>
        <Icon name="shield" size={16} />
      </div>
      <div className="status-list">
        {items.map((item) => (
          <article className="status-item" key={item.label}>
            <div className="status-copy">
              <strong>{item.label}</strong>
              <p>{item.hint}</p>
            </div>
            <span className={`status-pill ${item.tone || "neutral"}`}>
              {item.value || toneLabel(item.tone)}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
