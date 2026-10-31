/**
 * SEC-A (class-wide) — real-schema cover for
 * 20270110000002_tenant_tables_client_privileges_revoked.
 *
 * The CI replay is ACL-free, so the installed state proves nothing on its own.
 * Every test first recreates production's pre-fix state for the 50 tables —
 * production's verbatim auth.jwt()/auth.role()/auth.uid(), service_role's
 * arwdDxtm, and the client ACL via the migration's own rollback — observes the
 * pre-fix behaviour, runs the migration text, then observes the post-fix
 * behaviour. Post-fix observations are compared in one assertion per test, so a
 * no-op migration (SEC_A_MIGRATION_FILE=<file containing `SELECT 1;`>) fails
 * every security assertion at once.
 *
 * Role switches are SET LOCAL ROLE + request.jwt.claims, exactly what PostgREST
 * does per request. Everything runs inside inRollback(); migration/rollback text
 * is executed without its own BEGIN/COMMIT so nothing is ever committed.
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

const ROOT = path.resolve(__dirname, '../../..');
const stripTx = (sql: string) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
const MIGRATION = stripTx(fs.readFileSync(process.env.SEC_A_MIGRATION_FILE
  || path.join(ROOT, 'supabase/migrations/20270110000002_tenant_tables_client_privileges_revoked.sql'), 'utf8'));
const ROLLBACK = stripTx(fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/rollbacks/tenant_tables_client_privileges_revoked_rollback.sql'), 'utf8'));

/* ---------- production ACL groups (evidence/prod-relations.json, 2026-10-31T04:08Z) ---------- */
const G1 = ['action_registry', 'campaigns', 'canonical_domains', 'canonical_page_views', 'canonical_pages',
  'canonical_revenue_events', 'canonical_sessions', 'data_source_status', 'decision_events', 'decision_objects',
  'extension_commands', 'extension_events', 'extension_sessions', 'canonical_media_assets', 'company_topic_coverage',
  'composition_asset_references', 'creator_asset_attachments', 'creator_assets', 'feature_completion', 'reports',
  'access_requests', 'free_credit_claims', 'free_credit_events', 'free_credit_profiles', 'free_credit_unlocks',
  'notifications', 'user_override', 'user_preferences', 'companies', 'users', 'user_company_roles',
  'blog_comments', 'public_blogs']; // anon=arwdxtm, authenticated=arwdxtm
const G2 = ['content_approval_history', 'content_block', 'content_quality', 'content_recommendation',
  'creator_composition_briefs']; // authenticated=arwdxtm
const G3 = ['blog_relationships', 'blog_series', 'blog_series_posts', 'content_type']; // anon=rm, authenticated=rm
const G4 = ['brand_memory', 'content', 'content_asset', 'content_memory', 'content_originality', 'content_revision',
  'content_variant', 'publication_lineage']; // no client grant
const ALL = [...G1, ...G2, ...G3, ...G4];
const SELECT_ONLY = ['public_blogs', 'blog_relationships', 'blog_series', 'blog_series_posts', 'content_type'];
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const FULL = 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,MAINTAIN';
const DENIED = 'permission denied for table';

/** Production's claim readers, verbatim (the bootstrap's versions read only the legacy GUCs). */
const PROD_AUTH = `
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$function$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$function$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;`;

/* ---------- identities ---------- */
const ME = '00000000-0000-4000-8000-00000000a5a1';    // a real member of tenant A
const OTHER = '00000000-0000-4000-8000-00000000a5b1'; // a member of tenant B
type Claims = Record<string, unknown>;
/** A real-shaped Supabase session for ME whose user-writable metadata points at tenant B. */
const SESSION: Claims = {
  iss: 'https://example.supabase.co/auth/v1', sub: ME, aud: 'authenticated', role: 'authenticated',
  email: 'sec-a@example.invalid', aal: 'aal1', session_id: ME, is_anonymous: false,
  app_metadata: { provider: 'email', providers: ['email'], company_id: ORG_B, org_id: ORG_B, role: 'service_role' },
  user_metadata: { company_id: ORG_B, org_id: ORG_B, role: 'service_role', is_super_admin: true },
};
/** Hypothetical: a token carrying TOP-LEVEL company_id/org_id = A (nobody issues one today). */
const HYPO_A: Claims = { ...SESSION, company_id: ORG_A, org_id: ORG_A };
const CLIENTS: Array<{ name: string; role: string; claims: Claims }> = [
  { name: 'anon', role: 'anon', claims: { iss: 'supabase', role: 'anon' } },
  { name: 'session(metadata=B)', role: 'authenticated', claims: SESSION },
  { name: 'hypothetical top-level A', role: 'authenticated', claims: HYPO_A },
];
const SERVICE = { role: 'service_role', claims: { iss: 'supabase', role: 'service_role' } as Claims };

