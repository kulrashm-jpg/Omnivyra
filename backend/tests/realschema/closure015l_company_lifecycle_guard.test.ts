/**
 * Closure-015L — REAL-POSTGRES proof for the proposed company-lifecycle guard and the
 * rbac_config save function. OPERATOR-RUN ONLY: this phase wrote it but did NOT execute it
 * (no database access was authorized). Run on a DISPOSABLE database only:
 *
 *     npm run test:realschema -- closure015l
 *
 * (scripts/ci/real-schema-ci.sh provisions a throwaway container from baseline.sql; setup.ts
 * refuses managed hosts.) Closure-015R: when the promoted migrations 20261210000001..3 are installed
 * (the CI replay), the suite tests those INSTALLED objects and applies nothing; only on a database
 * with none of them does beforeAll apply the PROPOSAL files from supabase/proposals/closure015l
 * (they are not migrations). A partial install is refused. See "setup isolation" at the end.
 *
 * Deterministic in the style of concurrency.test.ts: session A opens a transaction and holds it,
 * session B is issued, A commits, and B's SQLSTATE / message is asserted. No sleep decides an
 * outcome; the 400 ms wait only records whether B was blocked.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const PROPOSALS = path.resolve(__dirname, '../../../supabase/proposals/closure015l');
const CO = '00000000-0000-4000-8000-0000000015a1';
const ACTOR = '00000000-0000-4000-8000-0000000015f0';
const U1 = '00000000-0000-4000-8000-0000000015b1';
const U2 = '00000000-0000-4000-8000-0000000015b2';

type Outcome = { ok: true } | { ok: false; code: string; message: string };
const settle = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(() => ({ ok: true as const }), (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? '?', message: e.message ?? '' }));

/** A runs `a` inside an open transaction; B runs `b`; A commits; B's outcome is returned. */
async function race(a: string, aParams: unknown[], b: string, bParams: unknown[]) {
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    await c2.query('BEGIN');
    await c1.query(a, aParams);
    let settled = false;
    const pending = settle(c2.query(b, bParams)).then((o) => { settled = true; return o; });
    await new Promise((r) => setTimeout(r, 400));
    const bBlocked = !settled;
    await c1.query('COMMIT');
    const outcome = await pending;
    await c2.query(outcome.ok ? 'COMMIT' : 'ROLLBACK').catch(() => undefined);
    return { outcome, bBlocked };
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

async function freshWorld() {
  await db.query('DELETE FROM public.user_company_roles WHERE company_id = $1', [CO]);
  await db.query('UPDATE public.users SET active_company_id = NULL WHERE id = ANY($1::uuid[])', [[U1, U2]]);
  await db.query('DELETE FROM public.company_profiles WHERE company_id = $1', [CO]);
  await db.query('DELETE FROM public.companies WHERE id = $1', [CO]);
  await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'C15L lifecycle')`, [CO]);
  await db.query(
    `INSERT INTO public.user_company_roles (id, user_id, company_id, role, status)
     VALUES ('00000000-0000-4000-8000-0000000015c1', $1, $2, 'CONTENT_CREATOR', 'active')`, [U1, CO]);
}
const ROW = '00000000-0000-4000-8000-0000000015c1';
const activateSA = `UPDATE public.user_company_roles SET role = 'SUPER_ADMIN', status = 'active' WHERE id = '${ROW}'`;
const insertSA = `INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ('${U2}', '${CO}', 'SUPER_ADMIN', 'active')`;
const activeSA = async () =>
  (await db.query(`SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1 AND role = 'SUPER_ADMIN' AND status = 'active'`, [CO])).rows[0].n as number;
const companyRow = async () => (await db.query('SELECT status, deleted_at FROM public.companies WHERE id = $1', [CO])).rows[0];

/**
 * Closure-015R — setup isolation. The objects this suite exercises, as installed by the promoted
 * migrations 20261210000001..3 (or, on a database without them, by the 015L proposals). The setup
 * decision is taken from the VERIFIED DATABASE STATE, never from suite order or an env var alone:
 *   • every object present → test what is INSTALLED and apply NOTHING. Re-applying the stale 015L
 *     proposal 01 would replace the guard installed by 20261210000002 with its pre-015P body (no
 *     SUPER_ADMIN_GRANT_NOT_GOVERNED) for every later suite sharing the database;
 *   • no object present    → apply the proposals (the original operator-run path), unless
 *     C15N_NO_APPLY=1 forbids applying anything — then refuse, there is nothing to test;
 *   • some present         → refuse: overlaying proposal SQL on a partial install could downgrade it.
 */
const PROMOTED_FUNCTIONS: Record<string, string> = {
  guard_super_admin_membership_company: 'public.guard_super_admin_membership_company()',
  hard_delete_company: 'public.hard_delete_company(uuid, uuid, text)',
  assign_super_admin: 'public.assign_super_admin(uuid, uuid)',
  save_rbac_config: 'public.save_rbac_config(jsonb, jsonb, uuid, bigint)',
};
type SetupState = { defs: Record<string, string | null>; trigger: string | null; rbacTable: boolean; guardGoverned: boolean };
async function readSetupState(): Promise<SetupState> {
  const fns = (await db.query(
    `SELECT t.k, md5(pg_get_functiondef(to_regprocedure(t.sig))) AS def
       FROM unnest($1::text[], $2::text[]) AS t(k, sig)`,
    [Object.keys(PROMOTED_FUNCTIONS), Object.values(PROMOTED_FUNCTIONS)])).rows;
  const misc = (await db.query(
    `SELECT (SELECT md5(pg_get_triggerdef(oid)) FROM pg_trigger
              WHERE tgname = 'trg_guard_super_admin_membership_company' AND tgrelid = 'public.user_company_roles'::regclass) AS trigger,
            to_regclass('public.rbac_config') IS NOT NULL AS rbac_table,
            coalesce(pg_get_functiondef(to_regprocedure('public.guard_super_admin_membership_company()')) LIKE '%SUPER_ADMIN_GRANT_NOT_GOVERNED%', false) AS governed`)).rows[0];
  return {
    defs: Object.fromEntries(fns.map((r) => [r.k as string, (r.def as string | null) ?? null])),
    trigger: (misc.trigger as string | null) ?? null,
    rbacTable: misc.rbac_table === true,
    guardGoverned: misc.governed === true,
  };
}
const presence = (s: SetupState): boolean[] => [...Object.values(s.defs).map((d) => d !== null), s.trigger !== null, s.rbacTable];
let setupBefore: SetupState;
let setupMode: 'installed' | 'proposals';

beforeAll(async () => {
  // Closure-015M: 02 (governed grant RPC) is applied too, so its lock order is exercised.
  setupBefore = await readSetupState();
  const present = presence(setupBefore);
  if (present.every(Boolean)) {
    setupMode = 'installed';
  } else if (present.some(Boolean)) {
    throw new Error(`closure015l: the guard objects are PARTIALLY installed (${JSON.stringify({ ...setupBefore.defs, trigger: setupBefore.trigger, rbac_config: setupBefore.rbacTable })}) — `
      + 'refusing to overlay the 015L proposals on them; install supabase/migrations/20261210000001..3 completely');
  } else if (process.env.C15N_NO_APPLY === '1') {
    throw new Error('closure015l: C15N_NO_APPLY=1 but none of the guard objects is installed — nothing to test');
  } else {
    setupMode = 'proposals';
    for (const f of ['01_company_lifecycle_super_admin_guard.sql', '02_assign_super_admin_rpc.sql', '03_rbac_config.sql']) {
      await db.query(fs.readFileSync(path.join(PROPOSALS, f), 'utf8'));
    }
  }
  for (const [id, email] of [[U1, 'c15l-u1@example.test'], [U2, 'c15l-u2@example.test'], [ACTOR, 'c15l-actor@example.test']]) {
    await db.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'c15l') ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
});
beforeEach(freshWorld);

describe('writer FIRST, lifecycle second → the lifecycle operation is refused and rolls back', () => {
  it.each([
    ['disable', `SELECT * FROM public.disable_company_cascade('${CO}', '${ACTOR}', 'c15l')`],
    ['soft delete', `SELECT * FROM public.soft_delete_company('${CO}', '${ACTOR}', 'c15l')`],
    ['hard delete', `SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`],
  ])('%s, membership UPDATEd to active SUPER_ADMIN', async (_n, lifecycle) => {
    const { outcome, bBlocked } = await race(activateSA, [], lifecycle, []);
    expect(bBlocked).toBe(true);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect((outcome as { message: string }).message).toContain('COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP');
    expect(await activeSA()).toBe(1);
    expect(await companyRow()).toMatchObject({ status: 'active', deleted_at: null });
  });

  it.each([
    ['disable', `SELECT * FROM public.disable_company_cascade('${CO}', '${ACTOR}', 'c15l')`],
    ['hard delete', `SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`],
  ])('%s, NEW active SUPER_ADMIN row INSERTed', async (_n, lifecycle) => {
    const { outcome } = await race(insertSA, [], lifecycle, []);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect(await activeSA()).toBe(1);
    expect(await companyRow()).toBeDefined();
  });
});

describe('lifecycle FIRST, writer second → the write is refused; no orphan, no deactivated SA', () => {
  it('hard delete then INSERT (the Closure-015K RACE D ordering) → SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING; no orphan row', async () => {
    const { outcome, bBlocked } = await race(`SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`, [], insertSA, []);
    expect(bBlocked).toBe(true);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect((outcome as { message: string }).message).toContain('SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING');
    expect(await companyRow()).toBeUndefined();
    expect((await db.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO])).rows[0].n).toBe(0);
  });

  it('soft delete then UPDATE to SUPER_ADMIN → SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE', async () => {
    const { outcome } = await race(`SELECT * FROM public.soft_delete_company('${CO}', '${ACTOR}', 'c15l')`, [], activateSA, []);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect((outcome as { message: string }).message).toContain('SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE');
    expect(await activeSA()).toBe(0);
  });

  it('disable then INSERT → refused; a later re-enable allows the governed grant again', async () => {
    const { outcome } = await race(`SELECT * FROM public.disable_company_cascade('${CO}', '${ACTOR}', 'c15l')`, [], insertSA, []);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    await db.query(`UPDATE public.companies SET status = 'active' WHERE id = $1`, [CO]);
    await db.query(insertSA);
    expect(await activeSA()).toBe(1);
  });
});

describe('deadlock window (writer locks the membership row before the company) — safety holds either way', () => {
  it('exactly one transaction is aborted (40P01) and no active SUPER_ADMIN is deactivated or orphaned', async () => {
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await a.query('SELECT 1 FROM public.companies WHERE id = $1 FOR UPDATE', [CO]);   // lifecycle lock first
      const bWrite = settle(b.query(activateSA));                                          // B: row lock, then waits for company
      await new Promise((r) => setTimeout(r, 300));
      const aWrite = settle(a.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = '${ROW}'`));
      const [ra, rb] = await Promise.all([aWrite, bWrite]);
      const aborted = [ra, rb].filter((o) => !o.ok);
      expect(aborted).toHaveLength(1);
      expect((aborted[0] as { code: string }).code).toBe('40P01');
      await a.query(ra.ok ? 'COMMIT' : 'ROLLBACK').catch(() => undefined);
      await b.query(rb.ok ? 'COMMIT' : 'ROLLBACK').catch(() => undefined);
      // If A won, the row was never an active SUPER_ADMIN; if B won, it is one and still active.
      const r = (await db.query('SELECT role, status FROM public.user_company_roles WHERE id = $1', [ROW])).rows[0];
      expect(r.role === 'SUPER_ADMIN' ? r.status === 'active' : true).toBe(true);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });
});

