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
  getUnstampedOldEventsApplied,
  UNSTAMPED_OLD_EVENT_SECONDS,
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
  let columns: string[] | null = null; // FAITHFUL: a read returns only the selected columns.
  const project = (r: Row) => (columns ? Object.fromEntries(columns.map((c) => [c, r[c]])) : { ...r });
  let payload: Row | null = null;
  const match = (r: Row) => filters.every(([k, c, v]) => (k === 'is' ? (pathValue(r, c) ?? null) === v : pathValue(r, c) === v));
  const q: any = {};
  q.select = (cols?: string) => { if (op === 'select' && cols && cols !== '*') columns = cols.split(',').map((c) => c.trim()); return q; };
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
    return { data: rows.filter(match).map(project), error: null };
  };
  q.maybeSingle = async () => { const r = settle(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(settle()).then(ok, ko);
  return q;
}
const NOW_MS = Date.parse('2026-06-10T12:00:00Z');
const deps = { db: { from: (t: string) => table(t) }, now: () => NOW_MS } as any;

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const sub = (status: string) => ({
  id: 'sub_1', status, customer: 'cus_1',
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

  const legacyRow = (status: string, metadata: Row) => ({
    id: 'legacy-1', organization_id: 'org-1', provider: 'stripe', provider_subscription_id: 'sub_1',
    status, metadata, updated_at: '2026-06-01T00:00:00.000Z',
  });

  it('UNSTAMPED row + OLD event: applies and stamps, counted + logged distinctly for reconciliation (e9/05 option 3)', async () => {
    rows.push(legacyRow('canceled', { note: 'kept' }));
    const old = Math.floor(NOW_MS / 1000) - UNSTAMPED_OLD_EVENT_SECONDS - 1;
    const before = getUnstampedOldEventsApplied();
    const staleBefore = getStaleSubscriptionEventsSkipped();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await apply('customer.subscription.updated', 'active', 'evt_old', old);
    expect(res).toMatchObject({ applied: true, status: 'active' });
    expect(rows[0].metadata).toEqual({ note: 'kept', stripe_last_event: { id: 'evt_old', created: old } });
    expect(getUnstampedOldEventsApplied()).toBe(before + 1);
    expect(getStaleSubscriptionEventsSkipped()).toBe(staleBefore);
    const line = warn.mock.calls.find((c) => String(c[0]).includes('UNSTAMPED_ROW_FIRST_EVENT'));
    // Everything reconciliation needs, captured at the only moment it exists (prior -> applied makes canceled -> active visible).
    expect(line?.[1]).toEqual({
      row_id: 'legacy-1', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1',
      event_id: 'evt_old', event_created: old, prior_status: 'canceled', applied_status: 'active',
      arrived_at: new Date(NOW_MS).toISOString(), age_seconds: UNSTAMPED_OLD_EVENT_SECONDS + 1, old_event: true,
    });
    warn.mockRestore();
  });

  it('UNSTAMPED row + FRESH event: applies and stamps, NOT counted as old; afterwards the stamp orders', async () => {
    rows.push(legacyRow('active', {}));
    const fresh = Math.floor(NOW_MS / 1000) - UNSTAMPED_OLD_EVENT_SECONDS; // exactly at the threshold: not "older than"
    const before = getUnstampedOldEventsApplied();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await apply('customer.subscription.deleted', 'active', 'evt_fresh', fresh)).toMatchObject({ applied: true, status: 'canceled' });
    expect(getUnstampedOldEventsApplied()).toBe(before);
    // The audit line fires for EVERY unstamped transition, fresh ones included (old_event: false).
    const audits = warn.mock.calls.filter((c) => String(c[0]).includes('UNSTAMPED_ROW_FIRST_EVENT'));
    expect(audits).toHaveLength(1);
    expect(audits[0][1]).toMatchObject({ event_id: 'evt_fresh', prior_status: 'active', applied_status: 'canceled', old_event: false });
    warn.mockRestore();
    expect(await apply('customer.subscription.updated', 'active', 'evt_older', fresh - 5)).toMatchObject({ applied: false, reason: 'stale_event' });
    expect(statusNow()).toBe('canceled');
  });

  it('a stamped row never counts or audits as unstamped, however old the event', async () => {
    await apply('customer.subscription.updated', 'active', 'evt_1', T0);
    const before = getUnstampedOldEventsApplied();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await apply('customer.subscription.updated', 'past_due', 'evt_2', T0 + 1)).toMatchObject({ applied: true });
    expect(getUnstampedOldEventsApplied()).toBe(before);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('UNSTAMPED_ROW_FIRST_EVENT'))).toHaveLength(0);
    warn.mockRestore();
  });

  for (const [label, stamp] of [
    ['a JSON string', 'evt_x'], ['JSON null', null], ['an object without id', { created: T0 }],
    ['an object with a string created', { id: 'evt_x', created: String(T0) }], ['an array', ['evt_x', T0]],
  ] as Array<[string, unknown]>) {
    it(`a MALFORMED stamp (${label}) fails closed: not applied, row untouched`, async () => {
      rows.push(legacyRow('canceled', { stripe_last_event: stamp }));
      const snapshot = structuredClone(rows);
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await apply('customer.subscription.updated', 'active', 'evt_new', T0 + 999);
      expect(res).toMatchObject({ applied: false, reason: 'invalid_event_stamp' });
      expect(rows).toEqual(snapshot);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  }

  it('fails closed without the provider event identity: nothing written', async () => {
    const res = await applyStripeSubscriptionEvent('customer.subscription.updated', sub('active') as any, 'org-1', deps);
    expect(res).toMatchObject({ applied: false, reason: 'missing_event_ref' });
    expect(rows).toEqual([]);
  });
});
