export default function SeverityBar({ value }) {
  const getColor = (v) => {
    if (v > 75) return 'var(--primary)';
    if (v > 50) return 'var(--accent)';
    if (v > 25) return 'var(--text-muted)';
    return 'var(--success)';
  };
  return (
    <div className="severity-bar-wrap">
      <div className="severity-bar-fill" style={{ width: `${value}%`, backgroundColor: getColor(value) }} />
    </div>
  );
}
