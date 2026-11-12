/**
 * MONEY class 2 (2026-11-12): admin grant / adjust keys.
 * grantAdminCreditExtension (without clientKey), consumptionAnalyticsService
 * grantCredits and adjustCredits keyed the ledger on a MINUTE bucket: a retry
 * after the minute rolled over granted twice, and two distinct grants inside
 * one minute collapsed into one while both reported success. They now key on
 * the REQUEST's Idempotency-Key (refused without one). The per-org velocity
 * count no longer fails open on a read error.
 *
 * Time is moved with jest's SYSTEM clock (it drives both Date.now and
 * `new Date()` - a Date.now spy alone would leave `new Date()`, which the old
 * minute bucket used, on the real clock and let the control pass falsely).
 */
export {};
const mockCreditKeys: string[] = [];
const mockExecKeys: string[] = [];
let mockCountErr = false;

jest.mock('../../services/creditExecutionService', () => ({
  createCredit: async (a: { idempotencyKey: string }) => { mockCreditKeys.push(a.idempotencyKey); },
  executeWithCredits: async (a: { idempotencyKey: string }) => { mockExecKeys.push(a.idempotencyKey); return { status: 'executed' }; },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));
function mockTable() {
  const b: any = {};
  for (const m of ['select', 'eq', 'gt', 'insert']) b[m] = () => b;
  b.then = (ok: any, ko: any) => Promise.resolve(mockCountErr ? { count: null, error: { message: 'down' } } : { count: 0, error: null }).then(ok, ko);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => mockTable() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => mockTable() } }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { grantAdminCreditExtension } from '../../services/creditAdminGrantService';
import { grantCredits, adjustCredits } from '../../services/consumptionAnalyticsService';

const T0 = Date.parse('2026-11-12T10:00:30Z');
const at = (ms: number) => jest.setSystemTime(ms);
beforeEach(() => {
  mockCreditKeys.length = 0; mockExecKeys.length = 0; mockCountErr = false;
  jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

const EXT = { organizationId: 'o1', credits: 10, reason: 'r', reasonType: 'goodwill' as const, actorUserId: 'a1' };

describe('grantAdminCreditExtension', () => {
  it('no clientKey and no request key -> IDEMPOTENCY_KEY_REQUIRED, nothing granted', async () => {
    await expect(grantAdminCreditExtension(EXT)).resolves.toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(mockCreditKeys).toEqual([]);
  });
  it('the SAME request retried in the NEXT minute forms the SAME ledger key', async () => {
    await grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-1' });
    at(T0 + 90_000);
    await grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-1' });
    expect(new Set(mockCreditKeys).size).toBe(1);
  });
  it('two DIFFERENT requests in the same minute form DIFFERENT keys (no collapse)', async () => {
    await grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-a' });
    await grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-b' });
    expect(new Set(mockCreditKeys).size).toBe(2);
  });
  it('velocity count read error -> GRANT_LIMIT_UNVERIFIABLE, nothing granted (never "0 recent")', async () => {
    mockCountErr = true;
    await expect(grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-1' })).resolves.toMatchObject({ ok: false, code: 'GRANT_LIMIT_UNVERIFIABLE' });
    expect(mockCreditKeys).toEqual([]);
  });
  it('control: allowOverLimit skips the count (escalation) and grants', async () => {
    mockCountErr = true;
    await expect(grantAdminCreditExtension({ ...EXT, requestIdempotencyKey: 'req-1', allowOverLimit: true })).resolves.toMatchObject({ ok: true });
  });
});

describe('consumptionAnalyticsService grantCredits / adjustCredits', () => {
  it('grantCredits: no request key -> refused, nothing granted', async () => {
    await expect(grantCredits({ organizationId: 'o1', credits: 5, performedBy: 'a1', requestIdempotencyKey: '' })).resolves.toMatchObject({ ok: false });
    expect(mockCreditKeys).toEqual([]);
  });
  it('grantCredits: same request in the next minute -> same key; a different request -> a new key', async () => {
    await grantCredits({ organizationId: 'o1', credits: 5, performedBy: 'a1', requestIdempotencyKey: 'r1' });
    at(T0 + 90_000);
    await grantCredits({ organizationId: 'o1', credits: 5, performedBy: 'a1', requestIdempotencyKey: 'r1' });
    await grantCredits({ organizationId: 'o1', credits: 5, performedBy: 'a1', requestIdempotencyKey: 'r2' });
    expect(mockCreditKeys[0]).toBe(mockCreditKeys[1]);
    expect(mockCreditKeys[2]).not.toBe(mockCreditKeys[0]);
  });
  it('adjustCredits (deduction): same request in the next minute -> same key', async () => {
    await adjustCredits({ organizationId: 'o1', credits: -5, note: 'n', performedBy: 'a1', requestIdempotencyKey: 'r1' });
    at(T0 + 90_000);
    await adjustCredits({ organizationId: 'o1', credits: -5, note: 'n', performedBy: 'a1', requestIdempotencyKey: 'r1' });
    expect(mockExecKeys).toHaveLength(2);
    expect(mockExecKeys[0]).toBe(mockExecKeys[1]);
  });
});
