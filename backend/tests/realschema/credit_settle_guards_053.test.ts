/**
 * Real-schema cover for 20270217000053 credit_settle_guards_reauthor (e1; e9-ruled BLOCKING for the enforcement flip and
 * the pricing release). The guards ARE Postgres behaviour, so they are proven here on real rows:
 *   BEFORE: the LIVE prod bodies (committed C100 fixtures, md5 = prod) are installed inside a rolled-back transaction and
 *           shown to HAVE each defect - so the defect list is real, not assumed;
 *   AFTER:  the 053 bodies (installed by the replay) refuse each one, keep the live arithmetic, and two connections
 *           settling one hold concurrently produce exactly one settle.
 * Synthetic org ids only (disposable replay DB; the suite refuses a non-loopback W6_DB_URL).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { db, inRollback } from './setup';

const URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(URL)) throw new Error('credit_settle_guards_053 refuses a non-loopback W6_DB_URL');

const ORG = '0eda0053-0000-4000-8000-000000000053';
const FIX = path.join(__dirname, '..', 'fixtures', 'live-credit-functions-20261113');
const LIVE_RES = fs.readFileSync(path.join(FIX, 'LIVE-apply_credit_reservation.prosrc.sql'), 'utf8');
const LIVE_PC = fs.readFileSync(path.join(FIX, 'LIVE-apply_credit_partial_confirm.prosrc.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/rollbacks/credit_settle_guards_reauthor_rollback.sql'), 'utf8');

// No params -> the simple-query protocol, which allows a multi-statement script (the rollback file).
const q = (sql: string, params: unknown[] = []) => (params.length ? db.query(sql, params) : db.query(sql));

/** Run on the shared connection inside a savepoint; 'ok' or the error message. */
async function attempt(sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT g053');
  try { await q(sql, params); await q('RELEASE SAVEPOINT g053'); return 'ok'; }
  catch (e: any) { await q('ROLLBACK TO SAVEPOINT g053'); return String(e.message); }
}

type Phase = 'hold' | 'confirm' | 'release' | 'grant' | 'expire';
function res(phase: Phase, free: number | null, key: string | null, parent: string | null = null): [string, unknown[]] {
  return [
    `SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => $2, p_free_amount => $3, p_idempotency_key => $4,
       p_parent_id => $5, p_reference_type => 'g053', p_category => 'free')`,
    [ORG, phase, free, key, parent],
  ];
}
const run = (phase: Phase, free: number | null, key: string | null, parent: string | null = null) => attempt(...res(phase, free, key, parent));
const pc = (hold: string, actual: number, key: string) => attempt(
  `SELECT public.apply_credit_partial_confirm(p_org_id => $1, p_hold_txn_id => $2, p_actual_free => $3, p_idempotency_key => $4)`,
  [ORG, hold, actual, key]);
const idOf = async (key: string) => (await q('SELECT id FROM public.credit_transactions WHERE idempotency_key = $1', [key])).rows[0]?.id as string;
const wallet = async () => (await q('SELECT free_balance, reserved_free FROM public.organization_credits WHERE organization_id = $1', [ORG])).rows[0];

/** 300 free credits granted, then a 50 hold. */
async function seed(prefix: string): Promise<string> {
  await q('INSERT INTO public.organization_credits (organization_id) VALUES ($1) ON CONFLICT DO NOTHING', [ORG]);
  expect(await run('grant', 300, `${prefix}:grant`)).toBe('ok');
  expect(await run('hold', 50, `${prefix}:hold`)).toBe('ok');
  return idOf(`${prefix}:hold`);
}

async function installLiveBodies(): Promise<void> {
  await q(`CREATE OR REPLACE FUNCTION public.apply_credit_reservation(p_org_id uuid, p_phase text, p_free_amount int DEFAULT 0,
    p_incentive_amount int DEFAULT 0, p_paid_amount int DEFAULT 0, p_idempotency_key text DEFAULT NULL,
    p_reference_type text DEFAULT NULL, p_reference_id text DEFAULT NULL, p_note text DEFAULT NULL,
    p_performed_by uuid DEFAULT NULL, p_parent_id uuid DEFAULT NULL, p_category text DEFAULT 'paid')
    RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $fn$` + LIVE_RES + '$fn$');
  await q(`CREATE OR REPLACE FUNCTION public.apply_credit_partial_confirm(p_org_id uuid, p_hold_txn_id uuid,
    p_actual_free int DEFAULT 0, p_actual_incentive int DEFAULT 0, p_actual_paid int DEFAULT 0,
    p_idempotency_key text DEFAULT NULL, p_reference_type text DEFAULT NULL, p_reference_id text DEFAULT NULL,
    p_note text DEFAULT NULL, p_performed_by uuid DEFAULT NULL)
    RETURNS jsonb LANGUAGE plpgsql SET search_path = public, extensions AS $fn$` + LIVE_PC + '$fn$');
}

