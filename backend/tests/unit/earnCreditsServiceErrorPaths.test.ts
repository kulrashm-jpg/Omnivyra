/**
 * MONEY unread-error sites (2026-11-12): earnCreditsService.
 *  - grantEarnCredit idempotency read error -> NOT granted, nothing written
 *    (the refusal leaves nothing behind, so the next completion retries).
 *  - getEarnProgress / checkAndGrantSetupCredits read errors THROW (never
 *    "nothing earned" / "steps not done").
 *  - notifyEarnProgress check error -> no nudge (never nudge for credits that
 *    may already be earned).
 *  - post-grant record / notification writes are best-effort, logged.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null; count?: number };
let mockScript: Record<string, () => Res> = {};
const mockWrites: string[] = [];
const mockGrants: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let op = 'select';
    const b: any = {};
    const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.insert = () => { op = 'insert'; mockWrites.push(table); return b; };
    b.maybeSingle = async () => result();
    b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  },
}));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: async (a: { referenceType: string }) => { mockGrants.push(a.referenceType); },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));

import { grantEarnCredit, getEarnProgress, checkAndGrantSetupCredits, notifyEarnProgress } from '../../services/earnCreditsService';

const DOWN = () => ({ data: null, error: { message: 'down' } });
let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockScript = { 'user_company_roles:select': () => ({ data: [{ user_id: 'admin1' }], error: null }) };
  mockWrites.length = 0; mockGrants.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('grant: idempotency read error -> NOT granted, nothing written', async () => {
  mockScript['earn_credit_actions:select'] = DOWN;
  const r = await grantEarnCredit({ orgId: 'o1', userId: 'u1', actionType: 'setup_complete' });
  expect(r).toEqual({ granted: false, credits: 0, reason: 'read_failed' });
  expect(mockGrants).toEqual([]);
  expect(mockWrites).toEqual([]);
});

it('grant control: a clean first grant credits, records and notifies', async () => {
  const r = await grantEarnCredit({ orgId: 'o1', userId: 'u1', actionType: 'setup_complete' });
  expect(r.granted).toBe(true);
  expect(mockGrants).toEqual(['setup_complete']);
  expect(mockWrites).toEqual(['earn_credit_actions', 'notifications']);
});

it('grant: record write fails -> still granted (ledger), failure logged', async () => {
  mockScript['earn_credit_actions:insert'] = DOWN;
  const r = await grantEarnCredit({ orgId: 'o1', userId: 'u1', actionType: 'setup_complete' });
  expect(r.granted).toBe(true);
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('earn action record write failed'))).toBe(true);
});

it('progress: read error THROWS (never "nothing earned")', async () => {
  mockScript['earn_credit_actions:select'] = DOWN;
  await expect(getEarnProgress('o1')).rejects.toThrow(/earn progress read failed/);
});

it.each(['company_setup_progress', 'social_accounts'])('setup grant check: %s read error THROWS (never "steps not done")', async (table) => {
  mockScript[table + ':select'] = DOWN;
  await expect(checkAndGrantSetupCredits('o1', 'u1')).rejects.toThrow(/read failed|count failed/);
  expect(mockGrants).toEqual([]);
});

it('nudge: check read error -> NO nudge sent', async () => {
  mockScript['earn_credit_actions:select'] = DOWN;
  await notifyEarnProgress({ orgId: 'o1', actionType: 'setup_complete', message: 'm' });
  expect(mockWrites).toEqual([]);
});

// 05 (2026-11-12): a concurrent grant of the same (org, action, reference) wins
// the earn_credit_actions UNIQUE; the loser's record insert gets 23505. That is
// the authoritative "already granted": no second notice, no credits reported.
it('grant: record insert hits the UNIQUE (concurrent winner) -> already_granted, NO second notification', async () => {
  mockScript['earn_credit_actions:insert'] = () => ({ data: null, error: { message: 'duplicate key value', code: '23505' } as any });
  const r = await grantEarnCredit({ orgId: 'o1', userId: 'u1', actionType: 'setup_complete' });
  expect(r).toEqual({ granted: false, credits: 0, reason: 'already_granted' });
  expect(mockWrites).toEqual(['earn_credit_actions']);
});

// MUTANT SURVIVORS (2026-11-12): the two notification writes (nudge, granted)
// log their OWN events; neither had a case.
it('nudge: notification write error -> logged as a nudge failure', async () => {
  mockScript['notifications:insert'] = DOWN;
  await notifyEarnProgress({ orgId: 'o1', actionType: 'setup_complete', message: 'm' });
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('nudge notification write failed'))).toBe(true);
});
it('grant: "you earned" notification write error -> still granted, logged as a granted-notice failure', async () => {
  mockScript['notifications:insert'] = DOWN;
  const r = await grantEarnCredit({ orgId: 'o1', userId: 'u1', actionType: 'setup_complete' });
  expect(r.granted).toBe(true);
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('granted notification write failed'))).toBe(true);
});
