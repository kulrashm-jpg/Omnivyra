/**
 * OPS DDL — 2026-08-12, W5 canonical person spine tenant-integrity hardening.
 *
 * Applies supabase/migrations/20260924000000_w5_person_spine_tenant_integrity.sql
 * to the production database via the pooler (the migration ledger is desynced —
 * NEVER db:push; this script is the sanctioned application mechanism and the
 * migration file is the record). Same pattern as W0, W0.1, W1 and W2.
 *
 * W4 shipped without a committed applier and its audit raised that as process
 * debt (finding A-6). This closes it.
 *
 * Converts eleven simple foreign keys on `unified_persons` into tenant-safe
 * composites. Touches constraints only: it deletes nothing, rewrites nothing,
 * re-tenants nothing, and creates no person, account or claim.
 *
 * Fails closed. Preconditions are asserted here AND independently inside the
 * migration, so a direct psql run is protected too.
 *
 * Run: node scripts/ops/w5-person-spine-tenant-ddl-20260812.js
 */
require('dotenv').config({ path: '.env.local' });
const { readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

const MIGRATION = '20260924000000_w5_person_spine_tenant_integrity.sql';

/** Every table W5 touches, plus the canonical spine tables that must not move. */
const WATCHED = ['companies', 'unified_persons', 'prospect_accounts', 'identity_claims',
  'leads', 'contacts', 'lead_intelligence', 'canonical_leads', 'canonical_users',
  'canonical_revenue_events', 'engagement_threads', 'users', 'unified_touchpoints',
  'visitor_sessions', 'expected_event_instances', 'unified_person_merges',
  'engagement_identity_candidates'];

/** [table, person column, tenant column, expected constraint name] */
const EDGES = [
  ['canonical_leads', 'unified_person_id', 'company_id', 'canonical_leads_person_tenant_fk'],
  ['canonical_revenue_events', 'unified_person_id', 'company_id', 'canonical_revenue_events_person_tenant_fk'],
  ['canonical_users', 'unified_person_id', 'company_id', 'canonical_users_person_tenant_fk'],
  ['contacts', 'unified_person_id', 'organization_id', 'contacts_person_tenant_fk'],
  ['engagement_threads', 'unified_person_id', 'organization_id', 'engagement_threads_person_tenant_fk'],
  ['expected_event_instances', 'unified_person_id', 'company_id', 'expected_event_instances_person_tenant_fk'],
  ['leads', 'unified_person_id', 'company_id', 'leads_person_tenant_fk'],
  ['unified_touchpoints', 'unified_person_id', 'company_id', 'unified_touchpoints_person_tenant_fk'],
  ['visitor_sessions', 'unified_person_id', 'company_id', 'visitor_sessions_person_tenant_fk'],
  ['unified_person_merges', 'winner_person_id', 'company_id', 'unified_person_merges_winner_tenant_fk'],
  ['unified_person_merges', 'loser_person_id', 'company_id', 'unified_person_merges_loser_tenant_fk'],
];

async function counts(client) {
  const out = {};
  for (const t of WATCHED) out[t] = (await client.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
  return out;
}

/**
 * The property W5 must never violate: which person each row points at, and
 * under which tenant. Hashed per edge so a single altered linkage is visible.
 */
async function linkage(client) {
  const out = {};
  for (const [tbl, pcol, tcol] of EDGES) {
    const { rows } = await client.query(
      `SELECT coalesce(md5(string_agg(coalesce(${pcol}::text,'~')||'|'||coalesce(${tcol}::text,'~'), E'\n'
              ORDER BY coalesce(${pcol}::text,'~'), coalesce(${tcol}::text,'~'))), 'empty') h
       FROM public.${tbl}`);
    out[`${tbl}.${pcol}`] = rows[0].h;
  }
  return out;
}

/** Cross-tenant rows on every candidate edge. Must be zero before and after. */
async function crossTenant(client) {
  const out = {};
  for (const [tbl, pcol, tcol] of EDGES) {
    const { rows } = await client.query(
      `SELECT count(*)::int n FROM public.${tbl} s
         JOIN public.unified_persons p ON p.id = s.${pcol}
        WHERE s.${tcol} IS NOT NULL AND s.${tcol} IS DISTINCT FROM p.company_id`);
    out[`${tbl}.${pcol}`] = rows[0].n;
  }
  return out;
}

async function constraintDefs(client) {
  const { rows } = await client.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) def
    FROM pg_constraint con
    JOIN pg_class s ON s.oid = con.conrelid
    JOIN pg_class t ON t.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public' AND t.relname = 'unified_persons'
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
    console.log('=== W5 PRECONDITIONS ===');

    const version = (await client.query('SHOW server_version')).rows[0].server_version;
    console.log(`  server_version: ${version}`);
    if (parseInt(version, 10) < 15) {
      throw new Error(`ON DELETE SET NULL (column_list) requires PostgreSQL 15+; found ${version}`);
    }

    const hasKey = (await client.query(`
      SELECT count(*)::int n FROM pg_indexes
      WHERE schemaname='public' AND tablename='unified_persons'
        AND indexname='uq_unified_persons_id_company'`)).rows[0].n;
    console.log(`  uq_unified_persons_id_company present: ${hasKey === 1}`);
    if (hasKey !== 1) throw new Error('referenced uniqueness (id, company_id) is missing');

    const before = await counts(client);
    const linkBefore = await linkage(client);
    const crossBefore = await crossTenant(client);
    const defsBefore = await constraintDefs(client);
    console.log(`  inbound person FKs: ${defsBefore.length}`);
    console.log(`  composite among them: ${defsBefore.filter((d) => /,\s/.test(d.def.split('REFERENCES')[0])).length}`);
    console.log(`  row counts: ${JSON.stringify(before)}`);

    const dirty = Object.entries(crossBefore).filter(([, n]) => n > 0);
    if (dirty.length) {
      throw new Error(`cross-tenant rows already present, refusing to proceed: ${JSON.stringify(dirty)}`);
    }
    console.log('  cross-tenant rows on all 11 edges: 0');

    console.log('\n=== APPLYING W5 ===');
    await client.query(sql);
    console.log(`  applied ${MIGRATION}`);

    console.log('\n=== W5 POSTCONDITIONS ===');
    const defsAfter = await constraintDefs(client);
    let missing = 0;
    for (const [tbl, pcol, tcol, name] of EDGES) {
      const found = defsAfter.find((d) => d.conname === name);
      const okShape = found && found.def.includes(`(${pcol}, ${tcol})`)
        && found.def.includes('REFERENCES unified_persons(id, company_id)');
      if (!okShape) { missing += 1; console.log(`  MISSING/WRONG: ${name}`); }
      else console.log(`  ${name}: ${found.def}`);
    }
    if (missing) throw new Error(`${missing} expected composite FK(s) missing or malformed`);

    // Nothing outside the eleven may have changed.
    const untouched = defsBefore.filter((d) => !EDGES.some(([, , , n]) => n === d.conname)
      && !/_unified_person_id_fkey$|^fk_leads_unified_person$|_winner_person_id_fkey$/.test(d.conname));
    for (const d of untouched) {
      const now = defsAfter.find((x) => x.conname === d.conname);
      if (!now || now.def !== d.def) throw new Error(`unrelated constraint changed: ${d.conname}`);
    }
    console.log(`  unrelated person FKs unchanged: ${untouched.length}`);

    const after = await counts(client);
    const linkAfter = await linkage(client);
    const crossAfter = await crossTenant(client);

    const countsSame = JSON.stringify(before) === JSON.stringify(after);
    const linkSame = JSON.stringify(linkBefore) === JSON.stringify(linkAfter);
    const crossClean = Object.values(crossAfter).every((n) => n === 0);
    console.log(`  row counts unchanged: ${countsSame}`);
    console.log(`  person/tenant linkage unchanged: ${linkSame}`);
    console.log(`  cross-tenant rows after: ${crossClean ? 0 : JSON.stringify(crossAfter)}`);
    if (!countsSame) throw new Error(`row counts changed: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    if (!linkSame) throw new Error('person/tenant linkage changed');
    if (!crossClean) throw new Error('cross-tenant rows present after apply');

    console.log('\nW5 APPLIED — 11 tenant-safe composite person foreign keys in force.');
  } catch (err) {
    console.error('\nW5 FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
