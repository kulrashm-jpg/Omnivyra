/**
 * MONEY unread-error sites (2026-11-12): the credits/earn routes.
 *
 * Each read that gates a credit-bearing action now treats a failed read as
 * "unknown" (503), never as "none":
 *  - feedback: a failed approved/pending check used to fall through and insert
 *    a second submission, which a later approval would credit again;
 *  - referral: an unread upsert answered "success" for an invite that was never
 *    recorded, so the referral could never be credited;
 *  - setup-progress: an unread upsert answered success for progress never
 *    saved; nudge-only reads are best-effort and send no nudge on failure;
 *  - progress: failed reads rendered every step "not done".
 */
export {};
const USER = 'u0000000-0000-4000-8000-0000000000u1';
const ORG = 'a0000000-0000-4000-8000-00000000000a';

type Res = { data?: unknown; error: { message: string } | null; count?: number };
let mockScript: Record<string, () => Res> = {};
const mockWrites: string[] = [];
const mockLogs: string[] = [];
const mockGrants: string[] = [];
const mockNudges: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/logger', () => ({
  logger: { error: (e: string) => mockLogs.push(e), warn: (e: string) => mockLogs.push(e), info: () => undefined },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: USER, email: 'me@example.com' }, error: null }),
}));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://app.example' }));
jest.mock('../../services/earnCreditsService', () => ({
  getEarnProgress: async () => ({}),
  checkAndGrantSetupCredits: async () => { mockGrants.push('setup'); return { setup_credits: 0, website_credits: 0 }; },
  notifyEarnProgress: async (a: { actionType: string }) => { mockNudges.push(a.actionType); },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      let filterStatus = '';
      const b: any = {};
      const key = () => table + ':' + op + (filterStatus ? ':' + filterStatus : '');
      const result = () => (mockScript[key()] ?? mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
      b.select = () => b;
      b.eq = (c: string, v: string) => { if (c === 'status' && table === 'feedback_submissions') filterStatus = v; return b; };
      for (const m of ['order', 'limit']) b[m] = () => b;
      b.insert = () => { op = 'insert'; mockWrites.push(table + ':insert'); return b; };
      b.upsert = () => { op = 'upsert'; mockWrites.push(table + ':upsert'); return b; };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import feedback from '../../../pages/api/credits/earn/feedback';
import referral from '../../../pages/api/credits/earn/referral';
import setupProgress from '../../../pages/api/credits/earn/setup-progress';
import progress from '../../../pages/api/credits/earn/progress';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = () => r;
  return r;
}
async function call(h: (req: any, res: any) => unknown, method: string, body: unknown = {}) {
  const res = mockRes();
  await h({ method, body, headers: {}, query: {} }, res);
  return res;
}
const DOWN = () => ({ data: null, error: { message: 'down' } });

beforeEach(() => {
  mockScript = { 'user_company_roles:select': () => ({ data: { company_id: ORG }, error: null }) };
  mockWrites.length = 0; mockLogs.length = 0; mockGrants.length = 0; mockNudges.length = 0;
});

const FEEDBACK = { feedbackText: 'This is long enough feedback text.' };

describe('earn/feedback', () => {
  it('membership read error -> 503 (not 400 "No active company"), nothing inserted', async () => {
    mockScript['user_company_roles:select'] = DOWN;
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(503);
    expect(mockWrites).toEqual([]);
  });
  it.each(['approved', 'pending'])('%s-check read error -> 503, NO second submission inserted', async (status) => {
    mockScript['feedback_submissions:select:' + status] = DOWN;
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(503);
    expect(mockWrites).toEqual([]);
  });
  it('insert error never returns the database message', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: null, error: { message: 'secret_internal' } });
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret_internal');
  });
  it('control: saved feedback whose admin notification fails still succeeds, and the failure is logged', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: { id: 'f1' }, error: null });
    mockScript['user_company_roles:select'] = () => ({ data: [{ user_id: 'sa1' }], error: null });
    mockScript['notifications:insert'] = DOWN;
    // the membership read uses maybeSingle and needs an object; the SA list uses then()
    const roles = { first: true };
    mockScript['user_company_roles:select'] = () => {
      if (roles.first) { roles.first = false; return { data: { company_id: ORG }, error: null }; }
      return { data: [{ user_id: 'sa1' }], error: null };
    };
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(200);
    expect(mockLogs).toContain('credits_earn_feedback_notify_failed');
  });
});

describe('earn/feedback admin lookup', () => {
  // MUTANT SURVIVOR (2026-11-12): user_company_roles is read TWICE (membership
  // via maybeSingle, then the SUPER_ADMIN list); fail only the second.
  it('super-admin lookup fails (2nd read) -> saved, 200, the lookup failure is logged', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: { id: 'f1' }, error: null });
    let n = 0;
    mockScript['user_company_roles:select'] = () => (++n === 1 ? { data: { company_id: ORG }, error: null } : DOWN());
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(200);
    expect(mockLogs).toContain('credits_earn_feedback_admin_lookup_failed');
  });
});

