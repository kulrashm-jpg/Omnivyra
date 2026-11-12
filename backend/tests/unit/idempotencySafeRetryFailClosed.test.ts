/**
 * BLOCKING money fix (e1, 2026-11-12; e9 trace of the safe-retry / recover path).
 * safeRetryOperation and checkFinancialDrift ignored their read errors: an errored settlement read was "no CONFIRM"
 * and an errored HOLD read was "no HOLD", so safe-retry minted a FRESH idempotency key for an operation the ledger
 * had already confirmed - the operator's re-run would then charge a second time. Every safety read now fails closed.
 * Controls: with clean reads the same flow still proceeds (a fresh key is issued for a genuinely stuck op).
 */
export {};
type Step = 'key' | 'settled' | 'hold' | 'sibling';
let mockFail: Step | null = null;
const mockUpdates: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let step: Step | null = null;
      const chain: any = {
        select: () => chain, lt: () => chain, order: () => chain,
        eq: (c: string, v: string) => {
          if (table === 'credit_transactions' && c === 'idempotency_key' && String(v).endsWith(':hold')) step = 'hold';
          if (table === 'credit_transactions' && c === 'parent_transaction_id') step = 'sibling';
          return chain;
        },
        in: (c: string) => { if (table === 'credit_transactions' && c === 'idempotency_key') step = 'settled'; return chain; },
        limit: () => {
          if (mockFail === step) return Promise.resolve({ data: null, error: { message: `transient ${step} read failure` } });
          if (step === 'hold') return Promise.resolve({ data: [{ id: 'hold-1' }], error: null });
          if (step === 'sibling') return Promise.resolve({ data: [{ id: 'c1', execution_phase: 'confirm' }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: () => {
          if (mockFail === 'key') return Promise.resolve({ data: null, error: { message: 'transient key read failure' } });
          return Promise.resolve({ data: { idempotency_key: 'key-x', status: 'initiated', organization_id: 'org-1' }, error: null });
        },
        update: () => ({ eq: () => { mockUpdates.push(table); return Promise.resolve({ error: null }); } }),
      };
      return chain;
    },
    rpc: jest.fn(),
  },
}));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn().mockResolvedValue(undefined) }));
/* eslint-disable @typescript-eslint/no-var-requires */
const { safeRetryOperation, checkFinancialDrift } = require('../../services/billing/idempotency/idempotencyRecoveryService');
/* eslint-enable @typescript-eslint/no-var-requires */
const retry = () => safeRetryOperation({ surface: 'billing_operations', id: 'op-1', actorUserId: 'admin', reason: 'stuck' });
beforeEach(() => { mockFail = null; mockUpdates.length = 0; });

it('control: clean reads on a genuinely stuck op -> a fresh key is issued (the flow still works)', async () => {
  const r = await retry();
  expect(r).toMatchObject({ ok: true });
  expect(mockUpdates).toEqual(['billing_operations']);
});

for (const step of ['key', 'settled', 'hold', 'sibling'] as const) {
  it(`a transient ${step} read error REFUSES the retry and writes nothing (no fresh key)`, async () => {
    mockFail = step;
    const r = await retry();
    expect(r.ok).toBe(false);
    expect((r as any).newIdempotencyKey).toBeUndefined();
    expect(mockUpdates).toEqual([]);
  });
}

it('checkFinancialDrift reports drift (never "ok") on any read error', async () => {
  for (const step of ['key', 'hold', 'sibling'] as const) {
    mockFail = step;
    expect([step, await checkFinancialDrift('billing_operations', 'op-1')]).toEqual([step, 'drift_detected']);
  }
  mockFail = null;
  expect(await checkFinancialDrift('billing_operations', 'op-1')).toBe('ok');
});
