/**
 * OPS DDL — 2026-08-12, W0.1 (follows W0).
 *
 * Applies supabase/migrations/20260918000000_engagement_threads_thread_arbiter.sql
 * to the production database via the pooler (migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record). Same pattern as
 * scripts/ops/engagement-threads-window-ddl-20260812.js.
 *
 * Replaces the PARTIAL unique index on
 * (platform, platform_thread_id, organization_id) with an equivalent
 * non-partial one, so the existing WhatsApp inbound upsert's column-only
 * ON CONFLICT can infer it (currently 42P10). Tenant scope unchanged —
 * organization_id remains in the key. No column, table or row is touched.
 *
 * Enables nothing. No WhatsApp activation, no outbound, no governance change.
 *
 * Run: node scripts/ops/engagement-threads-arbiter-ddl-20260812.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20260918000000_engagement_threads_thread_arbiter.sql';

const idxQuery = `
  SELECT c.relname AS name, i.indisunique AS uniq, pg_get_expr(i.indpred, i.indrelid) AS predicate
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname='public' AND t.relname='engagement_threads' AND i.indisunique
  ORDER BY c.relname`;

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const before = await client.query('SELECT count(*)::int AS n FROM public.engagement_threads');
    console.log('rows BEFORE:', before.rows[0].n);
    console.log('unique indexes BEFORE:', JSON.stringify((await client.query(idxQuery)).rows));

    await client.query(sql);

    const after = await client.query('SELECT count(*)::int AS n FROM public.engagement_threads');
    console.log('unique indexes AFTER :', JSON.stringify((await client.query(idxQuery)).rows));
    console.log('rows AFTER:', after.rows[0].n);

    if (after.rows[0].n !== before.rows[0].n) {
      throw new Error(`row count changed ${before.rows[0].n} → ${after.rows[0].n} — investigate`);
    }
    // The whole point of the change: the arbiter must now be inferable.
    const canInfer = (await client.query(idxQuery)).rows.some(
      (r) => r.name === 'idx_engagement_threads_platform_thread_org' && r.uniq && r.predicate === null,
    );
    console.log('arbiter inferable (unique, non-partial):', canInfer);
    if (!canInfer) throw new Error('arbiter index is still partial — migration did not take effect');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
