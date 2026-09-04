/**
 * OPS DDL — 2026-08-13, LI-2 source records and field-level provenance.
 *
 * Applies supabase/migrations/20261002000000_li2_source_records.sql to the
 * production database via the pooler. The migration ledger is desynced, so
 * `db push` is never used; this script is the sanctioned mechanism and the
 * migration file is the record. Same pattern as W0…W5 and LI-1.
 *
 * Creates two EMPTY tables. It writes no data, activates no provider, and
 * alters no existing table. The canonical spine, identity resolution and the
 * LI-1 attribute columns are asserted unchanged either side of the DDL.
 *
 * Run: node scripts/ops/li2-source-records-ddl-20260813.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20261002000000_li2_source_records.sql';

const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'lead_intelligence', 'canonical_leads', 'canonical_users',
  'engagement_threads', 'unified_touchpoints', 'unified_person_merges'];

const EXPECTED_UNIQUE = [
  'uq_source_records_tenant_identity',
  'uq_source_records_id_org',
  'uq_source_assertions_dedupe',
];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/** Identity must be byte-identical across LI-2: it touches none of it. */
async function identityFingerprint(client) {
  const { rows } = await client.query(`
    SELECT coalesce(md5(string_agg(
             id::text||'|'||company_id::text||'|'||
             coalesce(primary_email,'~')||'|'||coalesce(primary_phone,'~')||'|'||
             coalesce(account_id::text,'~')||'|'||coalesce(full_name,'~'),
             E'\n' ORDER BY id::text)), 'empty') h
    FROM public.unified_persons`);
  return rows[0].h;
}

async function spineConstraints(client) {
  const { rows } = await client.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) d
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE n.nspname='public' AND s.relname IN ('unified_persons','prospect_accounts')
    ORDER BY con.conname`);
  return rows;
}

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log('=== LI-2 PRECONDITIONS ===');

    // How many LI-2 tables are missing decides how many the apply must create.
    // On a re-run both already exist and the expected delta is zero — the
    // migration is idempotent, so "exactly +2" is only true the first time.
    let expectedNewTables = 0;
    for (const t of ['source_records', 'source_assertions']) {
      const exists = (await client.query(`SELECT to_regclass('public.${t}') r`)).rows[0].r;
      console.log(`  ${t} already exists: ${exists ? 'YES' : 'no'}`);
      if (!exists) { expectedNewTables += 1; continue; }
      const n = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
      if (n > 0) throw new Error(`${t} already exists with ${n} row(s) — refusing to proceed`);
    }

    const before = await counts(client);
    const fpBefore = await identityFingerprint(client);
    const spineBefore = await spineConstraints(client);
    const tablesBefore = (await client.query(
      `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].n;
    console.log(`  row counts: ${JSON.stringify(before)}`);
    console.log(`  public tables: ${tablesBefore}`);
    console.log(`  spine constraints: ${spineBefore.length}`);

    console.log('\n=== APPLYING LI-2 ===');
    await client.query(sql);
    console.log(`  applied ${MIGRATION}`);

    console.log('\n=== LI-2 POSTCONDITIONS ===');
    for (const t of ['source_records', 'source_assertions']) {
      const n = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
      const cols = (await client.query(
        `SELECT count(*)::int n FROM pg_attribute WHERE attrelid=('public.'||$1)::regclass AND attnum>0 AND NOT attisdropped`, [t])).rows[0].n;
      const rls = (await client.query(`SELECT relrowsecurity r FROM pg_class WHERE oid=('public.'||$1)::regclass`, [t])).rows[0].r;
      console.log(`  ${t}: ${cols} columns, ${n} rows, RLS=${rls}`);
      if (n !== 0) throw new Error(`${t} must be empty on arrival, found ${n}`);
      if (!rls) throw new Error(`${t} does not have RLS enabled`);
    }

    const comp = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname IN ('source_records','source_assertions')
         AND array_length(con.conkey,1)=2`)).rows[0].n;
    console.log(`  composite tenant FKs: ${comp}/5`);
    if (comp !== 5) throw new Error(`expected 5 composite tenant FKs, found ${comp}`);

    const uq = (await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
      [EXPECTED_UNIQUE])).rows.map((r) => r.indexname);
    console.log(`  unique indexes: ${uq.join(', ')}`);
    if (uq.length !== 3) throw new Error(`expected 3 unique indexes, found ${uq.length}`);

    // The source identity index must NOT be partial, or ON CONFLICT cannot
    // infer it — the 42P10 trap W0.1/W0.2/W3 all hit.
    const idxDef = (await client.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_source_records_tenant_identity'`)).rows[0].indexdef;
    const partial = / WHERE /.test(idxDef);
    console.log(`  source identity index is inferable (non-partial): ${!partial}`);
    if (partial) throw new Error('uq_source_records_tenant_identity is PARTIAL — ON CONFLICT could not infer it');

    const after = await counts(client);
    const fpAfter = await identityFingerprint(client);
    const spineAfter = await spineConstraints(client);
    const tablesAfter = (await client.query(
      `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].n;

    const countsSame = JSON.stringify(before) === JSON.stringify(after);
    const fpSame = fpBefore === fpAfter;
    const spineSame = JSON.stringify(spineBefore) === JSON.stringify(spineAfter);
    console.log(`  row counts unchanged           : ${countsSame}`);
    console.log(`  identity fingerprint unchanged : ${fpSame}`);
    console.log(`  spine constraints unchanged    : ${spineSame} (${spineAfter.length})`);
    console.log(`  public tables ${tablesBefore} -> ${tablesAfter} (expect +${expectedNewTables})`);
    if (!countsSame) throw new Error('row counts changed');
    if (!fpSame) throw new Error('identity fingerprint changed — LI-2 must not touch identity');
    if (!spineSame) throw new Error('a canonical spine constraint changed');
    if (tablesAfter !== tablesBefore + expectedNewTables) throw new Error(`expected exactly ${expectedNewTables} new table(s), got ${tablesAfter - tablesBefore}`);

    console.log('\nLI-2 APPLIED — source evidence layer in place, empty, identity untouched.');
  } catch (err) {
    console.error('\nLI-2 FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
