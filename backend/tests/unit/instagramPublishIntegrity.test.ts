/**
 * Instagram Graph publishing adapter — correctness, separate from token state.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three adapter defects, none of which needs a live Instagram account to
 * demonstrate and none of which is caused by an expired token:
 *
 * 1. VIDEO MISCLASSIFIED. The video test was `$`-anchored, so a signed or
 *    cache-busted Reel URL (`…/clip.mp4?token=…`) was not recognised as video
 *    and was sent to the IMAGE container as `image_url: <an mp4>`. Graph
 *    rejects that with a 400, which this adapter reports as
 *    INSTAGRAM_VALIDATION_ERROR, retryable: false — so a valid Reel died
 *    permanently under "Invalid post content or media".
 *
 * 2. CAROUSEL SILENTLY TRUNCATED. The capability registry lists 'carousel' for
 *    Instagram, so a multi-image post reaches this adapter — which builds ONE
 *    container from media_urls[0], publishes it, and reports success. A
 *    three-image carousel shipped as a single image. That is the P3-A
 *    invariant violation the other adapters already close.
 *
 * 3. EVERY NON-FINISHED VIDEO STATUS CALLED A TIMEOUT. Graph's status_code is
 *    also ERROR / EXPIRED / PUBLISHED, and all of them were reported as
 *    "Instagram took too long to process".
 *
 * All HTTP is mocked. Nothing here contacts Instagram and no credential is used.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../adapters/mediaCover', () => ({
  generateHostedBrandedCover: jest.fn(async () => null),
  resolveCoverBrand: jest.fn(async () => ({})),
}));

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

const IG_ID = '17841400000000000';
const ACCOUNT = { id: 'a1', platform: 'instagram', platform_user_id: IG_ID };
const TOKEN = { access_token: 'page-scoped-token' };

const basePost = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  platform: 'instagram',
  content: 'Caption here',
  media_urls: ['https://cdn.example.com/a.jpg'],
  scheduled_for: new Date().toISOString(),
  ...over,
});

const load = async () => (await import('../../adapters/instagramAdapter')).publishToInstagram;

/** Container create + media_publish both answer with an id. */
function stubGraphOk() {
  let n = 0;
  mockPost.mockImplementation(async () => {
    n += 1;
    return { data: { id: n === 1 ? 'container-1' : 'media-1' } };
  });
}

/** The container status poll. */
function stubStatus(statusCode: unknown) {
  mockGet.mockResolvedValue({ data: { status_code: statusCode } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  jest.useRealTimers();
});

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Media type detection
 * ────────────────────────────────────────────────────────────────────────── */
describe('media type detection', () => {
  it('CRITICAL: a signed .mp4 URL builds a REELS container, not an image container', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    stubGraphOk();
    stubStatus('FINISHED');

    const p = (await load())(
      basePost({ media_urls: ['https://cdn.example.com/clip.mp4?token=abc'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );
    await jest.advanceTimersByTimeAsync(11000);
    const r = await p;

    expect(r.success).toBe(true);
    const containerBody = mockPost.mock.calls[0][1];
    expect(containerBody.media_type).toBe('REELS');
    expect(containerBody.video_url).toBe('https://cdn.example.com/clip.mp4?token=abc');
    expect(containerBody.image_url).toBeUndefined();
  });

  it('a plain .mp4 still builds a REELS container (no regression)', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    stubGraphOk();
    stubStatus('FINISHED');

    const p = (await load())(
      basePost({ media_urls: ['https://cdn.example.com/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );
    await jest.advanceTimersByTimeAsync(11000);
    await p;

    expect(mockPost.mock.calls[0][1].media_type).toBe('REELS');
  });

  it('a signed .jpg URL still builds an IMAGE container', async () => {
    stubGraphOk();

    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/a.jpg?sig=1'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.success).toBe(true);
    const containerBody = mockPost.mock.calls[0][1];
    expect(containerBody.image_url).toBe('https://cdn.example.com/a.jpg?sig=1');
    expect(containerBody.media_type).toBeUndefined();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Carousel
 * ────────────────────────────────────────────────────────────────────────── */
describe('carousel', () => {
  it('CRITICAL: a multi-image post fails instead of quietly publishing only the first', async () => {
    stubGraphOk();

    const r = await (await load())(
      basePost({ media_urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg', 'https://cdn.example.com/c.jpg'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.error?.retryable).toBe(false);
    expect(r.error?.message).toMatch(/Nothing was published/);
    // Nothing was created on Instagram's side.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a single-image post is unaffected', async () => {
    stubGraphOk();
    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);
    expect(r.success).toBe(true);
    expect(r.platform_post_id).toBe('media-1');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Video processing status
 * ────────────────────────────────────────────────────────────────────────── */
describe('video processing status', () => {
  it('CRITICAL: a non-FINISHED terminal status is not reported as a timeout', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    stubGraphOk();
    stubStatus('EXPIRED');

    const p = (await load())(
      basePost({ media_urls: ['https://cdn.example.com/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );
    await jest.advanceTimersByTimeAsync(11000);
    const r = await p;

    expect(r.success).toBe(false);
    expect(r.error?.message).toContain('EXPIRED');
    expect(r.error?.message).not.toMatch(/took too long/);
  });

  it('a missing status_code says so rather than blaming processing time', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    stubGraphOk();
    stubStatus(undefined);

    const p = (await load())(
      basePost({ media_urls: ['https://cdn.example.com/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );
    await jest.advanceTimersByTimeAsync(11000);
    const r = await p;

    expect(r.success).toBe(false);
    expect(r.error?.message).toContain('missing');
  });

  it('ERROR still surfaces the explicit processing failure', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    stubGraphOk();
    stubStatus('ERROR');

    const p = (await load())(
      basePost({ media_urls: ['https://cdn.example.com/clip.mp4'] }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );
    await jest.advanceTimersByTimeAsync(11000);
    const r = await p;

    expect(r.success).toBe(false);
    expect(r.error?.message).toMatch(/Video processing failed on Instagram/);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 4. The existing error ladder is untouched (token state stays distinguishable)
 * ────────────────────────────────────────────────────────────────────────── */
describe('provider error classification', () => {
  const cases: Array<[number, string, boolean]> = [
    [401, 'INSTAGRAM_UNAUTHORIZED', false],
    [403, 'INSTAGRAM_PERMISSION_DENIED', false],
    [429, 'INSTAGRAM_RATE_LIMIT', true],
    [400, 'INSTAGRAM_VALIDATION_ERROR', false],
  ];

  it.each(cases)('HTTP %s → %s (retryable=%s)', async (status, code, retryable) => {
    mockPost.mockRejectedValue({ response: { status, data: { error: { message: 'x' } } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe(code);
    expect(r.error?.retryable).toBe(retryable);
  });
});
