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

describe('M1 / M2 super-admin guards (real Postgres, separate connections)', () => {
  const extra: Client[] = [];
  let preexisting: string[] = [];

  beforeAll(async () => {
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
    await db.query(`UPDATE public.users SET is_deleted = false, role = 'COMPANY_ADMIN' WHERE id = ANY($1::uuid[])`, [U]);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM public.user_company_roles WHERE user_id = ANY($1::uuid[])`, [U]);
    await db.query(`UPDATE public.user_company_roles SET status = 'active' WHERE id = ANY($1::uuid[])`, [preexisting]);
    await Promise.all(extra.map((c) => c.end()));
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
