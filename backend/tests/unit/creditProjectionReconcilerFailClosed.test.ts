/**
 * BLOCKING money fix (e1, 2026-11-12; found in the billing upsert class sweep, e9 ruling).
 *  1. The reconciler's write GUARD re-read the wallet but ignored the read error, so a transient failure looked
 *     like "no wallet" and the absolute rebuild overwrote a live wallet (the 2026-07-09 incident class inside the
 *     incident's own guard). A guard read error now aborts with no write.
 *  2. loadLedger paged with .range() and NO ORDER BY: rows could be skipped / duplicated. It now pages by KEYSET on
 *     the primary key (05): WHERE id > last ORDER BY id LIMIT n - immune to order instability AND to rows inserted
 *     during the scan (random uuid ids can land below the cursor and shift an OFFSET page: a duplicate).
 * The fake serves an unordered heap unless .order('id') is used, and supports .range (OFFSET) and .gt + .limit (keyset).
 */
export {};
let mockLedger: any[] = [];
let mockWallet: any = null;
let mockWalletReadError: { message: string } | null = null;
const mockUpserts: any[] = [];
let mockPageCall = 0;
let mockAfterPage: ((page: number) => void) | null = null;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let ordered = false;
      let after: string | null = null;
      const b: any = {};
      for (const op of ['select', 'eq']) b[op] = () => b;
      b.order = (col: string) => { if (col === 'id') ordered = true; return b; };
      b.gt = (_c: string, v: string) => { after = v; return b; };
      b.limit = (n: number) => {
        mockPageCall += 1;
        const view = ordered
          ? [...mockLedger].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
          : mockLedger.map((_, i, arr) => arr[(i + mockPageCall * 337) % arr.length]);
        const out = view.filter((r) => after === null || r.id > after).slice(0, n);
        mockAfterPage?.(mockPageCall);
        return Promise.resolve({ data: out, error: null });
      };
      b.range = (from: number, to: number) => {
        mockPageCall += 1;
        const view = ordered
          ? [...mockLedger].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
          // unordered: each page sees the heap in a different order (rotate by page call)
          : mockLedger.map((_, i, arr) => arr[(i + mockPageCall * 337) % arr.length]);
        const out = view.slice(from, to + 1);
        mockAfterPage?.(mockPageCall);
        return Promise.resolve({ data: out, error: null });
      };
      b.maybeSingle = () => Promise.resolve(mockWalletReadError ? { data: null, error: mockWalletReadError } : { data: mockWallet, error: null });
      b.upsert = (payload: any) => { mockUpserts.push({ table, payload }); return Promise.resolve({ error: null }); };
      return b;
    },
  },
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { reconcileOrgCreditProjection } = require('../../services/creditProjectionReconciler');
/* eslint-enable @typescript-eslint/no-var-requires */
const ORG = '11111111-1111-4111-8111-111111111111';
const grants = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  execution_phase: 'grant', free_delta: i + 1, paid_delta: 0, incentive_delta: 0, idempotency_key: `g-${i}`,
}));
beforeEach(() => { mockLedger = []; mockWallet = null; mockWalletReadError = null; mockUpserts.length = 0; mockPageCall = 0; mockAfterPage = null; });

it('a transient wallet READ ERROR in the guard aborts: outcome failed, NOTHING written', async () => {
  mockLedger = grants(5);
  mockWalletReadError = { message: 'connection reset' };
  const r = await reconcileOrgCreditProjection(ORG);
  expect(r.outcome).toBe('failed');
  expect(mockUpserts).toEqual([]);
});

it('control: a genuinely ABSENT wallet is rebuilt', async () => {
  mockLedger = grants(5);
  const r = await reconcileOrgCreditProjection(ORG);
  expect(r.outcome).toBe('rebuilt');
  expect(mockUpserts[0].payload.free_balance).toBe(15);
});

it('paging over >1000 ledger rows sums EXACTLY (deterministic ORDER BY a unique key)', async () => {
  mockLedger = grants(2500);
  const r = await reconcileOrgCreditProjection(ORG);
  expect(r.outcome).toBe('rebuilt');
  const expected = (2500 * 2501) / 2;
  expect(mockUpserts[0].payload.free_balance).toBe(expected);
  expect(mockUpserts[0].payload.lifetime_purchased).toBe(expected);
});

it('a ledger row INSERTED during the scan below the cursor is not counted twice (keyset; OFFSET would duplicate)', async () => {
  mockLedger = grants(2500);
  // after page 1, a new row lands with an id BELOW the cursor (random uuids do this): an OFFSET page 2 would shift
  // back by one and re-read a page-1 row; keyset (id > last) never revisits.
  mockAfterPage = (page) => {
    if (page === 1) mockLedger.push({ id: '00000000-0000-4000-8000-000000000000a', execution_phase: 'grant', free_delta: 0, paid_delta: 0, incentive_delta: 0, idempotency_key: 'late' });
  };
  const r = await reconcileOrgCreditProjection(ORG);
  expect(r.outcome).toBe('rebuilt');
  expect(mockUpserts[0].payload.free_balance).toBe((2500 * 2501) / 2);
});
