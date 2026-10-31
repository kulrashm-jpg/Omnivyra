/**
 * SEC-A1 — real-schema cover for
 * 20270111000000_canonical_leads_users_client_privileges_revoked.
 *
 * The replay database is ACL-free (the baseline is dumped --no-privileges and no
 * replayed migration grants anything on these tables), so the INSTALLED state
 * proves nothing on its own. Every test therefore first recreates production's
 * pre-fix ACL with the migration's own rollback (anon/authenticated arwdxtm),
 * observes the pre-fix behaviour, then runs the migration text and observes the
 * post-fix behaviour. Post-fix observations are collected and compared in one
 * assertion per test, so a no-op migration fails every cell at once
 * (SEC_A1_MIGRATION_FILE substitutes a mutated migration to prove exactly that).
 *
 * Every role switch is SET LOCAL ROLE + request.jwt.claims, exactly what
 * PostgREST does per request, using production's verbatim auth.jwt()/auth.role().
 * Everything runs inside inRollback(); migration/rollback text is executed
 * without its own BEGIN/COMMIT so the database is never committed.
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback, seedTenants, newPerson, ORG_A, ORG_B } from './setup';

const ROOT = path.resolve(__dirname, '../../..');
const stripTx = (sql: string) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
const MIGRATION = stripTx(fs.readFileSync(process.env.SEC_A1_MIGRATION_FILE
  || path.join(ROOT, 'supabase/migrations/20270111000000_canonical_leads_users_client_privileges_revoked.sql'), 'utf8'));
const ROLLBACK = stripTx(fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/rollbacks/canonical_leads_users_client_privileges_revoked_rollback.sql'), 'utf8'));

const TABLES = ['canonical_leads', 'canonical_users'] as const;
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const DENIED = 'permission denied for table';

/** Production's claim readers, verbatim (the bootstrap's auth.role() reads only the legacy GUC). */
const PROD_AUTH = `
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$function$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$function$;`;

const ME = '00000000-0000-4000-8000-0000000a1a01';
const SESSION = {
  iss: 'https://example.supabase.co/auth/v1', sub: ME, aud: 'authenticated', role: 'authenticated',
  email: 'a1@example.invalid', aal: 'aal1', session_id: ME, is_anonymous: false,
  app_metadata: { provider: 'email', providers: ['email'] },
  // user_metadata is user-writable; a tenant id placed there must NOT count.
  user_metadata: { company_id: ORG_B },
};
type Claims = Record<string, unknown>;
const TOKEN_A = { ...SESSION, company_id: ORG_A };
const CLIENTS: Array<{ name: string; role: string; claims: Claims }> = [
  { name: 'anon', role: 'anon', claims: { iss: 'supabase', role: 'anon' } },
  { name: 'authenticated (real session)', role: 'authenticated', claims: SESSION },
  { name: 'authenticated (hypothetical top-level company_id=A)', role: 'authenticated', claims: TOKEN_A },
];
const SERVICE = { role: 'service_role', claims: { iss: 'supabase', role: 'service_role' } };

type Outcome = { ok: true; rows: any[] } | { ok: false; code: string; message: string };

/** One PostgREST-style request: role + claims + statement, always undone. */
async function req(role: string, claims: Claims | null, sql: string, params: unknown[] = []): Promise<Outcome> {
  await db.query('SAVEPOINT r');
  try {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (claims) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    return { ok: false, code: e.code ?? 'unknown', message: String(e.message ?? '') };
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT r');
  }
}
/** Rows per tenant on success; on failure the SQLSTATE plus "denied" when it is a PRIVILEGE (not RLS) refusal. */
const tenants = (o: Outcome) => {
  if (o.ok === false) return `ERR ${o.code}${o.message.includes(DENIED) ? ' denied' : ''}`;
  const ids = o.rows.map((r) => r.company_id);
  return `A:${ids.filter((x) => x === ORG_A).length} B:${ids.filter((x) => x === ORG_B).length}`;
};
const errorText = (o: Outcome) => (o.ok === false ? `${o.code}: ${o.message}` : 'ok');

