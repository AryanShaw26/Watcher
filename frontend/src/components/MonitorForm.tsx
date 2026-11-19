import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { monitorApi, type Monitor, type MonitorInput } from '../api/monitors';

export function MonitorForm({ monitor, onClose }: { monitor?: Monitor; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState<MonitorInput>({
    name: monitor?.name || '',
    url: monitor?.url || '',
    method: monitor?.method || 'GET',
    intervalSeconds: monitor?.intervalSeconds || 300,
    expectedStatusCode: monitor?.expectedStatusCode || 200,
    timeoutMs: monitor?.timeoutMs || 10000
  });
  const mutation = useMutation({
    mutationFn: () => monitor ? monitorApi.update(monitor.id, form) : monitorApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitors'] });
      onClose();
    },
    onError: (cause) => {
      if (axios.isAxiosError(cause)) {
        const code = cause.response?.data?.error?.code;
        setError(
          code === 'URL_NOT_ALLOWED'
            ? 'Watcher can only check public web addresses. Use an https:// URL reachable from the internet.'
            : code === 'MONITOR_LIMIT_REACHED'
              ? "You've reached the limit of 10 monitors. Delete one to add another."
              : cause.response?.data?.error?.message || 'Could not save monitor'
        );
      }
    }
  });

  return <div
    className="modal-overlay"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <div className="modal clay-panel" role="dialog" aria-modal="true" aria-labelledby="monitor-form-title">
      <h2 id="monitor-form-title">{monitor ? 'Edit monitor' : 'Add monitor'}</h2>
      <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
        <label>Name<input className="clay-well" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={100} /></label>
        <label>URL<input className="clay-well" type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} required maxLength={2048} /></label>
        <div className="form-grid">
          <label>Method
            <select className="clay-well" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value as 'GET' | 'HEAD' })}>
              <option>GET</option><option>HEAD</option>
            </select>
          </label>
          <label>Interval
            <select className="clay-well" value={form.intervalSeconds} onChange={(event) => setForm({ ...form, intervalSeconds: Number(event.target.value) })}>
              {[60, 300, 600, 900, 1800, 3600].map((value) =>
                <option key={value} value={value}>{value === 60 ? '1 minute' : `${value / 60} minutes`}</option>
              )}
            </select>
          </label>
          <label>Expected status<input className="clay-well" type="number" min={100} max={599} value={form.expectedStatusCode} onChange={(event) => setForm({ ...form, expectedStatusCode: Number(event.target.value) })} /></label>
          <label>Timeout (ms)<input className="clay-well" type="number" min={1000} max={30000} value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })} /></label>
        </div>
        {error && <p className="error" role="alert">! {error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={mutation.isPending}>{monitor ? 'Save changes' : 'Add monitor'}</button>
        </div>
      </form>
    </div>
  </div>;
}
