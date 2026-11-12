/**
 * MONEY unread-error sites (2026-11-12): the usage billing snapshot (the frozen
 * billing basis for a period) and the wallet snapshot's last-activity read.
 *
 *  - usageAggregationService:36 existing-check, :93 token rollup, :127 re-fetch
 *    after a concurrent insert: a failure returns ok:false and writes nothing -
 *    never 0 tokens frozen into a snapshot, never a 'success' with no id and
 *    this writer's totals. A missing optional meter table (42P01) still means
 *    0 tokens, as documented.
 *  - billingWalletService:63 last-activity read: best-effort, logged.
 */
export {};
type Res = { data?: unknown; error: { message: string; code?: string } | null };
let mockScript: Record<string, (n: number) => Res> = {};
const mockCalls: Record<string, number> = {};
const mockInserts: string[] = [];
const mockLogs: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      const b: any = {};
      const result = () => {
        const k = table + ':' + op;
        mockCalls[k] = (mockCalls[k] ?? 0) + 1;
        return (mockScript[k] ?? (() => ({ data: null, error: null })))(mockCalls[k]);
      };
      for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
      b.insert = () => { op = 'insert'; mockInserts.push(table); return b; };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));
jest.mock('../../services/logger', () => ({
  logger: { error: (e: string) => mockLogs.push(e), warn: (e: string) => mockLogs.push(e), info: () => undefined },
}));

import { takeUsageSnapshot } from '../../services/billing/payments/usageAggregationService';
import { getBillingWalletSnapshot } from '../../services/billing/payments/billingWalletService';

const ARGS = { organizationId: 'o1', periodStart: '2026-10-01', periodEnd: '2026-10-31' };
const DOWN = () => ({ data: null, error: { message: 'down' } });

beforeEach(() => {
  mockScript = { 'credit_transactions:select': () => ({ data: [{ credits_delta: -5, usd_equivalent: 0.05, reference_type: 'x' }], error: null }) };
  for (const k of Object.keys(mockCalls)) delete mockCalls[k];
  mockInserts.length = 0; mockLogs.length = 0;
});

describe('usage billing snapshot', () => {
  it('existing-snapshot read error -> ok:false, nothing inserted', async () => {
    mockScript['usage_billing_snapshots:select'] = DOWN;
    const r = await takeUsageSnapshot(ARGS as never);
    expect(r.ok).toBe(false);
    expect(mockInserts).toEqual([]);
  });

  it('token-rollup read error -> ok:false; 0 tokens are NEVER frozen into the snapshot', async () => {
    mockScript['usage_meter_monthly:select'] = DOWN;
    const r = await takeUsageSnapshot(ARGS as never);
    expect(r.ok).toBe(false);
    expect(mockInserts).toEqual([]);
  });

  it('control: a missing optional meter table (42P01) still snapshots with 0 tokens', async () => {
    mockScript['usage_meter_monthly:select'] = () => ({ data: null, error: { message: 'relation does not exist', code: '42P01' } });
    mockScript['usage_billing_snapshots:insert'] = () => ({ data: { id: 's1' }, error: null });
    const r = await takeUsageSnapshot(ARGS as never);
    expect(r).toMatchObject({ ok: true, snapshotId: 's1', llmInputTokens: 0 });
  });

  it('concurrent insert + failed re-fetch -> ok:false, never "success" with no id and this writer\'s totals', async () => {
    mockScript['usage_billing_snapshots:insert'] = () => ({ data: null, error: { message: 'duplicate key value', code: '23505' } });
    mockScript['usage_billing_snapshots:select'] = (n) => (n === 1 ? { data: null, error: null } : DOWN());
    const r = await takeUsageSnapshot(ARGS as never);
    expect(r.ok).toBe(false);
    expect(r.snapshotId).toBeUndefined();
  });
});

describe('wallet snapshot', () => {
  it('last-activity read error is best-effort: the snapshot still returns, and the failure is logged', async () => {
    mockScript['organization_credits:select'] = () => ({ data: { free_balance: 10, paid_balance: 0, incentive_balance: 0 }, error: null });
    mockScript['credit_transactions:select'] = DOWN;
    const w = await getBillingWalletSnapshot('o1');
    expect(w).toMatchObject({ freeBalance: 10 });
    expect(mockLogs).toContain('billing_wallet_last_activity_read_failed');
  });
});
