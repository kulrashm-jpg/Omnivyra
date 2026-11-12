/**
 * S2 tenant seam (e1, 2026-11-12) - creditApprovalService. Approval rows belong to the organization they act on.
 * FINDING fixed here: proposeApproval upserted on client_request_id (unique across ALL organizations), so a retried
 * request OVERWROTE the existing approval (new id, status / approvals_received recomputed) and a colliding key could
 * rewrite another organization's approval. Now: insert; a duplicate key replays the SAME organization's original and
 * is refused otherwise. execute / inspect read under the approval's own organization; the expiry sweep is the one
 * allow-listed cross-tenant write (credit-approval-expiry-sweep).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; filters: Array<[string, unknown]>; row?: Row }> = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; const filters: Array<[string, unknown]> = [];
  let one = false; let op = 'select'; let payload: Row = {}; let returning = false;
  const b: any = {
    select: () => { returning = true; return b; },
    eq: (c: string, v: unknown) => { filters.push([c, v]); tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filters.push([c, v]); tests.push((r) => v.includes(r[c])); return b; },
    lt: (c: string, v: any) => { filters.push([c, v]); tests.push((r) => r[c] < v); return b; },
    is: (c: string, v: unknown) => { filters.push([c, v]); tests.push((r) => (r[c] ?? null) === v); return b; },
    or: () => b, order: () => b, limit: () => b,
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    upsert: () => { throw new Error('approval writes must not upsert'); },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      const done = (data: unknown, error: unknown = null) => Promise.resolve({ data, error }).then(ok, ko);
      if (op === 'insert') {
        if (table === 'credit_action_approvals' && payload.client_request_id
          && rows.some((r) => r.client_request_id === payload.client_request_id)) {
          return done(null, { code: '23505', message: 'duplicate key value violates unique constraint "idx_caa_client_request_unique"' });
        }
        rows.push({ ...payload }); mockWrites.push({ table, op, filters, row: payload });
        return done(one ? { ...payload } : [{ ...payload }]);
      }
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, payload)); mockWrites.push({ table, op, filters, row: payload });
        return done(returning ? hit.map((r) => ({ id: r.id })) : null);
      }
      if (one && hit.length > 1) return done(null, { code: 'PGRST116' });
      return done(one ? hit[0] ?? null : hit);
    },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t), rpc: async () => ({ data: 2, error: null }) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn(), emitFinancialAudit: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/billing/billingCorrelationService', () => ({ getBillingCorrelation: () => ({ correlationId: 'c' }) }));
/* eslint-disable @typescript-eslint/no-var-requires */
const svc = require('../../services/billing/creditApprovalService');
/* eslint-enable @typescript-eslint/no-var-requires */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const propose = (org: string, key: string) => svc.proposeApproval({
  actionType: 'admin_grant', proposedBy: 'admin-1', clientRequestId: key,
  payload: { organizationId: org, reason: 'goodwill', amountCredits: 100 },
});
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0;
});

it('a retried request REPLAYS the original approval - it never overwrites it', async () => {
  const first = await propose(A, 'req-1');
  expect(first).toMatchObject({ ok: true, status: 'pending' });
  // a signature has landed on the original
  mockDb.credit_action_approvals[0].approvals_received = 1;
  const retry = await propose(A, 'req-1');
  expect(retry).toMatchObject({ ok: true, approvalId: first.approvalId, status: 'pending' });
  expect(mockDb.credit_action_approvals).toHaveLength(1);
  expect(mockDb.credit_action_approvals[0]).toMatchObject({ id: first.approvalId, approvals_received: 1, organization_id: A });
});

it("a key already used by ANOTHER organization is refused - B's approval is untouched", async () => {
  const b = await propose(B, 'req-shared');
  const a = await propose(A, 'req-shared');
  expect(a).toMatchObject({ ok: false, code: 'CLIENT_REQUEST_CONFLICT' });
  expect(mockDb.credit_action_approvals).toHaveLength(1);
  expect(mockDb.credit_action_approvals[0]).toMatchObject({ id: b.approvalId, organization_id: B });
});

it('execute and inspect act under the approval’s OWN organization only', async () => {
  const b = await propose(B, 'req-b');
  mockDb.credit_action_approvals[0].status = 'approved';
  mockDb.credit_action_approval_signatures = [
    { id: 's1', approval_id: b.approvalId, signed_at: '1' },
    { id: 's2', approval_id: 'other-approval', signed_at: '2' },
  ];
  const details = await svc.getApprovalDetails(b.approvalId);
  expect(details.approval).toMatchObject({ id: b.approvalId, organization_id: B });
  expect(details.signatures.map((s: Row) => s.id)).toEqual(['s1']);
  const done = await svc.markApprovalExecuted({ approvalId: b.approvalId, executedIdempotencyKey: 'k', actorUserId: 'admin-2' });
  expect(done).toEqual({ ok: true });
  const upd = mockWrites.find((w) => w.table === 'credit_action_approvals' && w.op === 'update');
  expect(upd!.filters).toEqual(expect.arrayContaining([['organization_id', B], ['id', b.approvalId]]));
  expect(await svc.getApprovalDetails('missing-id')).toEqual({ approval: null, signatures: [] });
});

it('the expiry sweep only expires pending rows past expires_at', async () => {
  const past = new Date(Date.now() - 86400_000).toISOString();
  const future = new Date(Date.now() + 86400_000).toISOString();
  mockDb.credit_action_approvals = [
    { id: 'p-old', organization_id: A, status: 'pending', expires_at: past },
    { id: 'p-new', organization_id: B, status: 'pending', expires_at: future },
    { id: 'a-old', organization_id: B, status: 'approved', expires_at: past },
  ];
  const r = await svc.expirePendingApprovals();
  expect(r.expired).toBe(1);
  expect(mockDb.credit_action_approvals.map((x) => [x.id, x.status])).toEqual([['p-old', 'expired'], ['p-new', 'pending'], ['a-old', 'approved']]);
});