describe('ordinary cases and atomic rollback', () => {
  it('disable / soft delete / hard delete of a company WITHOUT an active SUPER_ADMIN succeed', async () => {
    await db.query(`SELECT * FROM public.disable_company_cascade('${CO}', '${ACTOR}', 'c15l')`);
    expect(await companyRow()).toMatchObject({ status: 'inactive' });
    await freshWorld();
    await db.query(`SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`);
    expect(await companyRow()).toBeUndefined();
  });

  it('an INACTIVE SUPER_ADMIN row does not block and is removed by hard delete', async () => {
    await db.query(`UPDATE public.user_company_roles SET role = 'SUPER_ADMIN', status = 'inactive' WHERE id = '${ROW}'`);
    await db.query(`SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`);
    expect((await db.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO])).rows[0].n).toBe(0);
  });

  it('hard delete blocked by a non-cascading FK (users.active_company_id) rolls back EVERYTHING (23503)', async () => {
    await db.query('UPDATE public.users SET active_company_id = $1 WHERE id = $2', [CO, U1]);
    const o = await settle(db.query(`SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15l')`));
    expect(o).toMatchObject({ ok: false, code: '23503' });
    expect(await companyRow()).toBeDefined();
    expect((await db.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO])).rows[0].n).toBe(1);
  });

  it('no-transition update of an existing active SUPER_ADMIN row is allowed even in a disabled company (revoke still works)', async () => {
    await db.query(activateSA);
    await db.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]);
    await db.query(`UPDATE public.user_company_roles SET updated_at = now() WHERE id = '${ROW}'`);
    await db.query(`UPDATE public.user_company_roles SET role = 'COMPANY_ADMIN' WHERE id = '${ROW}'`); // governed revoke shape
    expect(await activeSA()).toBe(0);
  });
});

