/**
 * Image credits helper (owner ruling 2026-11-11: charge image credits BEFORE
 * launch). The ledger fake models the reservation RPC: check-and-deduct is one
 * atomic step, idempotent per key (hold / confirm / release keys), so the
 * helper's contract can be exercised end to end:
 *   insufficient -> no provider call; success -> exactly one deduction;
 *   provider failure -> release, zero net; retry -> no double charge;
 *   concurrent pair -> one charge each, never negative.
 */
import { makeImageCredits, clampCredits, imageUnitFor, IMAGE_CREDITS_HELPER, type ImageCreditsDeps } from '../../services/billing/imageCredits';

const ORG = '00000000-0000-4000-8000-0000000000aa';

class PricingMissing extends Error {}

function world(opts: { balance?: number; priceCredits?: number | 'missing'; registry?: string | null; slow?: string | null; confirmStatus?: string; releaseStatus?: string; closeMiss?: string; raceOnOpen?: boolean } = {}) {
  let balance = opts.balance ?? 100;
  const holds = new Map<string, { credits: number; state: 'held' | 'confirmed' | 'released' }>();
  const ops = new Map<string, Record<string, any>>();
  const ledger: Array<{ phase: string; key: string; credits: number }> = [];
  let seq = 0;
  const stall = <T>(step: string, v: T) => (opts.slow === step ? new Promise<T>(() => undefined) : Promise.resolve(v));

  const deps: ImageCreditsDeps = {
    timeoutMs: 50,
    resolveFeatureActionKey: () => (opts.registry === undefined ? 'image_generation' : opts.registry),
    bounds: () => ({ min: 2, max: 12 }),
    price: async () => {
      if (opts.priceCredits === 'missing') throw new PricingMissing('no unit cost');
      return stall('price', { credits: opts.priceCredits ?? 5, snapshot: { cost_multiplier: 1.5 } });
    },
    isPricingMissing: (e) => e instanceof PricingMissing,
    findOpByKey: async (k) => stall('lookup', [...ops.values()].find((o) => o.idempotency_key === k) as any ?? null),
    findOpById: async (id) => (ops.get(id) as any) ?? null,
    openOp: async (a) => {
      if (opts.raceOnOpen) {
        // A concurrent first-open won: the upsert lands on THEIR row (same key).
        const winner = [...ops.values()].find((o) => o.idempotency_key === a.idempotencyKey);
        if (winner) return winner.id;
      }
      const id = `op-${++seq}`;
      ops.set(id, { id, status: 'initiated', organization_id: a.organizationId, idempotency_key: a.idempotencyKey, metadata: a.metadata });
      return id;
    },
    closeOp: async (id, patch: any, from) => {
      const o = ops.get(id);
      if (opts.closeMiss === patch.status) return { updated: 0, error: null };
      if (!o || !from.includes(o.status)) return { updated: 0, error: null };
      Object.assign(o, { status: patch.status, metadata: patch.metadata ?? o.metadata, amount_charged: patch.amountCharged });
      return { updated: 1, error: null };
    },
    reserve: async (o: any) => {
      const h = holds.get(o.idempotencyKey);
      if (h?.state === 'confirmed') return { status: 'already_confirmed' };
      if (h?.state === 'released') return { status: 'already_released' };
      const handle = { orgId: o.orgId, userId: o.userId, action: o.action, referenceType: o.referenceType, referenceId: o.referenceId,
        idempotencyKey: o.idempotencyKey, holdTransactionId: `hold-${o.idempotencyKey}`, split: { free: 0, incentive: 0, paid: o.amountOverride } };
      if (h?.state === 'held') return { status: 'already_reserved', ...handle, creditsReserved: h.credits };
      // atomic check-and-deduct (the RPC's guarantee)
      if (balance < o.amountOverride) return { status: 'insufficient_credits', available: balance, required: o.amountOverride };
      balance -= o.amountOverride;
      holds.set(o.idempotencyKey, { credits: o.amountOverride, state: 'held' });
      ledger.push({ phase: 'hold', key: o.idempotencyKey, credits: o.amountOverride });
      return { status: 'reserved', ...handle, creditsReserved: o.amountOverride };
    },
    confirm: async (h) => {
      if (opts.confirmStatus) return { status: opts.confirmStatus } as any;
      const x = holds.get(h.idempotencyKey)!;
      if (x.state === 'confirmed') return { status: 'already_confirmed' };
      if (x.state === 'released') return { status: 'already_released' };
      x.state = 'confirmed';
      ledger.push({ phase: 'confirm', key: h.idempotencyKey, credits: x.credits });
      return { status: 'confirmed', creditsCharged: x.credits, confirmTransactionId: `c-${h.idempotencyKey}` };
    },
    release: async (h) => {
      if (opts.releaseStatus) return { status: opts.releaseStatus } as any;
      const x = holds.get(h.idempotencyKey)!;
      if (x.state === 'released') return { status: 'already_released' };
      if (x.state === 'confirmed') return { status: 'already_confirmed' };
      x.state = 'released';
      balance += x.credits;
      ledger.push({ phase: 'release', key: h.idempotencyKey, credits: x.credits });
      return { status: 'released', releaseTransactionId: `r-${h.idempotencyKey}` };
    },
  };
  return { deps, api: makeImageCredits(deps), get balance() { return balance; }, topUp(n: number) { balance += n; }, ledger, ops, holds };
}

