/**
 * OPS DDL — 2026-08-13, LI-1 canonical attribute surface.
 *
 * Applies supabase/migrations/20261001000000_li1_canonical_attribute_surface.sql
 * to the production database via the pooler. The migration ledger is desynced,
 * so `db push` is never used; this script is the sanctioned application
 * mechanism and the migration file is the record. Same pattern as W0, W0.1, W1,
 * W2 and W5.
 *
 * Adds 12 nullable columns to unified_persons and 9 to prospect_accounts, plus
 * their CHECK constraints, plus ONE guarded backfill (leads.name -> full_name).
 * It creates no table, no index, no foreign key and no unique constraint, and
 * it alters no existing column.
 *
 * Fails closed. Asserts, either side of the DDL, that identity and tenancy are
 * untouched: row counts, the identity fingerprint (which person holds which
 * email/phone/account under which tenant), the W5 composite foreign keys, and
 * the account identity indexes.
 *
 * Run: node scripts/ops/li1-canonical-attribute-surface-ddl-20260813.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20261001000000_li1_canonical_attribute_surface.sql';

const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'lead_intelligence', 'canonical_leads', 'canonical_users',
  'engagement_threads', 'unified_touchpoints', 'unified_person_merges'];

const PERSON_COLS = ['full_name', 'first_name', 'last_name', 'job_title', 'department',
  'seniority', 'country_code', 'region', 'city', 'timezone', 'attributes_source', 'attributes_updated_at'];
const ACCOUNT_COLS = ['industry', 'employee_count', 'employee_band', 'country_code',
  'region', 'city', 'description', 'attributes_source', 'attributes_updated_at'];

/** Identity keys that must survive byte-identical — attributes may not disturb them. */
const IDENTITY_INDEXES = [
  'uq_unified_persons_id_company',
  'idx_unified_persons_company_email_unique',
  'idx_unified_persons_company_phone_unique',
  'uq_prospect_accounts_id_org',
  'uq_prospect_accounts_org_domain_active',
  'uq_prospect_accounts_org_source_ref',
];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/** Who is who, under which tenant, pointing at which employer. Must not change. */
async function identityFingerprint(client) {
  const { rows } = await client.query(`
    SELECT coalesce(md5(string_agg(
             id::text||'|'||company_id::text||'|'||
             coalesce(primary_email,'~')||'|'||coalesce(primary_phone,'~')||'|'||
             coalesce(account_id::text,'~')||'|'||external_keys::text,
             E'\n' ORDER BY id::text)), 'empty') h
    FROM public.unified_persons`);
  return rows[0].h;
}

