/**
 * CLASS 2 (2026-11-12): markExpiredSubscriptions read lapsed rows, then updated
 * them BY ID ONLY. A Stripe renewal advancing current_period_end between the
 * read and the write was overwritten to 'expired' (which then drains the
 * paying org's allocation via the credit-expiry sweep). The update now
 * re-states the predicate; the count is the rows actually updated.
 *
 * The fake applies in/lt filters over stored rows and returns copies; the
 * renewal is injected between the read and the update.
 */
export {};
import { markExpiredSubscriptions } from '../../services/billingSubscriptionService';

type Row = Record<string, any>;
const NOW = Date.parse('2026-11-12T00:00:00Z');
function world(rows: Row[], between?: (rows: Row[]) => void) {
  return {
    from: () => {
      const filters: Array<(r: Row) => boolean> = [];
      let op = 'select'; let payload: Row = {}; let lim = Infinity;
      const b: any = {
        select: () => (op === 'update' ? exec() : b),
        update: (p: Row) => { op = 'update'; payload = p; return b; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
        lt: (c: string, v: string) => { filters.push((r) => r[c] < v); return b; },
        limit: (n: number) => { lim = n; return b; },
        then: (ok: any, ko: any) => exec().then(ok, ko),
      };
      async function exec() {
        const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, op === 'select' ? lim : undefined);
        if (op === 'select') { const copies = hit.map((r) => ({ ...r })); if (between) { between(rows); between = undefined; } return { data: copies, error: null }; }
        for (const r of hit) Object.assign(r, payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return b;
    },
  };
}

it('control: lapsed subscriptions are expired and counted', async () => {
  const rows = [{ id: 's1', status: 'active', current_period_end: '2026-10-01T00:00:00Z' }];
  const r = await markExpiredSubscriptions({ db: world(rows) as never, now: () => NOW });
  expect(r).toEqual({ expired: 1, ids: ['s1'] });
  expect(rows[0].status).toBe('expired');
});

it('a RENEWAL landing between read and write is NOT overwritten to expired', async () => {
  const rows = [
    { id: 's1', status: 'active', current_period_end: '2026-10-01T00:00:00Z' },
    { id: 's2', status: 'active', current_period_end: '2026-10-01T00:00:00Z' },
  ];
  const r = await markExpiredSubscriptions({
    db: world(rows, (rs) => { rs[0].current_period_end = '2026-12-01T00:00:00Z'; }) as never,
    now: () => NOW,
  });
  expect(rows[0]).toMatchObject({ status: 'active', current_period_end: '2026-12-01T00:00:00Z' });
  expect(rows[1].status).toBe('expired');
  expect(r).toEqual({ expired: 1, ids: ['s2'] });
});

it('a status change to canceled between read and write is not rewritten to expired', async () => {
  const rows = [{ id: 's1', status: 'active', current_period_end: '2026-10-01T00:00:00Z' }];
  const r = await markExpiredSubscriptions({ db: world(rows, (rs) => { rs[0].status = 'canceled'; }) as never, now: () => NOW });
  expect(rows[0].status).toBe('canceled');
  expect(r.expired).toBe(0);
});

it('a MASS lapse is swept in batches (never one unbounded .in() URL), and every row is expired', async () => {
  const { EXPIRY_SWEEP_BATCH } = jest.requireActual('../../services/billingSubscriptionService');
  const rows = Array.from({ length: EXPIRY_SWEEP_BATCH * 2 + 7 }, (_, i) => ({ id: `s${i}`, status: 'active', current_period_end: '2026-10-01T00:00:00Z' }));
  const r = await markExpiredSubscriptions({ db: world(rows) as never, now: () => NOW });
  expect(r.expired).toBe(rows.length);
  expect(rows.every((x) => x.status === 'expired')).toBe(true);
});
