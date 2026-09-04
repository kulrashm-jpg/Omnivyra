/**
 * OPS DDL — 2026-08-13, LI-3B contact governance foundation.
 *
 * Applies supabase/migrations/20261003000000_li3_contact_governance.sql to the
 * production database via the pooler. The migration ledger is desynced, so
 * `db push` is never used; this script is the sanctioned mechanism and the
 * migration file is the record. Same pattern as W0…W5, LI-1 and LI-2.
 *
 * Creates ONE empty table. It writes no governance data, activates no channel,
 * touches neither legacy suppression table, and alters nothing existing.
 *
 * Fails closed, and refuses outright if either legacy suppression table has
 * gained rows since the ADR was written — that would change the deprecation
 * path decided in ADR §17 and must be re-decided, not worked around.
 *
 * Run: node scripts/ops/li3-contact-governance-ddl-20260813.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20261003000000_li3_contact_governance.sql';

const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'lead_intelligence', 'source_records', 'source_assertions',
  'suppression_entries', 'outreach_suppressions', 'outreach_governance_config'];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/** Identity must be byte-identical across LI-3B: it touches none of it. */
async function identityFingerprint(client) {
  const { rows } = await client.query(`
    SELECT coalesce(md5(string_agg(
             id::text||'|'||company_id::text||'|'||coalesce(primary_email,'~')||'|'||
             coalesce(primary_phone,'~')||'|'||coalesce(account_id::text,'~')||'|'||coalesce(full_name,'~'),
             E'\n' ORDER BY id::text)), 'empty') h
    FROM public.unified_persons`);
  return rows[0].h;
}