describe('BEFORE - the LIVE prod bodies have each defect (installed in a rolled-back transaction)', () => {
  it('release after confirm succeeds and refunds consumed credits; availability double-subtracts; negative hold raises balance', async () => {
    await inRollback(async () => {
      await installLiveBodies();
      const hold = await seed('b1');
      expect(await wallet()).toEqual({ free_balance: 250, reserved_free: 50 });
      expect(await run('hold', 250, 'b1:hold2')).toMatch(/insufficient free balance/);      // 250 spendable, refused
      expect(await run('confirm', 50, 'b1:confirm', hold)).toBe('ok');
      expect(await run('release', 50, 'b1:release', hold)).toBe('ok');                     // DOUBLE SETTLE accepted
      expect((await wallet()).free_balance).toBe(300);                                       // consumed credits refunded
      expect(await run('hold', -10, 'b1:neg')).toBe('ok');                                   // negative hold accepted
    });
  });
});

describe('AFTER - 053 refuses each defect and keeps the live arithmetic', () => {
  it('availability: 300 granted, 50 held -> a 250 hold succeeds (no double subtraction)', async () => {
    await inRollback(async () => {
      await seed('a1');
      expect(await run('hold', 250, 'a1:hold2')).toBe('ok');
      expect(await wallet()).toEqual({ free_balance: 0, reserved_free: 300 });
      expect(await run('hold', 1, 'a1:hold3')).toMatch(/insufficient free balance/);
    });
  });

  it('a hold settles ONCE: release after confirm, double release, confirm after release are refused', async () => {
    await inRollback(async () => {
      const hold = await seed('a2');
      expect(await run('confirm', 50, 'a2:confirm', hold)).toBe('ok');
      expect(await run('release', 50, 'a2:release', hold)).toMatch(/HOLD_ALREADY_SETTLED/);
      expect(await wallet()).toEqual({ free_balance: 250, reserved_free: 0 });
      const h2 = (await run('hold', 10, 'a2:h2'), await idOf('a2:h2'));
      expect(await run('release', 10, 'a2:r1', h2)).toBe('ok');
      expect(await run('release', 10, 'a2:r2', h2)).toMatch(/HOLD_ALREADY_SETTLED/);
      expect(await run('confirm', 10, 'a2:c2', h2)).toMatch(/HOLD_ALREADY_SETTLED/);
    });
  });

  it('settle needs a real parent hold of this org, may not exceed it, and other phases refuse a parent', async () => {
    await inRollback(async () => {
      const hold = await seed('a3');
      expect(await run('confirm', 10, 'a3:c-noparent')).toMatch(/SETTLE_REQUIRES_PARENT_HOLD/);
      const grantId = await idOf('a3:grant');
      expect(await run('confirm', 10, 'a3:c-notahold', grantId)).toMatch(/SETTLE_PARENT_NOT_A_HOLD/);
      expect(await run('confirm', 51, 'a3:c-over', hold)).toMatch(/SETTLE_EXCEEDS_HOLD/);
      expect(await run('grant', 5, 'a3:g-parent', hold)).toMatch(/PARENT_ONLY_FOR_SETTLE/);
    });
  });

  it('negative / NULL amounts and a missing key are refused', async () => {
    await inRollback(async () => {
      await seed('a4');
      expect(await run('hold', -10, 'a4:neg')).toMatch(/CREDIT_AMOUNT_NEGATIVE/);
      expect(await run('hold', null, 'a4:null')).toMatch(/CREDIT_AMOUNT_NULL/);
      expect(await run('hold', 10, null)).toMatch(/CREDIT_IDEMPOTENCY_KEY_REQUIRED/);
      expect(await run('hold', 10, '   ')).toMatch(/CREDIT_IDEMPOTENCY_KEY_REQUIRED/);
    });
  });

  it('a replay with the same key still returns the existing row (idempotency kept)', async () => {
    await inRollback(async () => {
      await seed('a5');
      const before = await wallet();
      expect(await run('hold', 50, 'a5:hold')).toBe('ok');
      expect(await wallet()).toEqual(before);
    });
  });

  it('partial confirm settles once: a second partial confirm or a later release of the same hold is refused', async () => {
    await inRollback(async () => {
      const hold = await seed('a6');
      expect(await pc(hold, 20, 'a6:pc1')).toBe('ok');
      expect(await wallet()).toEqual({ free_balance: 280, reserved_free: 0 });   // 30 returned with the partial settle
      expect(await pc(hold, 20, 'a6:pc2')).toMatch(/HOLD_ALREADY_SETTLED/);
      expect(await run('release', 50, 'a6:release', hold)).toMatch(/HOLD_ALREADY_SETTLED/);
      expect(await pc(hold, -1, 'a6:neg')).toMatch(/CREDIT_AMOUNT_NEGATIVE/);
    });
  });

  it('expire keeps the live clamp: expiring more than the free balance drains it to 0, never negative', async () => {
    await inRollback(async () => {
      await seed('a7');
      expect(await run('expire', 1000, 'a7:expire')).toBe('ok');
      expect(await wallet()).toEqual({ free_balance: 0, reserved_free: 50 });  // the hold's 50 is untouched
    });
  });

  it('expire_org_free_credits is dropped; the credit functions keep invoker rights and their live search_path', async () => {
    const { rows } = await q(`SELECT to_regprocedure('public.expire_org_free_credits(uuid,integer,text)') AS f,
      (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)')) AS r_def,
      (SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)')) AS pc_cfg`);
    expect(rows[0].f).toBeNull();
    expect(rows[0].r_def).toBe(false);
    expect(rows[0].pc_cfg).toEqual(['search_path=public, extensions']);
  });

  it('the rollback restores the three LIVE bodies byte-for-byte (its own md5 check passes)', async () => {
    await inRollback(async () => {
      expect(await attempt(ROLLBACK)).toBe('ok');
    });
  });
});