const SKU = { provider: 'openai', model: 'gpt-image-1.5', size: '1024x1024', quality: 'medium' };
const input = (key: string) => ({ organizationId: ORG, idempotencyKey: key, ...SKU });

/** The caller pattern: reserve -> provider -> settle | release. */
async function render(w: ReturnType<typeof world>, key: string, provider: () => Promise<boolean>) {
  const r = await w.api.reserveImageCredits(input(key));
  if (!r.ok) return { reserved: r, called: false };
  let delivered = false;
  try { delivered = await provider(); } catch { delivered = false; }
  if (delivered) return { reserved: r, called: true, settled: await w.api.settleImageCredits({ billingOperationId: r.billingOperationId }) };
  return { reserved: r, called: true, released: await w.api.releaseImageCredits({ billingOperationId: r.billingOperationId, reason: 'provider failed' }) };
}

describe('image credits - the five owner cases', () => {
  it('insufficient credits -> refused, NO provider call, nothing held', async () => {
    const w = world({ balance: 3, priceCredits: 5 });
    const provider = jest.fn(async () => true);
    const out = await render(w, 'k1', provider);
    expect(out.reserved).toMatchObject({ ok: false, reason: 'insufficient_credits' });
    expect(provider).not.toHaveBeenCalled();
    expect(w.balance).toBe(3);
    expect(w.ledger).toEqual([]);
  });

  it('success -> exactly ONE deduction of the priced amount', async () => {
    const w = world({ balance: 100, priceCredits: 5 });
    const out = await render(w, 'k1', async () => true);
    expect(out.settled).toEqual({ ok: true, creditsCharged: 5 });
    expect(w.balance).toBe(95);
    expect(w.ledger.map((l) => l.phase)).toEqual(['hold', 'confirm']);
    expect([...w.ops.values()][0]).toMatchObject({ status: 'confirmed', amount_charged: 5 });
  });

  it('provider failure (false or throw) -> released, ZERO net', async () => {
    for (const provider of [async () => false, async () => { throw new Error('boom'); }]) {
      const w = world({ balance: 100, priceCredits: 5 });
      const out = await render(w, 'k1', provider);
      expect(out.released).toEqual({ ok: true });
      expect(w.balance).toBe(100);
      expect(w.ledger.map((l) => l.phase)).toEqual(['hold', 'release']);
    }
  });

  it('retry of the same attempt key -> same operation, NO second hold, NO double charge', async () => {
    const w = world({ balance: 100, priceCredits: 5 });
    const a = await w.api.reserveImageCredits(input('k1'));
    const b = await w.api.reserveImageCredits(input('k1'));   // lost response, same attempt
    expect(a.ok && b.ok && a.billingOperationId === b.billingOperationId).toBe(true);
    expect(w.ledger.filter((l) => l.phase === 'hold')).toHaveLength(1);
    if (!a.ok) throw new Error('unreachable');
    await w.api.settleImageCredits({ billingOperationId: a.billingOperationId });
    expect(await w.api.settleImageCredits({ billingOperationId: a.billingOperationId })).toMatchObject({ ok: false, reason: 'not_held' });
    expect(await w.api.reserveImageCredits(input('k1'))).toMatchObject({ ok: false, reason: 'key_spent' });
    expect(w.balance).toBe(95);
  });

  it('concurrent pair -> one charge EACH; never negative when only one fits', async () => {
    const both = world({ balance: 10, priceCredits: 5 });
    const [x, y] = await Promise.all([render(both, 'a1', async () => true), render(both, 'a2', async () => true)]);
    expect([x.settled, y.settled]).toEqual([{ ok: true, creditsCharged: 5 }, { ok: true, creditsCharged: 5 }]);
    expect(both.balance).toBe(0);

    const one = world({ balance: 7, priceCredits: 5 });
    const outs = await Promise.all([render(one, 'b1', async () => true), render(one, 'b2', async () => true)]);
    expect(outs.filter((o) => o.called)).toHaveLength(1);
    expect(outs.filter((o) => o.reserved.ok === false && (o.reserved as { reason: string }).reason === 'insufficient_credits')).toHaveLength(1);
    expect(one.balance).toBe(2);
    expect(one.balance).toBeGreaterThanOrEqual(0);
  });
});

