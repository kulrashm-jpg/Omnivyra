/**
 * Real-schema cover for M1 (20270217000013 bootstrap_first_super_admin) and M2 (20270217000052 revoke_super_admin):
 * the guarantees ARE Postgres's - one transaction under a shared advisory lock - so they are proven here on REAL rows
 * from SEPARATE connections, not in a fake.
 *
 *   M2: revoking one of two active super-admins succeeds; the last one is refused LAST_SUPER_ADMIN (self-revoke too);
 *       a soft-deleted user does not count as "another" super-admin; TWO CONCURRENT revokes of the last two -> exactly one.
 *   M1: with one active super-admin, bootstrap is refused BOOTSTRAP_ALREADY_CONSUMED; with none, TWO CONCURRENT
 *       bootstraps (different users) -> exactly one; and the shared key serialises bootstrap against revoke.
 *
 * The realschema project runs --runInBand, so this suite may briefly own the platform's super-admin set: it snapshots
 * every pre-existing ACTIVE SUPER_ADMIN membership, deactivates them for the zero-admin cases, and restores them.
 * CONDITION THIS RESTS ON (05): the target is a DISPOSABLE replay container owned by one CI job. A killed process skips
 * afterAll and leaves zero active super-admins behind; never point this suite at a persistent or shared database -
 * there the restore would have to be a transaction rollback or a dedicated fixture org instead.
 */
import { Client } from 'pg';
import { db } from './setup';

const URL = process.env.W6_DB_URL as string;
const CO = '00000000-0000-4000-8000-00000000a120';
const U = ['00000000-0000-4000-8000-000000a12001', '00000000-0000-4000-8000-000000a12002', '00000000-0000-4000-8000-000000a12003'];

async function attemptOn(c: Client, sql: string, params: unknown[]): Promise<'ok' | string> {
  try { await c.query(sql, params); return 'ok'; } catch (e: any) { return String(e.message ?? e.code); }
}
const activeSa = async (uid: string) => Number((await db.query(
  `SELECT count(*) n FROM public.user_company_roles WHERE user_id = $1 AND upper(btrim(role)) = 'SUPER_ADMIN' AND status = 'active'`, [uid])).rows[0].n);

/** e9: the zero-SA window is only allowed on the disposable CI database - decided on the CLIENT-side URL host
 *  (inet_server_addr is not loopback in CI), and serialised against any other job on the same database. */
const ZERO_SA_WINDOW_LOCK = 7302118099;
function assertDisposableTarget(): void {
  let host = '';
  try { host = new globalThis.URL(URL).hostname.replace(/^\[|\]$/g, ''); } catch { host = ''; }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`super_admin_guards_m1_m2 REFUSES to run: W6_DB_URL host '${host || '?'}' is not loopback. This suite briefly leaves the database with ZERO active super-admins and may only target the disposable CI replay container.`);
  }
}

