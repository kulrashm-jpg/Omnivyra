/**
 * 05/e9 (2026-11-12) - the invariants every webhook retry (20270217000003) rests on.
 *  1. completePurchase's status CAS is CONDITIONAL on 'pending': a purchase already
 *     'completed' whose grant failed SKIPS the CAS and reaches the idempotent grant.
 *  2. createCredit treats ONLY a 23505 that NAMES the idempotency key as "already
 *     granted" - by SQLSTATE, never by message text (the old text match never fired).
 */
export {};

// ── 1. completePurchase over a fake credit_purchases table ──────────────────
type Row = Record<string, unknown>;
let mockPurchase: Row;
const mockWrites: Array<{ op: string; patch?: Row; filters: Row }> = [];
const mockCreateCredit = jest.fn(async () => undefined);
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const filters: Row = {};
    let op = 'select'; let patch: Row | undefined;
    const b: any = {
      select: () => b,
      update: (p: Row) => { op = 'update'; patch = p; return b; },
      eq: (c: string, v: unknown) => { filters[c] = v; return b; },
      maybeSingle: async () => {
        if (op === 'select') return { data: { ...mockPurchase }, error: null };
        mockWrites.push({ op, patch, filters: { ...filters } });
        const matches = Object.entries(filters).every(([k, v]) => mockPurchase[k] === v);
        if (matches && patch) Object.assign(mockPurchase, patch);
        return { data: matches ? { id: mockPurchase.id } : null, error: null };
      },
      then: (ok: any, ko: any) => {
        mockWrites.push({ op, patch, filters: { ...filters } });
        if (patch && Object.entries(filters).every(([k, v]) => mockPurchase[k] === v)) Object.assign(mockPurchase, patch);
        return Promise.resolve({ data: null, error: null }).then(ok, ko);
      },
    };
    return b;
  },
}));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: (...a: unknown[]) => mockCreateCredit(...(a as [])),
  makeIdempotencyKey: (o: string, t: string, i: string) => `${o}:${t}:${i}`,
}));
jest.mock('../../services/requestContext', () => ({ getRequestContext: () => ({}) }));

import { completePurchase } from '../../services/purchaseService';

const ORG = '00000000-0000-4000-8000-0000000000aa';
beforeEach(() => { mockWrites.length = 0; mockCreateCredit.mockClear(); });

it('a COMPLETED-but-ungranted purchase skips the status CAS and reaches the idempotent grant (retry works)', async () => {
  mockPurchase = { id: 'p1', organization_id: ORG, credits: 250, status: 'completed', fulfillment_status: 'failed', amount_paid: 10, currency: 'INR' };
  const r = await completePurchase('p1', 'pay_1');
  expect(mockCreateCredit).toHaveBeenCalledTimes(1);
  expect(mockWrites.some((w) => w.patch?.status === 'completed' && w.filters.status === 'pending')).toBe(false); // no CAS attempted
  expect(r).not.toMatchObject({ success: false, reason: 'already_completed' });
});

it('control: a PENDING purchase takes the CAS (pending -> completed) and then grants', async () => {
  mockPurchase = { id: 'p2', organization_id: ORG, credits: 250, status: 'pending', fulfillment_status: null, amount_paid: 10, currency: 'INR' };
  await completePurchase('p2', 'pay_2');
  expect(mockWrites.some((w) => w.patch?.status === 'completed' && w.filters.status === 'pending')).toBe(true);
  expect(mockCreateCredit).toHaveBeenCalledTimes(1);
});
