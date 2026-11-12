/**
 * CLASS 1 + 2 (2026-11-12): referral completion at company setup.
 *  - a referrer with >= 2 pending invites made the old maybeSingle lookup ERROR
 *    (read as "no referral") -> the referrer was never credited;
 *  - completion was by id only -> two signups both "completed" it and the
 *    second overwrote the referee (and both called the grant).
 * The fake applies eq filters and returns copies; a race is injected after
 * the read.
 */
export {};
type Row = Record<string, any>;
let mockRows: Row[] = [];
let mockReadErr = false;
let mockBetween: (() => void) | null = null;
const mockGrants: string[] = [];

jest.mock('../../services/earnCreditsService', () => ({
  grantEarnCredit: async (a: { referenceId: string }) => { mockGrants.push(a.referenceId); return { granted: true, credits: 200 }; },
}));
import { completeSignupReferral } from '../../services/referralCompletionService';

function db() {
  return {
    from: () => {
      const filters: Array<(r: Row) => boolean> = [];
      let op = 'select'; let payload: Row = {};
      const exec = async () => {
        if (op === 'select' && mockReadErr) return { data: null, error: { message: 'down' } };
        const hit = mockRows.filter((r) => filters.every((f) => f(r)));
        if (op === 'select') { const c = hit.map((r) => ({ ...r })); if (mockBetween) { const f = mockBetween; mockBetween = null; f(); } return { data: c, error: null }; }
        for (const r of hit) Object.assign(r, payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      };
      const b: any = {
        select: () => b, limit: () => b,
        update: (p: Row) => { op = 'update'; payload = p; return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        then: (ok: any, ko: any) => exec().then(ok, ko),
      };
      return b;
    },
  } as never;
}
const ARGS = { refCode: 'ABC', userId: 'u-new', userEmail: 'bob@x.com', companyId: 'c-new', now: '2026-11-12T00:00:00Z' };
beforeEach(() => {
  mockRows = [
    { id: 'r1', referral_code: 'abc', status: 'pending', referrer_user_id: 'u-ref', referrer_org_id: 'o-ref', invited_email: 'alice@x.com' },
    { id: 'r2', referral_code: 'abc', status: 'pending', referrer_user_id: 'u-ref', referrer_org_id: 'o-ref', invited_email: 'bob@x.com' },
  ];
  mockReadErr = false; mockBetween = null; mockGrants.length = 0;
});
let errSpy: jest.SpyInstance;
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => errSpy.mockRestore());

it('a referrer with TWO pending invites is still credited; the row for this email is the one completed', async () => {
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toMatchObject({ status: 'completed', referralId: 'r2', granted: true });
  expect(mockRows.find((x) => x.id === 'r2')).toMatchObject({ status: 'completed', referee_user_id: 'u-new' });
  expect(mockRows.find((x) => x.id === 'r1')!.status).toBe('pending');
  expect(mockGrants).toEqual(['r2']);
});

it('no invite for this email -> the first pending row (the old intent)', async () => {
  const r = await completeSignupReferral({ db: db(), ...ARGS, userEmail: 'carol@x.com' });
  expect(r).toMatchObject({ status: 'completed', referralId: 'r1' });
});

it('two signups racing on the same row: the loser does NOT overwrite the referee and does NOT grant', async () => {
  mockBetween = () => { const row = mockRows.find((x) => x.id === 'r2')!; Object.assign(row, { status: 'completed', referee_user_id: 'u-first' }); };
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toEqual({ status: 'lost_race', referralId: 'r2' });
  expect(mockRows.find((x) => x.id === 'r2')!.referee_user_id).toBe('u-first');
  expect(mockGrants).toEqual([]);
});

it('read error -> failed (logged), nothing written, never "no referral" silently', async () => {
  mockReadErr = true;
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toMatchObject({ status: 'failed', step: 'read' });
  expect(mockGrants).toEqual([]);
});

it('control: self-referral is refused', async () => {
  const r = await completeSignupReferral({ db: db(), ...ARGS, userId: 'u-ref' });
  expect(r).toEqual({ status: 'self_referral' });
  expect(mockGrants).toEqual([]);
});
