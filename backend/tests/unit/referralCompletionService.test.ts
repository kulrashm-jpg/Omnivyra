/**
 * CLASS 1 + 2 (2026-11-12): referral completion at company setup.
 *  - a referrer with >= 2 pending invites made the old maybeSingle lookup ERROR
 *    (read as "no referral") -> the referrer was never credited;
 *  - completion was by id only -> two signups both "completed" it;
 *  - (05) an uninvited signup must NEVER consume someone else's named invite:
 *    tiers = heal own completion / invite for this email / oldest code-only
 *    (invited_email IS NULL) row / nothing ('no_matching_invite').
 * The fake applies eq / is / order over rows with real created_at values and
 * returns copies; a race is injected after the read.
 */
export {};
type Row = Record<string, any>;
let mockRows: Row[] = [];
let mockReadErr = false;
let mockBetween: (() => void) | null = null;
/** Fire mockBetween after this many selects (heal read = 1, invite read = 2). */
let mockRaceAfter = 1;
let mockSelects = 0;
let mockGrantReason: string | undefined;
const mockGrants: string[] = [];

jest.mock('../../services/earnCreditsService', () => ({
  grantEarnCredit: async (a: { referenceId: string }) => {
    mockGrants.push(a.referenceId);
    return mockGrantReason ? { granted: false, credits: 0, reason: mockGrantReason } : { granted: true, credits: 200 };
  },
}));
import { completeSignupReferral } from '../../services/referralCompletionService';

function db() {
  return {
    from: () => {
      const filters: Array<(r: Row) => boolean> = [];
      let op = 'select'; let payload: Row = {}; let orderAsc: string | null = null; let lim = Infinity;
      const exec = async () => {
        if (op === 'select' && mockReadErr) return { data: null, error: { message: 'down' } };
        let hit = mockRows.filter((r) => filters.every((f) => f(r)));
        if (orderAsc) hit = [...hit].sort((x, y) => String(x[orderAsc!]).localeCompare(String(y[orderAsc!])));
        if (op === 'select') hit = hit.slice(0, lim); // a real LIMIT: a first-N window can miss the row
        if (op === 'select') { const c = hit.map((r) => ({ ...r })); mockSelects++; if (mockBetween && mockSelects === mockRaceAfter) { const f = mockBetween; mockBetween = null; f(); } return { data: c, error: null }; }
        for (const r of hit) Object.assign(r, payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      };
      const b: any = {
        select: () => b, limit: (n: number) => { lim = n; return b; },
        order: (c: string) => { orderAsc = c; return b; },
        update: (p: Row) => { op = 'update'; payload = p; return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
        then: (ok: any, ko: any) => exec().then(ok, ko),
      };
      return b;
    },
  } as never;
}
const row = (id: string, over: Row = {}): Row => ({ id, referral_code: 'abc', status: 'pending', referrer_user_id: 'u-ref', referrer_org_id: 'o-ref', invited_email: null, created_at: '2026-11-01T00:00:00Z', referee_user_id: null, ...over });
const ARGS = { refCode: 'ABC', userId: 'u-new', userEmail: 'Bob@X.com', companyId: 'c-new', now: '2026-11-12T00:00:00Z' };
const get = (id: string) => mockRows.find((x) => x.id === id)!;

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockRows = []; mockReadErr = false; mockBetween = null; mockRaceAfter = 1; mockSelects = 0; mockGrantReason = undefined; mockGrants.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('(a) the invite for THIS email is completed, even among 60 other pending invites (no first-N window)', async () => {
  mockRows = Array.from({ length: 60 }, (_, i) => row(`n${i}`, { invited_email: `p${i}@x.com` }));
  mockRows.push(row('bob', { invited_email: 'bob@x.com' }));
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toMatchObject({ status: 'completed', referralId: 'bob' });
  expect(get('bob')).toMatchObject({ status: 'completed', referee_user_id: 'u-new' });
  expect(mockRows.filter((x) => x.status === 'completed')).toHaveLength(1);
});

it('(b) an uninvited signup completes the OLDEST code-only row; named invites are untouched', async () => {
  mockRows = [
    row('alice', { invited_email: 'alice@x.com' }),
    row('shared-new', { created_at: '2026-11-05T00:00:00Z' }),
    row('shared-old', { created_at: '2026-11-02T00:00:00Z' }),
  ];
  const r = await completeSignupReferral({ db: db(), ...ARGS, userEmail: 'carol@x.com' });
  expect(r).toMatchObject({ status: 'completed', referralId: 'shared-old' });
  expect(get('alice').status).toBe('pending');
});

it('(c) an uninvited signup with ONLY named invites -> no_matching_invite; Alice\'s invite is NOT consumed', async () => {
  mockRows = [row('alice', { invited_email: 'alice@x.com' })];
  const r = await completeSignupReferral({ db: db(), ...ARGS, userEmail: 'carol@x.com' });
  expect(r).toEqual({ status: 'no_matching_invite' });
  expect(get('alice')).toMatchObject({ status: 'pending', referee_user_id: null });
  expect(mockGrants).toEqual([]);
});

it('(0) heal: a completion for THIS referee whose grant failed is re-granted (idempotent), nothing else touched', async () => {
  mockRows = [row('mine', { status: 'completed', referee_user_id: 'u-new' }), row('alice', { invited_email: 'alice@x.com' })];
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toMatchObject({ status: 'completed', referralId: 'mine' });
  expect(mockGrants).toEqual(['mine']);
  expect(get('alice').status).toBe('pending');
});

it('control: another user\'s completed row is NOT healed by this signup', async () => {
  mockRows = [row('theirs', { status: 'completed', referee_user_id: 'u-other' })];
  const r = await completeSignupReferral({ db: db(), ...ARGS, userEmail: 'carol@x.com' });
  expect(r).toEqual({ status: 'no_matching_invite' });
  expect(mockGrants).toEqual([]);
});

it('two signups racing on the same row: the loser does NOT overwrite the referee and does NOT grant', async () => {
  mockRows = [row('bob', { invited_email: 'bob@x.com' })];
  mockRaceAfter = 2; // after the INVITE read (the heal read is first)
  mockBetween = () => { Object.assign(get('bob'), { status: 'completed', referee_user_id: 'u-first' }); };
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toEqual({ status: 'lost_race', referralId: 'bob' });
  expect(get('bob').referee_user_id).toBe('u-first');
  expect(mockGrants).toEqual([]);
});

it('read error -> failed (logged), nothing written', async () => {
  mockRows = [row('bob', { invited_email: 'bob@x.com' })];
  mockReadErr = true;
  const r = await completeSignupReferral({ db: db(), ...ARGS });
  expect(r).toMatchObject({ status: 'failed', step: 'read' });
  expect(get('bob').status).toBe('pending');
});

it('control: self-referral is refused', async () => {
  mockRows = [row('shared')];
  const r = await completeSignupReferral({ db: db(), ...ARGS, userId: 'u-ref' });
  expect(r).toEqual({ status: 'self_referral' });
});
