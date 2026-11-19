import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { channelApi, type Channel, type ChannelType } from '../api/channels';
import { notificationApi, type Notification } from '../api/notifications';
import { TopBar } from '../components/TopBar';

function errorText(cause: unknown, fallback: string) {
  if (axios.isAxiosError(cause)) {
    const code = cause.response?.data?.error?.code;
    if (code === 'CHANNEL_LIMIT_REACHED')
      return "You've reached the limit of 5 channels. Delete one to add another.";
    if (code === 'CHANNEL_TYPE_UNAVAILABLE') return "Email alerts aren't available on this server.";
    if (code === 'URL_NOT_ALLOWED') return 'Enter a valid public HTTPS webhook URL.';
    if (code === 'CHANNEL_INACTIVE') return 'This channel is inactive.';
  }
  return fallback;
}

function statusLabel(status: Notification['status']) {
  return status[0].toUpperCase() + status.slice(1);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <>
      <button type="button" className="secondary copy-button" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: channelApi.list });
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationApi.list({ limit: 50 }),
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.status === 'pending' || row.status === 'sending')
        ? 10000
        : 60000,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState('');
  const [testMessage, setTestMessage] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: { type: ChannelType; name: string; url?: string }) =>
      channelApi.create(input),
    onSuccess: (channel) => {
      setFormOpen(false);
      setError('');
      if (channel.signingSecret) setSecret(channel.signingSecret);
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (cause) => setError(errorText(cause, 'Could not add channel')),
  });

  async function toggle(channel: Channel) {
    await channelApi.update(channel.id, { isActive: !channel.isActive });
    queryClient.invalidateQueries({ queryKey: ['channels'] });
  }
  async function remove(channel: Channel) {
    if (confirm(`Delete ${channel.name}?`)) {
      await channelApi.remove(channel.id);
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    }
  }
  async function test(channel: Channel) {
    setTestMessage('');
    try {
      await channelApi.test(channel.id);
      setTestMessage('Test notification queued');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (cause) {
      setError(errorText(cause, 'Could not send test notification'));
    }
  }

  const channels = channelsQuery.data?.channels || [];
  const availableTypes = channelsQuery.data?.availableTypes || [];

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="page-heading">
          <h1>Settings</h1>
        </div>
        <section className="settings-section clay-panel">
          <div className="section-heading">
            <h2>Alert channels</h2>
            <button
              className="primary"
              onClick={() => {
                setError('');
                setFormOpen(true);
              }}
            >
              Add channel
            </button>
          </div>
          {channels.length === 0 ? (
            <div className="empty channels-empty">
              <p>No alert channels yet. Add one to get notified when an incident starts.</p>
            </div>
          ) : (
            <div className="channel-list">
              {channels.map((channel) => (
                <article className="channel-card" key={channel.id}>
                  <span className={`channel-icon channel-${channel.type}`}>
                    {channel.type === 'slack'
                      ? 'S'
                      : channel.type === 'discord'
                        ? 'D'
                        : channel.type === 'webhook'
                          ? 'W'
                          : 'E'}
                  </span>
                  <div className="channel-main">
                    <strong>{channel.name}</strong>
                    <span>{channel.maskedTarget}</span>
                  </div>
                  <label className="active-toggle">
                    <input
                      type="checkbox"
                      checked={channel.isActive}
                      onChange={() => toggle(channel)}
                    />
                    Active
                  </label>
                  <button className="secondary" onClick={() => test(channel)}>
                    Send test
                  </button>
                  <button className="ghost danger" onClick={() => remove(channel)}>
                    Delete
                  </button>
                </article>
              ))}
            </div>
          )}
          {!availableTypes.includes('email') && availableTypes.length > 0 && (
            <p className="availability">Email alerts aren't available on this server.</p>
          )}
          {error && (
            <p className="error" role="alert">
              ! {error}
            </p>
          )}
          <p className="sr-only" aria-live="polite">
            {testMessage}
          </p>
        </section>
        <section className="settings-section clay-panel">
          <h2>Notification history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Monitor</th>
                  <th>Event</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {notificationsQuery.data?.map((notification) => (
                  <tr key={notification.id}>
                    <td>{new Date(notification.createdAt).toLocaleString()}</td>
                    <td>{notification.monitorName}</td>
                    <td>{notification.type}</td>
                    <td>{notification.channelName}</td>
                    <td title={notification.lastError || undefined}>
                      <span
                        className={`status-pill status-${notification.status === 'sent' ? 'up' : notification.status === 'failed' ? 'down' : notification.status === 'suppressed' ? 'pending' : 'paused'}`}
                      >
                        {statusLabel(notification.status)}
                      </span>
                      {notification.lastError && (
                        <span className="mobile-error">{notification.lastError}</span>
                      )}
                    </td>
                    <td>{notification.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="settings-section clay-panel api-key-slot" aria-label="API keys">
          <h2>API keys</h2>
          <p>API key management is not enabled in this version.</p>
          {/* Step 15 optional slot: implement API key panel here only when enabled. */}
        </section>
        {formOpen && (
          <ChannelForm
            availableTypes={availableTypes}
            onClose={() => setFormOpen(false)}
            onSubmit={(input) => createMutation.mutate(input)}
          />
        )}
        {secret && (
          <div className="modal-overlay" role="presentation">
            <div
              className="modal clay-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="secret-title"
            >
              <h2 id="secret-title">Webhook signing secret</h2>
              <code className="secret-value">{secret}</code>
              <p>This secret is shown once. Store it somewhere safe.</p>
              <div className="modal-actions">
                <CopyButton value={secret} />
                <button className="primary" onClick={() => setSecret(undefined)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function ChannelForm({
  availableTypes,
  onClose,
  onSubmit,
}: {
  availableTypes: ChannelType[];
  onClose: () => void;
  onSubmit: (input: { type: ChannelType; name: string; url?: string }) => void;
}) {
  const [type, setType] = useState<ChannelType>(availableTypes[0] || 'slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const needsUrl = type !== 'email';
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal clay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-title"
      >
        <h2 id="channel-title">Add channel</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ type, name, url: needsUrl ? url : undefined });
          }}
        >
          <label>
            Type
            <select
              className="clay-well"
              value={type}
              onChange={(event) => setType(event.target.value as ChannelType)}
            >
              {availableTypes.map((value) => (
                <option key={value} value={value}>
                  {value === 'webhook' ? 'Webhook' : value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              className="clay-well"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
            />
          </label>
          {needsUrl && (
            <label>
              URL
              <input
                className="clay-well"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </label>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit">
              Add channel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