interface Fixture { users: Record<string, string>; leads: Record<string, string>; }
async function seed(): Promise<Fixture> {
  await seedTenants();
  const fx: Fixture = { users: {}, leads: {} };
  for (const org of [ORG_A, ORG_B]) {
    const person = await newPerson(org);
    const { rows: u } = await db.query(
      `INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
       VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `sec-a1-${org.slice(-1)}`]);
    fx.users[org] = u[0].id;
    for (const src of ['crm', 'csv']) {
      const { rows: l } = await db.query(
        `INSERT INTO public.canonical_leads (company_id, user_id, source, unified_person_id) VALUES ($1,$2,$3,$4) RETURNING id`,
        [org, u[0].id, `sec-a1-${src}`, person]);
      fx.leads[org] = l[0].id;
    }
  }
  return fx;
}

/** Production's pre-fix state: verbatim claim readers + the pre-fix ACL (the rollback). */
async function productionPreFix(): Promise<void> {
  await db.query(PROD_AUTH);
  await db.query(ROLLBACK);
}

/** Only this suite's rows (the replay DB may hold other suites' fixtures). */
const MINE = `company_id IN ('${ORG_A}','${ORG_B}')`;

async function aclSnapshot(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT c.relname || ':' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type AS e
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid IN ('public.canonical_leads'::regclass, 'public.canonical_users'::regclass)
      ORDER BY 1`);
  return rows.map((r) => r.e);
}

/** Effective privileges of the client roles + service_role on both tables. */
async function privilegeReport(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    for (const r of ['anon', 'authenticated', 'public']) {
      const { rows } = await db.query(
        `SELECT p FROM unnest($2::text[]) p WHERE has_table_privilege($1, $3::regclass, p)`, [r, PRIVS, `public.${t}`]);
      out[`${t}/${r}`] = rows.map((x) => x.p).join(',');
    }
    const { rows } = await db.query(
      `SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE has_table_privilege('service_role', $1::regclass, p)`,
      [`public.${t}`]);
    out[`${t}/service_role`] = rows.map((x) => x.p).join(',');
  }
  return out;
}
const SERVICE_ONLY = {
  'canonical_leads/anon': '', 'canonical_leads/authenticated': '', 'canonical_leads/public': '',
  'canonical_leads/service_role': 'SELECT,INSERT,UPDATE,DELETE',
  'canonical_users/anon': '', 'canonical_users/authenticated': '', 'canonical_users/public': '',
  'canonical_users/service_role': 'SELECT,INSERT,UPDATE,DELETE',
};
async function expectServiceOnly(): Promise<void> {
  expect(await privilegeReport()).toEqual(SERVICE_ONLY);
}

