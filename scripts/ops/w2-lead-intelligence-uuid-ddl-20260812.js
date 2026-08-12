/**
 * OPS DDL — 2026-08-12, W2 canonical intelligence / UUID reconciliation.
 *
 * Applies supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql
 * to the production database via the pooler (migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism, the
 * migration file is the record). Same pattern as W0, W0.1 and W1.
 *
 * Retypes three text identifier columns to uuid and adds three foreign keys.
 * Deletes nothing, deduplicates nothing, merges nothing.
 *
 * Asserts, either side of the DDL, that row counts AND the identifier values
 * themselves are unchanged — the value fingerprint is the property a retype
 * must never silently violate.
 *
 * Run: node scripts/ops/w2-lead-intelligence-uuid-ddl-20260812.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20260921000000_w2_lead_intelligence_uuid_reconciliation.sql';

const LEGACY = ['leads', 'contacts', 'active_leads', 'canonical_leads',
  'lead_intelligence', 'lead_intelligence_profiles', 'lead_intelligence_events',
  'unified_persons', 'companies', 'prospect_accounts', 'identity_claims'];

async function counts(client) {
  const out = {};
  for (const t of LEGACY) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/** Order-independent hash of the identifier triples, rendered as text either side of the retype. */
async function fingerprint(client) {
  const { rows } = await client.query(`
    SELECT md5(string_agg(id::text||'|'||company_id::text||'|'||coalesce(unified_person_id::text,'~'), E'\n' ORDER BY id::text)) h
    FROM public.lead_intelligence`);
  return rows[0].h;
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
    const fpBefore = await fingerprint(client);
    console.log('counts BEFORE     :', JSON.stringify(before));
    console.log('value md5 BEFORE  :', fpBefore);

    await client.query(sql);

    const after = await counts(client);
    const fpAfter = await fingerprint(client);
    console.log('counts AFTER      :', JSON.stringify(after));
    console.log('value md5 AFTER   :', fpAfter);

    for (const t of LEGACY) {
      if (before[t] !== after[t]) throw new Error(`${t} row count changed ${before[t]} → ${after[t]} — W2 must not add or remove rows`);
    }
    if (fpBefore !== fpAfter) throw new Error('identifier VALUES changed during retype — investigate immediately');

    const { rows: types } = await client.query(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='lead_intelligence' AND column_name IN ('company_id','unified_person_id'))
          OR (table_name='lead_intelligence_profiles' AND column_name='company_id'))
      ORDER BY 1,2`);
    console.log('types AFTER       :', JSON.stringify(types));
    if (types.some((r) => r.data_type !== 'uuid')) throw new Error('a target column is still not uuid');

    const { rows: fks } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid IN ('public.lead_intelligence'::regclass,'public.lead_intelligence_profiles'::regclass)
        AND contype='f' ORDER BY 1`);
    console.log('foreign keys      :');
    for (const f of fks) console.log('   ', f.conname, '=>', f.def);
    if (fks.length !== 3) throw new Error(`expected 3 foreign keys, found ${fks.length}`);

    const { rows: orphans } = await client.query(`
      SELECT (SELECT count(*)::int FROM public.lead_intelligence li
                WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=li.company_id)) co,
             (SELECT count(*)::int FROM public.lead_intelligence li
                WHERE li.unified_person_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.unified_persons u WHERE u.id=li.unified_person_id)) person,
             (SELECT count(*)::int FROM public.lead_intelligence li
                JOIN public.unified_persons u ON u.id=li.unified_person_id
                WHERE u.company_id <> li.company_id) tenant_mismatch`);
    console.log('integrity         :', JSON.stringify(orphans[0]), '(all must be 0)');
    if (orphans[0].co || orphans[0].person || orphans[0].tenant_mismatch) throw new Error('referential integrity violated after migration');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
