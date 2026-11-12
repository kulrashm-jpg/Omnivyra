/**
 * 20270217000012_user_company_roles_last_admin_guard - COMMITTED real-schema evidence
 * (05 / e9 rule, 2026-11-12: sandbox-only evidence does not close a unit).
 *
 * The CI replay installs the guard (every migration newer than the baseline). Each
 * scenario runs in ONE transaction that is ROLLED BACK; because the check is a
 * DEFERRED constraint trigger, every scenario issues SET CONSTRAINTS ALL IMMEDIATE
 * before the rollback - that runs the same commit-time check against the same
 * transaction state, then discards everything.
 *
 * Also here: the LIVE prod bodies of disable_company_cascade / soft_delete_company /
 * hard_delete_company (83's C26, stored LF under fixtures/c26-lifecycle-bodies; the
 * CRLF form is rebuilt and its md5 asserted equal to prod BEFORE use) run UNDER the
 * guard - the real production code against the new constraint. The two-session
 * race (committing) is in *_concurrency_real.test.ts.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from './setup';

const CO = '00000000-0000-4000-8000-0000000012c0';
const A1 = '00000000-0000-4000-8000-0000000012a1';
const A2 = '00000000-0000-4000-8000-0000000012a2';
const M1 = '00000000-0000-4000-8000-0000000012b1';
const ACTOR = '00000000-0000-4000-8000-0000000012f0';
const USERS: Array<[string, string]> = [[A1, 'lag-a1@example.test'], [A2, 'lag-a2@example.test'], [M1, 'lag-m1@example.test'], [ACTOR, 'lag-actor@example.test']];

type Outcome = { ok: true } | { ok: false; code: string; message: string };

/** The company with admins A1 (+ A2 when two) and member M1 - inserted INSIDE the scenario transaction. */
const world = (twoAdmins: boolean, company = CO): Array<[string, unknown[]]> => [
  // users are created INSIDE the rolled-back transaction: this pass-1 suite commits nothing (05).
  ...USERS.map(([id, email]) => [`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'lag') ON CONFLICT (id) DO NOTHING`, [id, email]] as [string, unknown[]]),
  [`INSERT INTO public.companies (id, name) VALUES ($1, 'last-admin guard')`, [company]],
  [`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'COMPANY_ADMIN', 'active')`, [A1, company]],
  ...(twoAdmins ? [[`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'COMPANY_ADMIN', 'active')`, [A2, company]] as [string, unknown[]]] : []),
  [`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'VIEW_ONLY', 'active')`, [M1, company]],
];

/** Run statements in one transaction, force the deferred check, ROLL BACK. */
async function scenario(stmts: Array<[string, unknown[]]>): Promise<Outcome> {
  await db.query('BEGIN');
  try {
    for (const [sql, params] of stmts) await db.query(sql, params);
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, code: e.code ?? '?', message: e.message ?? '' };
  } finally {
    await db.query('ROLLBACK');
  }
}
const refusedByGuard = (o: Outcome) => o.ok === false && /LAST_COMPANY_ADMIN/.test(o.message);
const demote = (u: string): [string, unknown[]] => [`UPDATE public.user_company_roles SET role = 'VIEW_ONLY' WHERE user_id = $1 AND company_id = $2`, [u, CO]];

beforeAll(async () => {
  const fn = (await db.query(`SELECT to_regprocedure('public.company_admin_last_active_check()') AS f`)).rows[0].f;
  if (!fn) throw new Error('20270217000012 is NOT installed in this database - the replay did not apply it; refusing to pass vacuously');
  const deferred = (await db.query(`SELECT tgdeferrable AND tginitdeferred AS d FROM pg_trigger WHERE tgname = 'trg_company_admin_last_active_check'`)).rows[0]?.d;
  if (deferred !== true) throw new Error('trg_company_admin_last_active_check is not DEFERRABLE INITIALLY DEFERRED');
});

