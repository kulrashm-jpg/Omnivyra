/**
 * OPS DDL — 2026-08-12, W0 (Phase 0.5 ADR, mandatory first item).
 *
 * Applies supabase/migrations/20260917000000_engagement_threads_window_columns.sql
 * to the production database via the pooler (migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record). Same pattern as
 * scripts/ops/company-approval-flag-ddl-20260711.js.
 *
 * Adds engagement_threads.window_expires_at (timestamptz NULL) and
 * .window_open (boolean DEFAULT false) plus the canonical partial index
 * idx_eng_threads_window — all additive and idempotent. Restores the
 * schema/code contract that pages/api/engagement/threads.ts:60 and
 * backend/queue/jobProcessors/whatsappWebhookProcessor.ts:109-110 already
 * depend on; currently failing 42703 for every tenant.
 *
 * Enables nothing. No WhatsApp activation, no outbound, no governance change.
 *
 * Run: node scripts/ops/engagement-threads-window-ddl-20260812.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20260917000000_engagement_threads_window_columns.sql';

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    // Row count is captured either side of the DDL: an additive ADD COLUMN
    // must not change it, and asserting that is cheaper than trusting it.
    const before = await client.query('SELECT count(*)::int AS n FROM public.engagement_threads');
    console.log('rows BEFORE:', before.rows[0].n);

    await client.query(sql);

    const { rows: cols } = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='engagement_threads'
        AND column_name IN ('window_open','window_expires_at')
      ORDER BY column_name
    `);
    const { rows: idx } = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='engagement_threads'
        AND indexname='idx_eng_threads_window'
    `);
    const after = await client.query('SELECT count(*)::int AS n FROM public.engagement_threads');

    console.log('APPLIED columns:', JSON.stringify(cols));
    console.log('APPLIED index  :', JSON.stringify(idx));
    console.log('rows AFTER:', after.rows[0].n);
    if (after.rows[0].n !== before.rows[0].n) {
      throw new Error(`row count changed ${before.rows[0].n} → ${after.rows[0].n} — investigate`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
