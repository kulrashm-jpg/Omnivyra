/**
 * Unread-error sites (2026-11-12): billing forensics + ledger export. A
 * forensic trace or export missing a piece (ledger rows, approvals,
 * signatures, payments, audit events) would be presented as COMPLETE - and
 * believed in a dispute. Every read now throws on error.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockFail: string | null = null;
/** Fail ONE read: by table AND the column it filters on (eq / in). */
let mockFailAt: { table: string; col: string } | null = null;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      const cols: string[] = [];
      const failsHere = () => mockFail === table || (mockFailAt?.table === table && cols.includes(mockFailAt.col));
      const result = (): Res => (failsHere() ? { data: null, error: { message: 'down' } } : {
        data: table === 'billing_operations' ? [{ id: 'op1', idempotency_key: 'k1', correlation_id: 'c1', organization_id: 'o1', started_at: '2026-11-01T00:00:00Z' }]
          : table === 'credit_action_approvals' ? [{ id: 'a1' }]
          : table === 'job_execution_registry' ? [{ id: 'j1', billing_operation_id: 'op1', idempotency_key: 'k1' }] : [],
        error: null,
      });
      for (const m of ['select', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
      b.eq = (c: string) => { cols.push(c); return b; };
      b.in = (c: string) => { cols.push(c); return b; };
      b.maybeSingle = async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import { traceBillingOperation, investigateJobReplay } from '../../services/billing/exports/billingForensicsService';

beforeEach(() => { mockFail = null; mockFailAt = null; });

it.each(['credit_transactions', 'credit_action_approvals', 'credit_action_approval_signatures', 'admin_financial_audit_events', 'payment_transactions'])(
  'trace: %s read error THROWS (never a trace presented as complete)', async (table) => {
    mockFail = table;
    await expect(traceBillingOperation({ correlationId: 'c1' })).rejects.toThrow(/read failed/);
  });

it('control: clean reads produce a trace', async () => {
  const t = await traceBillingOperation({ correlationId: 'c1' });
  expect(t.billingOperations).toHaveLength(1);
});

// MUTANT SURVIVORS (2026-11-12): the ops read had no case; the financial audit
// table is read TWICE (by correlation_id and by ledger_idempotency_key) and the
// table-keyed fake failed both; the job-replay trace's billing-op and ledger
// reads had no case. Each now fails ALONE (table + filter column).
it('trace: billing_operations read error THROWS', async () => {
  mockFail = 'billing_operations';
  await expect(traceBillingOperation({ correlationId: 'c1' })).rejects.toThrow(/ops read failed/);
});
it.each(['correlation_id', 'ledger_idempotency_key'])('trace: the audit read by %s failing ALONE THROWS', async (col) => {
  mockFailAt = { table: 'admin_financial_audit_events', col };
  await expect(traceBillingOperation({ correlationId: 'c1' })).rejects.toThrow(/financial audit read failed/);
});
it('job replay: the billing-op read failing ALONE THROWS', async () => {
  mockFailAt = { table: 'billing_operations', col: 'id' };
  await expect(investigateJobReplay({ registryId: 'j1' } as never)).rejects.toThrow(/bo read failed/);
});
it('job replay: the ledger read failing ALONE THROWS', async () => {
  mockFailAt = { table: 'credit_transactions', col: 'idempotency_key' };
  await expect(investigateJobReplay({ registryId: 'j1' } as never)).rejects.toThrow(/l read failed/);
});
it('control: job replay with clean reads returns registry, op and ledger', async () => {
  const r = await investigateJobReplay({ registryId: 'j1' } as never);
  expect(r.registry).toMatchObject({ id: 'j1' });
});