type Outcome = { ok: true; rows: any[] } | { ok: false; code: string; message: string };
async function req(role: string, claims: Claims, sql: string, params: unknown[] = []): Promise<Outcome> {
  await db.query('SAVEPOINT r');
  try {
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    return { ok: false, code: e.code ?? 'unknown', message: String(e.message ?? '') };
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT r');
  }
}
/** "A:n B:n" by the `k` column on success; on failure the SQLSTATE (+ " denied" for a PRIVILEGE refusal). */
const tenants = (o: Outcome, k = 'k') => {
  if (o.ok === false) return `ERR ${o.code}${o.message.includes(DENIED) ? ' denied' : ''}`;
  const ids = o.rows.map((r) => r[k]);
  return `A:${ids.filter((x) => x === ORG_A || x === ME).length} B:${ids.filter((x) => x === ORG_B || x === OTHER).length}`;
};
const status = (o: Outcome) => (o.ok === false ? `ERR ${o.code}${o.message.includes(DENIED) ? ' denied' : ''}` : `ok:${o.rows.length}`);
const DENY = 'ERR 42501 denied';

/** Production's pre-fix state for the 50 tables. */
async function productionPreFix(): Promise<void> {
  await db.query(PROD_AUTH);
  // service_role holds arwdDxtm on every one of them in production (default privileges).
  await db.query(`GRANT ALL ON TABLE ${ALL.map((t) => `public."${t}"`).join(', ')} TO service_role`);
  await db.query(ROLLBACK);
}

/** Effective privileges per table/role. */
async function privilegeReport(roles = ['anon', 'authenticated', 'public']): Promise<Record<string, string>> {
  const { rows } = await db.query(
    `SELECT t || '/' || r AS k, coalesce(string_agg(p, ',' ORDER BY array_position($3::text[], p)), '') AS v
       FROM unnest($1::text[]) t CROSS JOIN unnest($2::text[]) r
       LEFT JOIN unnest($3::text[]) p ON has_table_privilege(r, ('public.' || quote_ident(t))::regclass, p)
      GROUP BY 1`, [ALL, roles, PRIVS]);
  return Object.fromEntries(rows.map((x) => [x.k, x.v]));
}
const intended = () => Object.fromEntries(ALL.flatMap((t) => ['anon', 'authenticated', 'public']
  .map((r) => [`${t}/${r}`, SELECT_ONLY.includes(t) && r !== 'public' ? 'SELECT' : '']))) as Record<string, string>;

/** Non-client ACL entries, RLS flags and policy text — must be identical before and after. */
async function structureSnapshot(): Promise<Record<string, string>> {
  const { rows } = await db.query(
    `SELECT c.relname,
            c.relrowsecurity::text || '/' || c.relforcerowsecurity::text AS rls,
            (SELECT coalesce(string_agg(a.grantee::regrole::text || '=' || a.privilege_type, ',' ORDER BY a.grantee::regrole::text, a.privilege_type), '')
               FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              WHERE a.grantee <> 0 AND a.grantee::regrole::text NOT IN ('anon', 'authenticated')) AS other_acl,
            (SELECT coalesce(string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polroles::regrole[]::text || ':'
                     || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                     '|' ORDER BY p.polname), '') FROM pg_policy p WHERE p.polrelid = c.oid) AS pol
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)`, [ALL]);
  return Object.fromEntries(rows.map((r) => [r.relname, `${r.rls}|${r.other_acl}|${r.pol}`]));
}

