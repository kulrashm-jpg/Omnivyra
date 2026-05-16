#!/usr/bin/env node
/**
 * Diagnostic: show the last 8 bolt_execution_runs with the new
 * instrumentation columns + lock state. One-shot, read-only.
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(`
      SELECT id, status, current_stage, progress_percentage,
             EXTRACT(EPOCH FROM (now() - created_at))::int AS age_sec,
             EXTRACT(EPOCH FROM (now() - COALESCE(heartbeat_at, updated_at)))::int AS since_hb_sec,
             lock_owner IS NOT NULL AS locked,
             EXTRACT(EPOCH FROM (lock_expires_at - now()))::int AS lock_ttl_sec,
             cancel_requested,
             failed_stage,
             SUBSTRING(COALESCE(raw_error_message, error_message), 1, 120) AS msg,
             campaign_type, pipeline_mode
      FROM bolt_execution_runs
      ORDER BY created_at DESC
      LIMIT 8;
    `);
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
