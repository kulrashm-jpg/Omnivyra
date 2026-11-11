/**
 * Image credits (owner ruling 2026-11-11) - the "concurrent pair: one charge
 * each, never negative" property, proved against REAL PostgreSQL locking.
 *
 * The image-credits helper reserves through reserveCreditsForWork, whose hold
 * is ONE call of public.apply_credit_reservation. The unit suite proves the
 * helper relies on that call correctly; only the database can prove the call
 * itself is atomic under concurrency. Two genuinely separate sessions race,
 * deterministically: A holds and stays open, B is issued, A commits, then B's
 * outcome is collected (same pattern as concurrency.test.ts).
 *
 * WALLET MODEL (apply_credit_reservation, measured in CI-69): a HOLD moves
 * credits - free_balance -= amount AND reserved_free += amount - so after a
 * hold free_balance already EXCLUDES the held credits and is what remains
 * spendable. The function's own availability check, however, computes
 * free_balance - reserved_free, subtracting open holds a SECOND time
 * (pre-existing production defect, reported 2026-11-12): a second concurrent
 * hold is refused while credits remain. Final charges are unaffected (confirm
 * only clears reserved_free). The 'both fit' case pins the CORRECT behaviour as
 * it.failing until the function is fixed.
 *
 * The ledger (credit_transactions) is append-only, so the committed rows this
 * suite writes stay in the disposable CI database; each case uses its own
 * synthetic organisation so they never interfere.
 */
import { Client } from 'pg';

const url = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(url)) {
  throw new Error('image_credits_reservation_concurrency refuses a non-loopback W6_DB_URL');
}

const HOLD_SQL = `SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => 'hold', p_free_amount => $2,
  p_idempotency_key => $3, p_reference_type => 'image_generation', p_note => 'image-credits concurrency', p_performed_by => $1, p_category => 'free')`;

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function seedOrg(org: string, freeBalance: number): Promise<void> {
  await withClient(async (c) => {
    await c.query(`INSERT INTO public.companies (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [org, `image-credits ${org.slice(-4)}`]);
    await c.query(`INSERT INTO public.organization_credits (organization_id, free_balance) VALUES ($1, $2)`, [org, freeBalance]);
  });
}

async function walletOf(org: string): Promise<{ free_balance: number; reserved_free: number }> {
  return withClient(async (c) => (await c.query(
    'SELECT free_balance::int AS free_balance, reserved_free::int AS reserved_free FROM public.organization_credits WHERE organization_id=$1', [org],
  )).rows[0]);
}

async function holdsFor(org: string): Promise<number> {
  return withClient(async (c) => Number((await c.query(
    `SELECT count(*)::int AS n FROM public.credit_transactions WHERE organization_id=$1 AND execution_phase='hold'`, [org],
  )).rows[0].n));
}

/** A holds (open), B issued, A commits, B collected. */
async function race(org: string, a: { amount: number; key: string }, b: { amount: number; key: string }) {
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    await c2.query('BEGIN');
    await c1.query(HOLD_SQL, [org, a.amount, a.key]);
    const pending = c2.query(HOLD_SQL, [org, b.amount, b.key]).then(() => null).catch((e: { message?: string; code?: string }) => e);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query('COMMIT');
    const bErr = await pending;
    if (bErr) await c2.query('ROLLBACK'); else await c2.query('COMMIT');
    return { bErr };
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

const org = (n: number) => `1ac0c0de-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tag = Date.now().toString(36);

describe('apply_credit_reservation under real concurrency (image credits)', () => {
  it('a pair where only ONE fits: exactly one hold commits, the other is refused as insufficient, never negative', async () => {
    const o = org(1);
    await seedOrg(o, 7);
    const { bErr } = await race(o, { amount: 5, key: `ic-${tag}-a:hold` }, { amount: 5, key: `ic-${tag}-b:hold` });
    expect(bErr).not.toBeNull();
    expect(String(bErr?.message ?? '')).toMatch(/insufficient/i);
    const w = await walletOf(o);
    expect(w.reserved_free).toBe(5);
    expect(w.free_balance).toBe(2);                 // 7 - 5: never negative
    expect(w.free_balance).toBeGreaterThanOrEqual(0);
    expect(await holdsFor(o)).toBe(1);
  });

  // KNOWN DEFECT (pre-existing, reported): the availability check double-counts
  // open holds, so the second hold is refused with 'need 5, have 0' although 5
  // remain. it.failing keeps CI honest and turns red the day the function is
  // fixed - then make this a plain it().
  it.failing('a pair where BOTH fit: one hold each, the balance reaches zero and no lower', async () => {
    const o = org(2);
    await seedOrg(o, 10);
    const { bErr } = await race(o, { amount: 5, key: `ic-${tag}-c:hold` }, { amount: 5, key: `ic-${tag}-d:hold` });
    expect(bErr).toBeNull();
    const w = await walletOf(o);
    expect(w.reserved_free).toBe(10);
    expect(w.free_balance).toBe(0);
    expect(await holdsFor(o)).toBe(2);
  });

  it('the SAME attempt key raced twice: at most one hold exists (a retry never double-reserves)', async () => {
    const o = org(3);
    await seedOrg(o, 50);
    const key = `ic-${tag}-same:hold`;
    await race(o, { amount: 5, key }, { amount: 5, key });
    expect(await holdsFor(o)).toBe(1);
    const w = await walletOf(o);
    expect(w.reserved_free).toBe(5);
  });
});
