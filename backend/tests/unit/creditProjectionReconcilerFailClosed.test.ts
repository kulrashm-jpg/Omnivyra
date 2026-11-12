/**
 * BLOCKING money fix (e1, 2026-11-12; found in the billing upsert class sweep, e9 ruling).
 *  1. The reconciler's write GUARD re-read the wallet but ignored the read error, so a transient failure looked
 *     like "no wallet" and the absolute rebuild overwrote a live wallet (the 2026-07-09 incident class inside the
 *     incident's own guard). A guard read error now aborts with no write.
 *  2. loadLedger paged with .range() and NO ORDER BY. Postgres does not promise a stable order across OFFSET pages,
 *     so >1000 ledger rows could be skipped / duplicated and the rebuild summed wrong. It now orders by id (PK).
 * The fake is faithful to the failure: without .order('id') every page is served from a DIFFERENT row order (as an
 * unordered heap scan may), with .order('id') pages are stable.
 */
export {};
let mockLedger: any[] = [];
let mockWallet: any = null;
let mockWalletReadError: { message: string } | null = null;
const mockUpserts: any[] = [];
let mockPageCall = 0;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let ordered = false;
      const b: any = {};
      for (const op of ['select', 'eq', 'limit']) b[op] = () => b;
      b.order = (col: string) => { if (col === 'id') ordered = true; return b; };
      b.range = (from: number, to: number) => {
        mockPageCall += 1;
        const view = ordered
          ? [...mockLedger].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
          // unordered: each page sees the heap in a different order (rotate by page call)
          : mockLedger.map((_, i, arr) => arr[(i + mockPageCall * 337) % arr.length]);
        return Promise.resolve({ data: view.slice(from, to + 1), error: null });
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
beforeEach(() => { mockLedger = []; mockWallet = null; mockWalletReadError = null; mockUpserts.length = 0; mockPageCall = 0; });

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
