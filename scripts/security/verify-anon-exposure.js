#!/usr/bin/env node
/**
 * verify-anon-exposure — READ-ONLY production verification for
 * supabase/migrations/20261026000000_close_anon_rls_exposure.sql (STEP 3AH-70).
 *
 *   node scripts/security/verify-anon-exposure.js --expect before   # proves the exposure exists
 *   node scripts/security/verify-anon-exposure.js --expect after    # proves it is closed and access still works
 *
 * Env: SUPABASE_POOLER_DB_URL (or SUPABASE_DB_URL / DATABASE_URL) — direct Postgres, read-only session.
 *      SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (optional) — anonymous REST probes.
 *
 * Guarantees:
 *   * The database session is forced read-only (default_transaction_read_only = on).
 *   * REST probes use GET/HEAD with the PUBLISHABLE key only, count-only (Range 0-0).
 *     They never POST/PATCH/DELETE and never call /rpc — before the fix an anonymous
 *     RPC call would EXECUTE a SECURITY DEFINER function, so privileges on functions
 *     are verified from the catalog only.
 *   * No row content is printed. Object lists are read from the migration file itself.
 * Exit 0 = every check matches the expectation; 1 = at least one mismatch; 2 = usage/connection.
 */
const fs = require('fs');
const path = require('path');

const expectArg = (process.argv.find((a) => a.startsWith('--expect=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--expect') + 1];
if (!['before', 'after'].includes(expectArg)) {
  console.error('usage: verify-anon-exposure.js --expect before|after');
  process.exit(2);
}
const AFTER = expectArg === 'after';
const DB_URL = process.env.SUPABASE_POOLER_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error('SUPABASE_POOLER_DB_URL (direct Postgres) is required'); process.exit(2); }

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261026000000_close_anon_rls_exposure.sql'), 'utf8');
function arrayItems(name) {
  const m = MIGRATION.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`));
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}
const TABLES = arrayItems('protected_tables');
const FUNCTIONS = arrayItems('definer_functions');
const OWNER_VIEWS = arrayItems('owner_rights_views');
const INVOKER_VIEWS = arrayItems('invoker_views');
const RETARGETED_TABLES = arrayItems('retargeted_tables');
const PUBLIC_READ = arrayItems('public_read_tables');
const POLICIES = [...MIGRATION.match(/FROM \(VALUES([\s\S]*?)\) AS x\(tbl, pol\)/)[1].matchAll(/\('([a-z_]+)', '((?:[^']|'')+)'\)/g)].map((m) => [m[1], m[2].replace(/''/g, "'")]);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

async function catalog() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: DB_URL, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const one = async (sql, params) => (await c.query(sql, params)).rows[0];
  const ro = await one('SHOW transaction_read_only');
  check('session is read-only', ro.transaction_read_only === 'on');

  const t = await one(`
    SELECT count(*)::int AS present,
           count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_on,
           count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))::int AS anon_any,
           count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT'))::int AS anon_select,
           count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))::int AS anon_write,
           count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))::int AS authn_any,
           count(*) FILTER (WHERE has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))::int AS svc_all
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relname = ANY($1)`, [TABLES]);
  check(`protected tables present ${t.present}/${TABLES.length}`, t.present === TABLES.length);
  check(AFTER ? 'RLS enabled on every protected table' : 'RLS disabled on the protected tables (exposure)', AFTER ? t.rls_on === t.present : t.rls_on === 0, `rls_on=${t.rls_on}`);
  check(AFTER ? 'anon has NO privilege on any protected table' : 'anon holds privileges on the protected tables (exposure)', AFTER ? t.anon_any === 0 : t.anon_any === t.present, `anon_any=${t.anon_any} select=${t.anon_select} write=${t.anon_write}`);
  check(AFTER ? 'authenticated has NO privilege on any protected table' : 'authenticated holds privileges (exposure)', AFTER ? t.authn_any === 0 : t.authn_any === t.present, `authenticated_any=${t.authn_any}`);
  check('service_role keeps SELECT/INSERT/UPDATE/DELETE on every protected table', t.svc_all === t.present, `svc_all=${t.svc_all}`);
  const bypass = await one(`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'`);
  check('service_role has BYPASSRLS', bypass.rolbypassrls === true);

  const f = await one(`
    SELECT count(*)::int AS present,
           count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))::int AS anon,
           count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int AS authn,
           count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE'))::int AS svc
      FROM pg_proc p WHERE ('public.' || p.oid::regprocedure::text) = ANY($1)`, [FUNCTIONS]);
  check(`definer functions present ${f.present}/${FUNCTIONS.length}`, f.present === FUNCTIONS.length);
  check(AFTER ? 'no SECURITY DEFINER function executable by anon/authenticated' : 'definer functions executable by anon (exposure)', AFTER ? f.anon === 0 && f.authn === 0 : f.anon === f.present, `anon=${f.anon} authenticated=${f.authn}`);
  check('service_role can EXECUTE every definer function', f.svc === f.present, `service_role=${f.svc}`);

  const v = await one(`
    SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT'))::int AS anon_sel,
           count(*) FILTER (WHERE c.relname = ANY($2) AND has_table_privilege('authenticated', c.oid, 'SELECT'))::int AS authn_owner_sel,
           count(*) FILTER (WHERE has_table_privilege('service_role', c.oid, 'SELECT'))::int AS svc_sel,
           count(*)::int AS present
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m') AND c.relname = ANY($1)`, [[...OWNER_VIEWS, ...INVOKER_VIEWS], OWNER_VIEWS]);
  check(AFTER ? 'no view readable by anon; no owner-rights view readable by authenticated' : 'views readable by anon (exposure)', AFTER ? v.anon_sel === 0 && v.authn_owner_sel === 0 : v.anon_sel === v.present, `anon=${v.anon_sel} authenticated_owner_rights=${v.authn_owner_sel}`);
  check('service_role can read every view', v.svc_sel === v.present, `service_role=${v.svc_sel}/${v.present}`);

  const pol = (await c.query(`SELECT tablename, policyname, roles::text AS roles FROM pg_policies WHERE schemaname = 'public'`)).rows;
  const target = POLICIES.map(([tb, pn]) => pol.find((p) => p.tablename === tb && p.policyname === pn)).filter(Boolean);
  const onService = target.filter((p) => p.roles === '{service_role}').length;
  check(AFTER ? `the ${POLICIES.length} unconditional policies are scoped TO service_role` : 'unconditional policies grant {public} (exposure)', AFTER ? onService === target.length : onService === 0, `service_role=${onService}/${target.length}`);
  const rt = await one(`SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))::int AS n FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY($1)`, [RETARGETED_TABLES]);
  if (AFTER) check('retargeted-policy tables carry no anon/authenticated grant', rt.n === 0, `still granted=${rt.n}`);

  const pr = await one(`SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT'))::int AS sel,
                               count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))::int AS wr,
                               count(*) FILTER (WHERE c.relrowsecurity)::int AS rls, count(*)::int AS n
                          FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY($1)`, [PUBLIC_READ]);
  check('intentionally public tables stay readable with RLS on', pr.sel === pr.n && pr.rls === pr.n, `anon_select=${pr.sel}/${pr.n}`);
  if (AFTER) check('intentionally public tables are not anonymously writable', pr.wr === 0, `anon_write=${pr.wr}`);

  const ct = await one(`SELECT c.relrowsecurity AS rls, has_table_privilege('authenticated', c.oid, 'SELECT') AS authn_sel,
                               (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='credit_transactions') AS policies
                          FROM pg_class c WHERE c.oid = 'public.credit_transactions'::regclass`);
  check('browser realtime path intact: credit_transactions RLS on, authenticated SELECT, policies present', ct.rls && ct.authn_sel && ct.policies > 0, `policies=${ct.policies}`);

  const global = await one(`SELECT count(*)::int AS n FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT')`);
  check(AFTER ? 'NO public table anywhere is RLS-off and anon-readable' : 'RLS-off anon-readable tables exist (exposure)', AFTER ? global.n === 0 : global.n > 0, `count=${global.n}`);
  const tr = await one(`SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))::int AS n, count(*)::int AS total
                          FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')`);
  check(AFTER ? 'TRUNCATE (not governed by RLS) held by anon/authenticated on NO public table' : 'anon/authenticated hold TRUNCATE on public tables (exposure)', AFTER ? tr.n === 0 : tr.n > 0, `tables=${tr.n}/${tr.total}`);
  const dacl = await one(`SELECT count(*)::int AS n FROM pg_default_acl d WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclacl::text ~ '(^|[{,])anon='`);
  check(AFTER ? 'default privileges no longer grant anything to anon' : 'default privileges grant anon (root cause)', AFTER ? dacl.n === 0 : dacl.n > 0, `entries=${dacl.n}`);
  const ledger = await one(`SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version = '20261026000000'`);
  check(AFTER ? 'ledger records 20261026000000' : 'ledger does not yet record 20261026000000', AFTER ? ledger.n === 1 : ledger.n === 0);
  await c.end();
}

