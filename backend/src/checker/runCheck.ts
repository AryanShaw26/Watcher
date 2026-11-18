import { performance } from 'node:perf_hooks';
import { request } from 'undici';
import { createSafeAgent } from '../lib/ssrf.js';

export type CheckOutcome = {
  status: 'up'|'down';
  statusCode: number|null;
  responseTimeMs: number|null;
  error: string|null;
  checkedAt: Date;
};

export async function runCheck(input: {
  url: string; method: 'GET'|'HEAD'; expectedStatusCode: number; timeoutMs: number;
}): Promise<CheckOutcome> {
  const started = performance.now();
  const agent = createSafeAgent();
  try {
    const response = await request(input.url, {
      method: input.method,
      dispatcher: agent,
      headersTimeout: input.timeoutMs,
      bodyTimeout: input.timeoutMs,
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: { 'user-agent': 'WatcherBot/1.0 (+uptime-monitor)' }
    });
    const elapsed = Math.round(performance.now() - started);
    await response.body.dump().catch(() => response.body.destroy());
    if (response.statusCode === input.expectedStatusCode) {
      return { status: 'up', statusCode: response.statusCode, responseTimeMs: elapsed, error: null, checkedAt: new Date() };
    }
    return {
      status: 'down', statusCode: response.statusCode, responseTimeMs: elapsed,
      error: `Expected ${input.expectedStatusCode}, got ${response.statusCode}`, checkedAt: new Date()
    };
  } catch (error: unknown) {
    const elapsed = Math.round(performance.now() - started);
    const text = error instanceof Error ? error.message : '';
    let mapped = 'Connection failed';
    if (/timeout|aborted/i.test(text)) mapped = `Timeout after ${input.timeoutMs}ms`;
    else if (/dns|lookup|ENOTFOUND/i.test(text)) mapped = 'DNS lookup failed';
    else if (/ECONNREFUSED|connection refused/i.test(text)) mapped = 'Connection refused';
    else if (/certificate|TLS|SSL/i.test(text)) mapped = 'TLS error';
    else if (/private|blocked|public/i.test(text)) mapped = 'Blocked: private address';
    return { status: 'down', statusCode: null, responseTimeMs: elapsed, error: mapped, checkedAt: new Date() };
  } finally {
    await agent.close();
  }
}
