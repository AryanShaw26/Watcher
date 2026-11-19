import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from './auth/AuthContext';
import { login, register } from './api/auth';
import { monitorApi, type Monitor } from './api/monitors';
import { StatusBadge, statusFor } from './components/StatusBadge';
import { PipelineCard } from './components/PipelineCard';
import { MonitorForm } from './components/MonitorForm';
import { TopBar } from './components/TopBar';
import { incidentApi } from './api/incidents';

const MonitorDetail = lazy(() => import('./pages/MonitorDetail'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Settings = lazy(() => import('./pages/Settings'));

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { setSession, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!email.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    if (password.length < 10 || password.length > 72) {
      setError('Password must be 10 to 72 characters');
      return;
    }
    try {
      const result =
        mode === 'login' ? await login(email, password) : await register(email, password);
      setSession(result.accessToken, result.user);
      navigate('/dashboard');
    } catch (cause) {
      if (axios.isAxiosError(cause))
        setError(cause.response?.data?.error?.message || 'Request failed');
    }
  }
  return (
    <main className="auth-shell">
      <div className="auth-card clay-panel">
        <div className="brand">
          <span className="brand-orb" /> <span>Watcher</span>
        </div>
        <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
        <p className="tagline">Your APIs. Always in Sight.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              className="clay-well"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <div className="password-wrap">
              <input
                className="clay-well"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {error && (
            <p className="error" role="alert">
              ! {error}
            </p>
          )}
          <button className="primary full" type="submit">
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <button
          className="ghost link"
          onClick={() => navigate(mode === 'login' ? '/register' : '/login')}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
      </div>
    </main>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <main className="loader">Loading Watcher...</main>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function relativeTime(value: string | null) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function MonitorCard({ monitor }: { monitor: Monitor }) {
  const navigate = useNavigate();
  const state = statusFor(monitor);
  return (
    <button className="monitor-card clay-card" onClick={() => navigate(`/monitors/${monitor.id}`)}>
      <span className={`orb orb-lg`} data-state={state}>
        {state === 'up' ? '✓' : state === 'down' ? '×' : state === 'paused' ? 'Ⅱ' : '◷'}
      </span>
      <span className="monitor-main">
        <strong>{monitor.name}</strong>
        <span className="monitor-url">{monitor.url}</span>
      </span>
      <span className="monitor-meta">
        <span className="monitor-pills">
          <StatusBadge monitor={monitor} />
          {monitor.openIncident && <span className="status-pill status-down">Incident</span>}
        </span>
        <span>
          {monitor.lastResponseTimeMs === null ? '—' : `${monitor.lastResponseTimeMs} ms`} ·{' '}
          {relativeTime(monitor.lastCheckedAt)}
        </span>
      </span>
    </button>
  );
}

function Dashboard() {
  const [formOpen, setFormOpen] = useState(false);
  const query = useQuery({
    queryKey: ['monitors'],
    queryFn: monitorApi.list,
    refetchInterval: 15000,
  });
  const incidentQuery = useQuery({
    queryKey: ['open-incidents'],
    queryFn: () => incidentApi.list({ status: 'open', limit: 50 }),
    refetchInterval: 15000,
  });
  const openIncidents = incidentQuery.data || [];
  const navigate = useNavigate();
  const monitors = query.data || [];
  const sorted = [...monitors].sort((a, b) => {
    const rank = (m: Monitor) =>
      !m.isActive ? 3 : m.currentStatus === 'down' ? 0 : m.currentStatus === 'up' ? 1 : 2;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const counts = {
    up: monitors.filter((m) => m.isActive && m.currentStatus === 'up').length,
    down: monitors.filter((m) => m.isActive && m.currentStatus === 'down').length,
    paused: monitors.filter((m) => !m.isActive).length,
    pending: monitors.filter((m) => m.isActive && m.currentStatus === 'pending').length,
  };
  return (
    <>
      <TopBar />
      <main className="page">
        <div className="page-heading">
          <h1>Monitors</h1>
          <button className="primary" onClick={() => setFormOpen(true)}>
            + Add monitor
          </button>
        </div>
        {openIncidents.length > 0 && (
          <section className="incident-banner clay-card" role="status">
            <span className="orb orb-sm" data-state="down">
              ×
            </span>
            <div>
              <strong>
                {openIncidents.length === 1
                  ? '1 incident open'
                  : `${openIncidents.length} incidents open`}
              </strong>
              <span>
                {[...new Set(openIncidents.map((incident) => incident.monitorName))]
                  .slice(0, 2)
                  .join(', ')}
              </span>
            </div>
            <button className="ghost" onClick={() => navigate('/incidents')}>
              View incidents
            </button>
          </section>
        )}
        {query.isLoading ? (
          <div className="grid">
            <div className="monitor-card clay-card skeleton" />
            <div className="monitor-card clay-card skeleton" />
          </div>
        ) : query.isError ? (
          <div className="empty clay-panel">
            <p>Could not load monitors.</p>
            <button className="secondary" onClick={() => query.refetch()}>
              Retry
            </button>
          </div>
        ) : monitors.length === 0 ? (
          <div className="empty clay-panel">
            <span className="orb orb-xl" data-state="pending">
              ◷
            </span>
            <h2>No monitors yet</h2>
            <p>Add the first API you want to keep an eye on.</p>
            <button className="primary" onClick={() => setFormOpen(true)}>
              Add monitor
            </button>
          </div>
        ) : (
          <>
            <section className="summary-strip">
              {(
                [
                  ['up', 'Up'],
                  ['down', 'Down'],
                  ['paused', 'Paused'],
                  ['pending', 'Pending'],
                ] as const
              ).map(([key, label]) => (
                <div className="stat-tile clay-card" key={key}>
                  <span
                    className={`orb orb-sm`}
                    data-state={key === 'pending' ? key : key === 'paused' ? 'paused' : key}
                  />
                  <strong>{counts[key]}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </section>
            <section className="monitor-grid">
              {sorted.map((m) => (
                <MonitorCard key={m.id} monitor={m} />
              ))}
            </section>
          </>
        )}
        <PipelineCard />
      </main>
      {formOpen && <MonitorForm onClose={() => setFormOpen(false)} />}
    </>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="page not-found">
      <span className="orb orb-xl" data-state="down">
        ×
      </span>
      <h1>Page not found</h1>
      <p>That page doesn't exist or you don't have access to it.</p>
      <button className="primary" onClick={() => navigate('/dashboard')}>
        Back to monitors
      </button>
    </main>
  );
}

export default function App() {
  const { status } = useAuth();
  useEffect(() => {
    document.title = 'Watcher — Your APIs. Always in Sight.';
  }, []);
  if (status === 'loading') return <main className="loader">Loading Watcher...</main>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/monitors/:id"
        element={
          <Protected>
            <Suspense fallback={<main className="loader">Loading monitor...</main>}>
              <MonitorDetail />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/incidents"
        element={
          <Protected>
            <Suspense fallback={<main className="loader">Loading incidents...</main>}>
              <Incidents />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <Suspense fallback={<main className="loader">Loading settings...</main>}>
              <Settings />
            </Suspense>
          </Protected>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
