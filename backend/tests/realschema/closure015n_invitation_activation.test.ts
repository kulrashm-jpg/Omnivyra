/**
 * Closure-015N — R-16: public.activate_invitation_membership (caller: pages/api/auth/set-password.ts).
 * REAL POSTGRES ONLY, on a disposable database (setup.ts refuses managed hosts).
 *
 *   npm run test:realschema -- closure015n            (fixed function: proposal 04 applied)
 *   C15N_SKIP_FIX=1 … -- closure015n                 (NEGATIVE CONTROL: the baseline body stays)
 *
 * beforeAll first RECORDS the two original defects against the function as currently installed
 * (42702 ambiguous company_id; and, with the ambiguity removed, 42P10 — no unique constraint matches
 * ON CONFLICT (user_id, company_id)), then applies supabase/proposals/closure015n/04_… unless
 * C15N_SKIP_FIX=1. Concurrency cases use two real sessions; outcomes are asserted on SQLSTATE /
 * message after the holder commits (no sleep decides an outcome).
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const SKIP_FIX = process.env.C15N_SKIP_FIX === '1';
/** C15N_NO_APPLY=1: test whatever body is INSTALLED (used by the SQL mutation runner); never re-applies 04. */
const NO_APPLY = process.env.C15N_NO_APPLY === '1';
const FIX = path.resolve(__dirname, '../../../supabase/proposals/closure015n/04_activate_invitation_membership.sql');

const CO = '00000000-0000-4000-8000-0000000016a1';
const U = '00000000-0000-4000-8000-0000000016b1';
const U_OTHER = '00000000-0000-4000-8000-0000000016b2';
const EMAIL = 'c15n-invitee@example.test';
const INV = '00000000-0000-4000-8000-0000000016c1';
const INV2 = '00000000-0000-4000-8000-0000000016c2';

type Outcome = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string };
const settle = (p: Promise<{ rows: Record<string, unknown>[] }>): Promise<Outcome> =>
  p.then((r) => ({ ok: true as const, rows: r.rows }), (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? '?', message: e.message ?? '' }));
const activate = (inv = INV, user = U) => `SELECT * FROM public.activate_invitation_membership('${inv}', '${user}')`;
const fail = (o: Outcome, msg: string) => {
  expect(o.ok).toBe(false);
  expect((o as { message: string }).message).toContain(msg);
};

const baselineDefects: Record<string, Outcome> = {};

