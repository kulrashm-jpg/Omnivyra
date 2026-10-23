/**
 * API-B — X/Twitter media upload migrated from the SUNSET v1.1 endpoint to the
 * X API v2 media surface.
 *
 * THE DEFECT THIS ENCODES
 * -----------------------
 * `backend/adapters/xMedia.ts` uploaded through
 *   POST https://upload.twitter.com/1.1/media/upload.json
 * with the command-style protocol (`command=INIT|APPEND|FINALIZE|STATUS`,
 * base64 `media_data`, x-www-form-urlencoded). X sunset the v1.1 media upload
 * endpoints on 2025-06-09, so every media post was structurally impossible.
 *
 * The contract asserted below is the documented v2 one:
 *   POST /2/media/upload                      multipart: media, media_category
 *   POST /2/media/upload/initialize           json: media_type, total_bytes, media_category
 *   POST /2/media/upload/{id}/append          multipart: segment_index, media
 *   POST /2/media/upload/{id}/finalize        (no body)
 *   GET  /2/media/upload?command=STATUS&media_id={id}
 * with the id read from `data.id` (v1.1 returned `media_id_string`).
 *
 * Sources: docs.x.com/x-api/media/{introduction,upload-media,
 * media-upload-initialize,append-media-upload,finalize-media-upload,
 * get-media-upload-status} and the chunked quickstart.
 */

export {};

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockAssertUrlSafe = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: (...args: any[]) => mockPost(...args),
    get: (...args: any[]) => mockGet(...args),
  },
}));

jest.mock('../../../lib/security/safeFetch', () => ({
  assertUrlSafe: (...args: any[]) => mockAssertUrlSafe(...args),
}));

const BASE = 'https://api.x.com/2/media/upload';
const TOKEN = { access_token: 'user-context-bearer' };

/** Calls that downloaded the user's media (not X API calls). */
const downloadCalls = () => mockGet.mock.calls.filter((c) => c[1]?.responseType === 'arraybuffer');
/** Calls that polled the v2 STATUS endpoint. */
const statusCalls = () => mockGet.mock.calls.filter((c) => c[1]?.params?.command === 'STATUS');
const postUrls = () => mockPost.mock.calls.map((c) => String(c[0]));

