import type { Monitor } from '../api/monitors';

export function statusFor(monitor: Monitor) {
  return !monitor.isActive ? 'paused' : monitor.currentStatus;
}
export function StatusBadge({ monitor }: { monitor: Monitor }) {
  const state = statusFor(monitor);
  const label =
    state === 'up' ? 'Up' : state === 'down' ? 'Down' : state === 'paused' ? 'Paused' : 'Pending';
  const icon = state === 'up' ? '✓' : state === 'down' ? '×' : state === 'paused' ? 'Ⅱ' : '◷';
  return (
    <span className={`status-pill status-${state}`}>
      <b>{icon}</b>
      {label}
    </span>
  );
}
