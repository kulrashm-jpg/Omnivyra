/**
 * BLOCKING money fix (e9, 2026-11-13): Stripe subscription events are applied to billing_subscriptions in PROVIDER
 * EVENT ORDER. A stale or out-of-order event (an older 'active' arriving after a newer 'canceled') must never
 * overwrite the newer state (unpaid service otherwise).
 *
 * The fake is a FAITHFUL in-memory billing_subscriptions table: eq / is filters must match (including the jsonb
 * path filters `metadata->stripe_last_event->>id` and `metadata->stripe_last_event`), insert enforces the
 * (provider, provider_subscription_id) uniqueness with 23505, update returns only the rows it changed.
 */
import {
  applyStripeSubscriptionEvent,
  compareProviderEvents,
  getStaleSubscriptionEventsSkipped,
} from '../../services/billingSubscriptionService';

type Row = Record<string, any>;
let rows: Row[] = [];
let beforeUpdate: (() => void) | null = null;
let seq = 0;

const pathValue = (row: Row, col: string): unknown => {
  const m = col.match(/^metadata->stripe_last_event(?:->>(\w+))?$/);
  if (m) {
    const evt = row.metadata?.stripe_last_event;
    if (!m[1]) return evt ?? null;
    return evt?.[m[1]] === undefined ? null : String(evt[m[1]]);
  }
  return row[col];
};

