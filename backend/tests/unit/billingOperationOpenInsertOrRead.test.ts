/**
 * BLOCKING money fix (e1, 2026-11-12; 6f finding, reproduced on the real schema).
 * openBillingOperation used ON CONFLICT DO UPDATE on idempotency_key, so re-opening a key rewrote the row (new id,
 * organization moved, confirmed -> initiated, metadata incl. ai_result wiped). closeBillingOperation then NULLed
 * fields it was not given. Pinned here with a faithful fake (unique key -> 23505; every filter applied):
 *   - a same-organization retry reuses the row UNTOUCHED (id, status, amount_charged, metadata);
 *   - a key held by ANOTHER organization is refused and that row is untouched;
 *   - a full runBilledOperation retry over a confirmed row leaves it confirmed with its amount;
 *   - close never rewrites a final row; it writes only the fields supplied.
 */
export {};
type Row = Record<string, any>;
const mockRows: Row[] = [];
function mockTable(table: string) {
  if (table !== 'billing_operations') throw new Error(`unexpected table ${table}`);
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: Row = {}; let one = false; let upsertOpts: Row = {};
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    not: (c: string, operator: string, v: string) => {
      if (operator !== 'in') throw new Error('fake supports not.in only');
      const set = v.replace(/^\(|\)$/g, '').split(',');
      tests.push((r) => !set.includes(r[c])); return b;
    },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    // FAITHFUL upsert (what the old code emitted): ON CONFLICT (idempotency_key) DO UPDATE SET every supplied column
    upsert: (p: Row, o: Row = {}) => { op = 'upsert'; payload = p; upsertOpts = o; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const done = (data: unknown, error: unknown = null) => Promise.resolve({ data, error }).then(ok, ko);
      if (op === 'insert') {
        if (mockRows.some((r) => r.idempotency_key === payload.idempotency_key)) {
          return done(null, { code: '23505', message: 'duplicate key value violates unique constraint' });
        }
        mockRows.push({ amount_charged: null, ...payload });
        return done(one ? { id: payload.id } : [{ id: payload.id }]);
      }
      if (op === 'upsert') {
        const existing = mockRows.find((r) => r.idempotency_key === payload.idempotency_key);
        if (!existing) { mockRows.push({ amount_charged: null, ...payload }); return done({ id: payload.id }); }
        if (upsertOpts.ignoreDuplicates) return done(null);
        Object.assign(existing, payload);
        return done({ id: existing.id });
      }
      const hit = mockRows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); return done(null); }
      if (one && hit.length > 1) return done(null, { code: 'PGRST116' });
      return done(one ? hit[0] ?? null : hit);
    },
  };
  return b;
}
const mockExecute = jest.fn();
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/creditExecutionService', () => ({
  ...jest.requireActual('../../services/creditExecutionService'),
  executeWithCredits: (a: unknown) => mockExecute(a),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const orch = require('../../services/billing/enterpriseBillingOrchestrator');
/* eslint-enable @typescript-eslint/no-var-requires */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const open = (org: string, metadata: Row = {}) => orch.openBillingOperation({
  correlationId: 'c', module: 'ai', action: 'act', organizationId: org, actorUserId: 'user-1',
  idempotencyKey: 'K', amountEstimated: null, metadata,
});
const settle = (id: string) => Object.assign(mockRows.find((r) => r.id === id)!, {
  status: 'confirmed', amount_charged: 5, metadata: { ai_result: { v: 1 } },
});
beforeEach(() => { mockRows.length = 0; mockExecute.mockReset(); });

it('a same-organization retry REUSES the settled row untouched (id, status, amount, metadata)', async () => {
  const id = await open(A, { ai_result: { v: 1 } });
  settle(id);
  const before = JSON.stringify(mockRows);
  const again = await open(A);
  expect(again).toBe(id);
  expect(JSON.stringify(mockRows)).toBe(before);
});

it("a key held by ANOTHER organization is refused and A's row (and its stored result) is untouched", async () => {
  const id = await open(A);
  settle(id);
  const before = JSON.stringify(mockRows);
  await expect(open(B)).rejects.toMatchObject({ code: 'BILLING_OPERATION_KEY_CONFLICT' });
  expect(JSON.stringify(mockRows)).toBe(before);
  expect(mockRows).toHaveLength(1);
  expect(mockRows[0]).toMatchObject({ id, organization_id: A, status: 'confirmed', amount_charged: 5 });
});

it('close never rewrites a FINAL row (confirmed / released / duplicate)', async () => {
  for (const status of ['confirmed', 'released', 'duplicate']) {
    mockRows.length = 0;
    const id = await open(A);
    Object.assign(mockRows[0], { status, amount_charged: 5, failure_reason: null });
    await orch.closeBillingOperation(id, { status: 'error', failureReason: 'retry blew up' });
    expect([status, mockRows[0].status, mockRows[0].amount_charged, mockRows[0].failure_reason]).toEqual([status, status, 5, null]);
  }
});

it('close writes only the supplied fields (an initiated row is settled; nothing else is NULLed)', async () => {
  const id = await open(A);
  Object.assign(mockRows[0], { reservation_txn_id: 'hold-1' });
  await orch.closeBillingOperation(id, { status: 'confirmed', amountCharged: 7 });
  expect(mockRows[0]).toMatchObject({ status: 'confirmed', amount_charged: 7, reservation_txn_id: 'hold-1' });
});

it('an errored row stays recoverable: a later close may settle it', async () => {
  const id = await open(A);
  Object.assign(mockRows[0], { status: 'error' });
  await orch.closeBillingOperation(id, { status: 'confirmed', amountCharged: 3 });
  expect(mockRows[0]).toMatchObject({ status: 'confirmed', amount_charged: 3 });
});

it('a full runBilledOperation RETRY over a confirmed operation leaves it confirmed, charged and with its metadata', async () => {
  mockExecute.mockResolvedValueOnce({ status: 'executed', settlement: { creditsCharged: 5 }, data: 'r1' });
  const args = {
    module: 'ai', action: 'act', userId: 'user-1', orgId: A, referenceType: 'x', referenceId: 'ref-1',
    idempotency: { kind: 'queue', queueName: 'q', jobId: 'job-1' }, metadata: { ai_result: { v: 1 } },
    executor: async () => 'r1',
  };
  const first = await orch.runBilledOperation(args);
  expect(mockRows[0]).toMatchObject({ id: first.operationId, status: 'confirmed', amount_charged: 5 });
  mockExecute.mockResolvedValueOnce({ status: 'already_confirmed', data: 'r1' });
  const retry = await orch.runBilledOperation({ ...args, metadata: {} });
  expect(retry.operationId).toBe(first.operationId);
  expect(mockRows).toHaveLength(1);
  expect(mockRows[0]).toMatchObject({ id: first.operationId, organization_id: A, status: 'confirmed', amount_charged: 5, metadata: { ai_result: { v: 1 } } });
});
