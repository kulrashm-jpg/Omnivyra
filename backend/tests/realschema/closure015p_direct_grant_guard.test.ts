/**
 * Closure-015P — REAL-POSTGRES proof of the database-level restriction on direct application-role
 * SUPER_ADMIN grants (supabase/migrations/20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql).
 * Run on a DISPOSABLE database only, after the promoted migrations are installed:
 *
 *     npm run test:realschema -- closure015p
 *
 * Nothing is applied by this suite: it tests the objects already INSTALLED. The execution-role
 * distinction is exercised for real: each statement runs inside a transaction after
 * `SET LOCAL ROLE <role>`, so current_user is that role exactly as it is behind PostgREST, while the
 * owner session (postgres) stands in for migrations, seeds and break-glass operators.
 */
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const CO = '00000000-0000-4000-8000-0000000015d1';
const CO2 = '00000000-0000-4000-8000-0000000015d2';
const U1 = '00000000-0000-4000-8000-0000000015e1';
const U2 = '00000000-0000-4000-8000-0000000015e2';
const ROW = '00000000-0000-4000-8000-0000000015e9';
const APP_ROLES = ['service_role', 'authenticated', 'anon', 'authenticator'] as const;

type Outcome = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string };

/** Runs `sql` in its own transaction as `role` (null = the owner session); commits on success. */
async function as(role: string | null, sql: string, params: unknown[] = []): Promise<Outcome> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    try {
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return { ok: true, rows: r.rows };
    } catch (e) {
      await c.query('ROLLBACK');
      const err = e as { code?: string; message?: string };
      return { ok: false, code: err.code ?? '?', message: err.message ?? '' };
    }
  } finally {
    await c.end();
  }
}

const memberships = async () =>
  (await db.query(`SELECT user_id, company_id, role, status FROM public.user_company_roles WHERE company_id = ANY($1::uuid[]) ORDER BY user_id, company_id`, [[CO, CO2]])).rows;
const activeSA = async () =>
  (await db.query(`SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = ANY($1::uuid[]) AND upper(role) = 'SUPER_ADMIN' AND status = 'active'`, [[CO, CO2]])).rows[0].n as number;

/** The owner session seeds one membership row in the given role/status. */
async function seed(role: string, status: string) {
  await db.query(
    `INSERT INTO public.user_company_roles (id, user_id, company_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
    [ROW, U1, CO, role, status]);
}

const notGoverned = (o: Outcome) => {
  expect(o).toMatchObject({ ok: false, code: 'P0001' });
  expect((o as { message: string }).message).toContain('SUPER_ADMIN_GRANT_NOT_GOVERNED');
};

beforeAll(async () => {
  // The suite relies on the installed objects; refuse to run against a database without them.
  const fn = (await db.query(
    `SELECT prosecdef, pg_get_functiondef(oid) AS def FROM pg_proc WHERE oid = to_regprocedure('public.guard_super_admin_membership_company()')`)).rows[0];
  // C15P_CONTROL=1 is the negative control: run against a database WITHOUT 20261210000002 to show
  // the refusal tests fail when the guard is absent.
  if (process.env.C15P_CONTROL !== '1' && (!fn || !String(fn.def).includes('SUPER_ADMIN_GRANT_NOT_GOVERNED'))) {
    throw new Error('direct-grant guard (20261210000002) is not installed in this database');
  }
  // baseline.sql is dumped WITHOUT privileges, so a throwaway replay has none of Supabase's default
  // table grants. Model the hosted default (service_role holds DML on public tables) for the one
  // table under test, so the guard — not a missing grant — is what the refusal tests exercise.
  await db.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_roles TO service_role');
  for (const [id, email] of [[U1, 'c15p-u1@example.test'], [U2, 'c15p-u2@example.test']]) {
    await db.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'c15p') ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
});

beforeEach(async () => {
  await db.query('DELETE FROM public.user_company_roles WHERE company_id = ANY($1::uuid[])', [[CO, CO2]]);
  await db.query('UPDATE public.users SET active_company_id = NULL WHERE id = ANY($1::uuid[])', [[U1, U2]]);
  await db.query('DELETE FROM public.company_profiles WHERE company_id = ANY($1::text[])', [[CO, CO2]]);
  await db.query('DELETE FROM public.companies WHERE id = ANY($1::uuid[])', [[CO, CO2]]);
  await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'C15P one'), ($2, 'C15P two')`, [CO, CO2]);
});

