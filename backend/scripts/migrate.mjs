import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';

const v1Migrations = [
  '1700000000001_create-users',
  '1700000000002_create-refresh-tokens',
  '1700000000003_create-monitors',
  '1700000000004_create-check-results'
];
const eventMigration = '1700000000005_add-check-result-event-id';
const v1Tables = ['users', 'refresh_tokens', 'monitors', 'check_results'];
const url = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!url) {
  console.error('Migration failed: set DIRECT_DATABASE_URL or DATABASE_URL.');
  process.exit(1);
}
if (url.includes('-pooler')) {
  console.warn('Warning: database URL contains -pooler; advisory locks may be unreliable through a transaction pooler.');
}

function migrationSql(name) {
  return readFile(resolve('migrations', `${name}.sql`), 'utf8').then((text) => {
    const up = text.split(/-- Down Migration/i)[0].replace(/^-- Up Migration\s*/i, '').trim();
    if (!up) throw new Error(`Migration ${name} has no up SQL.`);
    return up;
  });
}

function normalized(value, schema) {
  return String(value ?? '').replaceAll(`${schema}.`, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function schemaSnapshot(client, schema) {
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema=$1 AND table_type='BASE TABLE' AND table_name <> 'pgmigrations'
     ORDER BY table_name`,
    [schema]
  );
  const columns = await client.query(
    `SELECT table_name,column_name,ordinal_position,data_type,udt_name,
            character_maximum_length,is_nullable,column_default
     FROM information_schema.columns
     WHERE table_schema=$1 AND table_name=ANY($2)
     ORDER BY table_name,ordinal_position`,
    [schema, v1Tables]
  );
  const constraints = await client.query(
    `SELECT rel.relname AS table_name, con.conname AS name, con.contype AS type,
            pg_get_constraintdef(con.oid,true) AS definition, con.convalidated AS validated
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid=con.conrelid
     JOIN pg_namespace ns ON ns.oid=rel.relnamespace
     WHERE ns.nspname=$1 AND rel.relname=ANY($2)
     ORDER BY rel.relname,con.conname`,
    [schema, v1Tables]
  );
  const indexes = await client.query(
    `SELECT tablename,indexname,indexdef FROM pg_indexes
     WHERE schemaname=$1 AND tablename=ANY($2)
     ORDER BY tablename,indexname`,
    [schema, v1Tables]
  );

  return {
    tables: tables.rows.map((row) => row.table_name),
    columns: columns.rows.map((row) => ({
      ...row,
      column_default: normalized(row.column_default, schema)
    })),
    constraints: constraints.rows.map((row) => ({
      ...row,
      definition: normalized(row.definition, schema)
    })),
    indexes: indexes.rows.map((row) => ({
      table: row.tablename,
      name: row.indexname,
      definition: normalized(row.indexdef, schema)
    }))
  };
}

function entryKey(category, entry) {
  if (category === 'tables') return entry;
  if (category === 'columns') return `${entry.table_name}.${entry.column_name}`;
  if (category === 'constraints') return `${entry.table_name}.${entry.name}`;
  return `${entry.table}.${entry.name}`;
}

function describeDifference(category, expected, actual) {
  const expectedMap = new Map(expected[category].map((entry) => [entryKey(category, entry), entry]));
  const actualMap = new Map(actual[category].map((entry) => [entryKey(category, entry), entry]));
  const keys = [...new Set([...expectedMap.keys(), ...actualMap.keys()])].sort();
  const differences = [];
  for (const key of keys) {
    const want = expectedMap.get(key);
    const have = actualMap.get(key);
    if (JSON.stringify(want) !== JSON.stringify(have)) {
      differences.push(`  ${key}: expected ${JSON.stringify(want ?? null)}, found ${JSON.stringify(have ?? null)}`);
    }
  }
  return differences;
}

async function findTable(client, table) {
  const result = await client.query('SELECT to_regclass($1) AS name', [`public.${table}`]);
  return result.rows[0].name !== null;
}

async function recordValidatedLegacyBaseline(client) {
  if (!(await findTable(client, 'pgmigrations'))) {
    const existing = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name=ANY($1)`,
      [v1Tables]
    );
    if (existing.rowCount) {
      throw new Error('Legacy application tables exist without pgmigrations; refusing to baseline an untracked schema.');
    }
    return;
  }

  const history = await client.query('SELECT name FROM public.pgmigrations');
  const applied = new Set(history.rows.map((row) => row.name));
  const eventColumn = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='check_results' AND column_name='event_id'`
  );
  if (eventColumn.rowCount && !applied.has(eventMigration)) {
    throw new Error(`public.check_results.event_id exists but ${eventMigration} is not recorded; refusing to continue.`);
  }
  if (history.rowCount) return;

  const existing = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY($1)`,
    [v1Tables]
  );
  if (!existing.rowCount) return;

  const schema = `watcher_expected_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const migration of v1Migrations) {
      await client.query(await migrationSql(migration));
    }

    const expected = await schemaSnapshot(client, schema);
    const actual = await schemaSnapshot(client, 'public');
    const differences = ['tables', 'columns', 'constraints', 'indexes']
      .flatMap((category) => describeDifference(category, expected, actual));
    if (differences.length) {
      throw new Error(`Existing V1 schema does not exactly match migrations 1-4:\n${differences.join('\n')}`);
    }

    await client.query('SET LOCAL search_path TO public');
    for (const migration of v1Migrations) {
      await client.query('INSERT INTO public.pgmigrations (name,run_on) VALUES ($1,now())', [migration]);
    }
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.query('COMMIT');
    console.info('Validated the existing V1 schema exactly against migrations 1-4 and recorded its four history entries; application data was not changed.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
  try {
    await client.connect();
    await recordValidatedLegacyBaseline(client);
  } finally {
    await client.end();
  }

  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/node-pg-migrate/bin/node-pg-migrate.js'),
      'up',
      '--database-url-var', 'WATCHER_MIGRATION_DATABASE_URL',
      '--migrations-dir', 'migrations'
    ],
    { stdio: 'inherit', env: { ...process.env, WATCHER_MIGRATION_DATABASE_URL: url } }
  );
  if (result.error) throw new Error(`Could not run database migrations: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Migration command failed with exit code ${result.status ?? 'unknown'}.`);
}

main().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
