/**
 * OPS DDL — 2026-08-15, LI-4C person duplicate lifecycle and parking.
 *
 * Applies supabase/migrations/20261004000000_li4c_person_duplicates.sql to the
 * production database via the pooler. The migration ledger is desynced, so
 * `db push` is never used; this script is the sanctioned mechanism and the
 * migration file is the record. Same pattern as W0…W5, LI-1, LI-2 and LI-3B.
 *
 * Applies EXACTLY ONE migration. Never a batch.
 *
 * Unlike LI-3B this migration ALTERS an existing table — it adds `status` and
 * `merged_into_id` to `unified_persons`. So the identity fingerprint below
 * covers the VALUES that must not change, and the column count is expected to
 * rise by exactly two. Everything else must be byte-identical.
 *
 * Fails closed, and refuses outright if any person has already been merged or
 * if the candidate table already holds data — either would mean this is not the
 * additive first application it is written to be.
 *
 * Run: node scripts/ops/li4c-person-duplicates-ddl-20260815.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20261004000000_li4c_person_duplicates.sql';

const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'lead_intelligence', 'source_records', 'source_assertions',
  'contact_governance_records', 'canonical_leads', 'canonical_users'];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/**
 * The identity VALUES that must survive untouched. Deliberately excludes the two
 * new columns: they are what this migration adds.
 */
async function identityFingerprint(client) {
  const { rows } = await client.query(`
    SELECT coalesce(md5(string_agg(
             id::text||'|'||company_id::text||'|'||coalesce(primary_email,'~')||'|'||
             coalesce(primary_phone,'~')||'|'||coalesce(account_id::text,'~')||'|'||coalesce(full_name,'~'),
             E'\n' ORDER BY id::text)), 'empty') h
    FROM public.unified_persons`);
  return rows[0].h;
}

/** Constraints on the tables LI-4C references but must not change. */
async function neighbourConstraints(client) {
  const { rows } = await client.query(`
    SELECT s.relname||'.'||con.conname n, pg_get_constraintdef(con.oid) d
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = s.relnamespace
    WHERE ns.nspname='public'
      AND s.relname IN ('prospect_accounts','source_records','source_assertions',
                        'contact_governance_records','identity_claims','leads')
    ORDER BY 1`);
  return rows;
}

