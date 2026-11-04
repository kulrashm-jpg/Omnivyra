/**
 * Owner ruling 2026-11-04 (Checkpoint 1, item 6): /api/social/comments no longer replies.
 * The reply action posted directly to LinkedIn/X (with a placeholder token) and reported
 * Facebook/Instagram replies as posted when nothing was sent. It is removed and NOT replaced
 * by another direct platform call.
 */
import * as fs from 'fs';
import * as path from 'path';

const from = jest.fn();
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: { id: '00000000-0000-4000-8000-0000000000a1' } })),
}));
jest.mock('../../services/engagementIngestionService', () => ({
  ingestComments: jest.fn(async () => ({ ingested: 0 })),
  getCommentsForScheduledPost: jest.fn(async () => []),
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/social/comments').default as (req: unknown, res: unknown) => Promise<unknown>;

function call(body: Record<string, unknown>) {
  const res = { statusCode: 0, body: null as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res);
}

const fetchSpy = jest.fn(async () => { throw new Error('no platform call may be made'); });
beforeEach(() => {
  from.mockReset();
  fetchSpy.mockClear();
  (global as unknown as { fetch: unknown }).fetch = fetchSpy;
});

describe('/api/social/comments — the direct reply action is removed', () => {
  it.each(['linkedin', 'twitter', 'facebook', 'instagram'])('action=reply on %s: 410, no platform call, no account or token lookup', async (platform) => {
    const res = await call({ action: 'reply', platform, postId: 'p1', accountId: 'a1', commentId: 'c1', replyText: 'hi' });
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ error: 'REPLY_REMOVED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('the route source holds no direct platform endpoint and makes no fetch', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'pages/api/social/comments.ts'), 'utf8');
    expect(src).not.toMatch(/api\.linkedin\.com|api\.twitter\.com|graph\.facebook\.com/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/mock_token_/);
  });

  it('an unknown action is still refused as before', async () => {
    const res = await call({ action: 'nope' });
    expect(res.statusCode).toBe(400);
  });
});