describe('AFTER - concurrency (separate connections, committed rows)', () => {
  const extra: Client[] = [];
  const CORG = '0eda0053-0000-4000-8000-0000000c0053';
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) { const c = new Client({ connectionString: URL }); await c.connect(); extra.push(c); }
  });
  afterAll(async () => { await Promise.all(extra.map((c) => c.end())); });

  it('two partial confirms of ONE hold with DIFFERENT keys, concurrently -> exactly one settles', async () => {
    const tag = `cc${Date.now()}`;
    await db.query('INSERT INTO public.organization_credits (organization_id) VALUES ($1) ON CONFLICT DO NOTHING', [CORG]);
    await db.query(`SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => 'grant', p_free_amount => 100,
      p_idempotency_key => $2, p_reference_type => 'g053', p_category => 'free')`, [CORG, `${tag}:grant`]);
    await db.query(`SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => 'hold', p_free_amount => 40,
      p_idempotency_key => $2, p_reference_type => 'g053', p_category => 'free')`, [CORG, `${tag}:hold`]);
    const hold = (await db.query('SELECT id FROM public.credit_transactions WHERE idempotency_key = $1', [`${tag}:hold`])).rows[0].id;
    const settle = (c: Client, key: string) => c.query(
      'SELECT public.apply_credit_partial_confirm(p_org_id => $1, p_hold_txn_id => $2, p_actual_free => 25, p_idempotency_key => $3)',
      [CORG, hold, key]).then(() => 'ok', (e) => String(e.message));
    const out = await Promise.all([settle(extra[0], `${tag}:pcA`), settle(extra[1], `${tag}:pcB`)]);
    expect(out.filter((o) => o === 'ok')).toHaveLength(1);
    expect(out.filter((o) => /HOLD_ALREADY_SETTLED/.test(o))).toHaveLength(1);
    const { rows } = await db.query(`SELECT count(*)::int n FROM public.credit_transactions WHERE parent_transaction_id = $1`, [hold]);
    expect(rows[0].n).toBe(1);
  });
});
