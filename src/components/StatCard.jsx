export default function StatCard({ icon, value, label, color }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value" style={color ? { background: 'none', WebkitTextFillColor: color, color } : {}}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
