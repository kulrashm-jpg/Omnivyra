/**
 * SEC-A1 — real-schema cover for
 * 20270110000000_canonical_leads_users_client_privileges_revoked.
 *
 * Proves, on the replayed production schema:
 *   1. the INSTALLED state (the replay applies every migration) leaves
 *      canonical_leads / canonical_users reachable by service_role only;
 *   2. production's pre-fix state (recreated from the migration's own rollback
 *      plus production's verbatim auth.jwt()/auth.role()) isolates tenants for
 *      every claim set a client can actually hold, and isolates them even for a
 *      hypothetical token carrying a top-level company_id — then the migration
 *      removes client access entirely while service_role keeps full access;
 *   3. the migration is idempotent and the rollback restores the exact prior ACL.
 *
 * Every role switch is SET LOCAL ROLE + request.jwt.claims, exactly what
 * PostgREST does per request. Everything runs inside inRollback(); the
 * migration/rollback text is executed without its own BEGIN/COMMIT so the outer
 * transaction (and therefore the database) is never committed.
 */
import fs from 'fs';
import path from 'path';
import { db, inRollback, seedTenants, newPerson, ORG_A, ORG_B } from './setup';

const ROOT = path.resolve(__dirname, '../../..');
const stripTx = (sql: string) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');
const MIGRATION = stripTx(fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20270110000000_canonical_leads_users_client_privileges_revoked.sql'), 'utf8'));
const ROLLBACK = stripTx(fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/rollbacks/canonical_leads_users_client_privileges_revoked_rollback.sql'), 'utf8'));

const TABLES = ['canonical_leads', 'canonical_users'] as const;
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

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
const CLIENTS: Array<{ name: string; role: string; claims: Claims }> = [
  { name: 'anon', role: 'anon', claims: { iss: 'supabase', role: 'anon' } },
  { name: 'authenticated (real session)', role: 'authenticated', claims: SESSION },
  { name: 'authenticated (hypothetical top-level company_id=A)', role: 'authenticated', claims: { ...SESSION, company_id: ORG_A } },
];
const SERVICE = { role: 'service_role', claims: { iss: 'supabase', role: 'service_role' } };

type Outcome = { ok: true; rows: any[] } | { ok: false; code: string };

/** One PostgREST-style request: role + claims + statement, always undone. */
async function req(role: string, claims: Claims | null, sql: string, params: unknown[] = []): Promise<Outcome> {
  await db.query('SAVEPOINT r');
  try {
    await db.query(`SET LOCAL ROLE ${role}`);
    if (claims) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    return { ok: false, code: e.code ?? 'unknown' };
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT r');
  }
}
const tenants = (o: Outcome) => {
  if (!o.ok) return `ERR ${(o as { code: string }).code}`;
  const ids = o.rows.map((r) => r.company_id);
  return `A:${ids.filter((x) => x === ORG_A).length} B:${ids.filter((x) => x === ORG_B).length}`;
};

interface Fixture { users: Record<string, string>; }
async function seed(): Promise<Fixture> {
  await seedTenants();
  const users: Record<string, string> = {};
  for (const org of [ORG_A, ORG_B]) {
    const person = await newPerson(org);
    const { rows: u } = await db.query(
      `INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
       VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `sec-a1-${org.slice(-1)}`]);
    users[org] = u[0].id;
    for (const src of ['crm', 'csv']) {
      await db.query(
        `INSERT INTO public.canonical_leads (company_id, user_id, source, unified_person_id) VALUES ($1,$2,$3,$4)`,
        [org, u[0].id, `sec-a1-${src}`, person]);
    }
  }
  return { users };
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

async function expectServiceOnly(): Promise<void> {
  for (const t of TABLES) {
    for (const r of ['anon', 'authenticated', 'public']) {
      const { rows } = await db.query(
        `SELECT p FROM unnest($2::text[]) p WHERE has_table_privilege($1, $3::regclass, p)`, [r, PRIVS, `public.${t}`]);
      expect(`${t}/${r}: ${rows.map((x) => x.p).join(',')}`).toBe(`${t}/${r}: `);
    }
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await db.query(`SELECT has_table_privilege('service_role', $1::regclass, $2) AS ok`, [`public.${t}`, p]);
      expect(`${t}/service_role/${p}:${rows[0].ok}`).toBe(`${t}/service_role/${p}:true`);
    }
  }
}

describe('SEC-A1 canonical_leads / canonical_users client privileges', () => {
  it('installed state: service_role only, RLS still enabled, policies intact', async () => {
    await expectServiceOnly();
    const { rows } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('public.canonical_leads'::regclass,'public.canonical_users'::regclass) ORDER BY 1`);
    expect(rows).toEqual([{ relname: 'canonical_leads', relrowsecurity: true }, { relname: 'canonical_users', relrowsecurity: true }]);
    const pol = await db.query(`SELECT count(*)::int n FROM pg_policy WHERE polrelid = 'public.canonical_leads'::regclass`);
    expect(pol.rows[0].n).toBe(5);
  });

  it('pre-fix production state isolates tenants for every client claim set; the migration then removes client access', async () => {
    await inRollback(async () => {
      await db.query(PROD_AUTH);
      await db.query(ROLLBACK); // production's pre-fix ACL (anon/authenticated arwdxtm)
      const fx = await seed();
      const insA = `INSERT INTO public.canonical_leads (company_id, user_id, source) VALUES ('${ORG_A}','${fx.users[ORG_A]}','sec-a1-x') RETURNING company_id`;
      const insB = `INSERT INTO public.canonical_leads (company_id, user_id, source) VALUES ('${ORG_B}','${fx.users[ORG_B]}','sec-a1-x') RETURNING company_id`;
      const sel = `SELECT company_id FROM public.canonical_leads WHERE ${MINE}`;
      const upd = `UPDATE public.canonical_leads SET lead_status = 'sec-a1' WHERE ${MINE} RETURNING company_id`;
      const move = `UPDATE public.canonical_leads SET company_id = '${ORG_B}', user_id = '${fx.users[ORG_B]}', unified_person_id = NULL WHERE company_id = '${ORG_A}' RETURNING company_id`;
      const del = `DELETE FROM public.canonical_leads WHERE ${MINE} RETURNING company_id`;
      const selU = `SELECT company_id FROM public.canonical_users WHERE ${MINE}`;

      const before: Record<string, string[]> = {};
      for (const c of CLIENTS) {
        const out: string[] = [];
        for (const s of [sel, insA, insB, upd, move, del, selU, 'TRUNCATE public.canonical_leads CASCADE']) {
          out.push(tenants(await req(c.role, c.claims, s)));
        }
        before[c.name] = out;
      }
      //                         SELECT     INSERT A     INSERT B     UPDATE     A->B         DELETE     users      TRUNCATE
      expect(before).toEqual({
        anon: ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501'],
        'authenticated (real session)': ['A:0 B:0', 'ERR 42501', 'ERR 42501', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'A:0 B:0', 'ERR 42501'],
        // Latent: such a token would give direct tenant-A read/write — but never tenant B.
        'authenticated (hypothetical top-level company_id=A)': ['A:2 B:0', 'A:1 B:0', 'ERR 42501', 'A:2 B:0', 'ERR 42501', 'A:2 B:0', 'A:1 B:0', 'ERR 42501'],
      });
      expect(tenants(await req(SERVICE.role, SERVICE.claims, sel))).toBe('A:2 B:2');

      await db.query(MIGRATION);
      await expectServiceOnly();

      for (const c of CLIENTS) {
        for (const s of [sel, insA, insB, upd, move, del, selU, 'TRUNCATE public.canonical_leads CASCADE',
          `INSERT INTO public.canonical_users (company_id, user_type, device) VALUES ('${ORG_A}','known','desktop') RETURNING company_id`,
          `DELETE FROM public.canonical_users WHERE ${MINE} RETURNING company_id`]) {
          expect(`${c.name} | ${s.slice(0, 40)} | ${tenants(await req(c.role, c.claims, s))}`)
            .toBe(`${c.name} | ${s.slice(0, 40)} | ERR 42501`);
        }
      }
      // service_role (BYPASSRLS) keeps full cross-tenant access.
      expect(tenants(await req(SERVICE.role, SERVICE.claims, sel))).toBe('A:2 B:2');
      expect(tenants(await req(SERVICE.role, SERVICE.claims, insB))).toBe('A:0 B:1');
      expect(tenants(await req(SERVICE.role, SERVICE.claims, upd))).toBe('A:2 B:2');
      expect(tenants(await req(SERVICE.role, SERVICE.claims, del))).toBe('A:2 B:2');
      expect(tenants(await req(SERVICE.role, SERVICE.claims, selU))).toBe('A:1 B:1');
    });
  });

  it('a forged role claim cannot reach the tables once client grants are gone', async () => {
    await inRollback(async () => {
      await db.query(PROD_AUTH);
      await db.query(ROLLBACK);
      await seed();
      const forged = { ...SESSION, company_id: ORG_A, role: 'service_role' };
      const sel = `SELECT company_id FROM public.canonical_leads WHERE ${MINE}`;
      // Pre-fix: service_role_full_access trusts the CLAIM, so a DB role of
      // `authenticated` with role=service_role in its claims reads every tenant.
      // (Not reachable through PostgREST, which derives the DB role from the same claim.)
      expect(tenants(await req('authenticated', forged, sel))).toBe('A:2 B:2');
      await db.query(MIGRATION);
      expect(tenants(await req('authenticated', forged, sel))).toBe('ERR 42501');
    });
  });

  it('merge_unified_persons never lets a client role re-point canonical_leads', async () => {
    await inRollback(async () => {
      await db.query(PROD_AUTH);
      await db.query(ROLLBACK);
      await seed();
      const { rows } = await db.query(
        `SELECT unified_person_id AS p FROM public.canonical_leads WHERE company_id = $1 LIMIT 1`, [ORG_A]);
      const winner = await newPerson(ORG_A);
      for (const phase of ['pre-fix', 'post-fix']) {
        if (phase === 'post-fix') await db.query(MIGRATION);
        for (const c of CLIENTS) {
          const o = await req(c.role, c.claims, `SELECT public.merge_unified_persons($1, $2, 'sec-a1', 'sec-a1')`, [winner, rows[0].p]);
          expect(`${phase} ${c.name}: ${o.ok ? 'ok' : 'refused'}`).toBe(`${phase} ${c.name}: refused`);
        }
      }
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