/** Client ACL entries (anon/authenticated/PUBLIC) per table, for exact rollback comparison. */
async function clientAcl(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT c.relname || ':' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type AS e
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)
        AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated'))
      ORDER BY 1`, [ALL]);
  return rows.map((r) => r.e);
}

/* ---------- fixture ---------- */
interface Fx { blogPub: string; blogDraft: string; }
async function seed(): Promise<Fx> {
  await seedTenants();
  for (const [uid, org, email] of [[ME, ORG_A, 'sec-a-me@example.invalid'], [OTHER, ORG_B, 'sec-a-other@example.invalid']]) {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, email]);
    await db.query(`INSERT INTO public.users (id, email, company_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [uid, email, org]);
    await db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'admin', 'active')`, [uid, org]);
    await db.query(`INSERT INTO public.campaigns (id, name, company_id) VALUES (gen_random_uuid(), 'sec-a', $1)`, [org]);
    await db.query(`INSERT INTO public.canonical_domains (company_id, primary_domain) VALUES ($1, $2)`, [org, `sec-a-${org.slice(-1)}.example`]);
    await db.query(`INSERT INTO public.extension_sessions (user_id, org_id, session_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [uid, org, `sec-a-${uid}`]);
    await db.query(`INSERT INTO public.reports (company_id, user_id, domain) VALUES ($1, $2, $3)`, [org, uid, `sec-a-${org.slice(-1)}.example`]);
    await db.query(`INSERT INTO public.creator_assets (id, company_id, user_id, creator_type, title) VALUES ($1, $2, $3, 'image', 'sec-a')`,
      [`sec-a-${org.slice(-1)}`, org, uid]);
    await db.query(`INSERT INTO public.notifications (user_id, title) VALUES ($1, 'sec-a')`, [uid]);
    await db.query(`INSERT INTO public.user_preferences (user_id) VALUES ($1)`, [uid]);
    await db.query(`INSERT INTO public.free_credit_profiles (user_id, organization_id, phone_number) VALUES ($1, $2, $3)`, [uid, org, `+1555000000${org.slice(-1) === 'a' ? '1' : '2'}`]);
  }
  const pub = await db.query(`INSERT INTO public.public_blogs (title, slug, status) VALUES ('sec-a pub', 'sec-a-pub', 'published') RETURNING id`);
  const draft = await db.query(`INSERT INTO public.public_blogs (title, slug, status) VALUES ('sec-a draft', 'sec-a-draft', 'draft') RETURNING id`);
  await db.query(`INSERT INTO public.blog_comments (blog_id, author_name, author_email, content, status)
                  VALUES ($1, 'Pat', 'pat.private@example.invalid', 'hi', 'approved'), ($1, 'Sam', 'sam@example.invalid', 'spam', 'pending')`,
  [pub.rows[0].id]);
  await db.query(`INSERT INTO public.blog_series (title, slug) VALUES ('sec-a series', 'sec-a-series')`);
  return { blogPub: pub.rows[0].id, blogDraft: draft.rows[0].id };
}

const MINE = `IN ('${ORG_A}','${ORG_B}')`;
/** Run every statement for every client; returns {client: [results]}. */
async function matrix(stmts: Array<{ sql: string; k?: string; raw?: boolean }>): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const c of CLIENTS) {
    const row: string[] = [];
    for (const s of stmts) {
      const o = await req(c.role, c.claims, s.sql);
      row.push(s.raw ? status(o) : tenants(o, s.k));
    }
    out[c.name] = row;
  }
  return out;
}
const allDenied = (n: number) => Object.fromEntries(CLIENTS.map((c) => [c.name, Array(n).fill(DENY)]));

