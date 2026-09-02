/**
 * OPS DDL — 2026-09-02, D1 tenant-owned versioned ICP model.
 *
 * Applies supabase/migrations/20261012000000_d1_tenant_icp_model.sql to the
 * production database via the pooler. The migration ledger is desynced, so
 * `db push` is never used; this script is the sanctioned mechanism and the
 * migration file is the record. Same pattern as W1, W2, W5, LI-1, LI-2, LI-3B
 * and LI-4C.
 *
 * Applies EXACTLY ONE migration. Never a batch. The migration file carries its
 * own BEGIN/COMMIT, its own preflight and its own postcondition block, so a
 * failure anywhere aborts the whole transaction and leaves the schema as it
 * was. The assertions below are an INDEPENDENT second opinion: they re-derive
 * every property from the catalog after the fact rather than trusting the
 * migration's own verdict.
 *
 * This migration is purely additive — two new EMPTY tables, their indexes,
 * constraints, one trigger function, one trigger and two RLS policies. It
 * writes no row, alters no existing table and touches no existing column. So
 * the strongest invariant available is: every watched row count identical,
 * every pre-existing public relation still present and unchanged in kind, and
 * exactly two new tables.
 *
 * Refuses outright if either table already exists — that would mean this is not
 * the first application it is written to be.
 *
 * Run: node scripts/ops/d1-tenant-icp-ddl-20261012.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20261012000000_d1_tenant_icp_model.sql';

/** --verify-only re-checks an already-applied migration and never writes. */
const VERIFY_ONLY = process.argv.includes('--verify-only');

/**
 * Production row counts observed immediately BEFORE this migration was applied,
 * recorded from the apply run. In --verify-only mode these are the reference the
 * data-safety assertion compares against, because the pre-state is no longer
 * observable. This migration is purely additive: every one must be unchanged.
 */
const EXPECTED_BASELINE = {
  companies: 40, unified_persons: 23, prospect_accounts: 0, identity_claims: 42,
  leads: 18, contacts: 10, source_records: 0, source_assertions: 0,
  contact_governance_records: 0, person_duplicate_candidates: 0, consent_records: 0,
  outreach_tasks: 0, outreach_decisions: 0,
};

/** Public non-index relations before the apply. The migration adds exactly 2. */
const EXPECTED_RELATIONS_BEFORE = 868;

const NEW_TABLES = ['prospect_icps', 'prospect_icp_versions'];

const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'source_records', 'source_assertions', 'contact_governance_records',
  'person_duplicate_candidates', 'consent_records', 'outreach_tasks', 'outreach_decisions'];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/** Every public relation that is not an index, by name and kind. */
async function relations(client) {
  const { rows } = await client.query(`
    SELECT c.relname n, c.relkind k
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r','v','m','S','p')
     ORDER BY 1, 2`);
  return rows.map((r) => `${r.k}:${r.n}`);
}

async function columns(client, table) {
  const { rows } = await client.query(`
    SELECT a.attname::text name,
           format_type(a.atttypid, a.atttypmod) type,
           a.attnotnull AS is_not_null,
           pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`, [`public.${table}`]);
  return rows;
}

async function constraintsOf(client, table) {
  const { rows } = await client.query(`
    SELECT con.conname::text name, con.contype::text type, pg_get_constraintdef(con.oid) def
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = $1
     ORDER BY 1`, [table]);
  return rows;
}

