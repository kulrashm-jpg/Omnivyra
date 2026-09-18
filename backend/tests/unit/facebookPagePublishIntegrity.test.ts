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

  // A signed video URL is still RECOGNISED as a video — that recognition is
  // what earns the video-specific refusal below instead of the generic
  // "unrecognised media" one. What changed (owner decision, 2026-09-18) is that
  // recognising it no longer means attaching it to a /feed write. See §5.
  it('CRITICAL: a signed video URL is recognised as a video, and refused as one', async () => {
    const url = 'https://cdn.example.com/media/a.mp4?sig=xyz';

    const r = await (await load())(basePost({ media_urls: [url] }) as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.error?.message).toMatch(/video/i);
    expect(r.error?.message).not.toMatch(/does not recognise/);
    expect(mockPost).not.toHaveBeenCalled();
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
 * 3. The PERSISTED Page target
 *
 * The Page and its token are resolved once, during OAuth, and stored on the
 * connection (`social_accounts.linked_page_id` + `page_access_token`; see
 * pages/api/auth/facebook/callback.ts). Publishing reads that target rather
 * than re-deriving it, so the destination cannot change between the moment an
 * operator connected a Page and the moment a post goes out.
 * ────────────────────────────────────────────────────────────────────────── */

const OTHER_TENANT_PAGE_ID = '555000111';

/** A connection as the OAuth callback now writes it. */
const PAGE_BOUND_ACCOUNT = {
  id: 'a1',
  platform: 'facebook',
  platform_user_id: USER_ID,          // the Facebook USER — identity only
  linked_page_id: PAGE_ID,            // the Page — the publish target
  page_access_token: 'enc:page-token' // proof the Page token was stored here
};

/** getToken() hands the adapter the decrypted PAGE token for such a row. */
const PAGE_TOKEN = { access_token: 'page-token' };

describe('persisted Page target', () => {
  it('CRITICAL: publishes to the PERSISTED Page, with the PAGE token', async () => {
    stubFeedOk();

    const r = await (await load())(basePost() as any, PAGE_BOUND_ACCOUNT as any, PAGE_TOKEN as any);

    expect(r.success).toBe(true);
    expect(mockPost.mock.calls[0][0]).toBe(`https://graph.facebook.com/v22.0/${PAGE_ID}/feed`);
    expect(mockPost.mock.calls[0][2].params.access_token).toBe('page-token');
  });

  it('CRITICAL: the stored USER id is never the target', async () => {
    stubFeedOk();

    await (await load())(basePost() as any, PAGE_BOUND_ACCOUNT as any, PAGE_TOKEN as any);

    expect(String(mockPost.mock.calls[0][0])).not.toContain(USER_ID);
    expect(JSON.stringify(mockPost.mock.calls[0][2].params)).not.toContain(USER_ID);
  });

  it('a persisted target needs no live Page lookup at publish time', async () => {
    stubFeedOk();

    await (await load())(basePost() as any, PAGE_BOUND_ACCOUNT as any, PAGE_TOKEN as any);

    expect(mockGet).not.toHaveBeenCalled();
  });

  /* ── Negative: identity is not a destination ─────────────────────────── */

  it('CRITICAL (negative): a USER id stored as the Page id is refused, not published to', async () => {
    const conflated = { ...PAGE_BOUND_ACCOUNT, linked_page_id: USER_ID };

    const r = await (await load())(basePost() as any, conflated as any, PAGE_TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TARGET');
    expect(r.error?.retryable).toBe(false);
    expect(r.error?.message).toMatch(/not a Page/);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  /* ── Negative: another tenant's Page id is not authorisation ─────────── */

  it('CRITICAL (negative): a Page id from another connection, with no Page token stored here, is refused', async () => {
    // The Page genuinely exists — for somebody else. This connection never
    // obtained its token, so the id alone must not make it publishable.
    const foreign = {
      id: 'a1',
      platform: 'facebook',
      platform_user_id: USER_ID,
      linked_page_id: OTHER_TENANT_PAGE_ID,
      page_access_token: null,
    };

    const r = await (await load())(basePost() as any, foreign as any, PAGE_TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TOKEN');
    expect(r.error?.message).toMatch(/not authorisation/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('CRITICAL (negative): the live path will not reach another connection\'s Page either', async () => {
    // This login's own /me/accounts does not contain it, which is the whole
    // tenant boundary: the Page list is derived from THIS connection's token.
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);

    const r = await (await load())(
      basePost() as any,
      { id: 'a1', platform: 'facebook', platform_user_id: OTHER_TENANT_PAGE_ID } as any,
      TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TARGET');
    expect(mockPost).not.toHaveBeenCalled();
  });

  /* ── Malformed / missing target: explicit, never fatal ───────────────── */

  it('a persisted Page with no decryptable token → explicit failure, nothing published', async () => {
    const r = await (await load())(basePost() as any, PAGE_BOUND_ACCOUNT as any, { access_token: '' } as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TOKEN');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a blank linked_page_id is treated as no target, not as an empty Page id', async () => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);

    const r = await (await load())(
      basePost() as any,
      { ...PAGE_BOUND_ACCOUNT, linked_page_id: '   ' } as any,
      TOKEN as any,
    );

    // Falls through to the live lookup, which cannot match a USER id.
    expect(r.error?.code).toBe('FACEBOOK_NO_PAGE_TARGET');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('several manageable Pages and none bound → selection is REQUIRED, never guessed', async () => {
    stubPages([
      { id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' },
      { id: OTHER_TENANT_PAGE_ID, name: 'Second Page', access_token: 'page-token-2' },
    ]);

    const r = await (await load())(basePost() as any, USER_BOUND_ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('FACEBOOK_PAGE_SELECTION_REQUIRED');
    expect(r.error?.retryable).toBe(false);
    expect(r.error?.message).toMatch(/NOT chosen automatically/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('media honesty still applies on the persisted path', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }) as any,
      PAGE_BOUND_ACCOUNT as any,
      PAGE_TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 4. Video is refused, not silently degraded to a text post
 *
 * OWNER DECISION, 2026-09-18. The adapter used to put the video URL in
 * `payload.source` on the `/{page-id}/feed` write. `source` is not a parameter
 * of the feed edge — Facebook video publishing is POST /{page-id}/videos — so
 * Graph could accept the write, ignore the unknown parameter and publish the
 * MESSAGE ALONE, returning a post id. The adapter would then report success
 * with the video gone: a text-only publication of a post that asked for media,
 * which is the P3-A failure, and the only shape of it that no assertion could
 * catch, because from the caller's side the call succeeded.
 *
 * The owner chose explicit refusal over leaving the divergence documented or
 * waiting for a live-Graph experiment. POST /{page-id}/videos remains
 * UNIMPLEMENTED — it has no call site, fixture or response shape anywhere in
 * this repo, and inventing one to ship unverified would be the worse defect.
 * ────────────────────────────────────────────────────────────────────────── */
describe('video publishing is refused explicitly', () => {
  beforeEach(() => {
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();
  });

  const VIDEO_URLS = [
    'https://cdn.example.com/media/clip.mp4',
    'https://cdn.example.com/media/clip.mov?sig=xyz',
    'https://cdn.example.com/media/clip.avi#t=1',
    'https://cdn.example.com/media/clip.webm?token=abc&exp=1',
  ];

  it.each(VIDEO_URLS)('CRITICAL: %s fails explicitly — nothing is published', async (url) => {
    const r = await (await load())(basePost({ media_urls: [url] }) as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.error?.retryable).toBe(false);
    expect(r.platform_post_id).toBeUndefined();
  });

  it('CRITICAL: ZERO writes reach the feed edge', async () => {
    await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(mockPost).not.toHaveBeenCalled();
    const feedWrites = mockPost.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/feed'));
    expect(feedWrites).toHaveLength(0);
  });

  it('CRITICAL: `source` is never sent — the parameter that caused the silent drop is gone', async () => {
    await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    const everySentParam = JSON.stringify(mockPost.mock.calls);
    expect(everySentParam).not.toContain('source');
    expect(everySentParam).not.toContain('clip.mp4');
  });

  it('the reason names the missing upload endpoint, not a broken credential', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    // An operator must not go hunting through tokens, scopes or Page settings
    // for a feature that was simply never built.
    expect(r.error?.message).toContain('/{page-id}/videos');
    expect(r.error?.message).toMatch(/not implemented/i);
    expect(r.error?.message).toMatch(/Nothing was published/);
    expect(r.error?.message).toMatch(/connection, Page and token are\s+fine|Page and token are fine/);
  });

  it('a video is refused on the PERSISTED Page path too, not just the live-lookup one', async () => {
    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/clip.mp4'] }) as any,
      PAGE_BOUND_ACCOUNT as any,
      PAGE_TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('video refusal is distinct from the unrecognised-media refusal', async () => {
    const video = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/clip.mp4'] }) as any, ACCOUNT as any, TOKEN as any);
    jest.clearAllMocks();
    stubPages([{ id: PAGE_ID, name: 'Acme Page', access_token: 'page-token' }]);
    stubFeedOk();
    const unknown = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/media/asset'] }) as any, ACCOUNT as any, TOKEN as any);

    // Same code (the shared vocabulary), different diagnosis.
    expect(video.error?.code).toBe(unknown.error?.code);
    expect(video.error?.message).not.toBe(unknown.error?.message);
    expect(unknown.error?.message).toMatch(/does not recognise/);
    expect(video.error?.message).not.toMatch(/does not recognise/);
  });

  it('images are untouched by this decision — still published', async () => {
    const url = 'https://cdn.example.com/media/a.jpg?token=abc';

    const r = await (await load())(basePost({ media_urls: [url] }) as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    expect(mockPost.mock.calls[0][2].params.link).toBe(url);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 5. Mock mode short-circuit is untouched
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