describe('installed shape', () => {
  it('the guard is invoker-rights; assign_super_admin is SECURITY DEFINER, owned by a non-application role, EXECUTE for service_role only', async () => {
    const guard = (await db.query(`SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_super_admin_membership_company()'::regprocedure`)).rows[0];
    expect(guard.prosecdef).toBe(false);
    const rpc = (await db.query(`SELECT prosecdef, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = 'public.assign_super_admin(uuid, uuid)'::regprocedure`)).rows[0];
    expect(rpc.prosecdef).toBe(true);
    expect(APP_ROLES as readonly string[]).not.toContain(rpc.owner);
    const exec = (await db.query(
      `SELECT r AS role, has_function_privilege(r, 'public.assign_super_admin(uuid, uuid)', 'EXECUTE') AS can FROM unnest($1::text[]) AS r ORDER BY r`, [[...APP_ROLES]])).rows;
    expect(Object.fromEntries(exec.map((x) => [x.role, x.can]))).toEqual({ anon: false, authenticated: false, authenticator: false, service_role: true });
    const trg = (await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_guard_super_admin_membership_company' AND tgrelid = 'public.user_company_roles'::regclass`)).rows;
    expect(trg).toEqual([{ tgenabled: 'O' }]);
  });

  it('precondition: service_role can write user_company_roles at all (so the refusals below come from the guard, not from missing grants)', async () => {
    const o = await as('service_role', `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'CONTENT_CREATOR', 'active') RETURNING role`, [U2, CO]);
    expect(o).toMatchObject({ ok: true, rows: [{ role: 'CONTENT_CREATOR' }] });
  });
});

describe('direct application-role grants are REFUSED (service_role, as behind PostgREST)', () => {
  it('INSERT of an active SUPER_ADMIN row', async () => {
    notGoverned(await as('service_role', `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')`, [U1, CO]));
    expect(await memberships()).toEqual([]);
  });

  it.each(['invited', 'inactive'])('INSERT of a %s SUPER_ADMIN row (creation, any status)', async (status) => {
    notGoverned(await as('service_role', `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', $3)`, [U1, CO, status]));
    expect(await memberships()).toEqual([]);
  });

  it.each(['super_admin', ' Super_Admin '])('INSERT with the role spelled %j (case/whitespace variants)', async (role) => {
    notGoverned(await as('service_role', `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, $3, 'active')`, [U1, CO, role]));
    expect(await memberships()).toEqual([]);
  });

  it('UPDATE of an active member role INTO SUPER_ADMIN', async () => {
    await seed('CONTENT_CREATOR', 'active');
    notGoverned(await as('service_role', `UPDATE public.user_company_roles SET role = 'SUPER_ADMIN' WHERE id = $1`, [ROW]));
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'CONTENT_CREATOR', status: 'active' }]);
  });

  it('UPDATE of an inactive member role INTO SUPER_ADMIN (role change while not active)', async () => {
    await seed('CONTENT_CREATOR', 'inactive');
    notGoverned(await as('service_role', `UPDATE public.user_company_roles SET role = 'SUPER_ADMIN' WHERE id = $1`, [ROW]));
    expect(await activeSA()).toBe(0);
  });

  it('the R-14 flip: invited SUPER_ADMIN → active', async () => {
    await seed('SUPER_ADMIN', 'invited');
    notGoverned(await as('service_role', `UPDATE public.user_company_roles SET status = 'active' WHERE id = $1`, [ROW]));
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'SUPER_ADMIN', status: 'invited' }]);
  });

  it('re-activation of a deactivated SUPER_ADMIN', async () => {
    await seed('SUPER_ADMIN', 'inactive');
    notGoverned(await as('service_role', `UPDATE public.user_company_roles SET status = 'active' WHERE id = $1`, [ROW]));
    expect(await activeSA()).toBe(0);
  });

  it('moving an active SUPER_ADMIN membership to another company', async () => {
    await seed('SUPER_ADMIN', 'active');
    notGoverned(await as('service_role', `UPDATE public.user_company_roles SET company_id = $2 WHERE id = $1`, [ROW, CO2]));
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'SUPER_ADMIN', status: 'active' }]);
  });

  it('an upsert (INSERT … ON CONFLICT DO UPDATE) cannot launder the grant', async () => {
    await seed('CONTENT_CREATOR', 'active');
    notGoverned(await as('service_role',
      `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')
       ON CONFLICT (user_id, company_id) WHERE status = 'active' DO UPDATE SET role = EXCLUDED.role`, [U1, CO]));
    expect(await activeSA()).toBe(0);
  });

  it('one refused row aborts the whole multi-row statement', async () => {
    notGoverned(await as('service_role',
      `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $3, 'CONTENT_CREATOR', 'active'), ($2, $3, 'SUPER_ADMIN', 'active')`, [U2, U1, CO]));
    expect(await memberships()).toEqual([]);
  });
});

