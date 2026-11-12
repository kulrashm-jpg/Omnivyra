/**
 * MONEY class 2 (2026-11-12): revokeCredit built its idempotency key from
 * `drain` = min(amount, balance READ). A retry after a successful revoke read a
 * LOWER balance -> a different drain -> a different key -> a SECOND revoke.
 * Without an original-grant key it used a 60 s time bucket instead (a retry
 * after the bucket rolled revoked again; two distinct revokes in one minute
 * collapsed while both reported success).
 * Now: the key comes from the REQUEST (grant key + requested amount, or the
 * request's Idempotency-Key), a grant already revoked in that category is
 * detected by BUSINESS IDENTITY (any key format, incl. the old drain-embedding
 * one), and with neither key the revoke is refused.
 *
 * The ledger fake applies eq + like over stored rows, so the prior-revoke
 * check is answered by WHICH rows exist, not by a canned reply.
 */
export {};
type Row = Record<string, any>;
let mockWallet: Row | null = { free_balance: 100, incentive_balance: 0 };
let mockLedger: Row[] = [];
let mockFailLedgerRead = false;
const mockRpcKeys: string[] = [];

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const b: any = {
    select: () => b,
    limit: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    like: (c: string, pattern: string) => {
      const re = new RegExp('^' + pattern.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      filters.push((r) => re.test(String(r[c] ?? '')));
      return b;
    },
    maybeSingle: async () => (table === 'organization_credits' ? { data: mockWallet ? { ...mockWallet } : null, error: null } : { data: null, error: null }),
    then: (ok: any, ko: any) => {
      const r = table === 'credit_transactions'
        ? (mockFailLedgerRead ? { data: null, error: { message: 'down' } } : { data: mockLedger.filter((x) => filters.every((f) => f(x))).map((x) => ({ ...x })), error: null })
        : { data: [], error: null };
      return Promise.resolve(r).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockQuery(t) }));
jest.mock('../../repositories/creditExecutionRepository', () => ({
  callCreditReservation: async (c: { orgId: string; idempotencyKey: string; split: { free: number } }) => {
    mockRpcKeys.push(c.idempotencyKey);
    // the ledger: a duplicate key is a no-op; a new key drains the wallet
    if (!mockLedger.some((r) => r.idempotency_key === c.idempotencyKey)) {
      mockLedger.push({ id: `t${mockLedger.length + 1}`, organization_id: c.orgId, reference_type: 'credit_revoke', idempotency_key: c.idempotencyKey });
      if (mockWallet) mockWallet.free_balance -= c.split.free;
    }
    return { error: null, transactionId: `t${mockLedger.length}` };
  },
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async () => undefined }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { revokeCredit } from '../../services/creditRevoke';

const BASE = { orgId: 'o1', category: 'free' as const, performedBy: 'admin', reason: 'test' };
beforeEach(() => { mockWallet = { free_balance: 100, incentive_balance: 0 }; mockLedger = []; mockFailLedgerRead = false; mockRpcKeys.length = 0; });

it('no grant key and no request key -> refused (IDEMPOTENCY_KEY_REQUIRED), nothing revoked', async () => {
  await expect(revokeCredit({ ...BASE, amount: 60 })).resolves.toMatchObject({ success: false, reason: 'IDEMPOTENCY_KEY_REQUIRED' });
  expect(mockRpcKeys).toEqual([]);
  expect(mockWallet!.free_balance).toBe(100);
});

it('request key: a RETRY after success (balance now lower) uses the SAME key -> revoked ONCE', async () => {
  mockWallet!.free_balance = 80;
  await revokeCredit({ ...BASE, amount: 60, requestIdempotencyKey: 'req-1' });
  await revokeCredit({ ...BASE, amount: 60, requestIdempotencyKey: 'req-1' });
  expect(new Set(mockRpcKeys).size).toBe(1);
  expect(mockWallet!.free_balance).toBe(20);
});

it('grant key: a RETRY after a partial drain is detected as already revoked -> nothing more drained', async () => {
  mockWallet!.free_balance = 40; // drain = 40 < requested 60
  const first = await revokeCredit({ ...BASE, amount: 60, originalGrantIdempotencyKey: 'grant-1' });
  expect(first).toMatchObject({ success: true, revoked: 40 });
  mockWallet!.free_balance = 30; // new credits arrived meanwhile
  const retry = await revokeCredit({ ...BASE, amount: 60, originalGrantIdempotencyKey: 'grant-1' });
  expect(retry).toMatchObject({ success: true, revoked: 0, alreadyRevoked: true });
  expect(mockWallet!.free_balance).toBe(30);
});

it('grant key: a revoke written under the OLD drain-embedding key format is honoured', async () => {
  mockLedger.push({ id: 'old', organization_id: 'o1', reference_type: 'credit_revoke', idempotency_key: 'grant-1:revoke:free:37' });
  const r = await revokeCredit({ ...BASE, amount: 60, originalGrantIdempotencyKey: 'grant-1' });
  expect(r).toMatchObject({ success: true, revoked: 0, alreadyRevoked: true, transactionId: 'old' });
  expect(mockRpcKeys).toEqual([]);
});

it('grant key: a revoke of a DIFFERENT grant or category does not block this one', async () => {
  mockLedger.push({ id: 'x', organization_id: 'o1', reference_type: 'credit_revoke', idempotency_key: 'grant-2:revoke:free:60' });
  mockLedger.push({ id: 'y', organization_id: 'o1', reference_type: 'credit_revoke', idempotency_key: 'grant-1:revoke:incentive:60' });
  const r = await revokeCredit({ ...BASE, amount: 60, originalGrantIdempotencyKey: 'grant-1' });
  expect(r).toMatchObject({ success: true, revoked: 60 });
});

it('prior-revoke read error -> refused (PRIOR_REVOKE_READ_FAILED), nothing revoked', async () => {
  mockFailLedgerRead = true;
  await expect(revokeCredit({ ...BASE, amount: 60, originalGrantIdempotencyKey: 'grant-1' })).resolves.toMatchObject({ success: false, reason: 'PRIOR_REVOKE_READ_FAILED' });
  expect(mockRpcKeys).toEqual([]);
});

it('two DISTINCT requests (different request keys) are two revokes (no time-bucket collapse)', async () => {
  await revokeCredit({ ...BASE, amount: 10, requestIdempotencyKey: 'req-a' });
  await revokeCredit({ ...BASE, amount: 10, requestIdempotencyKey: 'req-b' });
  expect(mockWallet!.free_balance).toBe(80);
});
