/**
 * CLASS 2 (2026-11-12): applySettlementTransition updated the session by
 * idempotency_key only - the expiry sweeper and a `succeeded` webhook both
 * decided from 'pending' and the last writer won. With fromStatus it is a CAS.
 * The fake applies eq/is filters to a stored row.
 */
export {};
type Row = Record<string, any>;
let mockRow: Row = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const filters: Array<(r: Row) => boolean> = [];
      let payload: Row = {};
      const b: any = {
        update: (p: Row) => { payload = p; return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
        select: async () => {
          if (!filters.every((f) => f(mockRow))) return { data: [], error: null };
          Object.assign(mockRow, payload);
          return { data: [{ idempotency_key: mockRow.idempotency_key }], error: null };
        },
      };
      return b;
    },
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));
import { applySettlementTransition } from '../../services/billing/payments/checkoutSessionStore';

const T = { idempotencyKey: 'k1', providerRawStatus: 'x', settledAt: null };
beforeEach(() => { mockRow = { idempotency_key: 'k1', settlement_status: 'pending' }; });

it('control: from matches -> applied', async () => {
  await expect(applySettlementTransition({ ...T, settlementStatus: 'expired', fromStatus: 'pending' })).resolves.toEqual({ applied: true });
  expect(mockRow.settlement_status).toBe('expired');
});
it('the session moved (succeeded) -> state_changed, NOT regressed to expired', async () => {
  mockRow.settlement_status = 'succeeded';
  await expect(applySettlementTransition({ ...T, settlementStatus: 'expired', fromStatus: 'pending' })).resolves.toEqual({ applied: false, reason: 'state_changed' });
  expect(mockRow.settlement_status).toBe('succeeded');
});
it('a NULL status is matched with IS NULL', async () => {
  mockRow.settlement_status = null;
  await expect(applySettlementTransition({ ...T, settlementStatus: 'pending', fromStatus: null })).resolves.toEqual({ applied: true });
});

it('a missing column is NOT silent: reason schema_missing, logged once (05)', async () => {
  const { logger } = jest.requireMock('../../services/logger');
  const sb = jest.requireMock('../../db/supabaseClient').supabase;
  const orig = sb.from;
  sb.from = () => { const b: any = { update: () => b, eq: () => b, is: () => b, select: async () => ({ data: null, error: { message: 'column "settlement_status" does not exist' } }) }; return b; };
  try {
    await expect(applySettlementTransition({ ...T, settlementStatus: 'expired', fromStatus: 'pending' })).resolves.toEqual({ applied: false, reason: 'schema_missing' });
    await applySettlementTransition({ ...T, settlementStatus: 'expired', fromStatus: 'pending' });
    expect((logger.warn as jest.Mock).mock.calls.filter((c) => c[0] === 'settlement_transition_column_missing')).toHaveLength(1);
  } finally { sb.from = orig; }
});