describe('SEC-A1 canonical_leads / canonical_users client privileges', () => {
  it('privileges: the pre-fix production ACL is NOT service-only; the migration makes it service-only', async () => {
    await inRollback(async () => {
      await productionPreFix();
      // Negative control: on the pre-fix ACL the post-condition must not hold.
      await expect(expectServiceOnly()).rejects.toThrow();
      expect((await privilegeReport())['canonical_leads/anon']).toBe('SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,MAINTAIN');

      await db.query(MIGRATION);
      await expectServiceOnly();
      const { rows } = await db.query(
        `SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('public.canonical_leads'::regclass,'public.canonical_users'::regclass) ORDER BY 1`);
      expect(rows).toEqual([{ relname: 'canonical_leads', relrowsecurity: true }, { relname: 'canonical_users', relrowsecurity: true }]);
      const pol = await db.query(`SELECT count(*)::int n FROM pg_policy WHERE polrelid = 'public.canonical_leads'::regclass`);
      expect(pol.rows[0].n).toBe(5);
    });
  });

  it('pre-fix production state isolates tenants for every client claim set; the migration then removes client access', async () => {
    await inRollback(async () => {
      await productionPreFix();
      const fx = await seed();
      const insA = `INSERT INTO public.canonical_leads (company_id, user_id, source) VALUES ('${ORG_A}','${fx.users[ORG_A]}','sec-a1-x') RETURNING company_id`;
      const insB = `INSERT INTO public.canonical_leads (company_id, user_id, source) VALUES ('${ORG_B}','${fx.users[ORG_B]}','sec-a1-x') RETURNING company_id`;
      const sel = `SELECT company_id FROM public.canonical_leads WHERE ${MINE}`;
      const upd = `UPDATE public.canonical_leads SET lead_status = 'sec-a1' WHERE ${MINE} RETURNING company_id`;
      const move = `UPDATE public.canonical_leads SET company_id = '${ORG_B}', user_id = '${fx.users[ORG_B]}', unified_person_id = NULL WHERE company_id = '${ORG_A}' RETURNING company_id`;
      const del = `DELETE FROM public.canonical_leads WHERE ${MINE} RETURNING company_id`;
      const selU = `SELECT company_id FROM public.canonical_users WHERE ${MINE}`;
      const insU = `INSERT INTO public.canonical_users (company_id, user_type, device) VALUES ('${ORG_A}','known','desktop') RETURNING company_id`;
      const delU = `DELETE FROM public.canonical_users WHERE ${MINE} RETURNING company_id`;
      const trunc = 'TRUNCATE public.canonical_leads CASCADE';
      const STMTS = [sel, insA, insB, upd, move, del, selU, insU, delU, trunc];
      const observe = async () => {
        const out: Record<string, string[]> = {};
        for (const c of CLIENTS) {
          const row: string[] = [];
          for (const s of STMTS) row.push(tenants(await req(c.role, c.claims, s)));
          out[c.name] = row;
        }
        return out;
      };

      // Pre-fix. Note INSERTs refused by RLS are 42501 WITHOUT "permission denied for table".
      //        SELECT     INSERT A     INSERT B     UPDATE     A->B         DELETE     users sel  users ins    users del  TRUNCATE
      expect(await observe()).toEqual({
        anon: ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0', 'ERR 42501 denied'],
        'authenticated (real session)': ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501', 'A:0 B:0', 'ERR 42501 denied'],
        // Latent: such a token would give direct tenant-A read/write — but never tenant B.
        'authenticated (hypothetical top-level company_id=A)': ['A:2 B:0', 'A:1 B:0', 'ERR 42501', 'A:2 B:0', 'ERR 42501', 'A:2 B:0', 'A:1 B:0', 'A:1 B:0', 'A:1 B:0', 'ERR 42501 denied'],
      });
      expect(tenants(await req(SERVICE.role, SERVICE.claims, sel))).toBe('A:2 B:2');

      await db.query(MIGRATION);

      // Post-fix: every client statement — INSERTs included — is a PRIVILEGE denial
      // ("permission denied for table"), not the RLS 42501 INSERTs returned pre-fix.
      const denied = Array(STMTS.length).fill('ERR 42501 denied');
      const service: string[] = [];
      for (const s of [sel, insB, upd, del, selU]) service.push(tenants(await req(SERVICE.role, SERVICE.claims, s)));
      expect({ clients: await observe(), service }).toEqual({
        clients: Object.fromEntries(CLIENTS.map((c) => [c.name, denied])),
        // service_role (BYPASSRLS) keeps full cross-tenant access.
        service: ['A:2 B:2', 'A:0 B:1', 'A:2 B:2', 'A:2 B:2', 'A:1 B:1'],
      });
    });
  });

  it('existence oracle: a company_id=A token learns whether a tenant-B lead id exists pre-fix; post-fix both probes are privilege denials', async () => {
    await inRollback(async () => {
      await productionPreFix();
      const fx = await seed();
      const probe = (id: string) => req('authenticated', TOKEN_A,
        `INSERT INTO public.canonical_leads (id, company_id, user_id, source) VALUES ($1, $2, $3, 'sec-a1-oracle') RETURNING company_id`,
        [id, ORG_A, fx.users[ORG_A]]);
      const fresh = '00000000-0000-4000-8000-0000000a1f01';
      const observe = async () => ({ reused: errorText(await probe(fx.leads[ORG_B])), fresh: errorText(await probe(fresh)) });

      const pre = await observe();
      expect(pre.reused).toMatch(/^23505: .*canonical_leads_pkey/);
      expect(pre.fresh).toBe('ok');

      await db.query(MIGRATION);
      expect(await observe()).toEqual({
        reused: '42501: permission denied for table canonical_leads',
        fresh: '42501: permission denied for table canonical_leads',
      });
    });
  });

  it('a forged role claim cannot reach the tables once client grants are gone', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      const forged = { ...SESSION, company_id: ORG_A, role: 'service_role' };
      const sel = `SELECT company_id FROM public.canonical_leads WHERE ${MINE}`;
      // Pre-fix: service_role_full_access trusts the CLAIM, so a DB role of
      // `authenticated` with role=service_role in its claims reads every tenant.
      // (Not reachable through PostgREST, which derives the DB role from the same claim.)
      expect(tenants(await req('authenticated', forged, sel))).toBe('A:2 B:2');
      await db.query(MIGRATION);
      expect(tenants(await req('authenticated', forged, sel))).toBe('ERR 42501 denied');
    });
  });

  it('merge_unified_persons: with its other tables opened to clients, the canonical tables are what stops it post-fix', async () => {
    await inRollback(async () => {
      await productionPreFix();
      await seed();
      // Open every OTHER table the function touches so canonical_users/canonical_leads
      // are the only variable. The neighbours get a permissive test policy;
      // canonical_revenue_events keeps its production company_id policies (rows hidden).
      const neighbours = ['users', 'leads', 'contacts', 'engagement_threads', 'unified_persons', 'unified_person_merges'];
      // service_role too: production holds it by default privileges; the ACL-free replay does not.
      for (const t of [...neighbours, 'canonical_revenue_events']) {
        await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${t}" TO anon, authenticated, service_role`);
      }
      for (const t of neighbours) {
        await db.query(`CREATE POLICY sec_a1_test_open ON public."${t}" TO anon, authenticated USING (true) WITH CHECK (true)`);
      }
      // SEC-B (20270111000003) also revokes client EXECUTE on this function. This test isolates
      // the TABLE layer, so the function grant is reopened inside the rolled-back transaction.
      await db.query(`GRANT EXECUTE ON FUNCTION public.merge_unified_persons(uuid, uuid, text, text) TO anon, authenticated, service_role`);
      const winner = await newPerson(ORG_A);
      const loser = await newPerson(ORG_A);
      const call = (c: { role: string; claims: Claims }) => req(c.role, c.claims,
        `SELECT public.merge_unified_persons($1, $2, 'sec-a1', 'sec-a1')`, [winner, loser]);

      // Pre-fix: the call gets past every table (canonical_* rows are merely RLS-hidden).
      const pre: Record<string, string> = {};
      for (const c of CLIENTS) pre[c.name] = errorText(await call(c));
      expect(pre).toEqual(Object.fromEntries(CLIENTS.map((c) => [c.name, 'ok'])));

      await db.query(MIGRATION);
      const post: Record<string, string> = {};
      for (const c of CLIENTS) post[c.name] = errorText(await call(c));
      expect(post).toEqual(Object.fromEntries(CLIENTS.map((c) => [c.name, '42501: permission denied for table canonical_users'])));
      // service_role still merges.
      expect(errorText(await call(SERVICE))).toBe('ok');
    });
  });

  it('is idempotent, and the rollback restores the exact pre-fix ACL', async () => {
    await inRollback(async () => {
      await db.query(ROLLBACK);
      const prefix = await aclSnapshot();
      expect(prefix).toEqual(expect.arrayContaining([
        'canonical_leads:anon:SELECT', 'canonical_leads:authenticated:DELETE', 'canonical_users:anon:MAINTAIN']));
      expect(prefix.filter((e) => /:(anon|authenticated):TRUNCATE$/.test(e))).toEqual([]);

      await db.query(MIGRATION);
      const once = await aclSnapshot();
      await db.query(MIGRATION);
      expect(await aclSnapshot()).toEqual(once);
      expect(once.filter((e) => /:(anon|authenticated|PUBLIC):/.test(e))).toEqual([]);

      await db.query(ROLLBACK);
      expect(await aclSnapshot()).toEqual(prefix);
    });
  });
});