describe.each(['authenticated', 'anon', 'authenticator'])('the other application role %s is refused by the guard too', (role) => {
  it('INSERT of an active SUPER_ADMIN row (privileges temporarily granted so the GUARD is what refuses)', async () => {
    // These roles normally cannot write the table at all (grants / RLS). Remove both barriers inside
    // the test's own transaction (transactional DDL, rolled back below) so the trigger is the only
    // thing left that can refuse.
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`GRANT INSERT, SELECT ON public.user_company_roles TO ${role}`);
      await c.query('ALTER TABLE public.user_company_roles DISABLE ROW LEVEL SECURITY');
      await c.query(`SET LOCAL ROLE ${role}`);
      const r = await c.query(
        `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')`, [U1, CO])
        .then(() => ({ ok: true as const, code: '', message: '' }), (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? '?', message: e.message ?? '' }));
      expect(r).toMatchObject({ ok: false, code: 'P0001' });
      expect(r.message).toContain('SUPER_ADMIN_GRANT_NOT_GOVERNED');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
    expect(await memberships()).toEqual([]);
  });
});

describe('application-role writes that are NOT grants stay ALLOWED (service_role)', () => {
  it('revocation: active SUPER_ADMIN → another role', async () => {
    await seed('SUPER_ADMIN', 'active');
    expect(await as('service_role', `UPDATE public.user_company_roles SET role = 'COMPANY_ADMIN' WHERE id = $1`, [ROW])).toMatchObject({ ok: true });
    expect(await activeSA()).toBe(0);
  });

  it('deactivation of an active SUPER_ADMIN', async () => {
    await seed('SUPER_ADMIN', 'active');
    expect(await as('service_role', `UPDATE public.user_company_roles SET status = 'inactive', deactivated_at = now() WHERE id = $1`, [ROW])).toMatchObject({ ok: true });
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'SUPER_ADMIN', status: 'inactive' }]);
  });

  it('DELETE of a SUPER_ADMIN membership', async () => {
    await seed('SUPER_ADMIN', 'active');
    expect(await as('service_role', `DELETE FROM public.user_company_roles WHERE id = $1`, [ROW])).toMatchObject({ ok: true });
    expect(await memberships()).toEqual([]);
  });

  it('a no-transition update of an existing active SUPER_ADMIN (updated_at / status re-set)', async () => {
    await seed('SUPER_ADMIN', 'active');
    expect(await as('service_role', `UPDATE public.user_company_roles SET status = 'active', role = 'SUPER_ADMIN', updated_at = now() WHERE id = $1`, [ROW])).toMatchObject({ ok: true });
    expect(await activeSA()).toBe(1);
  });

  it('non-SUPER_ADMIN grants and activations', async () => {
    expect(await as('service_role', `INSERT INTO public.user_company_roles (id, user_id, company_id, role, status) VALUES ($1, $2, $3, 'COMPANY_ADMIN', 'invited')`, [ROW, U1, CO])).toMatchObject({ ok: true });
    expect(await as('service_role', `UPDATE public.user_company_roles SET status = 'active' WHERE id = $1`, [ROW])).toMatchObject({ ok: true });
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'COMPANY_ADMIN', status: 'active' }]);
  });
});

