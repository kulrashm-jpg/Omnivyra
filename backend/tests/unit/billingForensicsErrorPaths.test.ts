/**
 * Unread-error sites (2026-11-12): billing forensics + ledger export. A
 * forensic trace or export missing a piece (ledger rows, approvals,
 * signatures, payments, audit events) would be presented as COMPLETE - and
 * believed in a dispute. Every read now throws on error.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockFail: string | null = null;
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      const result = (): Res => (mockFail === table ? { data: null, error: { message: 'down' } } : {
        data: table === 'billing_operations' ? [{ id: 'op1', idempotency_key: 'k1', correlation_id: 'c1', organization_id: 'o1', started_at: '2026-11-01T00:00:00Z' }]
          : table === 'credit_action_approvals' ? [{ id: 'a1' }] : [],
        error: null,
      });
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import { traceBillingOperation } from '../../services/billing/exports/billingForensicsService';

beforeEach(() => { mockFail = null; });

it.each(['credit_transactions', 'credit_action_approvals', 'credit_action_approval_signatures', 'admin_financial_audit_events', 'payment_transactions'])(
  'trace: %s read error THROWS (never a trace presented as complete)', async (table) => {
    mockFail = table;
    await expect(traceBillingOperation({ correlationId: 'c1' })).rejects.toThrow(/read failed/);
  });

it('control: clean reads produce a trace', async () => {
  const t = await traceBillingOperation({ correlationId: 'c1' });
  expect(t.billingOperations).toHaveLength(1);
});