/** Every constraint on the tables LI-3B references but must not change. */
async function neighbourConstraints(client) {
  const { rows } = await client.query(`
    SELECT s.relname||'.'||con.conname n, pg_get_constraintdef(con.oid) d
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = s.relnamespace
    WHERE ns.nspname='public'
      AND s.relname IN ('unified_persons','prospect_accounts','source_records',
                        'source_assertions','suppression_entries','outreach_suppressions')
    ORDER BY 1`);
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
    console.log('=== LI-3B PRECONDITIONS ===');

    // ADR §17 assumed both legacy tables are empty. If that changed, the
    // deprecation path changes and this is no longer a safe additive step.
    const legacy = (await client.query(`
      SELECT (SELECT count(*)::int FROM public.suppression_entries) se,
             (SELECT count(*)::int FROM public.outreach_suppressions) os`)).rows[0];
    console.log(`  suppression_entries=${legacy.se} outreach_suppressions=${legacy.os}`);
    if (legacy.se !== 0 || legacy.os !== 0) {
      throw new Error('a legacy suppression table is no longer empty — ADR §17 must be re-decided before proceeding');
    }

    const li2 = (await client.query(`
      SELECT (SELECT count(*)::int FROM public.source_records) sr,
             (SELECT count(*)::int FROM public.source_assertions) sa`)).rows[0];
    console.log(`  source_records=${li2.sr} source_assertions=${li2.sa}`);

    const existing = (await client.query(`SELECT to_regclass('public.contact_governance_records') r`)).rows[0].r;
    let expectedNewTables = 1;
    if (existing) {
      expectedNewTables = 0;
      const n = (await client.query('SELECT count(*)::int n FROM public.contact_governance_records')).rows[0].n;
      console.log(`  contact_governance_records already exists with ${n} row(s)`);
      if (n > 0) throw new Error('contact_governance_records already holds data — refusing to proceed');
    } else {
      console.log('  contact_governance_records: not present (expected)');
    }

    const before = await counts(client);
    const fpBefore = await identityFingerprint(client);
    const neighboursBefore = await neighbourConstraints(client);
    const tablesBefore = (await client.query(
      `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].n;
    console.log(`  row counts: ${JSON.stringify(before)}`);
    console.log(`  public tables: ${tablesBefore} · neighbour constraints: ${neighboursBefore.length}`);

    console.log('\n=== APPLYING LI-3B ===');
    await client.query(sql);
    console.log(`  applied ${MIGRATION}`);

    console.log('\n=== LI-3B POSTCONDITIONS ===');
    const cols = (await client.query(
      `SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND attnum>0 AND NOT attisdropped`)).rows[0].n;
    const rows0 = (await client.query('SELECT count(*)::int n FROM public.contact_governance_records')).rows[0].n;
    const rls = (await client.query(
      `SELECT relrowsecurity r FROM pg_class WHERE oid='public.contact_governance_records'::regclass`)).rows[0].r;
    console.log(`  contact_governance_records: ${cols} columns, ${rows0} rows, RLS=${rls}`);
    if (rows0 !== 0) throw new Error(`table must be empty on arrival, found ${rows0}`);
    if (!rls) throw new Error('RLS is not enabled');

    // Tenant key must be uuid with a real FK — the whole point of D-1.
    const tenantType = (await client.query(
      `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND attname='organization_id'`)).rows[0].t;
    const tenantFk = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con
      JOIN pg_class s ON s.oid=con.conrelid JOIN pg_class t ON t.oid=con.confrelid
      WHERE con.contype='f' AND s.relname='contact_governance_records' AND t.relname='companies'`)).rows[0].n;
    console.log(`  tenant key: ${tenantType} with ${tenantFk} FK to companies`);
    if (tenantType !== 'uuid' || tenantFk !== 1) throw new Error('tenant key is not a uuid with a real FK to companies');

    // No global-scope escape hatch may exist.
    const forbidden = (await client.query(`
      SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='public.contact_governance_records'::regclass AND NOT attisdropped
          AND attname = ANY(ARRAY['scope','is_suppressed','suppressed','company_id'])`)).rows[0].n;
    console.log(`  forbidden columns (scope/is_suppressed/company_id): ${forbidden}`);
    if (forbidden !== 0) throw new Error('a global-scope or boolean-suppression column is present');

    const comp = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname='contact_governance_records' AND array_length(con.conkey,1)=2`)).rows[0].n;
    const chk = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='c' AND s.relname='contact_governance_records'`)).rows[0].n;
    console.log(`  composite tenant FKs: ${comp}/2 · CHECK constraints: ${chk}`);
    if (comp !== 2) throw new Error(`expected 2 composite tenant FKs, found ${comp}`);
    if (chk < 11) throw new Error(`expected at least 11 CHECK constraints, found ${chk}`);

    const idx = (await client.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_contact_governance_identity'`)).rows[0];
    console.log(`  idempotency index partial: ${/ WHERE /.test(idx.indexdef)}`);
    if (!/ WHERE /.test(idx.indexdef)) throw new Error('idempotency index is not partial as the ADR requires');

    const personFk = (await client.query(`
      SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='contact_governance_person_tenant_fk'`)).rows[0].d;
    console.log(`  person FK: ${personFk}`);
    if (!/SET NULL \(person_id\)/.test(personFk)) throw new Error('person FK is not ON DELETE SET NULL (person_id) — D-3 violated');

    // Nothing else may have moved.
    const after = await counts(client);
    const fpAfter = await identityFingerprint(client);
    const neighboursAfter = await neighbourConstraints(client);
    const tablesAfter = (await client.query(
      `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].n;

    const countsSame = JSON.stringify(before) === JSON.stringify(after);
    const fpSame = fpBefore === fpAfter;
    const neighboursSame = JSON.stringify(neighboursBefore) === JSON.stringify(neighboursAfter);
    console.log(`  row counts unchanged            : ${countsSame}`);
    console.log(`  identity fingerprint unchanged  : ${fpSame}`);
    console.log(`  neighbour constraints unchanged : ${neighboursSame} (${neighboursAfter.length})`);
    console.log(`  public tables ${tablesBefore} -> ${tablesAfter} (expect +${expectedNewTables})`);
    if (!countsSame) throw new Error('row counts changed');
    if (!fpSame) throw new Error('identity fingerprint changed — LI-3B must not touch identity');
    if (!neighboursSame) throw new Error('a neighbouring table constraint changed');
    if (tablesAfter !== tablesBefore + expectedNewTables) {
      throw new Error(`expected exactly ${expectedNewTables} new table(s), got ${tablesAfter - tablesBefore}`);
    }

    console.log('\nLI-3B APPLIED — contact_governance_records in place, empty, tenant-only, identity untouched.');
  } catch (err) {
    console.error('\nLI-3B FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
