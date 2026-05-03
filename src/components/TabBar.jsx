import { ShieldCheck } from 'lucide-react';

export default function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <aside className="app-sidebar">
      {/* Brand Logo */}
      <div className="brand-container">
        <ShieldCheck size={28} strokeWidth={2.5} />
        <span>ResQAI</span>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon && <span className="nav-icon">{tab.icon}</span>}
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Sidebar footer accent */}
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Powered by AI Intelligence
        </div>
      </div>
    </aside>
  );
}