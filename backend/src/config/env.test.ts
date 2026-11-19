import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function runConfig(overrides: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', '--eval', "import('./src/config/env.ts')"],
    { encoding: 'utf8', env: { ...process.env, ...overrides } }
  );
}

describe('environment validation', () => {
  it.each([
    ['QUEUE_DRIVER', { NODE_ENV: 'production', QUEUE_DRIVER: 'memory', RATE_LIMIT_STORE: 'redis' }],
    ['RATE_LIMIT_STORE', { NODE_ENV: 'production', QUEUE_DRIVER: 'kafka', RATE_LIMIT_STORE: 'memory' }]
  ])('refuses production memory configuration for %s', (setting, overrides) => {
    const result = runConfig(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(setting);
  });

  it('rejects unknown roles', () => {
    const result = runConfig({ ROLES: 'nonsense' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ROLES may contain only api, scheduler, consumer');
  });

  it('warns when private targets are allowed in production', () => {
    const result = runConfig({
      NODE_ENV: 'production',
      QUEUE_DRIVER: 'kafka',
      RATE_LIMIT_STORE: 'redis',
      ALLOW_PRIVATE_TARGETS: 'true'
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('ALLOW_PRIVATE_TARGETS=true in production');
  });
});