describe('earn/referral', () => {
  it('upsert error -> 500, never "success" for an invite that was not recorded', async () => {
    mockScript['referrals:upsert'] = DOWN;
    const res = await call(referral, 'POST', { invitedEmail: 'friend@example.com' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'referral_not_recorded' });
  });
  it('list read error -> 503, not an empty history', async () => {
    mockScript['referrals:select'] = DOWN;
    const res = await call(referral, 'GET');
    expect(res.statusCode).toBe(503);
  });
  it('control: a recorded invite still succeeds', async () => {
    const res = await call(referral, 'POST', { invitedEmail: 'friend@example.com' });
    expect(res.statusCode).toBe(200);
  });
});

describe('earn/setup-progress', () => {
  it('progress upsert error -> 500, the grant check never runs on unsaved progress', async () => {
    mockScript['company_setup_progress:upsert'] = DOWN;
    const res = await call(setupProgress, 'PATCH', { step: 'profile_complete' });
    expect(res.statusCode).toBe(500);
    expect(mockGrants).toEqual([]);
  });
  it('nudge read error -> success, NO nudge with a wrong count, failure logged', async () => {
    mockScript['company_setup_progress:select'] = DOWN;
    const res = await call(setupProgress, 'PATCH', { step: 'website_blog_connected' });
    expect(res.statusCode).toBe(200);
    expect(mockNudges).toEqual([]);
    expect(mockLogs).toContain('credits_earn_setup_nudge_read_failed');
  });
  it('control: a clean read with steps remaining still nudges', async () => {
    mockScript['social_accounts:select'] = () => ({ error: null, count: 0 });
    const res = await call(setupProgress, 'PATCH', { step: 'profile_complete' });
    expect(res.statusCode).toBe(200);
    expect(mockNudges).toEqual(['setup_complete']);
  });
  // MUTANT SURVIVORS (2026-11-12): the same log event is written by TWO nudge
  // blocks (setup count, then website), and a website step runs both. Each
  // block's read now fails ALONE (company_setup_progress by call number).
  const nth = (failAt: number) => { let n = 0; return () => (++n === failAt ? DOWN() : { data: {}, error: null }); };
  it('setup-count block ALONE: progress read fails on a non-website step -> logged, no setup nudge', async () => {
    mockScript['social_accounts:select'] = () => ({ error: null, count: 0 });
    mockScript['company_setup_progress:select'] = nth(1);
    const res = await call(setupProgress, 'PATCH', { step: 'profile_complete' });
    expect(res.statusCode).toBe(200);
    expect(mockNudges).toEqual([]);
    expect(mockLogs).toContain('credits_earn_setup_nudge_read_failed');
  });
  it('setup-count block ALONE: social count read fails -> logged, no setup nudge', async () => {
    mockScript['social_accounts:select'] = () => ({ error: { message: 'down' }, count: null });
    const res = await call(setupProgress, 'PATCH', { step: 'profile_complete' });
    expect(mockNudges).toEqual([]);
    expect(mockLogs).toContain('credits_earn_setup_nudge_read_failed');
  });
  it('website block ALONE: its read (call 2) fails -> logged; the setup nudge still goes, the website nudge does not', async () => {
    mockScript['social_accounts:select'] = () => ({ error: null, count: 0 });
    mockScript['company_setup_progress:select'] = nth(2);
    const res = await call(setupProgress, 'PATCH', { step: 'website_blog_connected' });
    expect(res.statusCode).toBe(200);
    expect(mockNudges).toEqual(['setup_complete']);
    expect(mockLogs).toContain('credits_earn_setup_nudge_read_failed');
  });
  it('control: website step with clean reads sends BOTH nudges', async () => {
    mockScript['social_accounts:select'] = () => ({ error: null, count: 0 });
    mockScript['company_setup_progress:select'] = () => ({ data: {}, error: null });
    await call(setupProgress, 'PATCH', { step: 'website_blog_connected' });
    expect(mockNudges).toEqual(['setup_complete', 'website_connected']);
  });
});

describe('earn/progress', () => {
  it.each(['company_setup_progress', 'social_accounts', 'feedback_submissions', 'referrals'])(
    '%s read error -> 503, never "every step not done"', async (table) => {
      mockScript[table + ':select'] = DOWN;
      const res = await call(progress, 'GET');
      expect(res.statusCode).toBe(503);
    });
  it('control: clean reads still answer 200', async () => {
    mockScript['social_accounts:select'] = () => ({ error: null, count: 0 });
    mockScript['referrals:select'] = () => ({ data: [], error: null });
    const res = await call(progress, 'GET');
    expect(res.statusCode).toBe(200);
  });
});

// CLASS 2 (20270217000002): the partial UNIQUE index is the authority; a 23505
// on the insert (the concurrent loser) is a 409, never a 500.
describe('earn/feedback concurrent submit', () => {
  it('insert hits the one-open-per-user UNIQUE (23505) -> 409, not 500', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "feedback_submissions_one_open_per_user"', code: '23505' } as any });
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(409);
  });
  it('a 23505 from a DIFFERENT unique constraint -> 500 (the 409 is keyed on the index NAME)', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "feedback_submissions_pkey"', code: '23505' } as any });
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(500);
  });
  it('control: any other insert error is still a 500 (never a false "already submitted")', async () => {
    mockScript['feedback_submissions:insert'] = () => ({ data: null, error: { message: 'connection reset', code: '08006' } as any });
    const res = await call(feedback, 'POST', FEEDBACK);
    expect(res.statusCode).toBe(500);
  });
});