describe('M1 / M2 super-admin guards (real Postgres, separate connections)', () => {
  const extra: Client[] = [];
  let preexisting: string[] = [];
  let windowLock: Client | null = null;

  beforeAll(async () => {
    assertDisposableTarget();
    windowLock = new Client({ connectionString: URL });
    await windowLock.connect();
    const got = (await windowLock.query('SELECT pg_try_advisory_lock($1) AS ok', [ZERO_SA_WINDOW_LOCK])).rows[0].ok;
    if (!got) throw new Error('super_admin_guards_m1_m2 REFUSES to run: another session holds the zero-super-admin window lock on this database');
    preexisting = (await db.query(
      `SELECT id FROM public.user_company_roles WHERE upper(btrim(role)) = 'SUPER_ADMIN' AND status = 'active'`)).rows.map((r) => r.id);
    await db.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = ANY($1::uuid[])`, [preexisting]);
    await db.query(`INSERT INTO public.companies (id, name, status) VALUES ($1, 'M1M2 co', 'active') ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL`, [CO]);
    for (const [i, id] of U.entries()) {
      await db.query(`INSERT INTO public.users (id, email, role, is_deleted) VALUES ($1, $2, 'COMPANY_ADMIN', false)
                      ON CONFLICT (id) DO UPDATE SET is_deleted = false`, [id, `m1m2-${i}@example.test`]);
    }
    for (let i = 0; i < 2; i++) { const c = new Client({ connectionString: URL }); await c.connect(); extra.push(c); }
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM public.user_company_roles WHERE user_id = ANY($1::uuid[])`, [U]);
    await db.query(`UPDATE public.users SET is_deleted = false, role = 'COMPANY_ADMIN', status = 'active' WHERE id = ANY($1::uuid[])`, [U]);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM public.user_company_roles WHERE user_id = ANY($1::uuid[])`, [U]);
    await db.query(`UPDATE public.user_company_roles SET status = 'active' WHERE id = ANY($1::uuid[])`, [preexisting]);
    await Promise.all(extra.map((c) => c.end()));
    if (windowLock) { await windowLock.query('SELECT pg_advisory_unlock($1)', [ZERO_SA_WINDOW_LOCK]); await windowLock.end(); }
  });

  const grant = (uid: string) => db.query('SELECT * FROM public.assign_super_admin($1, $2)', [uid, CO]);
  const REVOKE = 'SELECT public.revoke_super_admin($1)';
  const BOOTSTRAP = 'SELECT * FROM public.bootstrap_first_super_admin($1, $2)';

  it('M2: one of two is revoked; the LAST is refused LAST_SUPER_ADMIN (self-revoke included)', async () => {
    await grant(U[0]); await grant(U[1]);
    expect(await attemptOn(extra[0], REVOKE, [U[1]])).toBe('ok');
    expect(await activeSa(U[1])).toBe(0);
    expect(await attemptOn(extra[0], REVOKE, [U[0]])).toMatch(/LAST_SUPER_ADMIN/);
    expect(await activeSa(U[0])).toBe(1);
  });

  it('M2: a soft-deleted super-admin does not count as "another" one', async () => {
    await grant(U[0]); await grant(U[1]);
    await db.query('UPDATE public.users SET is_deleted = true WHERE id = $1', [U[1]]);
    expect(await attemptOn(extra[0], REVOKE, [U[0]])).toMatch(/LAST_SUPER_ADMIN/);
  });

  it('M2 (05): a SUSPENDED super-admin cannot authenticate, so does not count - revoking the other is refused', async () => {
    await grant(U[0]); await grant(U[1]);
    await db.query(`UPDATE public.users SET status = 'suspended' WHERE id = $1`, [U[1]]);
    try {
      expect(await attemptOn(extra[0], REVOKE, [U[0]])).toMatch(/LAST_SUPER_ADMIN/);
      expect(await activeSa(U[0])).toBe(1);
    } finally {
      await db.query(`UPDATE public.users SET status = 'active' WHERE id = $1`, [U[1]]);
    }
  });

  it('M2: EVERY non-active users.status does not count (allowlist on active, not a suspended denylist)', async () => {
    // CI-487: users.status carries users_status_check (20260638: invited/active/suspended/deleted), so an unknown future
    // value is unrepresentable while the CHECK exists. The allowlist is proven over every non-active value the LIVE CHECK
    // admits ('invited' and 'deleted' would both count under a status<>'suspended' denylist); an unknown value is added
    // only when no CHECK exists.
    const { rows: chk } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%'`);
    const allowed = chk.length === 0 ? null
      : [...new Set(chk.flatMap((r: { def: string }) => [...r.def.matchAll(/'([^']+)'/g)].map((m) => m[1])))];
    const probes = (allowed ?? ['invited', 'suspended', 'deleted', 'some_future_status']).filter((s) => s !== 'active');
    expect(probes.length).toBeGreaterThanOrEqual(2);   // non-vacuity: at least two non-active states exercised
    if (allowed) expect(allowed).toContain('active');  // the parse found the real value list
    for (const status of probes) {
      await grant(U[0]); await grant(U[1]);
      await db.query(`UPDATE public.users SET status = $2 WHERE id = $1`, [U[1], status]);
      try {
        expect(`${status}:${await attemptOn(extra[0], REVOKE, [U[0]])}`).toMatch(new RegExp(`^${status}:.*LAST_SUPER_ADMIN`));
        expect(await activeSa(U[0])).toBe(1);
      } finally {
        await db.query(`UPDATE public.users SET status = 'active' WHERE id = $1`, [U[1]]);
      }
    }
  });

  it('M2: TWO CONCURRENT revokes of the last two super-admins -> exactly one succeeds', async () => {
    await grant(U[0]); await grant(U[1]);
    const results = await Promise.all([attemptOn(extra[0], REVOKE, [U[0]]), attemptOn(extra[1], REVOKE, [U[1]])]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => /LAST_SUPER_ADMIN/.test(r))).toHaveLength(1);
    expect((await activeSa(U[0])) + (await activeSa(U[1]))).toBe(1);
  });

  it('M2: both downgrades are one transaction - users.role and the membership move together', async () => {
    await grant(U[0]); await grant(U[1]);
    await db.query(`UPDATE public.users SET role = 'SUPER_ADMIN' WHERE id = $1`, [U[1]]);
    expect(await attemptOn(extra[0], REVOKE, [U[1]])).toBe('ok');
    const { rows } = await db.query('SELECT role FROM public.users WHERE id = $1', [U[1]]);
    expect(rows[0].role).toBe('COMPANY_ADMIN');
    expect(await activeSa(U[1])).toBe(0);
  });

  // R-10's successor (05's condition): partial failure CANNOT occur - a fault injected at EACH write step of the revoke
  // leaves NO change at all (not merely "the happy path is atomic"). A BEFORE trigger raises on exactly one step's write
  // for the target user; the whole function call must roll back.
  async function revokeWithFaultAt(table: 'users' | 'user_company_roles'): Promise<string> {
    await db.query('BEGIN');
    try {
      // CI-487: plpgsql does not short-circuit a field reference, so NEW.user_id on users raised "record new has no
      // field user_id" instead of the fault. The key column is chosen per table here, not inside the trigger.
      const keyCol = table === 'users' ? 'id' : 'user_id';
      await db.query(`CREATE FUNCTION pg_temp.m2_fault() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN IF NEW.${keyCol} = '${U[1]}'::uuid
              THEN RAISE EXCEPTION 'M2_INJECTED_FAULT at %', TG_TABLE_NAME; END IF; RETURN NEW; END $f$`);
      await db.query(`CREATE TRIGGER m2_fault BEFORE UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.m2_fault()`);
      await db.query('SAVEPOINT rv');
      let outcome = 'ok';
      try { await db.query(REVOKE, [U[1]]); } catch (e: any) { outcome = String(e.message); await db.query('ROLLBACK TO SAVEPOINT rv'); }
      const role = (await db.query('SELECT role FROM public.users WHERE id = $1', [U[1]])).rows[0].role;
      const active = await activeSa(U[1]);
      return `${outcome}|role=${role}|activeSa=${active}`;
    } finally {
      await db.query('ROLLBACK');
    }
  }

  it.each(['users', 'user_company_roles'] as const)(
    'R-10 successor: a fault injected at the %s downgrade step leaves NOTHING downgraded (no partial state)', async (table) => {
      await grant(U[0]); await grant(U[1]);
      await db.query(`UPDATE public.users SET role = 'SUPER_ADMIN' WHERE id = $1`, [U[1]]);
      const r = await revokeWithFaultAt(table);
      expect(r).toMatch(/^M2_INJECTED_FAULT at /);
      expect(r).toMatch(/\|role=SUPER_ADMIN\|activeSa=1$/);   // users.role AND the membership both untouched
    });

  it('M1: with an active super-admin, bootstrap is refused BOOTSTRAP_ALREADY_CONSUMED', async () => {
    await grant(U[0]);
    expect(await attemptOn(extra[0], BOOTSTRAP, [U[1], CO])).toMatch(/BOOTSTRAP_ALREADY_CONSUMED/);
    expect(await activeSa(U[1])).toBe(0);
  });

  it('M1: with NONE, TWO CONCURRENT bootstraps (different users) -> exactly one becomes super-admin', async () => {
    const results = await Promise.all([attemptOn(extra[0], BOOTSTRAP, [U[0], CO]), attemptOn(extra[1], BOOTSTRAP, [U[1], CO])]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => /BOOTSTRAP_ALREADY_CONSUMED/.test(r))).toHaveLength(1);
    expect((await activeSa(U[0])) + (await activeSa(U[1]))).toBe(1);
  });

  it('the shared key serialises bootstrap against revoke: a revoke holding the lock blocks a bootstrap until it commits', async () => {
    await grant(U[0]); await grant(U[1]);
    await extra[0].query('BEGIN');
    await extra[0].query(REVOKE, [U[1]]);                       // holds the advisory lock, uncommitted
    const bootstrap = attemptOn(extra[1], BOOTSTRAP, [U[2], CO]);   // must wait on the same key
    const raced = await Promise.race([bootstrap.then(() => 'finished'), new Promise((r) => setTimeout(() => r('blocked'), 400))]);
    expect(raced).toBe('blocked');
    await extra[0].query('COMMIT');
    expect(await bootstrap).toMatch(/BOOTSTRAP_ALREADY_CONSUMED/);  // U[0] is still an active super-admin
  });

  it('client roles cannot execute any of the three functions', async () => {
    const { rows } = await db.query(
      `SELECT r, f, has_function_privilege(r, f, 'EXECUTE') AS can FROM unnest(ARRAY['anon','authenticated']) r,
              unnest(ARRAY['public.revoke_super_admin(uuid)','public.bootstrap_first_super_admin(uuid, uuid)','public.super_admin_membership_lock_key()']) f`);
    expect(rows.filter((x) => x.can)).toEqual([]);
  });
});
