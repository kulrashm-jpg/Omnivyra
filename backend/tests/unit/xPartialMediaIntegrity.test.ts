/**
 * X publishing — a post never ships with a media set X did not receive in full.
 *
 * WHY THIS EXISTS
 * ---------------
 * `uploadXMedia` was "individually best-effort": each image upload sat inside
 * its own try/catch, and a failure was logged with console.warn and skipped.
 * The two composition rules were enforced the same way, by discarding whatever
 * did not fit — `urls.slice(0, MAX_IMAGES)` for a 5+ image post, and a
 * `continue` for any video/GIF found alongside images.
 *
 * In all three cases the function still returned a non-empty id list, so
 * xAdapter's `mediaIds.length > 0` honesty check passed and the tweet was
 * created with the surviving subset and reported `success: true`. A reviewed
 * three-image post could publish as two images and nothing downstream — not
 * the row, not the operator, not the campaign report — could tell.
 *
 * That is exactly the P3-A invariant ("never silently publish materially
 * different content") that the LinkedIn, Instagram and Facebook adapters
 * already enforce, and that this module's own header already claimed.
 *
 * Classification of the two failure modes differs, deliberately:
 *   - a per-item upload failure is transient      -> retryable: true
 *   - a composition X cannot accept is permanent  -> retryable: false
 *
 * All HTTP is mocked (`axios`). Nothing here contacts X and no credential is
 * used.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/security/safeFetch', () => ({
  assertUrlSafe: jest.fn(async () => undefined),
  outboundBreakerFor: () => ({ call: (fn: any) => fn() }),
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

const TOKEN = { access_token: 'tok' };
const ACCOUNT = { id: 'a1', platform: 'x', platform_user_id: 'u1', username: 'brand' };

const basePost = (mediaUrls: string[]) => ({
  id: 'p1',
  platform: 'x',
  content: 'Launch day',
  media_urls: mediaUrls,
  scheduled_for: new Date().toISOString(),
});

/** Media download (axios.get on the source URL) + STATUS polls. */
function stubDownload(contentType = 'image/jpeg') {
  mockGet.mockImplementation(async (url: string) => {
    if (String(url).includes('upload.json')) {
      return { data: { processing_info: { state: 'succeeded' } } };
    }
    return { data: new ArrayBuffer(32), headers: { 'content-type': contentType } };
  });
}

const loadAdapter = async () => (await import('../../adapters/xAdapter')).publishToX;
const loadMedia = async () => await import('../../adapters/xMedia');

/** Did we create a tweet? (POST to the v2 tweet-create endpoint.) */
const tweetCreateCalls = () =>
  mockPost.mock.calls.filter(([url]) => String(url).includes('api.twitter.com/2/tweets'));

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

/* --------------------------------------------------------------------------
 * 1. Partial image upload — the headline defect
 * ----------------------------------------------------------------------- */
describe('partial image upload', () => {
  it('CRITICAL: 1 of 3 image uploads failing rejects instead of returning a short list', async () => {
    stubDownload();
    let call = 0;
    mockPost.mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error('upload 2 exploded');
      return { data: { media_id_string: `id-${call}` } };
    });
    const { uploadXMedia } = await loadMedia();

    await expect(
      uploadXMedia(
        ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg', 'https://cdn.example.com/c.jpg'],
        TOKEN,
      ),
    ).rejects.toThrow(/upload 2 exploded/);
  });

  it('CRITICAL: the adapter publishes NOTHING when one of three images fails', async () => {
    stubDownload();
    let uploads = 0;
    mockPost.mockImplementation(async (url: string) => {
      if (String(url).includes('upload.json')) {
        uploads += 1;
        if (uploads === 2) throw new Error('transient X media failure');
        return { data: { media_id_string: `id-${uploads}` } };
      }
      return { data: { data: { id: 'tweet-1' } } };
    });

    const publishToX = await loadAdapter();
    const result = await publishToX(
      basePost([
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
        'https://cdn.example.com/c.jpg',
      ]) as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    // Transient — the queue should get another attempt.
    expect(result.error?.retryable).toBe(true);
    // The whole point: no tweet was created with the surviving two images.
    expect(tweetCreateCalls()).toHaveLength(0);
  });

  it('three healthy images still publish, with all three ids attached (happy path preserved)', async () => {
    stubDownload();
    let uploads = 0;
    mockPost.mockImplementation(async (url: string) => {
      if (String(url).includes('upload.json')) {
        uploads += 1;
        return { data: { media_id_string: `id-${uploads}` } };
      }
      return { data: { data: { id: 'tweet-1' } } };
    });

    const publishToX = await loadAdapter();
    const result = await publishToX(
      basePost([
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
        'https://cdn.example.com/c.jpg',
      ]) as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('tweet-1');
    const [, payload] = tweetCreateCalls()[0];
    expect((payload as any).media.media_ids).toEqual(['id-1', 'id-2', 'id-3']);
  });
});

/* --------------------------------------------------------------------------
 * 2. Composition rules — refused, not trimmed
 * ----------------------------------------------------------------------- */
describe('composition X cannot accept', () => {
  it('CRITICAL: image + video is refused, not published as the image alone', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ data: { data: { id: 'tweet-1' } } });

    const publishToX = await loadAdapter();
    const result = await publishToX(
      basePost(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/clip.mp4']) as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    // Permanent — no retry can make X accept image+video in one post.
    expect(result.error?.retryable).toBe(false);
    expect(tweetCreateCalls()).toHaveLength(0);
    // Refused before a single byte was uploaded.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('CRITICAL: a six-image post is refused, not silently cut to four', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ data: { data: { id: 'tweet-1' } } });

    const publishToX = await loadAdapter();
    const result = await publishToX(
      basePost([1, 2, 3, 4, 5, 6].map((n) => `https://cdn.example.com/${n}.jpg`)) as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.message).toContain('6');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a single video is still a valid single-media post (happy path preserved)', async () => {
    stubDownload('video/mp4');
    mockPost.mockImplementation(async (url: string) => {
      if (String(url).includes('upload.json')) return { data: { media_id_string: 'vid-1' } };
      return { data: { data: { id: 'tweet-9' } } };
    });

    const publishToX = await loadAdapter();
    const result = await publishToX(
      basePost(['https://cdn.example.com/clip.mp4']) as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(true);
    const [, payload] = tweetCreateCalls()[0];
    expect((payload as any).media.media_ids).toEqual(['vid-1']);
  });

  it('exactly four images is still allowed', async () => {
    const { planXMediaComposition } = await loadMedia();
    const plan = planXMediaComposition([1, 2, 3, 4].map((n) => `https://cdn.example.com/${n}.jpg`));
    expect(plan.ok).toBe(true);
    expect(plan.ok === true && plan.kind).toBe('images');
  });

  it('no media at all is not a composition violation', async () => {
    const { planXMediaComposition } = await loadMedia();
    expect(planXMediaComposition(undefined)).toEqual({ ok: true, kind: 'none', urls: [] });
    expect(planXMediaComposition(['  '])).toEqual({ ok: true, kind: 'none', urls: [] });
  });
});
