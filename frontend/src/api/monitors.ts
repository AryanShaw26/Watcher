import { api } from './client';

export type Monitor = {
  id:string;name:string;url:string;method:'GET'|'HEAD';intervalSeconds:number;
  expectedStatusCode:number;timeoutMs:number;isActive:boolean;currentStatus:'pending'|'up'|'down';
  lastCheckedAt:string|null;lastResponseTimeMs:number|null;lastStatusCode:number|null;
  lastError:string|null;nextCheckAt:string;createdAt:string;updatedAt:string;
};
export type CheckResult = {id:number;checkedAt:string;status:'up'|'down';statusCode:number|null;responseTimeMs:number|null;error:string|null};
export type Stats = {window:'24h'|'7d';totalChecks:number;failedChecks:number;uptimePercent:number|null;avgResponseTimeMs:number|null};
export type MonitorInput = Pick<Monitor,'name'|'url'|'method'|'intervalSeconds'|'expectedStatusCode'|'timeoutMs'>;

export const monitorApi = {
  list:async () => (await api.get<{monitors:Monitor[]}>('/monitors')).data.monitors,
  get:async (id:string) => (await api.get<{monitor:Monitor}>(`/monitors/${id}`)).data.monitor,
  create:async (input:MonitorInput) => (await api.post<{monitor:Monitor}>('/monitors',input)).data.monitor,
  update:async (id:string,patch:Partial<MonitorInput&{isActive:boolean}>) => (await api.patch<{monitor:Monitor}>(`/monitors/${id}`,patch)).data.monitor,
  remove:async (id:string) => api.delete(`/monitors/${id}`),
  results:async (id:string) => (await api.get<{results:CheckResult[]}>(`/monitors/${id}/results?limit=100`)).data.results,
  stats:async (id:string,window:'24h'|'7d') => (await api.get<Stats>(`/monitors/${id}/stats?window=${window}`)).data,
  check:async (id:string) => (await api.post<{result:CheckResult;monitor:Monitor}>(`/monitors/${id}/check`)).data
};