describe('the invariant: the LAST active COMPANY_ADMIN of an active company cannot be removed', () => {
  it('control: demoting one of TWO admins succeeds', async () => {
    expect(await scenario([...world(true), demote(A1)])).toEqual({ ok: true });
  });
  it.each([
    ['demote', `UPDATE public.user_company_roles SET role = 'VIEW_ONLY' WHERE user_id = $1 AND company_id = $2`],
    ['deactivate', `UPDATE public.user_company_roles SET status = 'inactive' WHERE user_id = $1 AND company_id = $2`],
    ['delete', `DELETE FROM public.user_company_roles WHERE user_id = $1 AND company_id = $2`],
  ])('%s the LAST admin -> refused LAST_COMPANY_ADMIN', async (_n, sql) => {
    expect(refusedByGuard(await scenario([...world(false), [sql, [A1, CO]]]))).toBe(true);
  });
  it('ONE statement demoting BOTH admins -> refused', async () => {
    const o = await scenario([...world(true), [`UPDATE public.user_company_roles SET role = 'VIEW_ONLY' WHERE company_id = $1 AND role = 'COMPANY_ADMIN'`, [CO]]]);
    expect(refusedByGuard(o)).toBe(true);
  });
  it('two statements in one transaction demoting both -> refused', async () => {
    expect(refusedByGuard(await scenario([...world(true), demote(A1), demote(A2)]))).toBe(true);
  });
  it('DEFERRAL PINNED (05): ownership transfer in ONE transaction - demote the sole admin FIRST, then promote another -> succeeds', async () => {
    // Under DEFERRED the commit-time end state has a live admin. A NOT DEFERRABLE check would
    // fire at the end of the FIRST statement (zero admins) and refuse - so this case kills
    // that mutant. (Promote-then-demote passes either way, so the order is the point.)
    const o = await scenario([...world(false), demote(A1),
      [`UPDATE public.user_company_roles SET role = 'COMPANY_ADMIN' WHERE user_id = $1 AND company_id = $2`, [M1, CO]]]);
    expect(o).toEqual({ ok: true });
  });

  it('a no-op touch of the last admin (status active -> active) succeeds', async () => {
    expect(await scenario([...world(false), [`UPDATE public.user_company_roles SET status = 'active' WHERE user_id = $1 AND company_id = $2`, [A1, CO]]])).toEqual({ ok: true });
  });
  it('a non-admin change in a one-admin company succeeds', async () => {
    expect(await scenario([...world(false), [`UPDATE public.user_company_roles SET role = 'CONTENT_CREATOR' WHERE user_id = $1 AND company_id = $2`, [M1, CO]]])).toEqual({ ok: true });
  });
  it('05: a remaining admin whose USER is deleted does NOT count -> demoting the other is refused', async () => {
    const o = await scenario([...world(true), [`UPDATE public.users SET is_deleted = true, deleted_at = now() WHERE id = $1`, [A2]], demote(A1)]);
    expect(refusedByGuard(o)).toBe(true);
  });
  it('an ADMINLESS company: removing a non-admin is untouched', async () => {
    const o = await scenario([
      ...USERS.map(([id, email]) => [`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'lag') ON CONFLICT (id) DO NOTHING`, [id, email]] as [string, unknown[]]),
      [`INSERT INTO public.companies (id, name) VALUES ($1, 'adminless')`, [CO]],
      [`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'VIEW_ONLY', 'active')`, [M1, CO]],
      [`DELETE FROM public.user_company_roles WHERE user_id = $1 AND company_id = $2`, [M1, CO]],
    ]);
    expect(o).toEqual({ ok: true });
  });
});

