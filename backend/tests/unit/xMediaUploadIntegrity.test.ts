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

/** The media download (axios.get on the source URL). */
function stubDownload(contentType: string, bytes = 32) {
  mockGet.mockImplementation(async (url: string) => {
    if (String(url).includes('upload.json')) {
      // STATUS poll — only reached by the chunked flow.
      return { data: { processing_info: { state: 'succeeded' } } };
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
  it('CRITICAL: a 200 with no media_id_string yields NO id — never the string "undefined"', async () => {
    // These three used to assert `toEqual([])`, because the per-image
    // try/catch swallowed requireMediaId's throw. uploadXMedia is all-or-
    // nothing now, so the same unusable response surfaces as a rejection
    // instead of an empty list. Either way xAdapter returns the SAME truthful
    // MEDIA_WOULD_BE_STRIPPED failure — what is asserted here is unchanged:
    // the literal "undefined" never becomes a media_id.
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: {} }); // 200, but no media_id_string
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(
      /media_id_string/i,
    );
    // Nothing was handed back at all, so no "undefined" could be.
    const tweetCreate = mockPost.mock.calls.filter(([url]) => !String(url).includes('upload.json'));
    expect(tweetCreate).toHaveLength(0);
  });

  it('CRITICAL: an empty-string media_id_string is rejected too', async () => {
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { media_id_string: '   ' } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(
      /media_id_string/i,
    );
  });

  it('CRITICAL: a numeric-only media_id (no string form) is not accepted', async () => {
    // X documents media_id_string as the field to use; the numeric form is
    // lossy in JS, so accepting it would silently corrupt large ids.
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { media_id: 1234567890123456789 } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(
      /media_id_string/i,
    );
  });

  it('a real media_id_string is still returned unchanged (happy path preserved)', async () => {
    stubDownload('image/jpeg');
    mockPost.mockResolvedValue({ data: { media_id_string: '99887766554433221' } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    expect(await uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).toEqual(['99887766554433221']);
  });

  it('a batch with one unusable response rejects — it never returns the partial set', async () => {
    // Was: `expect(ids).toEqual(['id-1', 'id-3'])`. Handing back the survivors
    // WAS the silent PARTIAL strip: xAdapter saw two ids, published a
    // two-image tweet for a three-image post and reported success.
    // uploadXMedia is all-or-nothing now — see xPartialMediaIntegrity.test.ts
    // for the adapter-level consequence. The invariant this test exists for is
    // unchanged and still asserted: no id X did not issue is ever handed back.
    stubDownload('image/jpeg');
    let call = 0;
    mockPost.mockImplementation(async () => {
      call += 1;
      return { data: call === 2 ? {} : { media_id_string: `id-${call}` } };
    });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(
      uploadXMedia(
        ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg', 'https://cdn.example.com/c.jpg'],
        TOKEN,
      ),
    ).rejects.toThrow(/media_id_string/i);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Chunked video upload
 * ────────────────────────────────────────────────────────────────────────── */
describe('chunked video upload', () => {
  it('CRITICAL: an INIT with no media_id_string rejects instead of APPENDing to "undefined"', async () => {
    stubDownload('video/mp4');
    mockPost.mockResolvedValue({ data: {} }); // INIT returns nothing usable
    const { uploadXMedia } = await import('../../adapters/xMedia');

    await expect(uploadXMedia(['https://cdn.example.com/a.mp4'], TOKEN)).rejects.toThrow(/media_id_string/i);

    // The whole point: no APPEND was attempted against a nonexistent id.
    const appends = mockPost.mock.calls.filter(([, body]) => String(body).includes('command=APPEND'));
    expect(appends).toHaveLength(0);
  });

  it('a well-formed INIT still drives APPEND/FINALIZE with the real id (happy path preserved)', async () => {
    stubDownload('video/mp4');
    mockPost.mockResolvedValue({ data: { media_id_string: 'vid-1' } });
    const { uploadXMedia } = await import('../../adapters/xMedia');

    expect(await uploadXMedia(['https://cdn.example.com/a.mp4'], TOKEN)).toEqual(['vid-1']);

    const bodies = mockPost.mock.calls.map(([, body]) => String(body));
    expect(bodies.some((b) => b.includes('command=INIT'))).toBe(true);
    expect(bodies.some((b) => b.includes('command=APPEND') && b.includes('media_id=vid-1'))).toBe(true);
    expect(bodies.some((b) => b.includes('command=FINALIZE') && b.includes('media_id=vid-1'))).toBe(true);
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
