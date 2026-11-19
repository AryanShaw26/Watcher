import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { logout } from '../api/auth';
import { setAccessToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function TopBar() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const queryClient = useQueryClient();

  async function signOut() {
    await logout().catch(() => undefined);
    clearSession();
    setAccessToken(null);
    queryClient.clear();
    navigate('/login');
  }

  return (
    <>
      <header className="topbar clay-panel">
        <button className="brand ghost" onClick={() => navigate('/dashboard')}>
          <span className="brand-orb" />
          <span>Watcher</span>
        </button>
        <nav
          id="primary-nav"
          className={menuOpen ? 'top-nav open' : 'top-nav'}
          aria-label="Primary"
        >
          {[
            ['/dashboard', 'Monitors'],
            ['/incidents', 'Incidents'],
            ['/settings', 'Settings'],
          ].map(([path, label]) => (
            <button
              key={path}
              className="ghost nav-link"
              aria-current={location.pathname === path ? 'page' : undefined}
              onClick={() => {
                navigate(path);
                setMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="ghost mobile-menu"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menu
        </button>
        <div className="top-actions">
          <span className="user-email">{user?.email}</span>
          <button className="ghost" onClick={signOut}>
            Log out
          </button>
        </div>
      </header>
      <footer className="app-footer">
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </>
  );
}
