#!/usr/bin/env node
/**
 * Apply 20260515b_bolt_execution_resilience.sql via direct pg
 * connection. Same pattern as apply-bolt-error-instrumentation.js.
 * Idempotent — safe to re-run.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const MIGRATION_FILE = path.join(
  __dirname,
  '../supabase/migrations/20260515b_bolt_execution_resilience.sql'
);

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL missing from environment');
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log(`[migrate] applying ${path.basename(MIGRATION_FILE)} (${sql.length} bytes)`);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log('[migrate] DDL applied');

    const { rows: runCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bolt_execution_runs'
        AND column_name IN (
          'lock_owner','lock_acquired_at','lock_expires_at',
          'cancel_requested','cancel_requested_at','cancel_requested_by',
          'heartbeat_at'
        )
      ORDER BY column_name;
    `);
    console.log('[migrate] bolt_execution_runs new cols:', runCols.map((r) => r.column_name).join(', '));

    const { rows: schedCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'scheduled_posts'
        AND column_name = 'idempotency_key';
    `);
    console.log(`[migrate] scheduled_posts.idempotency_key present: ${schedCols.length > 0}`);

    const { rows: idxRows } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (
        'idx_bolt_execution_runs_lock_expires',
        'idx_bolt_execution_runs_heartbeat',
        'uidx_scheduled_posts_idempotency_key'
      )
      ORDER BY indexname;
    `);
    console.log('[migrate] indexes present:', idxRows.map((r) => r.indexname).join(', '));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
