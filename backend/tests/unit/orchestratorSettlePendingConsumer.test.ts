/**
 * 05/e9: the settle-ambiguity marker must not be write-only. The enterprise billing orchestrator - the in-process
 * consumer that records each billed operation's outcome - reads it: an execution whose settle outcome is unknown is
 * closed as 'executed' (the table's "work completed" state, 20260663 CHECK) with reason settle_pending:<state> and NO
 * charged amount; it is never recorded as 'confirmed'.
 */
const updates: Array<Record<string, unknown>> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
    }),
  },
}));
const counters: string[] = [];
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: (n: string) => { counters.push(n); } }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn() }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { reconcileBillingOperationToResult } from '../../services/billing/enterpriseBillingOrchestrator';

beforeEach(() => { updates.length = 0; counters.length = 0; });

it('an execution with settlementPending is closed as executed / settle_pending, with NO charged amount', async () => {
  await reconcileBillingOperationToResult('op-1', {
    status: 'executed',
    result: 'x',
    settlementPending: { code: 'CREDIT_SETTLE_AMBIGUOUS', holdId: 'h', state: 'open', detail: 'd' },
  } as never);
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ status: 'executed', amount_charged: null, failure_reason: 'settle_pending:open' });
  expect(counters).toEqual(['billing_operations_settle_pending']);
});

it('control: a settled execution is still closed as confirmed with its charged amount', async () => {
  await reconcileBillingOperationToResult('op-2', {
    status: 'executed',
    result: 'x',
    settlement: { creditsCharged: 4, creditsReleased: 6, underfunded: false },
  } as never);
  expect(updates[0]).toMatchObject({ status: 'confirmed', amount_charged: 4 });
  expect(counters).toEqual(['billing_operations_confirmed']);
});
