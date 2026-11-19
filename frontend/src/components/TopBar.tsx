import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/auth';
import { setAccessToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function TopBar() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await logout().catch(() => undefined);
    clearSession();
    setAccessToken(null);
    queryClient.clear();
    navigate('/login');
  }

  return <header className="topbar clay-panel">
    <button className="brand ghost" onClick={() => navigate('/dashboard')}>
      <span className="brand-orb" />
      <span>Watcher</span>
    </button>
    <div className="top-actions">
      <span className="user-email">{user?.email}</span>
      <button className="ghost" onClick={signOut}>Log out</button>
    </div>
  </header>;
}
