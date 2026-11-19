import { api } from './client';

export type PipelineStatus = {
  state: 'healthy' | 'lagging' | 'degraded';
  reason: 'redis' | 'queue' | 'redis_and_queue' | null;
  queueDriver: 'kafka' | 'redis-streams' | 'memory';
  redis: { status: 'up' | 'down' };
  queue: { status: 'up' | 'down'; lag: number | null; dlqDepth: number | null };
  lastProcessedAt: string | null;
  checkedAt: string;
};

export async function getPipelineStatus() {
  return (await api.get<PipelineStatus>('/system/pipeline')).data;
}
