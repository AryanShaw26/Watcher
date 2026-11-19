import { env } from '../config/env.js';

export type NotificationPayload = {
  title?: string;
  body?: string;
  monitor?: { id: string; name: string; url: string };
  incident?: {
    id: string;
    startedAt: string;
    resolvedAt: string | null;
    durationSeconds: number | null;
    failedChecks: number;
  };
  check?: { statusCode: number | null; error: string | null; responseTimeMs: number | null };
  createdAt?: string;
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining ? `${minutes} min ${remaining} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}

function formatTime(value: string | undefined): string {
  return value
    ? new Date(value)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '')
    : 'Unknown time';
}

export function renderNotification(
  type: 'incident.opened' | 'incident.resolved' | 'test',
  payload: NotificationPayload,
) {
  if (type === 'test') {
    return {
      title: 'Test notification from Watcher',
      body: 'This channel is set up correctly.',
      color: '#FF7A1A',
    };
  }

  const monitor = payload.monitor;
  const incident = payload.incident;
  const check = payload.check;
  const link = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/incidents`;
  if (type === 'incident.opened') {
    const error = check?.error || (check?.statusCode ? `HTTP ${check.statusCode}` : 'Check failed');
    return {
      title: `${monitor?.name ?? 'Monitor'} is down`,
      body: `${monitor?.url ?? ''}\n${error} after ${incident?.failedChecks ?? 0} failed checks.\nStarted ${formatTime(incident?.startedAt)} UTC.\n${link}`,
      color: '#D91E2B',
    };
  }

  return {
    title: `${monitor?.name ?? 'Monitor'} recovered`,
    body: `${monitor?.url ?? ''}\nBack up after ${formatDuration(incident?.durationSeconds ?? 0)}.\n${link}`,
    color: '#FFC83D',
  };
}

export function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
