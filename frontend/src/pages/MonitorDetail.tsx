import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { monitorApi } from '../api/monitors';
import { MonitorForm } from '../components/MonitorForm';
import { StatusBadge, statusFor } from '../components/StatusBadge';
import { TopBar } from '../components/TopBar';

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<'24h' | '7d'>('24h');
  const [editing, setEditing] = useState(false);
  const monitorQuery = useQuery({
    queryKey: ['monitors', id], queryFn: () => monitorApi.get(id!),
    refetchInterval: 15000, enabled: !!id
  });
  const resultsQuery = useQuery({
    queryKey: ['results', id], queryFn: () => monitorApi.results(id!),
    refetchInterval: 15000, enabled: !!id
  });
  const statsQuery = useQuery({
    queryKey: ['stats', id, window], queryFn: () => monitorApi.stats(id!, window),
    refetchInterval: 15000, enabled: !!id
  });

  if (monitorQuery.isError) return <><TopBar/><main className="page">
    <div className="empty clay-panel">
      <h2>Page not found</h2>
      <p>That page doesn't exist or you don't have access to it.</p>
      <button className="primary" onClick={() => navigate('/dashboard')}>Back to monitors</button>
    </div>
  </main></>;
  if (monitorQuery.isLoading) return <><TopBar/><main className="page">
    <div className="clay-panel detail-header skeleton"/>
  </main></>;

  const monitor = monitorQuery.data!;
  const results = [...(resultsQuery.data || [])].reverse();
  async function refresh() {
    await Promise.all([monitorQuery.refetch(), resultsQuery.refetch(), statsQuery.refetch()]);
    queryClient.invalidateQueries({ queryKey: ['monitors'] });
  }
  async function togglePause() {
    await monitorApi.update(monitor.id, { isActive: !monitor.isActive });
    await refresh();
  }
  async function remove() {
    if (!globalThis.confirm(`Delete ${monitor.name}? This also deletes its check history.`)) return;
    await monitorApi.remove(monitor.id);
    queryClient.invalidateQueries({ queryKey: ['monitors'] });
    navigate('/dashboard');
  }

  return <><TopBar/><main className="page">
    <button className="ghost back" onClick={() => navigate('/dashboard')}>← Monitors</button>
    <section className="detail-header clay-panel">
      <span className="orb orb-xl" data-state={statusFor(monitor)}>
        {statusFor(monitor) === 'up' ? '✓' : statusFor(monitor) === 'down' ? '×' : statusFor(monitor) === 'paused' ? 'Ⅱ' : '◷'}
      </span>
      <div className="detail-title">
        <h1>{monitor.name}</h1>
        <div className="detail-url"><span>{monitor.url}</span><StatusBadge monitor={monitor}/></div>
      </div>
      <div className="detail-actions">
        <button className="secondary" onClick={async () => { await monitorApi.check(monitor.id); await refresh(); }}>Check now</button>
        <button className="secondary" onClick={togglePause}>{monitor.isActive ? 'Pause' : 'Resume'} monitor</button>
        <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
        <button className="secondary danger" onClick={remove}>Delete</button>
      </div>
    </section>
    <div className="window-toggle">
      <span>Last {window === '24h' ? '24 hours' : '7 days'}</span>
      <button className={window === '24h' ? 'selected' : ''} onClick={() => setWindow('24h')}>24h</button>
      <button className={window === '7d' ? 'selected' : ''} onClick={() => setWindow('7d')}>7d</button>
    </div>
    <section className="stats-grid">
      <div className="stat-tile clay-card"><strong>{statsQuery.data?.uptimePercent === null || statsQuery.data?.uptimePercent === undefined ? '—' : `${statsQuery.data.uptimePercent}%`}</strong><span>Uptime</span></div>
      <div className="stat-tile clay-card"><strong>{statsQuery.data?.avgResponseTimeMs === null || statsQuery.data?.avgResponseTimeMs === undefined ? '—' : `${statsQuery.data.avgResponseTimeMs} ms`}</strong><span>Average</span></div>
      <div className="stat-tile clay-card"><strong>{statsQuery.data?.totalChecks ?? '—'}</strong><span>Checks</span></div>
      <div className="stat-tile clay-card"><strong>{statsQuery.data?.failedChecks ?? '—'}</strong><span>Failed</span></div>
    </section>
    <section className="chart-panel clay-panel">
      <h2>Response time</h2>
      <div className="chart-well">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={results}>
            <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FF7A1A" stopOpacity={0.28}/>
              <stop offset="95%" stopColor="#FF7A1A" stopOpacity={0}/>
            </linearGradient></defs>
            <CartesianGrid stroke="#3A1D21" strokeDasharray="4 6" vertical={false}/>
            <XAxis dataKey="checkedAt" hide/><YAxis stroke="#C9A9AA"/><Tooltip/>
            <Area type="monotone" dataKey="responseTimeMs" fill="url(#area)" stroke="none"/>
            <Line
              type="monotone"
              dataKey="responseTimeMs"
              stroke="#FF7A1A"
              strokeWidth={3}
              dot={(props) => props.payload.status === 'down'
                ? <circle cx={props.cx} cy={props.cy} r={7} fill="#F0434B" stroke="#FFF1EE" strokeWidth={2}/>
                : <circle cx={-100} cy={-100} r={0}/>}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {results.length === 0 && <div className="chart-empty">
          <span className="orb" data-state="pending"/>No checks yet. The first result appears within a minute.
        </div>}
      </div>
    </section>
    <section className="results-panel clay-panel">
      <h2>Recent checks</h2>
      <div className="table-wrap">
        <table><thead><tr><th>Time</th><th>Status</th><th>Code</th><th>Response</th><th>Error</th></tr></thead>
          <tbody>{[...results].reverse().slice(0, 20).map((result) =>
            <tr className={result.status === 'down' ? 'failed-row' : ''} key={result.id}>
              <td>{new Date(result.checkedAt).toLocaleString()}</td>
              <td>{result.status === 'up' ? 'Up' : 'Down'}</td>
              <td>{result.statusCode ?? '—'}</td>
              <td className={result.responseTimeMs && result.responseTimeMs > 1000 ? 'slow' : ''}>{result.responseTimeMs === null ? '—' : `${result.responseTimeMs} ms`}</td>
              <td>{result.error || '—'}</td>
            </tr>
          )}</tbody>
        </table>
      </div>
    </section>
  </main>{editing && <MonitorForm monitor={monitor} onClose={() => setEditing(false)}/>}</>;
}