async function personFks(client) {
  const { rows } = await client.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) d
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.confrelid
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE con.contype='f' AND n.nspname='public' AND t.relname='unified_persons'
    ORDER BY con.conname`);
  return rows;
}

async function indexDefs(client, names) {
  const { rows } = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
    [names]);
  return rows;
}

async function presentColumns(client, table, cols) {
  const { rows } = await client.query(
    `SELECT attname FROM pg_attribute
      WHERE attrelid = ('public.'||$1)::regclass AND NOT attisdropped AND attname = ANY($2::text[])`,
    [table, cols]);
  return rows.map((r) => r.attname).sort();
}

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log('=== LI-1 PRECONDITIONS ===');

    const before = await counts(client);
    const fpBefore = await identityFingerprint(client);
    const fksBefore = await personFks(client);
    const idxBefore = await indexDefs(client, IDENTITY_INDEXES);
    console.log(`  row counts: ${JSON.stringify(before)}`);
    console.log(`  inbound person FKs: ${fksBefore.length} (composite: ${fksBefore.filter((f) => /\([a-z_]+, [a-z_]+\)/.test(f.d)).length})`);
    console.log(`  identity indexes present: ${idxBefore.length}/${IDENTITY_INDEXES.length}`);
    if (idxBefore.length !== IDENTITY_INDEXES.length) {
      throw new Error('an identity index is missing before LI-1 — refusing to proceed');
    }

    // Backfill candidates, computed the same way the migration does.
    const cand = (await client.query(`
      SELECT count(*)::int n FROM (
        SELECT l.unified_person_id FROM public.leads l
         WHERE l.unified_person_id IS NOT NULL AND l.name IS NOT NULL AND length(btrim(l.name)) > 0
         GROUP BY l.unified_person_id, l.company_id
        HAVING count(DISTINCT btrim(l.name)) = 1) x`)).rows[0].n;
    const ambiguous = (await client.query(`
      SELECT count(*)::int n FROM (
        SELECT l.unified_person_id FROM public.leads l
         WHERE l.unified_person_id IS NOT NULL AND l.name IS NOT NULL
         GROUP BY l.unified_person_id HAVING count(DISTINCT btrim(l.name)) > 1) x`)).rows[0].n;
    console.log(`  backfill candidates: ${cand} · ambiguous (will stay NULL): ${ambiguous}`);

    console.log('\n=== APPLYING LI-1 ===');
    await client.query(sql);
    console.log(`  applied ${MIGRATION}`);

    console.log('\n=== LI-1 POSTCONDITIONS ===');
    const pCols = await presentColumns(client, 'unified_persons', PERSON_COLS);
    const aCols = await presentColumns(client, 'prospect_accounts', ACCOUNT_COLS);
    console.log(`  unified_persons attribute columns  : ${pCols.length}/12`);
    console.log(`  prospect_accounts attribute columns: ${aCols.length}/9`);
    if (pCols.length !== 12) throw new Error(`missing person columns: ${PERSON_COLS.filter((c) => !pCols.includes(c))}`);
    if (aCols.length !== 9) throw new Error(`missing account columns: ${ACCOUNT_COLS.filter((c) => !aCols.includes(c))}`);

    // Identity must be exactly as it was.
    const after = await counts(client);
    const fpAfter = await identityFingerprint(client);
    const fksAfter = await personFks(client);
    const idxAfter = await indexDefs(client, IDENTITY_INDEXES);

    const countsSame = JSON.stringify(before) === JSON.stringify(after);
    const fpSame = fpBefore === fpAfter;
    const fksSame = JSON.stringify(fksBefore) === JSON.stringify(fksAfter);
    const idxSame = JSON.stringify(idxBefore) === JSON.stringify(idxAfter);

    console.log(`  row counts unchanged            : ${countsSame}`);
    console.log(`  identity fingerprint unchanged  : ${fpSame}`);
    console.log(`  person foreign keys unchanged   : ${fksSame}`);
    console.log(`  identity indexes unchanged      : ${idxSame}`);
    if (!countsSame) throw new Error(`row counts changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    if (!fpSame) throw new Error('identity fingerprint changed — LI-1 must not touch identity');
    if (!fksSame) throw new Error('a person foreign key changed');
    if (!idxSame) throw new Error('an identity index changed');

    // Backfill landed, and only where it was allowed to.
    const bf = (await client.query(`
      SELECT count(*) FILTER (WHERE attributes_source = 'li1_backfill_lead_name')::int backfilled,
             count(*) FILTER (WHERE full_name IS NOT NULL)::int with_name,
             count(*) FILTER (WHERE first_name IS NOT NULL OR last_name IS NOT NULL)::int split_names,
             count(*) FILTER (WHERE job_title IS NOT NULL OR seniority IS NOT NULL
                              OR country_code IS NOT NULL)::int other_attrs
        FROM public.unified_persons`)).rows[0];
    console.log(`  backfilled full_name            : ${bf.backfilled} (expected ${cand})`);
    console.log(`  first/last name fabricated      : ${bf.split_names} (must be 0)`);
    console.log(`  other attributes fabricated     : ${bf.other_attrs} (must be 0)`);
    if (bf.backfilled !== cand) throw new Error(`backfill count ${bf.backfilled} != expected ${cand}`);
    if (bf.split_names !== 0) throw new Error('first/last name were populated — that would be inference');
    if (bf.other_attrs !== 0) throw new Error('non-backfill attributes were populated');

    const traceable = (await client.query(`
      SELECT count(*)::int n FROM public.unified_persons p
       WHERE p.attributes_source = 'li1_backfill_lead_name'
         AND NOT EXISTS (SELECT 1 FROM public.leads l
                          WHERE l.unified_person_id = p.id AND l.company_id = p.company_id
                            AND btrim(l.name) = p.full_name)`)).rows[0].n;
    console.log(`  backfilled names not traceable  : ${traceable} (must be 0)`);
    if (traceable !== 0) throw new Error('a backfilled name is not traceable to a same-tenant lead');

    console.log('\nLI-1 APPLIED — canonical attribute surface in force; identity untouched.');
  } catch (err) {
    console.error('\nLI-1 FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
