/**
 * OPS DDL — 2026-08-12, W1 canonical prospect / identity foundation.
 *
 * Applies supabase/migrations/20260920000000_w1_prospect_identity_foundation.sql
 * to the production database via the pooler (migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record). Same pattern as
 * scripts/ops/engagement-threads-window-ddl-20260812.js (W0) and
 * scripts/ops/engagement-threads-arbiter-ddl-20260812.js (W0.1).
 *
 * Creates prospect_accounts and identity_claims (both EMPTY) plus
 * unified_persons.account_id (nullable). Migrates no data, touches no legacy
 * lead model, contacts nobody, enables nothing.
 *
 * Asserts before and after that every legacy model's row count is unchanged —
 * the one property a "foundation" migration must never quietly violate.
 *
 * Run: node scripts/ops/w1-prospect-identity-ddl-20260812.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20260920000000_w1_prospect_identity_foundation.sql';

// Legacy models W1 must leave completely alone.
const LEGACY = ['leads', 'contacts', 'active_leads', 'canonical_leads',
  'lead_intelligence', 'lead_intelligence_profiles', 'unified_persons', 'companies'];

async function counts(client) {
  const out = {};
  for (const t of LEGACY) {
    const { rows } = await client.query(`SELECT count(*)::int n FROM public.${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const before = await counts(client);
    console.log('legacy counts BEFORE:', JSON.stringify(before));

    await client.query(sql);

    const after = await counts(client);
    console.log('legacy counts AFTER :', JSON.stringify(after));
    for (const t of LEGACY) {
      if (before[t] !== after[t]) {
        throw new Error(`${t} row count changed ${before[t]} → ${after[t]} — W1 must not migrate data`);
      }
    }

    const { rows: tables } = await client.query(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('prospect_accounts','identity_claims')
      ORDER BY 1`);
    console.log('created tables      :', JSON.stringify(tables));

    const { rows: col } = await client.query(`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='unified_persons' AND column_name='account_id'`);
    console.log('unified_persons.account_id:', JSON.stringify(col));

    const { rows: idx } = await client.query(`
      SELECT c.relname, i.indisunique, pg_get_expr(i.indpred, i.indrelid) predicate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname IN ('prospect_accounts','identity_claims')
      ORDER BY 1`);
    console.log('indexes             :', JSON.stringify(idx, null, 0));

    const { rows: newRows } = await client.query(`
      SELECT (SELECT count(*)::int FROM public.prospect_accounts) accounts,
             (SELECT count(*)::int FROM public.identity_claims) claims,
             (SELECT count(*)::int FROM public.unified_persons WHERE account_id IS NOT NULL) linked`);
    console.log('new tables rows     :', JSON.stringify(newRows[0]), '(all must be 0)');
    if (newRows[0].accounts !== 0 || newRows[0].claims !== 0 || newRows[0].linked !== 0) {
      throw new Error('W1 created rows — it must create structure only');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
