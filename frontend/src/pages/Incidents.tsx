import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { incidentApi, type Incident } from '../api/incidents';
import { TopBar } from '../components/TopBar';

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export default function Incidents() {
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [before, setBefore] = useState<string>();
  const [loaded, setLoaded] = useState<Incident[]>([]);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['incidents', filter, before],
    queryFn: () => incidentApi.list({ status: filter, limit: 50, before }),
    refetchInterval: filter === 'open' ? 15000 : undefined,
  });
  const incidents = before ? loaded : query.data || [];
  async function loadMore() {
    if (!incidents.at(-1)) return;
    const cursor = incidents.at(-1)!.startedAt;
    const more = await incidentApi.list({ status: filter, limit: 50, before: cursor });
    setLoaded([...(query.data || []), ...more]);
    setBefore(cursor);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="page-heading incidents-heading">
          <h1>Incidents</h1>
          <div className="segmented" role="group" aria-label="Incident status">
            {(['all', 'open', 'resolved'] as const).map((value) => (
              <button
                key={value}
                className={filter === value ? 'selected' : ''}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setBefore(undefined);
                }}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {query.isLoading ? (
          <div className="clay-panel skeleton" />
        ) : query.isError ? (
          <div className="empty clay-panel">
            <p>Could not load incidents.</p>
            <button className="secondary" onClick={() => query.refetch()}>
              Retry
            </button>
          </div>
        ) : incidents.length === 0 ? (
          <div className="empty clay-panel">
            <span className="orb orb-xl" data-state="up">
              ✓
            </span>
            <p>
              {filter === 'open'
                ? 'No open incidents.'
                : filter === 'resolved'
                  ? 'No resolved incidents.'
                  : 'No incidents. Everything you monitor has been healthy.'}
            </p>
          </div>
        ) : (
          <section className="incident-panel clay-panel" aria-label="Incidents">
            {incidents.map((incident) => (
              <button
                key={incident.id}
                className="incident-row"
                onClick={() => navigate(`/monitors/${incident.monitorId}`)}
              >
                <span
                  className="orb orb-sm"
                  data-state={incident.status === 'open' ? 'down' : 'up'}
                >
                  {incident.status === 'open' ? '×' : '✓'}
                </span>
                <span className="incident-main">
                  <strong>{incident.monitorName}</strong>
                  <span>
                    {incident.openedError || incident.lastError || 'Incident'} ·{' '}
                    {incident.failedChecks} failed checks
                  </span>
                  <span>
                    {incident.status === 'open'
                      ? `Started ${new Date(incident.startedAt).toUTCString()}`
                      : `${new Date(incident.startedAt).toUTCString()} to ${incident.resolvedAt ? new Date(incident.resolvedAt).toUTCString() : ''}`}
                  </span>
                </span>
                <span
                  className={`status-pill status-${incident.status === 'open' ? 'down' : 'up'}`}
                >
                  {incident.status === 'open' ? 'Open' : 'Resolved'}
                </span>
                <strong className="incident-duration">{duration(incident.durationSeconds)}</strong>
              </button>
            ))}
          </section>
        )}
        {incidents.length >= 50 && (
          <button className="secondary load-more" onClick={loadMore}>
            Load more
          </button>
        )}
      </main>
    </>
  );
}