describe('rbac_config — save_rbac_config serializes and refuses stale edits', () => {
  const save = (expected: number | null) =>
    `SELECT * FROM public.save_rbac_config('["SUPER_ADMIN","COMPANY_ADMIN"]'::jsonb, '{"ASSIGN_ROLE":["COMPANY_ADMIN"]}'::jsonb, NULL, ${expected === null ? 'NULL' : expected})`;
  beforeEach(async () => { await db.query('TRUNCATE public.rbac_config RESTART IDENTITY'); });

  it('two concurrent first saves (both expected NULL): the second waits on the advisory lock and is STALE', async () => {
    const { outcome, bBlocked } = await race(save(null), [], save(null), []);
    expect(bBlocked).toBe(true);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect((outcome as { message: string }).message).toContain('RBAC_CONFIG_STALE');
    expect((await db.query('SELECT count(*)::int AS n FROM public.rbac_config')).rows[0].n).toBe(1);
  });

  it('sequential saves: versions 1,2,3 and strictly increasing updated_at (read order = version order)', async () => {
    await db.query(save(null));
    await db.query(save(1));
    await db.query(save(2));
    const { rows } = await db.query('SELECT version, updated_at FROM public.rbac_config ORDER BY updated_at DESC');
    expect(rows.map((r: { version: string }) => Number(r.version))).toEqual([3, 2, 1]);
  });

  it('the CHECKs refuse an empty roles array / empty permissions object', async () => {
    const o = await settle(db.query(`INSERT INTO public.rbac_config (roles, permissions) VALUES ('[]'::jsonb, '{}'::jsonb)`));
    expect(o).toMatchObject({ ok: false, code: '23514' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Closure-015M additions — run on the verified throwaway database.
// ════════════════════════════════════════════════════════════════════════════
const assignSA = (user = U2) => `SELECT * FROM public.assign_super_admin('${user}', '${CO}')`;
const disable = `SELECT * FROM public.disable_company_cascade('${CO}', '${ACTOR}', 'c15m')`;
const hardDelete = `SELECT * FROM public.hard_delete_company('${CO}', '${ACTOR}', 'c15m')`;
const softDelete = `SELECT * FROM public.soft_delete_company('${CO}', '${ACTOR}', 'c15m')`;

describe('015M — grant into a company whose lifecycle forbids it (direct write AND governed RPC)', () => {
  const MISSING = '00000000-0000-4000-8000-0000000015ee';
  it.each([
    ['missing', async () => undefined, MISSING, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING'],
    ['soft-deleted', async () => { await db.query('UPDATE public.companies SET deleted_at = now() WHERE id = $1', [CO]); }, CO, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'],
    ['disabled (inactive)', async () => { await db.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]); }, CO, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'],
    ['suspended', async () => { await db.query(`UPDATE public.companies SET status = 'suspended' WHERE id = $1`, [CO]); }, CO, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'],
  ])('%s company: direct INSERT and assign_super_admin are both refused; nothing written', async (_n, prep, company, msg) => {
    await prep();
    const direct = await settle(db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'SUPER_ADMIN', 'active')`, [U2, company]));
    expect(direct).toMatchObject({ ok: false, code: 'P0001' });
    expect((direct as { message: string }).message).toContain(msg);
    const rpc = await settle(db.query('SELECT * FROM public.assign_super_admin($1, $2)', [U2, company]));
    expect(rpc).toMatchObject({ ok: false, code: 'P0001' });
    expect((await db.query(`SELECT count(*)::int AS n FROM public.user_company_roles WHERE user_id = $1 AND role = 'SUPER_ADMIN'`, [U2])).rows[0].n).toBe(0);
  });

  it('an active company: the governed RPC grants (insert, idempotent re-grant, existing row upgraded in place)', async () => {
    await db.query(assignSA());
    await db.query(assignSA());
    await db.query(assignSA(U1));
    const r = await db.query('SELECT user_id, role, status FROM public.user_company_roles WHERE company_id = $1 ORDER BY user_id', [CO]);
    expect(r.rows).toEqual([
      { user_id: U1, role: 'SUPER_ADMIN', status: 'active' },
      { user_id: U2, role: 'SUPER_ADMIN', status: 'active' },
    ]);
  });
});

describe('015M — governed grant RPC vs lifecycle (lock order company -> membership)', () => {
  it.each([['disable', disable], ['soft delete', softDelete], ['hard delete', hardDelete]])(
    'RPC FIRST vs %s: lifecycle blocked, then refused (P0001); the grant survives',
    async (_n, lifecycle) => {
      const { outcome, bBlocked } = await race(assignSA(), [], lifecycle, []);
      expect(bBlocked).toBe(true);
      expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
      expect(await activeSA()).toBe(1);
      expect(await companyRow()).toMatchObject({ status: 'active', deleted_at: null });
    },
  );

  it.each([
    ['disable', disable, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'],
    ['soft delete', softDelete, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE'],
    ['hard delete', hardDelete, 'SUPER_ADMIN_MEMBERSHIP_COMPANY_MISSING'],
  ])('%s FIRST vs the RPC: the RPC waits on the company lock, then is refused; nothing orphaned or left active', async (_n, lifecycle, msg) => {
    const { outcome, bBlocked } = await race(lifecycle, [], assignSA(), []);
    expect(bBlocked).toBe(true);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    expect((outcome as { message: string }).message).toContain(msg);
    expect(await activeSA()).toBe(0);
  });

  it('THE DEADLOCK WINDOW WITH THE RPC: lifecycle holds the company and updates the row; the RPC waits on the company first, so no 40P01', async () => {
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await a.query('SELECT 1 FROM public.companies WHERE id = $1 FOR UPDATE', [CO]);
      const bRpc = settle(b.query(assignSA(U1)));          // same membership row ROW
      await new Promise((r) => setTimeout(r, 300));
      const aRow = await settle(a.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = '${ROW}'`));
      expect(aRow).toEqual({ ok: true });                  // B holds no row lock: no wait, no deadlock
      await a.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]);
      await a.query('COMMIT');
      const rb = await bRpc;
      await b.query('ROLLBACK').catch(() => undefined);
      expect(rb).toMatchObject({ ok: false, code: 'P0001' });
      expect((rb as { message: string }).message).toContain('SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE');
      expect(await activeSA()).toBe(0);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it('two concurrent governed grants into the same company do not block each other (FOR SHARE + FOR SHARE)', async () => {
    const { outcome, bBlocked } = await race(assignSA(U2), [], assignSA(U1), []);
    expect(bBlocked).toBe(false);
    expect(outcome).toEqual({ ok: true });
    expect(await activeSA()).toBe(2);
  });
});

describe('015M — bounded retry around a lifecycle call: the invariant holds on every attempt', () => {
  it('disable retried on 40P01 (max 3) behind a committed direct grant: refused (P0001), SA intact, company active', async () => {
    const withRetry = async (c: Client, sql: string) => {
      let last: Outcome = { ok: false, code: 'RETRY_EXHAUSTED', message: '' };
      for (let attempt = 1; attempt <= 3; attempt++) {
        last = await settle(c.query(sql));
        if (last.ok || (last as { code?: string }).code !== '40P01') break;
      }
      return last;
    };
    const writer = new Client({ connectionString: url });
    const life = new Client({ connectionString: url });
    await Promise.all([writer.connect(), life.connect()]);
    try {
      await writer.query('BEGIN');
      await writer.query(activateSA);                 // holds the row lock + company FOR SHARE
      const lifeP = withRetry(life, disable);           // blocks behind the writer
      await new Promise((r) => setTimeout(r, 300));
      await writer.query('COMMIT');
      const o = await lifeP;
      expect(o).toMatchObject({ ok: false, code: 'P0001' });
      expect(await activeSA()).toBe(1);
      expect(await companyRow()).toMatchObject({ status: 'active' });
    } finally {
      await Promise.all([writer.end(), life.end()]);
    }
  });
});

describe('015M — direct writes cannot bypass the guard; ordinary operations remain', () => {
  it('moving an active SUPER_ADMIN row into a disabled company (company_id change) is refused', async () => {
    await db.query(assignSA());
    const OTHER = '00000000-0000-4000-8000-0000000015a2';
    await db.query(`INSERT INTO public.companies (id, name, status) VALUES ($1, 'C15M other', 'inactive') ON CONFLICT (id) DO UPDATE SET status = 'inactive'`, [OTHER]);
    const o = await settle(db.query('UPDATE public.user_company_roles SET company_id = $1 WHERE user_id = $2 AND company_id = $3', [OTHER, U2, CO]));
    expect(o).toMatchObject({ ok: false, code: 'P0001' });
    await db.query('DELETE FROM public.companies WHERE id = $1', [OTHER]);
  });

  it('ordinary memberships: invite, activate, role change, deactivate, delete; even in a disabled company the trigger ignores them', async () => {
    await db.query(`UPDATE public.user_company_roles SET status = 'invited' WHERE id = '${ROW}'`);
    await db.query(`UPDATE public.user_company_roles SET status = 'active', role = 'VIEW_ONLY' WHERE id = '${ROW}'`);
    await db.query(`UPDATE public.user_company_roles SET role = 'COMPANY_ADMIN' WHERE id = '${ROW}'`);
    await db.query(`UPDATE public.user_company_roles SET status = 'inactive' WHERE id = '${ROW}'`);
    await db.query(`DELETE FROM public.user_company_roles WHERE id = '${ROW}'`);
    await db.query(`UPDATE public.companies SET status = 'inactive' WHERE id = $1`, [CO]);
    await db.query(`INSERT INTO public.user_company_roles (user_id, company_id, role, status) VALUES ($1, $2, 'VIEW_ONLY', 'active')`, [U2, CO]);
    expect((await db.query('SELECT count(*)::int AS n FROM public.user_company_roles WHERE company_id = $1', [CO])).rows[0].n).toBe(1);
  });

  it('a refused lifecycle operation leaves NO partial effect (company row and every membership unchanged)', async () => {
    await db.query(assignSA());
    const before = (await db.query('SELECT id, role, status, updated_at FROM public.user_company_roles WHERE company_id = $1 ORDER BY id', [CO])).rows;
    for (const sql of [disable, softDelete, hardDelete]) {
      expect(await settle(db.query(sql))).toMatchObject({ ok: false, code: 'P0001' });
    }
    expect(await companyRow()).toMatchObject({ status: 'active', deleted_at: null });
    expect((await db.query('SELECT id, role, status, updated_at FROM public.user_company_roles WHERE company_id = $1 ORDER BY id', [CO])).rows).toEqual(before);
  });
});

describe('015M — rbac_config: initialization, latest committed version, invalid data, recovery', () => {
  const saveP = (expected: number | null, perms: string) =>
    `SELECT version FROM public.save_rbac_config('["SUPER_ADMIN","COMPANY_ADMIN"]'::jsonb, '${perms}'::jsonb, NULL, ${expected === null ? 'NULL' : expected})`;
  const P1 = '{"ASSIGN_ROLE":["COMPANY_ADMIN"]}';
  beforeEach(async () => { await db.query('TRUNCATE public.rbac_config RESTART IDENTITY'); });

  it('empty table: a guessed version is STALE; expected NULL creates version 1', async () => {
    expect(await settle(db.query(saveP(1, P1)))).toMatchObject({ ok: false, code: 'P0001' });
    expect(Number((await db.query(saveP(null, P1))).rows[0].version)).toBe(1);
  });

  it('two connections both editing version 1: one commits version 2, the other is STALE; the latest committed row is version 2', async () => {
    await db.query(saveP(null, P1));
    const { outcome } = await race(saveP(1, '{"ASSIGN_ROLE":["SUPER_ADMIN"]}'), [], saveP(1, '{"VIEW_DASHBOARD":["*"]}'), []);
    expect(outcome).toMatchObject({ ok: false, code: 'P0001' });
    const latest = (await db.query('SELECT version, permissions FROM public.rbac_config ORDER BY updated_at DESC, version DESC LIMIT 1')).rows[0];
    expect(Number(latest.version)).toBe(2);
    expect(latest.permissions).toEqual({ ASSIGN_ROLE: ['SUPER_ADMIN'] });
  });

  it('invalid whole documents cannot be stored at all (CHECK 23514), even by a direct insert', async () => {
    for (const [roles, perms] of [['"x"', '{"A":["B"]}'], ['[]', '{"A":["B"]}'], ['["SUPER_ADMIN"]', '[]'], ['["SUPER_ADMIN"]', '{}']]) {
      expect(await settle(db.query(`INSERT INTO public.rbac_config (roles, permissions) VALUES ('${roles}'::jsonb, '${perms}'::jsonb)`))).toMatchObject({ ok: false, code: '23514' });
    }
  });

  it('RECOVERY: a stored row with malformed entries (passes the CHECKs) is superseded by a governed save carrying its version', async () => {
    await db.query(`INSERT INTO public.rbac_config (roles, permissions) VALUES ('["SUPER_ADMIN"]'::jsonb, '{"ASSIGN_ROLE":"COMPANY_ADMIN"}'::jsonb)`);
    const v = Number((await db.query('SELECT max(version) AS v FROM public.rbac_config')).rows[0].v);
    expect(Number((await db.query(saveP(v, P1))).rows[0].version)).toBe(v + 1);
  });
});

// Closure-015R — runs LAST in this file, so it checks the database AFTER every test above.
describe('setup isolation (Closure-015R): the suite never downgrades installed objects', () => {
  it('the setup decision followed the verified database state', async () => {
    const before = presence(setupBefore);
    expect(setupMode).toBe(before.every(Boolean) ? 'installed' : 'proposals');
    // whichever path ran, every object the suite needs is now present
    expect(presence(await readSetupState()).every(Boolean)).toBe(true);
  });

  it('installed → nothing applied (every function and the trigger byte-for-byte unchanged); proposals → created from nothing', async () => {
    const after = await readSetupState();
    if (setupMode === 'installed') {
      expect(after.defs).toEqual(setupBefore.defs);
      expect(after.trigger).toBe(setupBefore.trigger);
    } else {
      expect(Object.values(setupBefore.defs).every((d) => d === null) && setupBefore.trigger === null).toBe(true);
      expect(Object.values(after.defs).every((d) => d !== null) && after.trigger !== null).toBe(true);
    }
  });

  it('the direct-grant guard (SUPER_ADMIN_GRANT_NOT_GOVERNED, 20261210000002) is never downgraded', async () => {
    const after = await readSetupState();
    // installed: exactly as found (a governed guard stays governed); proposals: the 015L body, which predates 0002
    expect(after.guardGoverned).toBe(setupMode === 'installed' ? setupBefore.guardGoverned : false);
  });
});