async function world() {
  await db.query('DELETE FROM public.invitations WHERE company_id = $1', [CO]);
  await db.query('DELETE FROM public.user_company_roles WHERE company_id = $1', [CO]);
  await db.query('UPDATE public.users SET active_company_id = NULL WHERE id = ANY($1::uuid[])', [[U, U_OTHER]]);
  await db.query('DELETE FROM public.companies WHERE id = $1', [CO]);
  await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'C15N invite co')`, [CO]);
}
async function invite(id = INV, over: Record<string, string> = {}) {
  const v = { role: 'CONTENT_CREATOR', email: EMAIL, expires: "now() + interval '1 day'", consumed: 'now()', ...over };
  await db.query(
    `INSERT INTO public.invitations (id, email, company_id, role, token_hash, expires_at, token_consumed_at)
     VALUES ($1, $2, $3, $4, $5, ${v.expires}, ${v.consumed})`, [id, v.email, CO, v.role, `c15n-${id}`]);
}
const memberships = async () => (await db.query(
  'SELECT id, role, status, updated_at FROM public.user_company_roles WHERE company_id = $1 AND user_id = $2 ORDER BY created_at', [CO, U])).rows;
const invitation = async (id = INV) => (await db.query('SELECT accepted_at, accepted_by, revoked_at FROM public.invitations WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  for (const [id, email] of [[U, EMAIL], [U_OTHER, 'c15n-other@example.test']]) {
    await db.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'c15n') ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
  // ── Record the ORIGINAL defects against the function as installed now ──
  await world();
  await invite();
  baselineDefects.installed = await settle(db.query(activate()));
  // The same body with the variable conflict resolved — exposes the missing uniqueness (42P10).
  const base = fs.readFileSync(path.resolve(__dirname, '../../../supabase/_schema/baseline.sql'), 'utf8');
  const start = base.indexOf('CREATE FUNCTION public.activate_invitation_membership(');
  const end = base.indexOf('$$;', base.indexOf('AS $$', start)) + 3;
  const variant = base.slice(start, end)
    .replace('CREATE FUNCTION public.activate_invitation_membership(', 'CREATE OR REPLACE FUNCTION pg_temp.c15n_baseline_variant(')
    // function replacer: a '$$' in a replacement STRING would collapse to '$'
    .replace('AS $$\n', () => 'AS $$\n#variable_conflict use_column\n');
  await db.query(variant);
  baselineDefects.variant = await settle(db.query(`SELECT * FROM pg_temp.c15n_baseline_variant('${INV}', '${U}')`));
  if (!SKIP_FIX && !NO_APPLY) await db.query(fs.readFileSync(FIX, 'utf8'));
});
beforeEach(world);

describe('R-16 — the original defects (recorded before the fix was applied)', () => {
  it('the installed baseline function fails 42702 (ambiguous company_id) — or, once fixed, it succeeds', () => {
    if (SKIP_FIX || (baselineDefects.installed as { code?: string }).code === '42702') {
      expect(baselineDefects.installed).toMatchObject({ ok: false, code: '42702' });
      expect((baselineDefects.installed as { message: string }).message).toMatch(/column reference "company_id" is ambiguous/);
    } else {
      // The suite was re-run on a database where the fix is already installed.
      expect(baselineDefects.installed.ok).toBe(true);
    }
  });

  it('with the ambiguity resolved, the baseline upsert fails 42P10: no unique constraint matches ON CONFLICT (user_id, company_id)', () => {
    expect(baselineDefects.variant).toMatchObject({ ok: false, code: '42P10' });
  });

  it('the schema invariant is the PARTIAL unique index (one ACTIVE membership per user+company), not a full uniqueness', async () => {
    const { rows } = await db.query(`SELECT pg_get_indexdef(indexrelid) AS d FROM pg_index WHERE indrelid = 'public.user_company_roles'::regclass AND indisunique`);
    const defs = rows.map((r: { d: string }) => r.d);
    expect(defs.some((d: string) => /\(user_id, company_id\) WHERE \(status = 'active'::text\)/.test(d))).toBe(true);
    expect(defs.some((d: string) => /\(user_id, company_id\)$/.test(d))).toBe(false);
  });
});

describe('R-16 — fixed activation (regression)', () => {
  it('first valid acceptance: returns (invitation, company, role); one ACTIVE row with the invitation role; invitation consumed', async () => {
    await invite();
    const o = await settle(db.query(activate()));
    expect(o).toMatchObject({ ok: true, rows: [{ invitation_id: INV, company_id: CO, role: 'CONTENT_CREATOR' }] });
    expect(await memberships()).toEqual([expect.objectContaining({ role: 'CONTENT_CREATOR', status: 'active' })]);
    expect(await invitation()).toMatchObject({ accepted_by: U });
  });

  it.each(['invited', 'inactive', 'expired'])('an existing %s row is activated IN PLACE (no second row)', async (status) => {
    await db.query(`INSERT INTO public.user_company_roles (id, user_id, company_id, role, status) VALUES ('00000000-0000-4000-8000-0000000016d1', $1, $2, 'VIEW_ONLY', $3)`, [U, CO, status]);
    await invite();
    expect((await settle(db.query(activate()))).ok).toBe(true);
    expect(await memberships()).toEqual([expect.objectContaining({ id: '00000000-0000-4000-8000-0000000016d1', role: 'CONTENT_CREATOR', status: 'active' })]);
  });

  it('REPLAY by the same user is idempotent (same result, no write); by another user it is refused', async () => {
    await invite();
    await db.query(activate());
    const before = await memberships();
    const again = await settle(db.query(activate()));
    expect(again).toMatchObject({ ok: true, rows: [{ invitation_id: INV, company_id: CO }] });
    expect(await memberships()).toEqual(before);
    fail(await settle(db.query(activate(INV, U_OTHER))), 'INVITATION_ALREADY_ACCEPTED');
  });

  it.each<[string, Record<string, string>, string]>([
    ['expired', { expires: "now() - interval '1 minute'" }, 'INVITATION_EXPIRED'],
    ['not consumed (no token use)', { consumed: 'NULL' }, 'INVITATION_NOT_CONSUMED'],
  ])('%s invitation → %s; nothing written', async (_d, over, msg) => {
    await invite(INV, over);
    fail(await settle(db.query(activate())), msg);
    expect(await memberships()).toEqual([]);
    expect(await invitation()).toMatchObject({ accepted_at: null });
  });

  it('revoked / unknown invitation → refused; nothing written', async () => {
    await invite();
    await db.query('UPDATE public.invitations SET revoked_at = now() WHERE id = $1', [INV]);
    fail(await settle(db.query(activate())), 'INVITATION_REVOKED');
    fail(await settle(db.query(activate('00000000-0000-4000-8000-0000000016ff'))), 'INVITATION_NOT_FOUND');
    expect(await memberships()).toEqual([]);
  });

  it('a user who is NOT the invitee cannot accept it (tenant/identity binding)', async () => {
    await invite();
    fail(await settle(db.query(activate(INV, U_OTHER))), 'INVITATION_USER_MISMATCH');
    expect((await db.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO])).rows[0].n).toBe(0);
  });

  it('a disallowed role (only possible if invitations_role_check is missing) → INVITATION_ROLE_NOT_ALLOWED; never SUPER_ADMIN', async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE public.invitations DROP CONSTRAINT invitations_role_check');
      await c.query(`INSERT INTO public.invitations (id, email, company_id, role, token_hash, expires_at, token_consumed_at) VALUES ($1, $2, $3, 'SUPER_ADMIN', 'c15n-sa', now() + interval '1 day', now())`, [INV, EMAIL, CO]);
      const o = await settle(c.query(activate()));
      fail(o, 'INVITATION_ROLE_NOT_ALLOWED');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
    expect((await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'invitations_role_check'`)).rows[0].n).toBe(1);
  });

  it.each(['active', 'invited', 'inactive'])('an existing SUPER_ADMIN row (%s) is never rewritten by an invitation', async (status) => {
    await db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', $3)`, [U, CO, status]);
    await invite();
    fail(await settle(db.query(activate())), 'INVITATION_TARGETS_SUPER_ADMIN_MEMBERSHIP');
    expect(await memberships()).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN', status })]);
    expect(await invitation()).toMatchObject({ accepted_at: null });
  });

  it('an ALREADY-ACTIVE member is not re-roled by an invitation (MEMBERSHIP_ALREADY_ACTIVE; invitation not consumed)', async () => {
    await db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'VIEW_ONLY', 'active')`, [U, CO]);
    await invite(INV, { role: 'COMPANY_ADMIN' });
    fail(await settle(db.query(activate())), 'MEMBERSHIP_ALREADY_ACTIVE');
    expect(await memberships()).toEqual([expect.objectContaining({ role: 'VIEW_ONLY', status: 'active' })]);
    expect(await invitation()).toMatchObject({ accepted_at: null });
  });

  it.each([["status = 'inactive'", 'disabled'], ['deleted_at = now()', 'soft-deleted']])('a %s company → INVITATION_COMPANY_NOT_ACTIVE', async (set) => {
    await invite();
    await db.query(`UPDATE public.companies SET ${set} WHERE id = $1`, [CO]);
    fail(await settle(db.query(activate())), 'INVITATION_COMPANY_NOT_ACTIVE');
    expect(await memberships()).toEqual([]);
  });

  it('a failed write after the membership step rolls back the WHOLE activation (no membership, invitation unconsumed)', async () => {
    await invite();
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE FUNCTION public.c15n_fail_users_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'C15N_FORCED_FAILURE'; END $$`);
      await c.query('CREATE TRIGGER c15n_fail BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.c15n_fail_users_update()');
      await c.query('SAVEPOINT s');
      fail(await settle(c.query(activate())), 'C15N_FORCED_FAILURE');
      await c.query('ROLLBACK TO SAVEPOINT s');
      const m = await c.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO]);
      const i = await c.query('SELECT accepted_at FROM public.invitations WHERE id = $1', [INV]);
      expect(m.rows[0].n).toBe(0);
      expect(i.rows[0].accepted_at).toBeNull();
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  });
});

