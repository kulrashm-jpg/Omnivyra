/**
 * W6 — regenerate the governed CI schema baseline.
 *
 * WHY THIS EXISTS. The repository's governed migration set cannot rebuild this
 * platform's schema on its own: replaying all 385 files onto an empty database
 * leaves 170 of them failing, because roughly half the schema was created by
 * the 312 ungoverned files under `database/` that were never promoted into
 * `supabase/migrations/`. Promoting them is a separate governance programme.
 * Until that lands, CI needs a schema source that is both real and complete, so
 * the baseline is a mechanically-produced schema-only snapshot of production.
 *
 * WHAT CI DOES WITH IT. CI never runs this script and never holds production
 * credentials. It reads the committed artifact, restores it into a disposable
 * container, replays any migration newer than the baseline's recorded ledger
 * position, and runs the invariant suite. See scripts/ci/real-schema-ci.sh.
 *
 * WHAT THIS SCRIPT TOUCHES. Production is READ ONLY: pg_dump --schema-only.
 * No data leaves the database, so the artifact contains no PII — only DDL.
 *
 * PREREQUISITES
 *   - Docker (pg_dump 17 runs inside a container, so no local Postgres client
 *     is needed and the dump version always matches the server)
 *   - SUPABASE_POOLER_DB_URL in .env.local (session-mode pooler, port 5432)
 *
 * Run: node scripts/ci/generate-schema-baseline.js
 */
require('dotenv').config({ path: '.env.local' });
const { execFileSync } = require('child_process');
const { writeFileSync, mkdirSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');

const IMAGE = 'pgvector/pgvector:pg17';
const OUT_DIR = join(__dirname, '../../supabase/_schema');
const OUT_SQL = join(OUT_DIR, 'baseline.sql');
const OUT_META = join(OUT_DIR, 'baseline.json');

/**
 * The connection string carries a raw `%` in the password, so it is not a
 * legal URI — parse it positionally rather than with URL().
 */
function parseConn(raw) {
  const s = raw.replace(/^postgres(ql)?:\/\//, '');
  const at = s.lastIndexOf('@');
  const cred = s.slice(0, at);
  const rest = s.slice(at + 1);
  const ci = cred.indexOf(':');
  const m = rest.match(/^([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error('could not parse host/port/database from SUPABASE_POOLER_DB_URL');
  return { host: m[1], port: m[2], database: m[3], user: cred.slice(0, ci), password: cred.slice(ci + 1) };
}

function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

function main() {
  const raw = process.env.SUPABASE_POOLER_DB_URL;
  if (!raw) throw new Error('SUPABASE_POOLER_DB_URL is not set; this script is a local developer step');
  const c = parseConn(raw);
  console.log(`Dumping schema from ${c.host}:${c.port}/${c.database} (schema-only, read-only)`);

  const env = [
    '-e', `PGHOST=${c.host}`, '-e', `PGPORT=${c.port}`, '-e', `PGUSER=${c.user}`,
    '-e', `PGPASSWORD=${c.password}`, '-e', `PGDATABASE=${c.database}`, '-e', 'PGSSLMODE=require',
  ];

  const sql = docker(['run', '--rm', ...env, IMAGE,
    'pg_dump', '--schema-only', '--no-owner', '--no-privileges', '--schema=public']);

  // The ledger position the baseline represents. Migrations at or below this
  // version are already inside the dump; anything above it is replayable.
  let ledger = [];
  try {
    ledger = docker(['run', '--rm', ...env, IMAGE, 'psql', '-tAc',
      'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    console.warn('  ledger unreadable; recording an empty ledger');
  }

  const tables = (sql.match(/^CREATE TABLE /gm) || []).length;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_SQL, sql, 'utf8');
  writeFileSync(OUT_META, `${JSON.stringify({
    generatedFrom: `${c.host}/${c.database}`,
    pgDumpImage: IMAGE,
    tables,
    lines: sql.split('\n').length,
    ledgerCount: ledger.length,
    ledgerMax: ledger.length ? ledger[ledger.length - 1] : null,
    note: 'Schema-only. No data, no PII. Regenerate with scripts/ci/generate-schema-baseline.js',
  }, null, 2)}\n`, 'utf8');

  console.log(`  wrote ${OUT_SQL} (${tables} tables, ${sql.split('\n').length} lines)`);
  console.log(`  ledger position: ${ledger.length ? ledger[ledger.length - 1] : 'none'} (${ledger.length} entries)`);

  if (existsSync(OUT_SQL) && readFileSync(OUT_SQL, 'utf8').length < 10000) {
    throw new Error('baseline looks truncated; refusing to leave it in place');
  }
}

main();
