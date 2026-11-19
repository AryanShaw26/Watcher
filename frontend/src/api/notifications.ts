import { api } from './client';

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';
export type Notification = {
  id: string;
  type: 'incident.opened' | 'incident.resolved' | 'test';
  status: NotificationStatus;
  channelType: 'slack' | 'discord' | 'webhook' | 'email';
  channelName: string;
  monitorName: string;
  incidentId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export const notificationApi = {
  list: async (params: { limit?: number; before?: string; status?: NotificationStatus } = {}) =>
    (await api.get<{ notifications: Notification[] }>('/notifications', { params })).data
      .notifications,
};
