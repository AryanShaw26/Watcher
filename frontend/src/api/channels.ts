import { api } from './client';

export type ChannelType = 'slack' | 'discord' | 'webhook' | 'email';
export type Channel = {
  id: string;
  type: ChannelType;
  name: string;
  isActive: boolean;
  maskedTarget: string;
  createdAt: string;
};
export type ChannelResponse = Channel & { signingSecret?: string };

export const channelApi = {
  list: async () =>
    (await api.get<{ channels: Channel[]; availableTypes: ChannelType[] }>('/channels')).data,
  create: async (input: { type: ChannelType; name: string; url?: string }) =>
    (await api.post<{ channel: ChannelResponse }>('/channels', input)).data.channel,
  update: async (id: string, patch: Partial<{ name: string; isActive: boolean; url: string }>) =>
    (await api.patch<{ channel: Channel }>(`/channels/${id}`, patch)).data.channel,
  remove: async (id: string) => api.delete(`/channels/${id}`),
  test: async (id: string) => (await api.post(`/channels/${id}/test`)).data,
};