describe('legitimate flows are exempt by POST-STATE (no flag)', () => {
  it('company disabled (status first), then memberships deactivated -> succeeds', async () => {
    expect(await scenario([...world(false), [`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]],
      [`UPDATE public.user_company_roles SET status = 'inactive' WHERE company_id = $1`, [CO]]])).toEqual({ ok: true });
  });
  it('company soft-deleted (deleted_at), then memberships deactivated -> succeeds', async () => {
    expect(await scenario([...world(false), [`UPDATE public.companies SET deleted_at = now() WHERE id = $1`, [CO]],
      [`UPDATE public.user_company_roles SET status = 'inactive' WHERE company_id = $1`, [CO]]])).toEqual({ ok: true });
  });
  it('the hard-delete FALLBACK shape (memberships deleted, active company kept) -> refused', async () => {
    expect(refusedByGuard(await scenario([...world(false), [`DELETE FROM public.user_company_roles WHERE company_id = $1`, [CO]]]))).toBe(true);
  });
  it('Route 2 REAL order on a SOLE admin: users soft-delete (Step C) THEN memberships inactive (Step D) -> succeeds', async () => {
    expect(await scenario([...world(false), [`UPDATE public.users SET is_deleted = true, deleted_at = now() WHERE id = $1`, [A1]],
      [`UPDATE public.user_company_roles SET status = 'inactive' WHERE user_id = $1 AND role <> 'SUPER_ADMIN'`, [A1]]])).toEqual({ ok: true });
  });
  it('Route 2 REVERSED on a SOLE admin: Step D before Step C -> refused (the hazard the ordering pin guards)', async () => {
    expect(refusedByGuard(await scenario([...world(false),
      [`UPDATE public.user_company_roles SET status = 'inactive' WHERE user_id = $1 AND role <> 'SUPER_ADMIN'`, [A1]]]))).toBe(true);
  });
});

describe('the LIVE prod lifecycle bodies (83 C26, md5-verified) run UNDER the guard', () => {
  const FIX = path.resolve(__dirname, 'fixtures/c26-lifecycle-bodies');
  const LIVE: Record<string, { md5: string; crlf: boolean; ret: string }> = {
    disable_company_cascade: { md5: 'c9ca35837953cc180fd35b39e3419b9d', crlf: true, ret: 'TABLE(affected_users integer, revoked_roles integer, revoked_sessions integer)' },
    soft_delete_company: { md5: 'ec31c97c849bc28112784b19f20abff8', crlf: false, ret: 'TABLE(affected_users integer, revoked_roles integer, revoked_sessions integer)' },
    hard_delete_company: { md5: '632ddc62639822a7bfe5a4c85d114f0e', crlf: true, ret: 'TABLE(deleted_memberships integer, deleted_profiles integer)' },
  };
  const body = (name: string) => {
    const lf = fs.readFileSync(path.join(FIX, `${name}.prod-prosrc.lf.sql`), 'utf8');
    return LIVE[name].crlf ? lf.replace(/\n/g, '\r\n') : lf;
  };
  const install: Array<[string, unknown[]]> = Object.keys(LIVE).map((name) => [
    `CREATE OR REPLACE FUNCTION public.${name}(p_company_id uuid, p_actor uuid, p_reason text) RETURNS ${LIVE[name].ret} LANGUAGE plpgsql SECURITY DEFINER AS $livebody$${body(name)}$livebody$`, [],
  ]);

  it('the fixtures rebuild to the EXACT prod md5 (otherwise this block would test different code)', () => {
    for (const name of Object.keys(LIVE)) {
      expect({ name, md5: crypto.createHash('md5').update(body(name), 'utf8').digest('hex') }).toEqual({ name, md5: LIVE[name].md5 });
    }
  });

  it.each(['disable_company_cascade', 'soft_delete_company', 'hard_delete_company'])('LIVE %s on a ONE-admin company succeeds under the guard', async (name) => {
    const o = await scenario([...install, ...world(false),
      [`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = to_regprocedure($1)`, [`public.${name}(uuid,uuid,text)`]],
      [`SELECT * FROM public.${name}($1, $2, 'last-admin guard test')`, [CO, ACTOR]]]);
    expect(o).toEqual({ ok: true });
  });

  it('control: under the same LIVE bodies, a plain demotion of that last admin is refused', async () => {
    expect(refusedByGuard(await scenario([...install, ...world(false), demote(A1)]))).toBe(true);
  });
});

// The COMMITTING race (05: the lock is load-bearing) lives in
// user_company_roles_last_admin_guard_concurrency_real.test.ts - 83's harness rule:
// committing cases run only in the *_concurrency_real second pass.

// No afterAll: this pass-1 suite commits nothing (every row lives in a rolled-back transaction).
