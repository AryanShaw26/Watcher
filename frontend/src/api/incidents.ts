import { api } from './client';

export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string;
  status: 'open' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number;
  failedChecks: number;
  openedError: string | null;
  lastError: string | null;
  lastStatusCode: number | null;
};

export const incidentApi = {
  list: async (
    params: {
      status?: 'open' | 'resolved' | 'all';
      monitorId?: string;
      limit?: number;
      before?: string;
    } = {},
  ) => (await api.get<{ incidents: Incident[] }>('/incidents', { params })).data.incidents,
};
