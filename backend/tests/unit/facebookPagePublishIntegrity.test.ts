/**
 * Facebook publishing — publish to a Page, with a Page token, or say why not.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two defects, both of which made a Facebook publish look like something it
 * was not:
 *
 * 1. WRONG TARGET, WRONG TOKEN. The adapter posted to
 *    `/{account.platform_user_id}/feed` with `token.access_token`. But the
 *    OAuth callback stores `profile.id` from `GET /me` — the Facebook USER id —
 *    and the USER token (pages/api/auth/facebook/callback.ts). Graph only
 *    accepts feed publishing against a Page node with that Page's own token, so
 *    this addressed a user node with a user token on every attempt. The Page
 *    flow the product already asks consent for (`pages_show_list`,
 *    `pages_manage_posts`; see pages/api/auth/facebook/index.ts) was never
 *    wired into publishing, even though metaDerivedAccountsService already
 *    reads Pages and their per-Page tokens from /me/accounts.
 *
 * 2. MEDIA SILENTLY DROPPED. The image/video tests were `$`-anchored, so a
 *    signed or cache-busted URL (`…/a.jpg?token=…`) matched NEITHER branch,
 *    nothing was attached, and the post went out as text with `success: true`.
 *    A multi-item post likewise attached only the first and reported success.
 *    Both violate the P3-A invariant that a post which asked for media is never
 *    reported as a successful text-only publication.
 *
 * All HTTP is mocked. Nothing here contacts Facebook and no credential is used.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...a: any[]) => mockGet(...a),
    post: (...a: any[]) => mockPost(...a),
  },
}));

import { PipelineErrorCode } from '../../../lib/shared/pipelineErrorCodes';

const PAGE_ID = '111222333';
const USER_ID = '999888777';

const ACCOUNT = { id: 'a1', platform: 'facebook', platform_user_id: PAGE_ID };
const USER_BOUND_ACCOUNT = { id: 'a1', platform: 'facebook', platform_user_id: USER_ID };
const TOKEN = { access_token: 'user-token' };

const basePost = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  platform: 'facebook',
  content: 'Hello world',
  scheduled_for: new Date().toISOString(),
  ...over,
});

/** `GET /me/accounts` answers with these pages. */
function stubPages(pages: unknown[]) {
  mockGet.mockResolvedValue({ data: { data: pages } });
}

function stubFeedOk() {
  mockPost.mockResolvedValue({ data: { id: `${PAGE_ID}_4242` } });
}

const load = async () => (await import('../../adapters/facebookAdapter')).publishToFacebook;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Page-token flow
 * ────────────────────────────────────────────────────────────────────────── */
describe('Page target + Page access token', () => {
  it('CRITICAL: the feed write is authorised with the PAGE token, not the stored user token', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    const [, , cfg] = mockPost.mock.calls[0];
    expect(cfg.params.access_token).toBe('page-token');
    expect(cfg.params.access_token).not.toBe('user-token');
  });

  it('reads the Pages from the endpoint and field set the repo already uses', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();

    await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    const [url, cfg] = mockGet.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v22.0/me/accounts');
    expect(cfg.params.fields).toBe('id,name,access_token');
  });

  it('posts to the matched Page feed node', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();

    await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(mockPost.mock.calls[0][0]).toBe(`https://graph.facebook.com/v22.0/${PAGE_ID}/feed`);
  });

  it('CRITICAL: a connection bound to a USER id fails explicitly — it does NOT post to the user node', async () => {
    // This is the state every current Facebook connection is in.
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);

    const r = await (await load())(basePost() as any, USER_BOUND_ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TARGET');
    expect(r.error?.retryable).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('the failure names the Pages that ARE available, so it is actionable', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);

    const r = await (await load())(basePost() as any, USER_BOUND_ACCOUNT as any, TOKEN as any);

    expect(r.error?.message).toContain('Acme Page');
    expect(r.error?.message).toContain(PAGE_ID);
    expect(r.error?.message).toMatch(/Nothing was published/);
  });

  it('no Pages at all → explicit failure, still no publish attempt', async () => {
    stubPages([]);

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TARGET');
    expect(r.error?.message).toMatch(/administers no Facebook Pages/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a matching Page with no access_token → explicit missing-grant failure', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page' }]);

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TOKEN');
    expect(r.error?.retryable).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a Graph error on the lookup still flows through the EXISTING error ladder', async () => {
    mockGet.mockRejectedValue({ response: { status: 401, data: { error: { message: 'bad token' } } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('FACEBOOK_UNAUTHORIZED');
    expect(mockPost).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Media honesty
 * ────────────────────────────────────────────────────────────────────────── */
describe('media is attached, or the publish fails', () => {
  beforeEach(() => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();
  });

  it('CRITICAL: a signed image URL is recognised and attached (it used to be dropped)', async () => {
    const url = 'https://cdn.example.com/media/a.jpg?token=abc&exp=123';

    const r = await (await load())(basePost({ media_urls: [url] }) as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    expect(mockPost.mock.calls[0][2].params.link).toBe(url);
  });

  it('CRITICAL: a signed video URL is recognised and attached', async () => {
    const url = 'https://cdn.example.com/media/a.mp4?sig=xyz';

    const r = await (await load())(basePost({ media_urls: [url] }) as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    expect(mockPost.mock.calls[0][2].params.source).toBe(url);
  });

  it('CRITICAL: an unrecognisable media URL fails instead of publishing text-only', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/asset-with-no-extension'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.error?.message).toMatch(/TEXT ONLY/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('CRITICAL: a multi-media post fails instead of quietly publishing only the first item', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.error?.retryable).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a plain extension still works exactly as before (no regression)', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/a.png'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.success).toBe(true);
    expect(mockPost.mock.calls[0][2].params.link).toBe('https://cdn.example.com/a.png');
  });

  it('a genuinely text-only post is untouched', async () => {
    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    const params = mockPost.mock.calls[0][2].params;
    expect(params.link).toBeUndefined();
    expect(params.source).toBeUndefined();
    expect(params.message).toContain('Hello world');
  });

  it('blank/whitespace media entries are not treated as requested media', async () => {
    const r = await (await load())(basePost({ media_urls: ['  ', ''] }) as any, ACCOUNT as any, TOKEN as any);
    expect(r.success).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Mock mode short-circuit is untouched
 * ────────────────────────────────────────────────────────────────────────── */
describe('mock mode', () => {
  it('still returns before any Graph call', async () => {
    jest.resetModules();
    jest.doMock('@/config', () => ({ config: { USE_MOCK_PLATFORMS: true }, getValidatedConfig: () => ({}) }));
    const { publishToFacebook } = await import('../../adapters/facebookAdapter');

    const r = await publishToFacebook(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
