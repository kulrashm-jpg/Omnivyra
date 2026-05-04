#!/usr/bin/env node
/**
 * scripts/db-audit-rls.js
 *
 * Connects to a Postgres database (local Supabase or any DB_URL-reachable
 * Postgres) and verifies RLS coverage on every public.* base table:
 *   - relrowsecurity = true
 *   - at least one policy exists
 *
 * Exit code:
 *   0 = clean (every table has RLS on with ≥1 policy)
 *   1 = gaps detected (printed)
 *   2 = could not connect / required env missing
 *
 * Required env:
 *   DB_URL  Postgres connection string (e.g. postgresql://postgres:postgres@localhost:54322/postgres)
 *           Falls back to DATABASE_URL or SUPABASE_DB_URL.
 *
 * Usage:
 *   DB_URL=postgresql://… node scripts/db-audit-rls.js
 */

const { Client } = require('pg');

const DB_URL = process.env.DB_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!DB_URL) {
  console.error('[db-audit-rls] FAIL: no DB_URL / DATABASE_URL / SUPABASE_DB_URL env set');
  process.exit(2);
}

const QUERY = `
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_on,
       COALESCE((SELECT count(*) FROM pg_policies p
                 WHERE p.schemaname='public' AND p.tablename=c.relname), 0) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY c.relname;
`;

(async () => {
  const client = new Client({ connectionString: DB_URL });
  try {
    await client.connect();
  } catch (e) {
    console.error('[db-audit-rls] FAIL: could not connect:', e.message);
    process.exit(2);
  }

  let rows;
  try {
    const res = await client.query(QUERY);
    rows = res.rows;
  } catch (e) {
    console.error('[db-audit-rls] FAIL: query error:', e.message);
    await client.end();
    process.exit(2);
  } finally {
    await client.end();
  }

  const total = rows.length;
  const noRls = rows.filter(r => !r.rls_on);
  const noPolicy = rows.filter(r => r.rls_on && Number(r.policy_count) === 0);

  console.log(`[db-audit-rls] scanned ${total} public.* tables`);
  console.log(`[db-audit-rls]   RLS off:           ${noRls.length}`);
  console.log(`[db-audit-rls]   RLS on, 0 policies: ${noPolicy.length}`);

  if (noRls.length === 0 && noPolicy.length === 0) {
    console.log('[db-audit-rls] OK — 100% coverage');
    process.exit(0);
  }

  console.error('\n[db-audit-rls] VIOLATIONS:');
  if (noRls.length > 0) {
    console.error(`\nTables with RLS OFF (${noRls.length}):`);
    for (const r of noRls) console.error(`  - ${r.table_name}`);
  }
  if (noPolicy.length > 0) {
    console.error(`\nTables with RLS on but 0 policies (${noPolicy.length}):`);
    for (const r of noPolicy) console.error(`  - ${r.table_name}`);
  }
  console.error('\nWhy this fails:');
  console.error('  Phase D requires every public.* table to have RLS enabled and');
  console.error('  at least one policy. Add a service role_all policy at minimum.');
  console.error('  See supabase/_snapshot/rls_policy_plan.md for the canonical pattern.\n');
  process.exit(1);
})();
