/**
 * MONEY unread-error sites (2026-11-12): the credit read primitives.
 *
 *  - creditDeductionService.wasRecentlyRun:214 (smart-mode dedup) - a failed
 *    read was "not recently run" and the action was charged again inside its
 *    dedup window. Now throws.
 *  - creditPriorityService.getWalletSnapshot:44 - a failed read was "no credit
 *    account"; every caller mislabelled an outage as a missing wallet. Throws.
 *  - creditRevoke:79 - a failed read was NO_WALLET (404); now WALLET_READ_FAILED
 *    (route -> 503), nothing revoked.
 *  - creditReadService:103 - a failed recent-transactions read was an empty
 *    history; now the summary is unavailable (null).
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockRpc: string[] = [];

function mockBuilder(table: string) {
  const b: any = {};
  const result = () => (mockScript[table] ?? (() => ({ data: null, error: null })))();
  for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = () => b;
  b.maybeSingle = async () => result();
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockBuilder(t), rpc: async (fn: string) => { mockRpc.push(fn); return { data: null, error: null }; } },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockBuilder(t) }));
jest.mock('../../services/creditProjectionReconciler', () => ({
  reconcileOrgCreditProjection: async () => ({ outcome: 'skipped_healthy' }),
  projectionIsBroken: () => false,
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async () => undefined }));

import { wasRecentlyRun } from '../../services/creditDeductionService';
import { getWalletSnapshot } from '../../services/creditPriorityService';
import { revokeCredit } from '../../services/creditRevoke';
import { getOrgCreditSummary } from '../../services/creditReadService';

const DOWN = () => ({ data: null, error: { message: 'down' } });
beforeEach(() => { mockScript = {}; mockRpc.length = 0; });

it('wasRecentlyRun: read error THROWS (never "not recently run" -> charged again)', async () => {
  mockScript.credit_transactions = DOWN;
  await expect(wasRecentlyRun('o1', 'campaign_chat', 3600)).rejects.toThrow(/dedup read failed/);
});
it('wasRecentlyRun control: a clean empty read is false', async () => {
  await expect(wasRecentlyRun('o1', 'campaign_chat', 3600)).resolves.toBe(false);
});

it('getWalletSnapshot: read error THROWS (never "no credit account")', async () => {
  mockScript.organization_credits = DOWN;
  await expect(getWalletSnapshot('o1')).rejects.toThrow(/wallet read failed/);
});
it('getWalletSnapshot control: a genuinely absent wallet is still null', async () => {
  await expect(getWalletSnapshot('o1')).resolves.toBeNull();
});

it('revokeCredit: wallet read error -> WALLET_READ_FAILED, nothing revoked (not NO_WALLET)', async () => {
  mockScript.organization_credits = DOWN;
  const r = await revokeCredit({ orgId: 'o1', category: 'free', amount: 10, reason: 'test', performedBy: 'admin', requestIdempotencyKey: 'req-1' } as never);
  expect(r).toMatchObject({ success: false, reason: 'WALLET_READ_FAILED' });
  expect(mockRpc).toEqual([]);
});

it('getOrgCreditSummary: recent-transactions read error -> unavailable (null), never an empty history', async () => {
  mockScript.organization_credits = () => ({ data: { free_balance: 10, paid_balance: 0, incentive_balance: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 }, error: null });
  mockScript.credit_transactions = DOWN;
  await expect(getOrgCreditSummary('o1')).resolves.toBeNull();
});