describe('fail closed and the contract details', () => {
  it('no unit cost set -> not_priced, no reservation', async () => {
    const w = world({ priceCredits: 'missing' });
    expect(await w.api.reserveImageCredits(input('k'))).toMatchObject({ ok: false, reason: 'not_priced' });
    expect(w.ledger).toEqual([]);
  });

  it('registry not resolving image_generation to itself -> not_priced (never billed as another action)', async () => {
    const w = world({ registry: 'website_audit' });
    expect(await w.api.reserveImageCredits(input('k'))).toMatchObject({ ok: false, reason: 'not_priced' });
    expect(w.ledger).toEqual([]);
  });

  it('price is clamped to the IMAGE_GENERATION catalog bounds [2, 12]', async () => {
    expect(clampCredits(0.4, { min: 2, max: 12 })).toBe(2);
    expect(clampCredits(30, { min: 2, max: 12 })).toBe(12);
    const w = world({ balance: 100, priceCredits: 40 });
    const r = await w.api.reserveImageCredits(input('k'));
    expect(r).toMatchObject({ ok: true, creditsReserved: 12 });
  });

  it('a refused key is REUSABLE after a top-up (same operation id, nothing was held)', async () => {
    const w = world({ balance: 1, priceCredits: 5 });
    expect(await w.api.reserveImageCredits(input('k'))).toMatchObject({ ok: false, reason: 'insufficient_credits' });
    const [refusedOp] = [...w.ops.values()];
    expect(refusedOp.status).toBe('insufficient');
    expect(w.ledger).toEqual([]);
    w.topUp(10);
    const again = await w.api.reserveImageCredits(input('k'));
    expect(again).toMatchObject({ ok: true, billingOperationId: refusedOp.id, creditsReserved: 5 });
    expect(w.ops.size).toBe(1);
    expect(w.ledger.map((l) => l.phase)).toEqual(['hold']);
  });

  it('a hung step surfaces as unavailable, never a hang (and no provider call)', async () => {
    const w = world({ slow: 'price' });
    const provider = jest.fn(async () => true);
    const out = await render(w, 'k', provider);
    expect(out.reserved).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('release is idempotent and NEVER un-confirms; settle needs a held row', async () => {
    const w = world();
    const r = await w.api.reserveImageCredits(input('k'));
    if (!r.ok) throw new Error('unreachable');
    expect(await w.api.releaseImageCredits({ billingOperationId: r.billingOperationId, reason: 'x' })).toEqual({ ok: true });
    expect(await w.api.releaseImageCredits({ billingOperationId: r.billingOperationId, reason: 'x' })).toEqual({ ok: true });
    expect(await w.api.settleImageCredits({ billingOperationId: r.billingOperationId })).toMatchObject({ ok: false, reason: 'not_held' });

    const w2 = world();
    const r2 = await w2.api.reserveImageCredits(input('k2'));
    if (!r2.ok) throw new Error('unreachable');
    await w2.api.settleImageCredits({ billingOperationId: r2.billingOperationId });
    expect(await w2.api.releaseImageCredits({ billingOperationId: r2.billingOperationId, reason: 'late' })).toMatchObject({ ok: false, reason: 'not_held' });
    expect(w2.balance).toBe(95);
  });

  it('only touches rows it created: a foreign row under the key -> key_spent, no hold', async () => {
    const w = world();
    w.ops.set('legacy', { id: 'legacy', status: 'held', organization_id: ORG, idempotency_key: 'render:job', metadata: {} });
    expect(await w.api.reserveImageCredits(input('render:job'))).toMatchObject({ ok: false, reason: 'key_spent' });
    expect(await w.api.releaseImageCredits({ billingOperationId: 'legacy', reason: 'x' })).toMatchObject({ ok: false, reason: 'not_held' });
    expect(w.ledger).toEqual([]);
  });

  it('records the SKU, pricing snapshot and helper marker on the operation', async () => {
    const w = world();
    await w.api.reserveImageCredits(input('k'));
    const op = [...w.ops.values()][0];
    expect(op.metadata).toMatchObject({ helper: IMAGE_CREDITS_HELPER, sku: SKU });
    expect(op.metadata.pricing).toMatchObject({ unclamped_credits: 5, catalog_min: 2, catalog_max: 12, credits: 5 });
    expect(imageUnitFor('GPT-Image-1.5', '1024x1024', '')).toBe('gpt-image-1.5:1024x1024:auto');
  });
});

describe('05 money findings (BLOCKING): charge only from a named status; release reports a missed row', () => {
  it.each(['released', 'already_released', 'insufficient_credits', 'no_credit_account', 'not_a_member', 'something_new'])(
    'settle with confirm status %s records NO charge and leaves the row held', async (status) => {
      const w = world({ confirmStatus: status });
      const r = await w.api.reserveImageCredits(input('k'));
      if (!r.ok) throw new Error('unreachable');
      const out = await w.api.settleImageCredits({ billingOperationId: r.billingOperationId });
      expect(out.ok).toBe(false);
      const op = [...w.ops.values()][0];
      expect(op.status).toBe('held');
      expect(op.amount_charged).toBeUndefined();
    });

  it.each([['confirmed', true], ['already_confirmed', true]])('settle with confirm status %s marks confirmed', async (status) => {
    const w = world({ confirmStatus: status as string });
    const r = await w.api.reserveImageCredits(input('k'));
    if (!r.ok) throw new Error('unreachable');
    expect((await w.api.settleImageCredits({ billingOperationId: r.billingOperationId })).ok).toBe(true);
    expect([...w.ops.values()][0]).toMatchObject({ status: 'confirmed', amount_charged: 5 });
  });

  it('a release whose CAS moves 0 rows is REPORTED (not ok), never silent', async () => {
    const w = world({ closeMiss: 'released' });
    const r = await w.api.reserveImageCredits(input('k'));
    if (!r.ok) throw new Error('unreachable');
    expect(await w.api.releaseImageCredits({ billingOperationId: r.billingOperationId, reason: 'x' }))
      .toMatchObject({ ok: false, reason: 'not_held' });
  });

  it('a release answered with an unexpected status records nothing', async () => {
    const w = world({ releaseStatus: 'something_new' });
    const r = await w.api.reserveImageCredits(input('k'));
    if (!r.ok) throw new Error('unreachable');
    expect(await w.api.releaseImageCredits({ billingOperationId: r.billingOperationId, reason: 'x' }))
      .toMatchObject({ ok: false, reason: 'unavailable' });
    expect([...w.ops.values()][0].status).toBe('held');
  });

  it('a lost first-open race CONVERGES on the row that owns the key (no second hold)', async () => {
    const w = world({ raceOnOpen: true });
    // The winner opened and HELD the key between our lookup and our open.
    const winner = await w.api.reserveImageCredits(input('k'));
    if (!winner.ok) throw new Error('unreachable');
    const realFind = w.deps.findOpByKey;
    let first = true;
    w.deps.findOpByKey = async (k) => { if (first) { first = false; return null; } return realFind(k); };
    const loser = await w.api.reserveImageCredits(input('k'));
    expect(loser).toMatchObject({ ok: true, billingOperationId: winner.billingOperationId });
    expect(w.ledger.filter((l) => l.phase === 'hold')).toHaveLength(1);
  });
});