async function personColumns(client) {
  const { rows } = await client.query(`
    SELECT attname FROM pg_attribute
     WHERE attrelid='public.unified_persons'::regclass AND attnum>0 AND NOT attisdropped
     ORDER BY attname`);
  return rows.map((r) => r.attname);
}

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log('=== LI-4C PRECONDITIONS ===');

    // If the lifecycle already exists, this is a re-run. Permit it only when
    // nothing has been merged and nothing has been parked.
    const hasStatus = (await client.query(`
      SELECT count(*)::int n FROM pg_attribute
       WHERE attrelid='public.unified_persons'::regclass AND attname='status' AND NOT attisdropped`)).rows[0].n;
    const candTable = (await client.query(`SELECT to_regclass('public.person_duplicate_candidates') r`)).rows[0].r;

    let expectedNewTables = 1;
    let expectedNewColumns = 2;
    if (hasStatus) {
      expectedNewColumns = 0;
      const merged = (await client.query(
        `SELECT count(*)::int n FROM public.unified_persons WHERE merged_into_id IS NOT NULL`)).rows[0].n;
      console.log(`  unified_persons.status already present; ${merged} merged person(s)`);
      if (merged > 0) throw new Error('persons have already been merged — refusing to re-apply');
    } else {
      console.log('  unified_persons.status: not present (expected)');
    }
    if (candTable) {
      expectedNewTables = 0;
      const n = (await client.query('SELECT count(*)::int n FROM public.person_duplicate_candidates')).rows[0].n;
      console.log(`  person_duplicate_candidates already exists with ${n} row(s)`);
      if (n > 0) throw new Error('person_duplicate_candidates already holds data — refusing to proceed');
    } else {
      console.log('  person_duplicate_candidates: not present (expected)');
    }

    const before = await counts(client);
    const fpBefore = await identityFingerprint(client);
    const neighboursBefore = await neighbourConstraints(client);
    const colsBefore = await personColumns(client);
    const tablesBefore = (await client.query(
      `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].n;
    console.log(`  row counts: ${JSON.stringify(before)}`);
    console.log(`  public tables: ${tablesBefore} · unified_persons columns: ${colsBefore.length} · neighbour constraints: ${neighboursBefore.length}`);
    console.log(`  identity fingerprint: ${fpBefore}`);

    console.log('\n=== APPLYING LI-4C ===');
    await client.query(sql);
    console.log(`  applied ${MIGRATION}`);

    console.log('\n=== LI-4C POSTCONDITIONS ===');

    // 1/2 — the lifecycle columns.
    const colsAfter = await personColumns(client);
    const added = colsAfter.filter((c) => !colsBefore.includes(c));
    console.log(`  unified_persons columns ${colsBefore.length} -> ${colsAfter.length} (added: ${added.join(', ') || 'none'})`);
    if (!colsAfter.includes('status') || !colsAfter.includes('merged_into_id')) {
      throw new Error('lifecycle columns missing after apply');
    }
    if (colsAfter.length !== colsBefore.length + expectedNewColumns) {
      throw new Error(`expected exactly ${expectedNewColumns} new column(s), got ${colsAfter.length - colsBefore.length}`);
    }

    // 3 — the candidate table, empty and RLS-protected.
    const cand = (await client.query(`
      SELECT (SELECT count(*)::int FROM public.person_duplicate_candidates) rows,
             (SELECT relrowsecurity FROM pg_class WHERE oid='public.person_duplicate_candidates'::regclass) rls,
             (SELECT count(*)::int FROM pg_attribute
               WHERE attrelid='public.person_duplicate_candidates'::regclass AND attnum>0 AND NOT attisdropped) cols`)).rows[0];
    console.log(`  person_duplicate_candidates: ${cand.cols} columns, ${cand.rows} rows, RLS=${cand.rls}`);
    if (cand.rows !== 0) throw new Error(`candidate table must be empty on arrival, found ${cand.rows}`);
    if (!cand.rls) throw new Error('RLS is not enabled on person_duplicate_candidates');

    // 4/5 — the composite tenant FK, and the ADR §15 action.
    const mergeFk = (await client.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='unified_persons_merge_tenant_fk'`)).rows[0];
    if (!mergeFk) throw new Error('unified_persons_merge_tenant_fk missing');
    console.log(`  merge FK: ${mergeFk.d}`);
    if (!/FOREIGN KEY \(merged_into_id, company_id\)/.test(mergeFk.d)) {
      throw new Error('merge FK is not tenant-safe (composite)');
    }
    if (/ON DELETE/.test(mergeFk.d) || /SET NULL/.test(mergeFk.d)) {
      throw new Error(`merge FK must be ON DELETE NO ACTION per ADR §15, found: ${mergeFk.d}`);
    }

    // 6 — lifecycle CHECKs.
    const checks = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='c' AND s.relname='unified_persons'
         AND con.conname IN ('unified_persons_status_valid','unified_persons_merge_coherent','unified_persons_no_self_merge')`)).rows[0].n;
    console.log(`  lifecycle CHECK constraints: ${checks}/3`);
    if (checks !== 3) throw new Error(`expected 3 lifecycle CHECKs, found ${checks}`);

    // 7 — the partial candidate uniqueness index.
    const idx = (await client.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_person_duplicate_open_pair'`)).rows[0];
    if (!idx) throw new Error('uq_person_duplicate_open_pair missing');
    console.log(`  candidate uniqueness index partial: ${/ WHERE /.test(idx.indexdef)}`);
    if (!/ WHERE /.test(idx.indexdef)) throw new Error('candidate uniqueness index is not partial as the ADR requires');

    // 8 — three composite tenant FKs on the queue.
    const candFks = (await client.query(`
      SELECT count(*)::int n FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname='person_duplicate_candidates' AND array_length(con.conkey,1)=2`)).rows[0].n;
    console.log(`  candidate composite tenant FKs: ${candFks}/3`);
    if (candFks !== 3) throw new Error(`expected 3 composite tenant FKs, found ${candFks}`);

    // 9 — no person was touched by the migration.
    const life = (await client.query(`
      SELECT count(*) FILTER (WHERE status <> 'active')         non_active,
             count(*) FILTER (WHERE merged_into_id IS NOT NULL) merged
        FROM public.unified_persons`)).rows[0];
    console.log(`  persons: ${life.non_active} non-active, ${life.merged} merged (expect 0 / 0)`);
    if (Number(life.non_active) !== 0 || Number(life.merged) !== 0) {
      throw new Error('migration altered person lifecycle');
    }

    // 10 — nothing else moved.
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
    if (!fpSame) throw new Error('identity fingerprint changed — LI-4C must not alter identity values');
    if (!neighboursSame) throw new Error('a neighbouring table constraint changed');
    if (tablesAfter !== tablesBefore + expectedNewTables) {
      throw new Error(`expected exactly ${expectedNewTables} new table(s), got ${tablesAfter - tablesBefore}`);
    }

    console.log('\nLI-4C APPLIED — person lifecycle + duplicate queue in place, empty, tenant-safe, NO ACTION, identity values untouched.');
  } catch (err) {
    console.error('\nLI-4C FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
