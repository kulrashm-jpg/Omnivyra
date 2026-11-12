/**
 * 20270217000023 - the COMMITTING cases (83's harness rule: pass 2, own clients).
 * Two settlements race on ONE hold under DIFFERENT keys. The guarded functions
 * serialise on a per-hold advisory lock, so the second sees the first's committed
 * row and is refused HOLD_ALREADY_SETTLED: exactly one settlement, never a confirm
 * AND a release of the same credits.
 *
 * The ledger is append-only (DELETE raises), so the committed rows stay in the
 * disposable database; each case uses its own random organisation.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const url = process.env.W6_DB_URL as string;
let admin: Client;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  const f = (await admin.query(`SELECT to_regprocedure('public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)') AS a,
                                       to_regprocedure('public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)') AS b`)).rows[0];
  if (!f.a || !f.b) throw new Error('20270217000023 is NOT installed - refusing to pass vacuously');
});

afterAll(async () => { await admin.end(); });

const RES = `SELECT public.apply_credit_reservation_guarded($1, $2, $3, 0, 0, $4, 'test', NULL, 'guarded race', $1, $5, 'free') AS r`;
const PC = `SELECT public.apply_credit_partial_confirm_guarded($1, $2, $3, 0, 0, $4, 'test', NULL, 'guarded race', $1) AS r`;

async function seedHold(free: number, held: number): Promise<{ org: string; hold: string; tag: string }> {
  const org = randomUUID();
  const tag = org.slice(0, 8);
  await admin.query('INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [org, `guarded race ${tag}`]);
  await admin.query('INSERT INTO public.organization_credits (organization_id, free_balance) VALUES ($1, $2)', [org, free]);
  const hold = (await admin.query(RES, [org, 'hold', held, `${tag}:hold`, null])).rows[0].r.id as string;
  return { org, hold, tag };
}

/** c1 settles and stays open; c2's settlement is issued; c1 commits; c2's outcome is collected. */
async function race(first: [string, unknown[]], second: [string, unknown[]]): Promise<{ secondErr: { message?: string } | null }> {
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    await c2.query('BEGIN');
    await c1.query(first[0], first[1]);
    const pending = c2.query(second[0], second[1]).then(() => null).catch((e: { message?: string }) => e);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query('COMMIT');
    const secondErr = await pending;
    await c2.query(secondErr ? 'ROLLBACK' : 'COMMIT');
    return { secondErr };
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

const settlements = async (hold: string) => (await admin.query(
  `SELECT execution_phase FROM public.credit_transactions
    WHERE parent_transaction_id = $1 AND execution_phase IN ('confirm', 'release', 'confirm_partial')
      AND idempotency_key NOT LIKE '%:remainder'`, [hold])).rows.map((r) => r.execution_phase as string);
const walletOf = async (org: string) => (await admin.query(
  'SELECT free_balance::int AS free, reserved_free::int AS rf, lifetime_consumed::int AS consumed FROM public.organization_credits WHERE organization_id = $1', [org])).rows[0];

it('CONFIRM vs RELEASE on one hold (different keys): exactly one settles; the loser is refused HOLD_ALREADY_SETTLED', async () => {
  const { org, hold, tag } = await seedHold(10, 4);
  const { secondErr } = await race(
    [RES, [org, 'confirm', 4, `${tag}:confirm`, hold]],
    [RES, [org, 'release', 4, `${tag}:release`, hold]],
  );
  expect(String(secondErr?.message ?? '')).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(await settlements(hold)).toEqual(['confirm']);
  expect(await walletOf(org)).toEqual({ free: 6, rf: 0, consumed: 4 }); // charged once, never also refunded
});

it('PARTIAL CONFIRM vs RELEASE on one hold: exactly one settles; the credits are never both consumed and refunded', async () => {
  const { org, hold, tag } = await seedHold(10, 4);
  const { secondErr } = await race(
    [PC, [org, hold, 3, `${tag}:confirm`]],
    [RES, [org, 'release', 4, `${tag}:release`, hold]],
  );
  expect(String(secondErr?.message ?? '')).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(await settlements(hold)).toEqual(['confirm_partial']);
  expect(await walletOf(org)).toEqual({ free: 7, rf: 0, consumed: 3 }); // 3 consumed, the 1 remainder released once
});