describe('R-16 — concurrency (two real sessions)', () => {
  async function race(aSql: string, bSql: string, between?: (a: Client) => Promise<void>) {
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const ra = await settle(a.query(aSql));
      if (between) await between(a);
      let settled = false;
      const pb = settle(b.query(bSql)).then((o) => { settled = true; return o; });
      await new Promise((r) => setTimeout(r, 400));
      const bBlocked = !settled;
      await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK');
      const rb = await pb;
      await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK').catch(() => undefined);
      return { ra, rb, bBlocked };
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  }

  it('the SAME invitation accepted twice concurrently: the second waits on the invitation lock, then is an idempotent replay; exactly one active row', async () => {
    await invite();
    const { ra, rb, bBlocked } = await race(activate(), activate());
    expect(ra.ok).toBe(true);
    expect(bBlocked).toBe(true);
    expect(rb).toMatchObject({ ok: true, rows: [{ invitation_id: INV }] });
    expect((await memberships()).filter((m: { status: string }) => m.status === 'active')).toHaveLength(1);
  });

  it('schema invariant: a second PENDING invitation for the same email+company cannot exist (invitations_active_unique)', async () => {
    await invite(INV);
    const o = await settle(db.query(
      `INSERT INTO public.invitations (id, email, company_id, role, token_hash, expires_at, token_consumed_at)
       VALUES ($1, upper($2), $3, 'VIEW_ONLY', 'c15n-dup', now() + interval '1 day', now())`, [INV2, EMAIL, CO]));
    expect(o).toMatchObject({ ok: false, code: '23505' });
  });

  it('INSERT-path race: another path inserts an ACTIVE row (uncommitted) — acceptance waits on the partial unique index, then MEMBERSHIP_ALREADY_ACTIVE; invitation unconsumed; one active row', async () => {
    await invite();
    const { ra, rb, bBlocked } = await race(
      `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ('${U}', '${CO}', 'VIEW_ONLY', 'active')`,
      activate(),
    );
    expect(ra.ok).toBe(true);
    expect(bBlocked).toBe(true);            // ON CONFLICT … WHERE status = 'active' waits on A's uncommitted entry
    fail(rb, 'MEMBERSHIP_ALREADY_ACTIVE');
    expect((await memberships()).filter((m: { status: string }) => m.status === 'active')).toEqual([expect.objectContaining({ role: 'VIEW_ONLY' })]);
    expect(await invitation()).toMatchObject({ accepted_at: null });
  });

  it('the membership row is changed concurrently into a SUPER_ADMIN row (governed path) — acceptance waits on the row lock, then refuses', async () => {
    await db.query(`INSERT INTO public.user_company_roles (id, user_id, company_id, role, status) VALUES ('00000000-0000-4000-8000-0000000016d2', $1, $2, 'VIEW_ONLY', 'invited')`, [U, CO]);
    await invite();
    const { ra, rb, bBlocked } = await race(
      `UPDATE public.user_company_roles SET role = 'SUPER_ADMIN' WHERE id = '00000000-0000-4000-8000-0000000016d2'`,
      activate(),
    );
    expect(ra.ok).toBe(true);
    expect(bBlocked).toBe(true);
    fail(rb, 'INVITATION_TARGETS_SUPER_ADMIN_MEMBERSHIP');
    expect(await memberships()).toEqual([expect.objectContaining({ role: 'SUPER_ADMIN', status: 'invited' })]);
  });

  it('the membership is activated concurrently by another path — acceptance waits, then refuses MEMBERSHIP_ALREADY_ACTIVE; no role change', async () => {
    await db.query(`INSERT INTO public.user_company_roles (id, user_id, company_id, role, status) VALUES ('00000000-0000-4000-8000-0000000016d3', $1, $2, 'VIEW_ONLY', 'invited')`, [U, CO]);
    await invite(INV, { role: 'COMPANY_ADMIN' });
    const { rb } = await race(
      `UPDATE public.user_company_roles SET status = 'active' WHERE id = '00000000-0000-4000-8000-0000000016d3'`,
      activate(),
    );
    fail(rb, 'MEMBERSHIP_ALREADY_ACTIVE');
    expect(await memberships()).toEqual([expect.objectContaining({ role: 'VIEW_ONLY', status: 'active' })]);
  });

  it('a company disable that commits first makes a waiting acceptance refuse (company FOR SHARE vs the lifecycle lock)', async () => {
    await invite();
    const { rb, bBlocked } = await race(`UPDATE public.companies SET status = 'inactive' WHERE id = '${CO}'`, activate());
    expect(bBlocked).toBe(true);
    fail(rb, 'INVITATION_COMPANY_NOT_ACTIVE');
    expect(await memberships()).toEqual([]);
  });
});

describe('R-16 — re-running the migration', () => {
  it('re-applying 04 is safe (CREATE OR REPLACE; precondition passes again)', async () => {
    if (SKIP_FIX || NO_APPLY) return;
    await db.query(fs.readFileSync(FIX, 'utf8'));
    await invite();
    expect((await settle(db.query(activate()))).ok).toBe(true);
  });
});
