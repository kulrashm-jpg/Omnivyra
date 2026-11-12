/**
 * SECURITY (2026-11-13): GET /api/community/threads and /api/community/engagement ran their access check only
 * when a company was known. resolveUserContext does not refuse an anonymous caller (it returns an
 * unauthenticated context with no default company), so an anonymous request carrying just a postId read ANY
 * company's thread content / engagement - no authentication, no tenant bound.
 *
 * Now: unauthenticated -> 401 before any read; a company (the query's or the user's default) is ALWAYS
 * access-checked; a postId only narrows within that company's posts; a foreign, unknown or malformed post is the
 * same 404. That 404 is decided by a scoped existence check, not by membership in a capped id list (05 review):
 * a legitimate post outside the company's newest-posts window is still found, and a listing whose window is full
 * says so (truncated) instead of silently omitting rows.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockUser = { current: null as null | Record<string, unknown> };
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => mockUser.current,
  enforceCompanyAccess: async (i: { companyId?: string; res: any }) => {
    const u = mockUser.current as { authenticated?: boolean; companyIds?: string[]; userId?: string } | null;
    if (u?.authenticated && u.companyIds?.includes(String(i.companyId))) return { userId: u.userId };
    i.res.status(403).json({ error: 'forbidden' });
    return null;
  },
}));

import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
/* eslint-disable @typescript-eslint/no-var-requires */
const threads = require('../../../pages/api/community/threads').default;
const engagement = require('../../../pages/api/community/engagement').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const UNKNOWN = 'cccccccc-0000-4000-8000-00000000000c';
const anonymous = { userId: '', role: 'user', companyIds: [], defaultCompanyId: '', authenticated: false, authError: 'MISSING_AUTH' };
const userA = { userId: 'user-a', role: 'user', companyIds: [A], defaultCompanyId: A, authenticated: true, authError: null };

async function get(handler: any, query: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method: 'GET', headers: {}, query }, res);
  return res;
}

beforeEach(() => {
  resetFakeDb({
    community_posts: [
      { id: PA, company_id: A, created_at: '2026-11-01T00:00:00Z' },
      { id: PB, company_id: B, created_at: '2026-11-01T00:00:00Z' },
    ],
    community_threads: [
      { id: 'th-a', post_id: PA, thread_type: 't', thread_content: 'A content', created_at: '2026-11-01T00:00:00Z' },
      { id: 'th-b', post_id: PB, thread_type: 't', thread_content: 'B CONFIDENTIAL', created_at: '2026-11-01T00:00:00Z' },
    ],
    engagement_signals: [
      { id: 'es-a', post_id: PA, platform: 'linkedin', engagement_type: 'like', engagement_count: 3, captured_at: '2026-11-01T00:00:00Z' },
      { id: 'es-b', post_id: PB, platform: 'linkedin', engagement_type: 'like', engagement_count: 99, captured_at: '2026-11-01T00:00:00Z' },
    ],
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

/** A's post PA becomes the OLDEST of 201: outside the newest-200 listing window. */
function bury(): void {
  for (let i = 0; i < 200; i += 1) {
    const n = String(i).padStart(12, '0');
    fakeDb.tables.community_posts.push({ id: `dddddddd-0000-4000-8000-${n}`, company_id: A, created_at: `2026-11-10T00:00:${String(i % 60).padStart(2, '0')}Z` });
  }
}

describe.each([
  ['threads', threads, 'threads', 'B CONFIDENTIAL'],
  ['engagement', engagement, 'engagement', '99'],
] as const)('/api/community/%s', (_n, handler, key, bSecret) => {
  it('ANONYMOUS with B\'s postId -> 401, nothing of B returned', async () => {
    mockUser.current = anonymous;
    const res = await get(handler, { postId: PB });
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(bSecret);
  });

  it('a user of A naming B\'s postId -> 404, identical to an unknown and a malformed post; nothing of B returned', async () => {
    mockUser.current = userA;
    const foreign = await get(handler, { postId: PB });
    const unknown = await get(handler, { postId: UNKNOWN });
    const malformed = await get(handler, { postId: 'post-zz' });
    expect([foreign.statusCode, unknown.statusCode, malformed.statusCode]).toEqual([404, 404, 404]);
    expect(foreign.body).toEqual(unknown.body);
    expect(malformed.body).toEqual(unknown.body);
    expect(JSON.stringify(foreign.body)).not.toContain(bSecret);
  });

  it('a user of A naming company B -> refused', async () => {
    mockUser.current = userA;
    expect((await get(handler, { companyId: B, postId: PB })).statusCode).toBe(403);
  });

  it('CONTROL: a user of A reads A\'s post (explicit company, and via the default company)', async () => {
    mockUser.current = userA;
    const explicit = await get(handler, { companyId: A, postId: PA });
    const viaDefault = await get(handler, { postId: PA });
    expect(explicit.statusCode).toBe(200);
    expect(viaDefault.statusCode).toBe(200);
    expect((explicit.body as Record<string, unknown[]>)[key]).toHaveLength(1);
    expect(JSON.stringify(explicit.body)).not.toContain(bSecret);
  });

  it('CONTROL: the company-wide listing returns A\'s rows only, not truncated', async () => {
    mockUser.current = userA;
    const res = await get(handler, {});
    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown[]>)[key]).toHaveLength(1);
    expect(res.body.truncated).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(bSecret);
  });

  it('ROW CAP: A\'s post outside the newest window is still found by postId; the full listing says truncated', async () => {
    bury();
    mockUser.current = userA;
    const byId = await get(handler, { postId: PA });
    expect(byId.statusCode).toBe(200);
    expect((byId.body as Record<string, unknown[]>)[key]).toHaveLength(1);
    const listing = await get(handler, {});
    expect(listing.statusCode).toBe(200);
    expect(listing.body.truncated).toBe(true);
  });
});
