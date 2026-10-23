/**
 * X media upload — never return a media_id X did not issue.
 *
 * WHY THIS EXISTS
 * ---------------
 * P3-A made the X adapter refuse to publish when media upload yields no usable
 * media_ids, so a post that asked for media is never shipped as bare text. That
 * guarantee rests on `uploadXMedia` returning ONLY ids X actually issued.
 *
 * Both call sites used `String(data.media_id_string)`. On a 200 whose body has
 * no `media_id_string`, that yields the literal string "undefined" — truthy and
 * non-empty — which defeated the guarantee two different ways:
 *
 *   single-shot: "undefined" passed the caller's `mediaIds.length > 0` check,
 *     so the tweet was created with media_ids: ["undefined"]. X answers 400,
 *     the adapter calls that TWITTER_VALIDATION_ERROR with retryable: false,
 *     and a transient upload glitch permanently killed the post under a cause
 *     that named the wrong thing.
 *   chunked: "undefined" became the media_id for every APPEND and FINALIZE,
 *     so the whole video was uploaded against a nonexistent id.
 *
 * All HTTP is mocked (`axios`) — nothing here contacts X, and no credential is
 * used.
 *
 * UPDATED with the all-or-nothing change (P3-A partial-media closeout):
 * uploadXMedia no longer swallows a per-image failure, so the unusable-response
 * cases below now REJECT rather than returning a short list. The guarantee
 * under test is the same one — an id X did not issue never reaches the caller —
 * and the caller-visible outcome is the same MEDIA_WOULD_BE_STRIPPED refusal.
 *
 * UPDATED for the X API v2 media migration: v2 responses carry the id at
 * `data.id` (a string) instead of v1.1's top-level `media_id_string`, and the
 * chunked flow uses the /initialize, /{id}/append and /{id}/finalize sub-paths.
 * The invariant is unchanged.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
// The download step routes through the SSRF guard; neutralise it, it is not
// what is under test here.
jest.mock('../../../lib/security/safeFetch', () => ({
  assertUrlSafe: jest.fn(async () => undefined),
  outboundBreakerFor: () => ({ call: (fn: any) => fn() }),
}), { virtual: false });

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...a: any[]) => mockGet(...a),
    post: (...a: any[]) => mockPost(...a),
  },
}));

const TOKEN = { access_token: 'tok' };
const BASE = 'https://api.x.com/2/media/upload';

/** The media download (axios.get on the source URL). */
function stubDownload(contentType: string, bytes = 32) {
  mockGet.mockImplementation(async (url: string) => {
    if (String(url).startsWith(BASE)) {
      // STATUS poll — only reached when X reports processing.
      return { data: { data: { processing_info: { state: 'succeeded' } } } };
    }
    return { data: new ArrayBuffer(bytes), headers: { 'content-type': contentType } };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Single-shot image upload
 * ────────────────────────────────────────────────────────────────────────── */
describe('single-shot image upload', () => {
  it('CRITICAL: a 200 with no data.id yields NO id — never the string "undefined"', async () => {
    // uploadXMedia is all-or-nothing, so an unusable response surfaces as a
    // rejection. xAdapter turns that into the truthful MEDIA_WOULD_BE_STRIPPED
    // failure — what is asserted here: "undefined" never becomes a media_id.
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { data: {} } }); // 200, but no data.id
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/no media id/i);
    // Nothing was handed back at all, so no "undefined" could be.
    const tweetCreate = mockPost.mock.calls.filter(([url]) => !String(url).startsWith(BASE));
    expect(tweetCreate).toHaveLength(0);
  });

  it('CRITICAL: a legacy v1.1 media_id_string body is not accepted as an id', async () => {
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { media_id_string: 'legacy-shape' } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/no media id/i);
  });

  it('CRITICAL: an empty-string data.id is rejected too', async () => {
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { data: { id: '   ' } } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/no media id/i);
  });

  it('CRITICAL: a numeric data.id is not accepted', async () => {
    // X documents the media id as a string; a numeric form is lossy in JS, so
    // accepting it would silently corrupt large ids.
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { data: { id: 1234567890123456789 } } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/no media id/i);
  });

  it('a real data.id is still returned unchanged (happy path preserved)', async () => {
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { data: { id: '99887766554433221' } } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    expect(await uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).toEqual(['99887766554433221']);
  });

  it('a batch with one unusable response rejects — it never returns the partial set', async () => {
    // Handing back the survivors WAS the silent PARTIAL strip: xAdapter saw two
    // ids, published a two-image tweet for a three-image post and reported
    // success. See xPartialMediaIntegrity.test.ts for the adapter consequence.
    stubDownload('image/jpeg');
    let call = 0;
    mockPost.mockImplementation(async () => {
      call += 1;
      return { data: call === 2 ? { data: {} } : { data: { id: `id-${call}` } } };
    });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(
      uploadXMedia(
        ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg', 'https://cdn.example.com/c.jpg'],
        TOKEN,
      ),
    ).rejects.toThrow(/no media id/i);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Chunked video upload
 * ────────────────────────────────────────────────────────────────────────── */
describe('chunked video upload', () => {
  it('CRITICAL: an initialize with no data.id rejects instead of APPENDing to "undefined"', async () => {
    stubDownload('video/mp4');
    mockPost.mockResolvedValue({ data: { data: {} } }); // initialize returns nothing usable
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.mp4'], TOKEN)).rejects.toThrow(/no media id/i);

    // The whole point: no APPEND was attempted against a nonexistent id.
    const appends = mockPost.mock.calls.filter(([url]) => String(url).endsWith('/append'));
    expect(appends).toHaveLength(0);
  });

  it('a well-formed initialize still drives append/finalize with the real id (happy path preserved)', async () => {
    stubDownload('video/mp4');
    mockPost.mockResolvedValue({ data: { data: { id: 'vid-1' } } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    expect(await uploadXMedia(['https://cdn.example.com/a.mp4'], TOKEN)).toEqual(['vid-1']);

    expect(mockPost.mock.calls.map(([url]) => String(url))).toEqual([
      `${BASE}/initialize`,
      `${BASE}/vid-1/append`,
      `${BASE}/vid-1/finalize`,
    ]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Contract with the adapter (unchanged by this fix, asserted so it stays so)
 * ────────────────────────────────────────────────────────────────────────── */
describe('no media requested', () => {
  it('returns [] without contacting X', async () => {
    const { uploadXMedia } = await import('../../adapters/xMedia');
    expect(await uploadXMedia(undefined, TOKEN)).toEqual([]);
    expect(await uploadXMedia([], TOKEN)).toEqual([]);
    expect(await uploadXMedia(['  '], TOKEN)).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
