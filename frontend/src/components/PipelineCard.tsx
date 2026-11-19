import { useQuery } from '@tanstack/react-query';
import { getPipelineStatus } from '../api/system';

function relativeTime(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function PipelineCard() {
  const query = useQuery({
    queryKey: ['pipeline'],
    queryFn: getPipelineStatus,
    refetchInterval: 10000,
  });
  const failed = query.isError;
  const status = failed ? undefined : query.data;
  const state = status?.state ?? 'pending';
  const title = failed
    ? 'Pipeline status unavailable'
    : !status
      ? 'Checking pipeline status'
      : state === 'healthy'
        ? 'Pipeline healthy'
        : state === 'lagging'
          ? 'Pipeline catching up'
          : 'Pipeline degraded';
  const message = failed
    ? "Couldn't load pipeline status. Try again in a moment."
    : !status
      ? 'Checking the pipeline...'
      : state === 'healthy'
        ? 'Results are saved as soon as they arrive.'
        : state === 'lagging'
          ? `${status.queue.lag ?? 0} results are waiting to be saved.`
          : status.reason === 'redis'
            ? "Redis can't be reached. Checks keep running and results are still saved."
            : status.reason === 'queue'
              ? "The message queue can't be reached. Results are saved directly until it's back."
              : "Redis and the message queue can't be reached. Checks keep running.";
  const orbState =
    state === 'healthy'
      ? 'up'
      : state === 'lagging'
        ? 'paused'
        : state === 'degraded'
          ? 'down'
          : 'pending';
  const queueName = !status
    ? '–'
    : status.queueDriver === 'kafka'
      ? 'Kafka'
      : status.queueDriver === 'redis-streams'
        ? 'Redis Streams'
        : 'Memory';
  return (
    <section className="pipeline-card clay-card" aria-live="polite">
      <div className="pipeline-heading">
        <span className="orb orb-sm" data-state={orbState} />
        <div>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
      </div>
      <dl className="pipeline-stats">
        <div>
          <dt>Queue</dt>
          <dd>{queueName}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{status?.queue.lag ?? '–'}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{status?.queue.dlqDepth ?? '–'}</dd>
        </div>
        <div>
          <dt>Last saved</dt>
          <dd>{relativeTime(status?.lastProcessedAt ?? null)}</dd>
        </div>
      </dl>
    </section>
  );
}