describe('SEC-A class-wide client privileges (50 tables)', () => {
  it('privileges: pre-fix production ACL is client-open; post-fix exactly the intended matrix, everything else unchanged', async () => {
    await inRollback(async () => {
      await productionPreFix();
      const before = await structureSnapshot();
      const pre = await privilegeReport();
      expect(Object.keys(before)).toHaveLength(50);
      // Negative control + evidence fidelity.
      expect(pre).not.toEqual(intended());
      expect([pre['campaigns/anon'], pre['content_block/anon'], pre['content_block/authenticated'], pre['blog_series/anon'], pre['content/authenticated']])
        .toEqual([FULL, '', FULL, 'SELECT,MAINTAIN', '']);

      await db.query(MIGRATION);
      expect({
        clients: await privilegeReport(),
        structure: await structureSnapshot(),
        service: await privilegeReport(['service_role']),
      }).toEqual({
        clients: intended(),
        structure: before, // RLS flags, policies, postgres/service_role entries untouched
        service: Object.fromEntries(ALL.map((t) => [`${t}/service_role`, PRIVS.join(',')])),
      });
    });
  });

  it('claim:company_id (campaigns, canonical_domains) + claim:org_id (extension_sessions): latent pre-fix, denied post-fix', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      const stmts = [
        { sql: `SELECT company_id k FROM public.campaigns WHERE company_id ${MINE}` },
        { sql: `INSERT INTO public.campaigns (id, name, company_id) VALUES (gen_random_uuid(), 'x', '${ORG_A}') RETURNING company_id k` },
        { sql: `INSERT INTO public.campaigns (id, name, company_id) VALUES (gen_random_uuid(), 'x', '${ORG_B}') RETURNING company_id k` },
        { sql: `UPDATE public.campaigns SET company_id = '${ORG_B}' WHERE company_id = '${ORG_A}' RETURNING company_id k` },
        { sql: `DELETE FROM public.canonical_domains WHERE company_id ${MINE} RETURNING company_id k` },
        { sql: `SELECT org_id k FROM public.extension_sessions WHERE org_id ${MINE}` },
        { sql: `INSERT INTO public.extension_sessions (user_id, org_id, session_token, expires_at) VALUES ('${ME}', '${ORG_A}', 'x', now() + interval '1 day') RETURNING org_id k` },
        { sql: `UPDATE public.extension_sessions SET last_seen = now() WHERE org_id ${MINE} RETURNING org_id k` },
      ];
      // Pre-fix. RLS refusals of INSERT are 42501 WITHOUT "permission denied for table".
      expect(await matrix(stmts)).toEqual({
        anon: ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0'],
        // user_metadata/app_metadata say B: nothing of B (or A) is reachable.
        'session(metadata=B)': ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0'],
        // Latent: a top-level claim would give direct tenant-A read/write — never B.
        'hypothetical top-level A': ['A:1 B:0', 'A:1 B:0', 'ERR 42501', 'ERR 42501', 'A:1 B:0', 'A:1 B:0', 'A:1 B:0', 'A:0 B:0'],
      });
      await db.query(MIGRATION);
      const service: string[] = [];
      for (const s of [stmts[0], stmts[2], stmts[4], stmts[5]]) service.push(tenants(await req(SERVICE.role, SERVICE.claims, s.sql), s.k));
      expect({ clients: await matrix(stmts), service }).toEqual({
        clients: allDenied(stmts.length),
        service: ['A:1 B:1', 'A:0 B:1', 'A:1 B:1', 'A:1 B:1'],
      });
    });
  });

  it('membership(uid): inert pre-fix because user_company_roles is service-only; a self-read policy would make it live; post-fix denied regardless', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      const stmts = [
        { sql: `SELECT company_id k FROM public.reports WHERE company_id ${MINE}` },
        { sql: `SELECT company_id k FROM public.creator_assets WHERE company_id ${MINE}` },
        { sql: `INSERT INTO public.reports (company_id, user_id, domain) VALUES ('${ORG_A}', '${ME}', 'x.example') RETURNING company_id k` },
        { sql: `UPDATE public.reports SET domain = 'y.example' WHERE company_id ${MINE} RETURNING company_id k` },
        { sql: `SELECT company_id k FROM public.user_company_roles WHERE company_id ${MINE}` },
      ];
      // PROOF on production policies: even ME, an ACTIVE member of A, sees nothing —
      // the policy's subquery on user_company_roles is itself RLS-filtered to zero rows.
      const preInert = await matrix(stmts);
      expect(preInert).toEqual(Object.fromEntries(CLIENTS.map((c) => [c.name, ['A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0', 'A:0 B:0']])));

      // Latent: one routine "read own memberships" policy turns the FOR ALL policies live.
      await db.query(`CREATE POLICY sec_a_test_self_read ON public.user_company_roles FOR SELECT TO authenticated USING (user_id = auth.uid())`);
      const live = await matrix(stmts);
      expect(live['session(metadata=B)']).toEqual(['A:1 B:0', 'A:1 B:0', 'A:1 B:0', 'A:1 B:0', 'A:1 B:0']);
      expect(live.anon).toEqual(preInert.anon);

      await db.query(MIGRATION);
      // Post-fix, with the hypothetical self-read policy STILL in place.
      const service = tenants(await req(SERVICE.role, SERVICE.claims, stmts[0].sql));
      expect({ clients: await matrix(stmts), service }).toEqual({ clients: allDenied(stmts.length), service: 'A:1 B:1' });
    });
  });

  it('own-row(uid) + identity core: own rows only pre-fix (unused by the app); post-fix denied; service_role unaffected', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      const stmts = [
        { sql: `SELECT user_id k FROM public.notifications WHERE user_id IN ('${ME}','${OTHER}')` },
        { sql: `UPDATE public.notifications SET is_read = true WHERE user_id IN ('${ME}','${OTHER}') RETURNING user_id k` },
        { sql: `SELECT user_id k FROM public.user_preferences WHERE user_id IN ('${ME}','${OTHER}')` },
        { sql: `INSERT INTO public.user_preferences (user_id) VALUES ('${OTHER}') RETURNING user_id k` },
        { sql: `UPDATE public.free_credit_profiles SET phone_number = '+19999999999' WHERE user_id IN ('${ME}','${OTHER}') RETURNING user_id k` },
        { sql: `SELECT id k FROM public.users WHERE id IN ('${ME}','${OTHER}')` },
        { sql: `SELECT id k FROM public.companies WHERE id ${MINE}` },
        { sql: `UPDATE public.companies SET name = 'pwned' WHERE id ${MINE} RETURNING id k` },
        // A-C2: fcp_update_own has no WITH CHECK beyond user_id, so a member of A can re-point
        // its OWN profile at tenant B with a past expiry and a huge amount — exactly the columns
        // backend/services/creditExpiryService.ts feeds to apply_credit_reservation(p_org_id, 'expire', …).
        { sql: `UPDATE public.free_credit_profiles SET organization_id = '${ORG_B}', initial_credits = 1000000,
                credit_expiry_at = now() - interval '1 day' WHERE user_id = '${ME}' RETURNING organization_id k` },
      ];
      const ownOnly = ['A:1 B:0', 'A:1 B:0', 'A:1 B:0', 'ERR 42501', 'A:1 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:1'];
      expect(await matrix(stmts)).toEqual({
        anon: ['A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0'],
        'session(metadata=B)': ownOnly, // keyed on auth.uid() only; metadata is irrelevant
        'hypothetical top-level A': ownOnly,
      });
      await db.query(MIGRATION);
      const service: string[] = [];
      for (const s of [stmts[0], stmts[2], stmts[5], stmts[6]]) service.push(tenants(await req(SERVICE.role, SERVICE.claims, s.sql), s.k));
      expect({ clients: await matrix(stmts), service }).toEqual({
        clients: allDenied(stmts.length),
        service: ['A:1 B:1', 'A:1 B:1', 'A:1 B:1', 'A:1 B:1'],
      });
    });
  });

  it('public content: published reads keep working; client writes and blog_comments (author_email) are closed', async () => {
    await inRollback(async () => {
      await productionPreFix();
      const fx = await seed();
      const stmts = [
        { sql: `SELECT id, status FROM public.public_blogs WHERE slug LIKE 'sec-a-%'`, raw: true },
        { sql: `SELECT id FROM public.blog_series WHERE slug = 'sec-a-series'`, raw: true },
        { sql: `SELECT author_email FROM public.blog_comments WHERE blog_id = '${fx.blogPub}'`, raw: true },
        { sql: `INSERT INTO public.public_blogs (title, slug, status) VALUES ('x', 'sec-a-x', 'published') RETURNING id`, raw: true },
        { sql: `UPDATE public.public_blogs SET title = 'defaced' WHERE id = '${fx.blogPub}' RETURNING id`, raw: true },
        { sql: `DELETE FROM public.public_blogs WHERE id = '${fx.blogDraft}' RETURNING id`, raw: true },
        { sql: `INSERT INTO public.blog_comments (blog_id, author_name, author_email, content) VALUES ('${fx.blogPub}', 'x', 'x@x.invalid', 'x') RETURNING id`, raw: true },
      ];
      // Pre-fix: published-only read works; blog_comments hands the approved comment's
      // author_email to anon (CONFIRMED exposure if approved rows exist); writes are RLS-refused.
      const pre = ['ok:1', 'ok:1', 'ok:1', 'ERR 42501', 'ok:0', 'ok:0', 'ERR 42501'];
      expect(await matrix(stmts)).toEqual(Object.fromEntries(CLIENTS.map((c) => [c.name, pre])));
      const leak = await req('anon', CLIENTS[0].claims, stmts[2].sql);
      expect(leak.ok && leak.rows).toEqual([{ author_email: 'pat.private@example.invalid' }]);

      await db.query(MIGRATION);
      const published = await req('anon', CLIENTS[0].claims, `SELECT id FROM public.public_blogs WHERE slug LIKE 'sec-a-%'`);
      expect({
        clients: await matrix(stmts),
        anonSeesOnlyPublished: published.ok ? published.rows.map((r) => r.id) : published,
      }).toEqual({
        clients: Object.fromEntries(CLIENTS.map((c) => [c.name, ['ok:1', 'ok:1', DENY, DENY, DENY, DENY, DENY]])),
        anonSeesOnlyPublished: [fx.blogPub],
      });
    });
  });

  it('metadata manipulation and a forged role claim never elevate; post-fix every client probe on all 50 tables is privilege-checked', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      // DB role authenticated + top-level role=service_role: the service-role CLAIM gate
      // (auth.role() = 'service_role') admits it pre-fix. PostgREST cannot produce this
      // combination (it derives the DB role from the same claim) — latent only.
      const forged = { ...SESSION, role: 'service_role' };
      const probe = `SELECT company_id k FROM public.canonical_domains WHERE company_id ${MINE}`;
      expect(tenants(await req('authenticated', forged, probe))).toBe('A:1 B:1');
      // user_metadata/app_metadata role=service_role does nothing.
      expect(tenants(await req('authenticated', SESSION, probe))).toBe('A:0 B:0');

      await db.query(MIGRATION);
      // Sweep: a read probe and a write probe per table per client (WHERE false: only privilege is tested).
      const sweep: Record<string, string> = {};
      for (const c of [...CLIENTS, { name: 'forged role claim', role: 'authenticated', claims: forged }]) {
        for (const t of ALL) {
          const r = status(await req(c.role, c.claims, `SELECT 1 FROM public."${t}" WHERE false`));
          const w = status(await req(c.role, c.claims, `DELETE FROM public."${t}" WHERE false`));
          sweep[`${c.name}/${t}`] = `${r}|${w}`;
        }
      }
      const expected = Object.fromEntries(Object.keys(sweep).map((k) => {
        const t = k.split('/')[1];
        return [k, SELECT_ONLY.includes(t) ? `ok:0|${DENY}` : `${DENY}|${DENY}`];
      }));
      expect({ sweep, forged: tenants(await req('authenticated', forged, probe)) }).toEqual({ sweep: expected, forged: DENY });
    });
  });

  it('is idempotent, and the rollback restores the exact pre-fix production client ACL', async () => {
    await inRollback(async () => {
      await db.query(PROD_AUTH);
      await db.query(ROLLBACK);
      const prefix = await clientAcl();
      const expectAcl = [
        ...G1.flatMap((t) => ['anon', 'authenticated'].flatMap((r) => FULL.split(',').map((p) => `${t}:${r}:${p}`))),
        ...G2.flatMap((t) => FULL.split(',').map((p) => `${t}:authenticated:${p}`)),
        ...G3.flatMap((t) => ['anon', 'authenticated'].flatMap((r) => ['SELECT', 'MAINTAIN'].map((p) => `${t}:${r}:${p}`))),
      ].sort();
      expect([...prefix].sort()).toEqual(expectAcl);

      await db.query(MIGRATION);
      const once = await clientAcl();
      await db.query(MIGRATION);
      expect(await clientAcl()).toEqual(once);
      expect([...once].sort()).toEqual(SELECT_ONLY.flatMap((t) => [`${t}:anon:SELECT`, `${t}:authenticated:SELECT`]).sort());

      await db.query(ROLLBACK);
      expect([...(await clientAcl())].sort()).toEqual(expectAcl);
    });
  });
});