async function rest() {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) { console.log('SKIP  anonymous REST probes (SUPABASE_URL / publishable key not set)'); return; }
  const head = async (rel) => {
    const r = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${rel}?select=*`, { method: 'HEAD', headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' } });
    return { status: r.status, range: r.headers.get('content-range') };
  };
  let open = 0, closed = 0; const openNames = [];
  for (const rel of [...TABLES, ...OWNER_VIEWS, ...INVOKER_VIEWS]) {
    const r = await head(rel);
    if (r.status === 200 || r.status === 206) { open++; if (openNames.length < 5) openNames.push(`${rel}(${r.range})`); } else closed++;
  }
  const total = TABLES.length + OWNER_VIEWS.length + INVOKER_VIEWS.length;
  check(AFTER ? `anonymous REST read refused for all ${total} protected tables/views` : 'anonymous REST read succeeds (exposure)', AFTER ? open === 0 : open > 0, `readable=${open} refused=${closed}${openNames.length ? ' e.g. ' + openNames.join(', ') : ''}`);
  let pub = 0; for (const rel of PUBLIC_READ) { const r = await head(rel); if (r.status === 200 || r.status === 206) pub++; }
  check('intentionally public tables readable anonymously over REST', pub === PUBLIC_READ.length, `${pub}/${PUBLIC_READ.length}`);
}

(async () => {
  console.log(`verify-anon-exposure --expect ${expectArg} (read-only; tables=${TABLES.length} functions=${FUNCTIONS.length} views=${OWNER_VIEWS.length + INVOKER_VIEWS.length} policies=${POLICIES.length})`);
  await catalog();
  await rest();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? 'MISMATCH' : 'OK'} — ${results.length - failed}/${results.length} checks match the '${expectArg}' expectation`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('verify-anon-exposure error: ' + String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '«DBURL»')); process.exit(2); });