async function indexesOf(client, table) {
  const { rows } = await client.query(`
    SELECT indexname::text name, indexdef def
      FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [table]);
  return rows;
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/', MIGRATION), 'utf8');
  const client = new Client({
    connectionString: process.env.SUPABASE_POOLER_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log(`=== D1 PRECONDITIONS (${MIGRATION}) ===`);
    console.log(`  migration bytes: ${Buffer.byteLength(sql, 'utf8')}`);
    must(!sql.startsWith('\uFEFF'), 'migration file starts with a BOM — refusing to send it');
    must(/^\s*BEGIN;/m.test(sql) && /^\s*COMMIT;/m.test(sql), 'migration is not transactional');

    // The tenant spine the foreign keys assume. The migration asserts this too;
    // asserting here means we never open a transaction we know will fail.
    const tenantType = (await client.query(`
      SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
       WHERE attrelid='public.companies'::regclass AND attname='id' AND attnum>0 AND NOT attisdropped`)).rows[0];
    console.log(`  companies.id: ${tenantType ? tenantType.t : '<absent>'}`);
    must(tenantType && tenantType.t === 'uuid', 'companies.id is not uuid — the tenant FK would be unsound');

    // First application only. Either table already present means something else
    // created it, and the additive assertions below would be meaningless.
    for (const t of NEW_TABLES) {
      const present = (await client.query(`SELECT to_regclass($1) r`, [`public.${t}`])).rows[0].r;
      console.log(`  ${t}: ${present ? 'exists' : 'absent (expected)'}`);
      if (VERIFY_ONLY) must(present, `${t} is absent — nothing to verify`);
      else must(!present, `${t} already exists — refusing to re-apply`);
    }

    const before = VERIFY_ONLY ? EXPECTED_BASELINE : await counts(client);
    const relsBefore = VERIFY_ONLY ? null : await relations(client);
    console.log(`  row counts${VERIFY_ONLY ? ' (recorded pre-apply baseline)' : ''}: ${JSON.stringify(before)}`);
    if (relsBefore) console.log(`  public relations (non-index): ${relsBefore.length}`);

    if (VERIFY_ONLY) {
      console.log('\n=== APPLY SKIPPED (--verify-only: no write of any kind) ===');
    } else {
      console.log('\n=== APPLYING D1 ===');
      await client.query(sql);
      console.log(`  applied ${MIGRATION}`);
    }

    console.log('\n=== D1 POSTCONDITIONS ===');

    // 1 — both tables exist, and they arrive EMPTY.
    for (const t of NEW_TABLES) {
      const present = (await client.query(`SELECT to_regclass($1) r`, [`public.${t}`])).rows[0].r;
      must(present, `${t} missing after apply`);
      const n = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
      console.log(`  ${t}: exists, ${n} row(s)`);
      must(n === 0, `${t} must arrive empty, found ${n}`);
    }

    // 2 — columns, types, nullability, defaults.
    const icpCols = await columns(client, 'prospect_icps');
    const verCols = await columns(client, 'prospect_icp_versions');
    console.log(`  prospect_icps columns        : ${icpCols.map((c) => c.name).join(', ')}`);
    console.log(`  prospect_icp_versions columns: ${verCols.map((c) => c.name).join(', ')}`);
    const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));
    const icp = byName(icpCols);
    const ver = byName(verCols);
    for (const [col, type, notnull] of [
      ['id', 'uuid', true], ['organization_id', 'uuid', true], ['icp_key', 'text', true],
      ['name', 'text', false], ['created_at', 'timestamp with time zone', true],
      ['updated_at', 'timestamp with time zone', true],
    ]) {
      must(icp[col], `prospect_icps.${col} missing`);
      must(icp[col].type === type, `prospect_icps.${col} is ${icp[col].type}, expected ${type}`);
      must(icp[col].is_not_null === notnull,
        `prospect_icps.${col} NOT NULL is ${icp[col].is_not_null}, expected ${notnull}`);
    }
    for (const [col, type, notnull] of [
      ['id', 'uuid', true], ['organization_id', 'uuid', true], ['icp_id', 'uuid', true],
      ['version', 'integer', true], ['status', 'text', true], ['criteria', 'jsonb', true],
      ['proposal', 'jsonb', true], ['proposed_by_model', 'text', false],
      ['ratified_at', 'timestamp with time zone', false], ['ratified_by', 'uuid', false],
      ['superseded_at', 'timestamp with time zone', false], ['superseded_by_version', 'integer', false],
      ['created_at', 'timestamp with time zone', true], ['updated_at', 'timestamp with time zone', true],
    ]) {
      must(ver[col], `prospect_icp_versions.${col} missing`);
      must(ver[col].type === type, `prospect_icp_versions.${col} is ${ver[col].type}, expected ${type}`);
      must(ver[col].is_not_null === notnull,
        `prospect_icp_versions.${col} NOT NULL is ${ver[col].is_not_null}, expected ${notnull}`);
    }
    must(/gen_random_uuid/.test(icp.id.def || ''), 'prospect_icps.id has no gen_random_uuid default');
    must(/gen_random_uuid/.test(ver.id.def || ''), 'prospect_icp_versions.id has no gen_random_uuid default');
    must(/'draft'/.test(ver.status.def || ''), 'prospect_icp_versions.status default is not draft');
    console.log('  column types / nullability / defaults: OK');

    // 3 — primary keys.
    const icpCon = await constraintsOf(client, 'prospect_icps');
    const verCon = await constraintsOf(client, 'prospect_icp_versions');
    const pk = (rows) => rows.filter((r) => r.type === 'p');
    must(pk(icpCon).length === 1, 'prospect_icps has no single primary key');
    must(pk(verCon).length === 1, 'prospect_icp_versions has no single primary key');
    console.log(`  primary keys: ${pk(icpCon)[0].def} · ${pk(verCon)[0].def}`);

    // 4 — foreign keys, including the tenant-safe composite.
    const fk = (rows) => rows.filter((r) => r.type === 'f');
    const icpFks = fk(icpCon);
    const verFks = fk(verCon);
    for (const f of [...icpFks, ...verFks]) console.log(`  FK ${f.name}: ${f.def}`);
    must(icpFks.some((f) => /FOREIGN KEY \(organization_id\) REFERENCES companies\(id\)/.test(f.def) && /ON DELETE CASCADE/.test(f.def)),
      'prospect_icps tenant FK to companies(id) ON DELETE CASCADE missing');
    must(verFks.some((f) => /FOREIGN KEY \(organization_id\) REFERENCES companies\(id\)/.test(f.def) && /ON DELETE CASCADE/.test(f.def)),
      'prospect_icp_versions tenant FK to companies(id) ON DELETE CASCADE missing');
    const composite = verFks.find((f) => f.name === 'prospect_icp_versions_icp_tenant_fk');
    must(composite, 'prospect_icp_versions_icp_tenant_fk missing');
    must(/FOREIGN KEY \(icp_id, organization_id\)/.test(composite.def),
      `icp FK is not tenant-safe (composite): ${composite.def}`);
    must(/REFERENCES prospect_icps\(id, organization_id\)/.test(composite.def),
      `icp FK does not target the composite key: ${composite.def}`);
    console.log('  tenant isolation: composite (icp_id, organization_id) FK present');

    // 5 — unique constraints / indexes, including the partial one.
    const icpIdx = await indexesOf(client, 'prospect_icps');
    const verIdx = await indexesOf(client, 'prospect_icp_versions');
    const named = Object.fromEntries([...icpIdx, ...verIdx].map((r) => [r.name, r.def]));
    for (const n of ['uq_prospect_icps_org_key', 'uq_prospect_icps_id_org',
      'uq_prospect_icp_versions_identity', 'uq_prospect_icp_versions_id_org',
      'uq_prospect_icp_versions_one_ratified', 'idx_prospect_icp_versions_ratified',
      'idx_prospect_icp_versions_history']) {
      must(named[n], `index ${n} missing`);
      console.log(`  index ${n}${/ WHERE /.test(named[n]) ? '  [PARTIAL]' : ''}`);
    }
    must(/UNIQUE/.test(named.uq_prospect_icps_org_key), 'uq_prospect_icps_org_key is not unique');
    must(/UNIQUE/.test(named.uq_prospect_icp_versions_identity), 'uq_prospect_icp_versions_identity is not unique');
    must(/ WHERE .*ratified/.test(named.uq_prospect_icp_versions_one_ratified),
      'the one-ratified-version index is not partial — ON CONFLICT would silently become inferable');
    console.log('  one-active-version rule: partial unique index present (insert + catch 23505, never ON CONFLICT)');

    // 6 — CHECK constraints.
    const checks = (rows) => rows.filter((r) => r.type === 'c').map((r) => r.name);
    const icpChecks = checks(icpCon);
    const verChecks = checks(verCon);
    for (const n of ['prospect_icps_key_slug', 'prospect_icps_name_not_blank']) {
      must(icpChecks.includes(n), `CHECK ${n} missing`);
    }
    for (const n of ['prospect_icp_versions_version_positive', 'prospect_icp_versions_status_valid',
      'prospect_icp_versions_criteria_is_array', 'prospect_icp_versions_proposal_is_object',
      'prospect_icp_versions_ratification_coherent', 'prospect_icp_versions_supersession_coherent',
      'prospect_icp_versions_supersession_forward', 'prospect_icp_versions_model_not_blank']) {
      must(verChecks.includes(n), `CHECK ${n} missing`);
    }
    console.log(`  CHECK constraints: prospect_icps ${icpChecks.length}, prospect_icp_versions ${verChecks.length}`);

    // 7 — the immutability trigger and its function.
    const fn = (await client.query(`
      SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname='public' AND p.proname='prospect_icp_versions_guard_immutable'`)).rows[0].n;
    const trg = (await client.query(`
      SELECT t.tgname::text name, pg_get_triggerdef(t.oid) def FROM pg_trigger t
       WHERE t.tgrelid='public.prospect_icp_versions'::regclass AND NOT t.tgisinternal`)).rows;
    must(fn === 1, 'guard function missing');
    must(trg.some((t) => t.name === 'trg_prospect_icp_versions_immutable'), 'immutability trigger missing');
    console.log(`  trigger: ${trg.map((t) => t.name).join(', ')}`);

    // 8 — RLS enabled, service-role policies present.
    const rls = (await client.query(`
      SELECT relname::text n, relrowsecurity r FROM pg_class
       WHERE oid IN ('public.prospect_icps'::regclass, 'public.prospect_icp_versions'::regclass)`)).rows;
    for (const r of rls) must(r.r, `RLS not enabled on ${r.n}`);
    const pol = (await client.query(`
      SELECT tablename::text t, policyname::text p FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY($1) ORDER BY 1,2`, [NEW_TABLES])).rows;
    console.log(`  RLS enabled on both · policies: ${pol.map((x) => `${x.t}.${x.p}`).join(', ')}`);
    must(pol.length === 2, `expected 2 policies, found ${pol.length}`);

    // 9 — nothing else moved.
    const after = await counts(client);
    const relsAfter = await relations(client);
    const countsSame = JSON.stringify(before) === JSON.stringify(after);
    console.log(`  row counts now      : ${JSON.stringify(after)}`);
    console.log(`  row counts unchanged: ${countsSame}`);
    must(countsSame, `row counts changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

    if (relsBefore) {
      const added = relsAfter.filter((r) => !relsBefore.includes(r));
      const removed = relsBefore.filter((r) => !relsAfter.includes(r));
      console.log(`  public relations ${relsBefore.length} -> ${relsAfter.length}`);
      console.log(`  added: ${added.join(', ') || 'none'}`);
      console.log(`  removed: ${removed.join(', ') || 'none'}`);
      must(removed.length === 0, `relations disappeared: ${removed.join(', ')}`);
      must(added.length === 2, `expected exactly 2 new relations, got ${added.length}: ${added.join(', ')}`);
      must(added.every((r) => NEW_TABLES.includes(r.replace(/^r:/, ''))), `unexpected new relation: ${added.join(', ')}`);
    } else {
      console.log(`  public relations: ${relsAfter.length} (baseline ${EXPECTED_RELATIONS_BEFORE} + 2)`);
      must(relsAfter.length === EXPECTED_RELATIONS_BEFORE + 2,
        `expected ${EXPECTED_RELATIONS_BEFORE + 2} public relations, found ${relsAfter.length}`);
      const icpish = relsAfter.filter((r) => /icp/i.test(r));
      console.log(`  public relations matching /icp/: ${icpish.join(', ')}`);
      must(icpish.length === 2 && icpish.every((r) => NEW_TABLES.includes(r.replace(/^r:/, ''))),
        `unexpected icp-related relation: ${icpish.join(', ')}`);
    }

    console.log('\nD1 APPLIED — tenant-owned versioned ICP model in place, both tables empty, '
      + 'tenant-safe composite FK, one-ratified partial index, ratified-content immutability trigger, '
      + 'RLS on, and no existing row or relation touched.');
  } catch (err) {
    console.error('\nD1 FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