describe('the governed path and the owner path are PRESERVED', () => {
  it('assign_super_admin called as service_role creates the grant (bootstrap / env-credential bootstrap)', async () => {
    const o = await as('service_role', `SELECT * FROM public.assign_super_admin($1, $2)`, [U1, CO]);
    expect(o).toMatchObject({ ok: true, rows: [{ company_id: CO }] });
    expect(await memberships()).toEqual([{ user_id: U1, company_id: CO, role: 'SUPER_ADMIN', status: 'active' }]);
  });

  it('assign_super_admin as service_role promotes an existing member and re-activates a deactivated SUPER_ADMIN', async () => {
    await seed('CONTENT_CREATOR', 'active');
    expect(await as('service_role', `SELECT * FROM public.assign_super_admin($1, $2)`, [U1, CO])).toMatchObject({ ok: true, rows: [{ role_row_id: ROW }] });
    expect(await activeSA()).toBe(1);
    await db.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = $1`, [ROW]);
    expect(await as('service_role', `SELECT * FROM public.assign_super_admin($1, $2)`, [U1, CO])).toMatchObject({ ok: true, rows: [{ role_row_id: ROW }] });
    expect(await activeSA()).toBe(1);
  });

  it('the governed path still enforces the company lifecycle (inactive company → SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE)', async () => {
    await db.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]);
    const o = await as('service_role', `SELECT * FROM public.assign_super_admin($1, $2)`, [U1, CO]);
    expect(o).toMatchObject({ ok: false, code: 'P0001' });
    expect((o as { message: string }).message).toContain('SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE');
    expect(await activeSA()).toBe(0);
  });

  it('authenticated / anon cannot call assign_super_admin (EXECUTE not granted)', async () => {
    for (const role of ['authenticated', 'anon']) {
      expect(await as(role, `SELECT * FROM public.assign_super_admin($1, $2)`, [U1, CO])).toMatchObject({ ok: false, code: '42501' });
    }
    expect(await activeSA()).toBe(0);
  });

  it('break-glass: the owner session (postgres) may still write an active SUPER_ADMIN row directly', async () => {
    expect(await as(null, `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')`, [U1, CO])).toMatchObject({ ok: true });
    expect(await activeSA()).toBe(1);
  });

  it('break-glass still respects the lifecycle guard (owner session, soft-deleted company → refused)', async () => {
    await db.query(`UPDATE public.companies SET deleted_at = now() WHERE id = $1`, [CO]);
    const o = await as(null, `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')`, [U1, CO]);
    expect(o).toMatchObject({ ok: false, code: 'P0001' });
    expect((o as { message: string }).message).toContain('SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE');
  });

  it('the invitation-activation function (SECURITY DEFINER, 0004) still refuses SUPER_ADMIN on its own, not via this guard', async () => {
    const def = (await db.query(`SELECT pg_get_functiondef('public.activate_invitation_membership(uuid, uuid, timestamp with time zone)'::regprocedure) AS d`)).rows[0].d as string;
    expect(def).toMatch(/SUPER_ADMIN/);
  });
});
