#!/usr/bin/env node
/**
 * Apply 20260515_bolt_pipeline_error_instrumentation.sql via direct pg
 * connection (SUPABASE_DB_URL). The Supabase JS client routes through
 * PostgREST and cannot execute arbitrary DDL, so we go direct.
 *
 * Idempotent: every ALTER uses IF NOT EXISTS.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const MIGRATION_FILE = path.join(
  __dirname,
  '../supabase/migrations/20260515_bolt_pipeline_error_instrumentation.sql'
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

    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bolt_execution_runs'
        AND column_name IN (
          'raw_error_message','error_stack','failed_stage',
          'failed_after_ms','pipeline_mode','campaign_type'
        )
      ORDER BY column_name;
    `);
    console.log('[migrate] new columns present:', rows.map((r) => r.column_name).join(', '));

    const { rows: idxRows } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'bolt_execution_runs'
        AND indexname = 'idx_bolt_execution_runs_failed_stage';
    `);
    console.log(`[migrate] failed-stage index present: ${idxRows.length > 0}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
