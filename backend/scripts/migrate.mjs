import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL or DIRECT_DATABASE_URL');
  process.exit(1);
}
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['node-pg-migrate','up','--database-url',url,'--migrations-dir','migrations'],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