/** Route axios.get: media download vs STATUS poll. */
function wireDownload(bytes: Buffer, contentType: string, statusSequence: any[] = []) {
  let statusIdx = 0;
  mockGet.mockImplementation((url: string, cfg: any) => {
    if (cfg?.responseType === 'arraybuffer') {
      return Promise.resolve({ data: bytes, headers: { 'content-type': contentType } });
    }
    if (cfg?.params?.command === 'STATUS') {
      const next = statusSequence[Math.min(statusIdx, statusSequence.length - 1)];
      statusIdx++;
      return Promise.resolve({ data: { data: { id: '42', processing_info: next } } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function httpError(status: number, detail?: string) {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: detail ? { detail } : {} };
  return err;
}

const load = () => require('../../adapters/xMedia');

beforeEach(() => {
  jest.resetModules();
  mockPost.mockReset();
  mockGet.mockReset();
  mockAssertUrlSafe.mockReset();
  mockAssertUrlSafe.mockResolvedValue(undefined);
});

/* ────────────────────────────────────────────────────────────────────────
 * 1. THE SUNSET ENDPOINT IS GONE
 * ──────────────────────────────────────────────────────────────────────── */
describe('the v1.1 media upload protocol is not used anywhere', () => {
  const source = () =>
    require('fs').readFileSync(require('path').join(__dirname, '../../adapters/xMedia.ts'), 'utf8');
  /** Comment-free source: the migration docblock names the old host on purpose. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('no code path references upload.twitter.com or /1.1/', () => {
    const src = code(source());
    expect(src).not.toContain('upload.twitter.com');
    expect(src).not.toContain('/1.1/');
  });

  it('the command-style protocol (command=INIT/APPEND/FINALIZE, media_data) is gone', () => {
    const src = code(source());
    expect(src).not.toMatch(/command:\s*'(INIT|APPEND|FINALIZE)'/);
    expect(src).not.toContain('media_data');
    expect(src).not.toContain('media_id_string');
  });

  it('every X call targets the fixed api.x.com v2 media host', () => {
    expect(code(source())).toContain("'https://api.x.com/2/media/upload'");
  });

  it('the SSRF seam is still used for the user-controlled media URL', () => {
    const src = code(source());
    expect(src).toContain('assertUrlSafe');
    expect(src).toContain('lib/security/safeFetch');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. IMAGE — POST /2/media/upload (simple, multipart)
 * ──────────────────────────────────────────────────────────────────────── */
describe('image upload → POST /2/media/upload', () => {
  beforeEach(() => {
    wireDownload(Buffer.from('jpeg-bytes'), 'image/jpeg');
    mockPost.mockResolvedValue({ data: { data: { id: '1880028106020515840', media_key: '3_18800' } } });
  });

  it('posts exactly once, to the v2 simple-upload URL', async () => {
    const ids = await load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN);
    expect(ids).toEqual(['1880028106020515840']);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe(BASE);
  });

  it('sends multipart/form-data with the documented field names', async () => {
    await load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN);
    const body = mockPost.mock.calls[0][1];
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('media_category')).toBe('tweet_image');
    const part: any = body.get('media');
    expect(part).toBeInstanceOf(Blob);
    expect(part.type).toBe('image/jpeg');
    expect(part.size).toBe(Buffer.from('jpeg-bytes').length);
  });

  it('authenticates with the OAuth 2.0 user-context bearer and lets axios set the boundary', async () => {
    await load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN);
    const cfg = mockPost.mock.calls[0][2];
    expect(cfg.headers.Authorization).toBe('Bearer user-context-bearer');
    // Content-Type must NOT be pinned — axios derives it with the multipart boundary.
    expect(cfg.headers['Content-Type']).toBeUndefined();
    expect(cfg.timeout).toBe(60000);
  });

  it('reads the id from `data.id` (v2), not a top-level media_id_string (v1.1)', async () => {
    mockPost.mockResolvedValue({ data: { media_id_string: 'legacy-shape' } });
    // no data.id → a failed upload (all-or-nothing), never a bogus id
    await expect(load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(
      /upload returned no media id/,
    );
  });

  it('runs the media URL through assertUrlSafe before downloading', async () => {
    await load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN);
    expect(mockAssertUrlSafe).toHaveBeenCalledWith('https://cdn.example.com/a.jpg');
    expect(downloadCalls()).toHaveLength(1);
  });

  it('uploads all 4 images of a 4-image post', async () => {
    const urls = ['a', 'b', 'c', 'd'].map((n) => `https://cdn.example.com/${n}.jpg`);
    const ids = await load().uploadXMedia(urls, TOKEN);
    expect(ids).toHaveLength(4);
    expect(postUrls()).toEqual([BASE, BASE, BASE, BASE]);
  });

  it('REFUSES a 5-image post (X composition rule) before any upload — never trims to 4', async () => {
    const urls = ['a', 'b', 'c', 'd', 'e'].map((n) => `https://cdn.example.com/${n}.jpg`);
    await expect(load().uploadXMedia(urls, TOKEN)).rejects.toThrow(/at most 4 images/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('returns [] for no media without calling X', async () => {
    expect(await load().uploadXMedia([], TOKEN)).toEqual([]);
    expect(await load().uploadXMedia(undefined, TOKEN)).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. VIDEO — initialize / append / finalize / STATUS
 * ──────────────────────────────────────────────────────────────────────── */
describe('video upload → the v2 chunked endpoints', () => {
  const MEDIA_ID = '1880028106020515840';

  function wireChunked(finalizeProcessing: any = undefined) {
    mockPost.mockImplementation((url: string) => {
      if (url === `${BASE}/initialize`) return Promise.resolve({ data: { data: { id: MEDIA_ID } } });
      if (url === `${BASE}/${MEDIA_ID}/append`) return Promise.resolve({ data: { data: { expires_at: 1 } } });
      if (url === `${BASE}/${MEDIA_ID}/finalize`) {
        return Promise.resolve({ data: { data: { id: MEDIA_ID, processing_info: finalizeProcessing } } });
      }
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
  }

  it('walks initialize → append → finalize in order, on the dedicated sub-paths', async () => {
    wireDownload(Buffer.from('mp4-bytes'), 'video/mp4');
    wireChunked();
    const ids = await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    expect(ids).toEqual([MEDIA_ID]);
    expect(postUrls()).toEqual([
      `${BASE}/initialize`,
      `${BASE}/${MEDIA_ID}/append`,
      `${BASE}/${MEDIA_ID}/finalize`,
    ]);
  });

  it('initialize sends a JSON body with media_type / total_bytes / media_category', async () => {
    const bytes = Buffer.from('mp4-bytes');
    wireDownload(bytes, 'video/mp4');
    wireChunked();
    await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    const [, body, cfg] = mockPost.mock.calls[0];
    expect(body).toEqual({ media_type: 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' });
    expect(cfg.headers['Content-Type']).toBe('application/json');
    expect(cfg.headers.Authorization).toBe('Bearer user-context-bearer');
  });

  it('append sends multipart segment_index + media (raw bytes, not base64)', async () => {
    const bytes = Buffer.from('mp4-bytes');
    wireDownload(bytes, 'video/mp4');
    wireChunked();
    await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    const body = mockPost.mock.calls[1][1];
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('segment_index')).toBe('0');
    const part: any = body.get('media');
    expect(part).toBeInstanceOf(Blob);
    expect(part.size).toBe(bytes.length); // base64 would be ~4/3 of this
  });

  it('finalize posts no body', async () => {
    wireDownload(Buffer.from('mp4-bytes'), 'video/mp4');
    wireChunked();
    await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    expect(mockPost.mock.calls[2][1]).toBeUndefined();
  });

  it('splits a >4MB asset into consecutive 4MB segments', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 7);
    wireDownload(big, 'video/mp4');
    wireChunked();
    await load().uploadXMedia(['https://cdn.example.com/big.mp4'], TOKEN);
    const appends = mockPost.mock.calls.filter((c) => String(c[0]).endsWith('/append'));
    expect(appends).toHaveLength(3);
    expect(appends.map((c) => c[1].get('segment_index'))).toEqual(['0', '1', '2']);
    expect(appends.map((c) => (c[1].get('media') as any).size)).toEqual([
      4 * 1024 * 1024,
      4 * 1024 * 1024,
      1024 * 1024,
    ]);
  });

  it('an animated GIF also goes through the chunked flow with media_category tweet_gif', async () => {
    wireDownload(Buffer.from('gif-bytes'), 'image/gif');
    wireChunked();
    await load().uploadXMedia(['https://cdn.example.com/loop.gif'], TOKEN);
    expect(mockPost.mock.calls[0][1]).toMatchObject({ media_category: 'tweet_gif', media_type: 'image/gif' });
  });

  it('a video mixed with images is REFUSED before any download or upload', async () => {
    wireDownload(Buffer.from('mp4-bytes'), 'video/mp4');
    wireChunked();
    await expect(
      load().uploadXMedia(['https://cdn.example.com/clip.mp4', 'https://cdn.example.com/a.jpg'], TOKEN),
    ).rejects.toThrow(/cannot mix/);
    expect(downloadCalls()).toHaveLength(0);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. ASYNC PROCESSING — GET /2/media/upload?command=STATUS
 * ──────────────────────────────────────────────────────────────────────── */
describe('async transcoding is polled on the v2 STATUS endpoint', () => {
  const MEDIA_ID = '1880028106020515840';

  function wireChunked(finalizeProcessing: any) {
    mockPost.mockImplementation((url: string) => {
      if (url === `${BASE}/initialize`) return Promise.resolve({ data: { data: { id: MEDIA_ID } } });
      if (url.endsWith('/append')) return Promise.resolve({ data: { data: {} } });
      return Promise.resolve({ data: { data: { id: MEDIA_ID, processing_info: finalizeProcessing } } });
    });
  }

  it('polls until succeeded, using command=STATUS and media_id as query params', async () => {
    wireDownload(Buffer.from('mp4'), 'video/mp4', [{ state: 'succeeded' }]);
    wireChunked({ state: 'in_progress', check_after_secs: 1 });
    const ids = await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    expect(ids).toEqual([MEDIA_ID]);
    const polls = statusCalls();
    expect(polls).toHaveLength(1);
    expect(polls[0][0]).toBe(BASE);
    expect(polls[0][1].params).toEqual({ command: 'STATUS', media_id: MEDIA_ID });
    expect(polls[0][1].headers.Authorization).toBe('Bearer user-context-bearer');
  });

  it('does not poll at all when finalize reports no processing_info', async () => {
    wireDownload(Buffer.from('mp4'), 'video/mp4');
    wireChunked(undefined);
    await load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN);
    expect(statusCalls()).toHaveLength(0);
  });

  it('rejects when processing fails, surfacing X’s message', async () => {
    wireDownload(Buffer.from('mp4'), 'video/mp4', [
      { state: 'failed', error: { message: 'InvalidMedia' } },
    ]);
    wireChunked({ state: 'pending', check_after_secs: 1 });
    await expect(load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN)).rejects.toThrow(
      /X media processing failed: InvalidMedia/,
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 5. FAILURE MODES
 * ──────────────────────────────────────────────────────────────────────── */
describe('failure modes', () => {
  it('401 (missing media.write scope / dead token) on an image REJECTS', async () => {
    wireDownload(Buffer.from('jpeg'), 'image/jpeg');
    mockPost.mockRejectedValue(httpError(401, 'Unauthorized'));
    await expect(load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/401/);
  });

  it('413 (payload too large) on an image REJECTS', async () => {
    wireDownload(Buffer.from('jpeg'), 'image/jpeg');
    mockPost.mockRejectedValue(httpError(413));
    await expect(load().uploadXMedia(['https://cdn.example.com/a.jpg'], TOKEN)).rejects.toThrow(/413/);
  });

  it('one bad image fails the whole set — never a partial id list (all-or-nothing)', async () => {
    wireDownload(Buffer.from('jpeg'), 'image/jpeg');
    mockPost
      .mockRejectedValueOnce(httpError(400, 'bad'))
      .mockResolvedValue({ data: { data: { id: 'ok-2' } } });
    await expect(
      load().uploadXMedia(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'], TOKEN),
    ).rejects.toThrow(/400/);
  });

  it('a video failure REJECTS (it is the whole post)', async () => {
    wireDownload(Buffer.from('mp4'), 'video/mp4');
    mockPost.mockRejectedValue(httpError(400, 'Invalid media_category'));
    await expect(load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN)).rejects.toThrow();
  });

  it('initialize returning no data.id rejects rather than appending to `undefined`', async () => {
    wireDownload(Buffer.from('mp4'), 'video/mp4');
    mockPost.mockResolvedValue({ data: { data: {} } });
    await expect(load().uploadXMedia(['https://cdn.example.com/clip.mp4'], TOKEN)).rejects.toThrow(
      /initialize returned no media id/,
    );
    expect(postUrls()).toEqual([`${BASE}/initialize`]);
  });

  it('an image over the documented 5MB limit is rejected before any upload is spent', async () => {
    wireDownload(Buffer.alloc(6 * 1024 * 1024, 1), 'image/jpeg');
    await expect(load().uploadXMedia(['https://cdn.example.com/huge.jpg'], TOKEN)).rejects.toThrow(/5MB/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('an SSRF-blocked media URL never reaches the download or X', async () => {
    mockAssertUrlSafe.mockRejectedValue(new Error('SSRF blocked'));
    await expect(load().uploadXMedia(['http://169.254.169.254/latest/meta-data'], TOKEN)).rejects.toThrow(
      /SSRF blocked/,
    );
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
