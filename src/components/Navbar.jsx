import { useAuth } from '../contexts/AuthContext';
import { LogOut } from 'lucide-react';

export default function Navbar() {
  const { userData, logout } = useAuth();
  const roleName = userData?.role?.toUpperCase() || '';
  const roleClass = userData?.role || '';

  return (
    <header className="app-header">
      <div className="navbar-inner">
        {userData && (
          <>
            <div className="navbar-user-meta">
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                {userData.name}
              </span>
              <span className={`role-badge ${roleClass}`}>{roleName}</span>
            </div>
            <div className="navbar-divider"></div>
            <button onClick={logout} className="btn btn-ghost btn-sm">
              <LogOut size={16} /> Logout
            </button>
          </>
        )}
      </div>
    </header>
  );
}