function table(name: string) {
  if (name !== 'billing_subscriptions' && name !== 'pricing_plans') throw new Error(`hostile fake: unexpected table ${name}`);
  const filters: Array<[string, string, unknown]> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: Row | null = null;
  const match = (r: Row) => filters.every(([k, c, v]) => (k === 'is' ? (pathValue(r, c) ?? null) === v : pathValue(r, c) === v));
  const q: any = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { filters.push(['eq', c, v]); return q; };
  q.is = (c: string, v: unknown) => { filters.push(['is', c, v]); return q; };
  q.in = () => q;
  q.limit = () => q;
  q.insert = (p: Row) => { op = 'insert'; payload = p; return q; };
  q.update = (p: Row) => { op = 'update'; payload = p; return q; };
  // upsert (onConflict provider,provider_subscription_id) is modelled so the HEAD control (the pre-fix code, which
  // upserted every event blindly) runs the same scenarios against the same table.
  q.upsert = (p: Row) => {
    const hit = rows.find((r) => r.provider === p.provider && r.provider_subscription_id === p.provider_subscription_id);
    if (hit) Object.assign(hit, structuredClone(p)); else rows.push({ id: `row-${++seq}`, metadata: {}, ...structuredClone(p) });
    return Promise.resolve({ data: null, error: null });
  };
  const settle = () => {
    if (name === 'pricing_plans') return { data: [], error: null };
    if (op === 'insert') {
      if (rows.some((r) => r.provider === payload!.provider && r.provider_subscription_id === payload!.provider_subscription_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      rows.push({ id: `row-${++seq}`, ...structuredClone(payload!) });
      return { data: null, error: null };
    }
    if (op === 'update') {
      if (beforeUpdate) { const f = beforeUpdate; beforeUpdate = null; f(); }
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, structuredClone(payload!));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    return { data: rows.filter(match), error: null };
  };
  q.maybeSingle = async () => { const r = settle(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(settle()).then(ok, ko);
  return q;
}
const deps = { db: { from: (t: string) => table(t) } } as any;

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const sub = (status: string) => ({
  id: 'sub_1', status,
  current_period_start: sec('2026-06-01T00:00:00Z'),
  current_period_end: sec('2026-07-01T00:00:00Z'),
});
const T0 = sec('2026-06-10T10:00:00Z');
const apply = (type: string, status: string, id: string, created: number) =>
  applyStripeSubscriptionEvent(type, sub(status) as any, 'org-1', deps, { id, created });
const statusNow = () => rows.find((r) => r.provider_subscription_id === 'sub_1')?.status;

beforeEach(() => { rows = []; beforeUpdate = null; seq = 0; });

describe('compareProviderEvents', () => {
  it('orders by created, ties by id, same id is a duplicate', () => {
    expect(compareProviderEvents({ id: 'evt_b', created: 2 }, { id: 'evt_a', created: 1 })).toBe('newer');
    expect(compareProviderEvents({ id: 'evt_a', created: 1 }, { id: 'evt_b', created: 2 })).toBe('stale');
    expect(compareProviderEvents({ id: 'evt_b', created: 5 }, { id: 'evt_a', created: 5 })).toBe('newer');
    expect(compareProviderEvents({ id: 'evt_a', created: 5 }, { id: 'evt_b', created: 5 })).toBe('stale');
    expect(compareProviderEvents({ id: 'evt_a', created: 5 }, { id: 'evt_a', created: 5 })).toBe('duplicate');
    expect(compareProviderEvents({ id: 'evt_a', created: 5 }, null)).toBe('newer');
  });
});

describe('Stripe subscription events are applied in provider-event order', () => {
  it('CRITICAL: an older "active" delivered AFTER a newer "canceled" leaves the subscription CANCELED', async () => {
    await apply('customer.subscription.updated', 'active', 'evt_1', T0);          // in order
    await apply('customer.subscription.deleted', 'active', 'evt_3', T0 + 120);     // newer: canceled
    // Guarded read: the HEAD control (pre-fix code) has no counter, and must fail on the STATUS, not on a missing export.
    const staleCount = () => (typeof getStaleSubscriptionEventsSkipped === 'function' ? getStaleSubscriptionEventsSkipped() : -1);
    const before = staleCount();
    const late = await apply('customer.subscription.updated', 'active', 'evt_2', T0 + 60); // stale, arrives last
    expect(statusNow()).toBe('canceled');
    expect(late).toMatchObject({ applied: false, reason: 'stale_event' });
    expect(staleCount()).toBe(before + 1);
    expect(rows[0].metadata.stripe_last_event).toEqual({ id: 'evt_3', created: T0 + 120 });
  });

  it('CONTROL: in-order events apply (active -> past_due -> canceled)', async () => {
    expect(await apply('customer.subscription.created', 'active', 'evt_1', T0)).toMatchObject({ applied: true });
    expect(await apply('customer.subscription.updated', 'past_due', 'evt_2', T0 + 10)).toMatchObject({ applied: true, status: 'past_due' });
    expect(await apply('customer.subscription.deleted', 'active', 'evt_3', T0 + 20)).toMatchObject({ applied: true, status: 'canceled' });
    expect(statusNow()).toBe('canceled');
  });

  it('a duplicate delivery of the same event id is a no-op', async () => {
    await apply('customer.subscription.updated', 'active', 'evt_1', T0);
    const snapshot = structuredClone(rows);
    expect(await apply('customer.subscription.updated', 'active', 'evt_1', T0)).toMatchObject({ applied: false, reason: 'duplicate_event' });
    expect(rows).toEqual(snapshot);
  });

  it('equal created time with different ids resolves deterministically (greater id wins, in either delivery order)', async () => {
    await apply('customer.subscription.updated', 'active', 'evt_a', T0);
    await apply('customer.subscription.updated', 'past_due', 'evt_b', T0);
    const first = statusNow();
    rows = [];
    await apply('customer.subscription.updated', 'past_due', 'evt_b', T0);
    await apply('customer.subscription.updated', 'active', 'evt_a', T0);
    expect(statusNow()).toBe(first);
    expect(first).toBe('past_due');
  });

  it('a concurrent delivery that wins between read and write makes the loser re-decide (compare-and-set)', async () => {
    await apply('customer.subscription.updated', 'active', 'evt_1', T0);
    // While evt_2 (older than evt_3) is between its read and its write, evt_3 (canceled) lands.
    beforeUpdate = () => {
      const r = rows[0];
      r.status = 'canceled';
      r.metadata = { ...r.metadata, stripe_last_event: { id: 'evt_3', created: T0 + 120 } };
    };
    const res = await apply('customer.subscription.updated', 'active', 'evt_2', T0 + 60);
    expect(res).toMatchObject({ applied: false, reason: 'stale_event' });
    expect(statusNow()).toBe('canceled');
  });

  it('fails closed without the provider event identity: nothing written', async () => {
    const res = await applyStripeSubscriptionEvent('customer.subscription.updated', sub('active') as any, 'org-1', deps);
    expect(res).toMatchObject({ applied: false, reason: 'missing_event_ref' });
    expect(rows).toEqual([]);
  });
});
