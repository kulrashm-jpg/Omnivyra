/**
 * YouTube publish flow — "already on YouTube" must mean a YouTube URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * publishToYouTube chooses between two completely different flows from
 * media_urls[0]:
 *
 *   - upload the file (resumable INIT -> PUT), or
 *   - treat it as a video already on the channel and PUT metadata at that id.
 *
 * The test that picked between them was `videoUrl.match(/[?&]v=([^&]+)/)` —
 * a `v=` query parameter ANYWHERE in the URL, with no check that the URL is a
 * YouTube URL. Its own comment claimed "Extract video ID from YouTube URL".
 *
 * So a cache-busted or versioned media file — `…/clip.mp4?v=3` — was read as
 * YouTube video id "3". Instead of being uploaded, the post's title,
 * description and privacyStatus were PUT at a video the channel does not own.
 * The real video never reached YouTube, and the row failed as
 * YOUTUBE_PERMISSION_DENIED with a message telling the operator to check the
 * youtube.upload scope, which was never the problem.
 *
 * Query strings on media URLs are ordinary in this repo: instagramAdapter.ts
 * carries an incident note about `…/clip.mp4?token=…`, and xMedia's type
 * regexes are all terminated `(\?|#|$)` for the same reason.
 *
 * All HTTP is mocked (`axios`). Nothing here contacts YouTube or Google and no
 * credential is used.
 */

export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../adapters/mediaCover', () => ({ resolveCoverBrand: jest.fn(async () => ({})) }));
jest.mock('../../adapters/youtubeThumbnail', () => ({
  generateBrandedYouTubeThumbnail: jest.fn(async () => null),
  setYouTubeThumbnail: jest.fn(async () => undefined),
}));
jest.mock('../../../lib/security/safeFetch', () => ({
  assertUrlSafe: jest.fn(async () => undefined),
  outboundBreakerFor: () => ({ call: (fn: any) => fn() }),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...a: any[]) => mockGet(...a),
    post: (...a: any[]) => mockPost(...a),
    put: (...a: any[]) => mockPut(...a),
  },
}));

const ACCOUNT = { id: 'a1', platform: 'youtube', platform_user_id: 'UC-channel' };
const TOKEN = { access_token: 'tok' };

const basePost = (mediaUrl: string) => ({
  id: 'p1',
  platform: 'youtube',
  title: 'A title',
  content: 'A title\n\nA description body',
  media_urls: [mediaUrl],
  scheduled_for: new Date().toISOString(),
});

const load = async () => (await import('../../adapters/youtubeAdapter')).publishToYouTube;
const loadHelper = async () =>
  (await import('../../adapters/youtubeAdapter')).extractExistingYouTubeVideoId;

/** A healthy resumable upload: download -> INIT (Location) -> PUT (id). */
function stubHealthyUpload() {
  mockGet.mockResolvedValue({
    data: new ArrayBuffer(64),
    headers: { 'content-type': 'video/mp4' },
  });
  mockPost.mockResolvedValue({
    status: 200,
    headers: { location: 'https://upload.googleapis.com/resumable/session-1' },
    data: {},
  });
  mockPut.mockResolvedValue({ status: 200, data: { id: 'uploaded-1' } });
}

/** Which axios.put calls were metadata updates on the videos endpoint? */
const metadataUpdates = () =>
  mockPut.mock.calls.filter(([url]) => String(url) === 'https://www.googleapis.com/youtube/v3/videos');

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe('extractExistingYouTubeVideoId', () => {
  it('CRITICAL: a versioned/cache-busted media file is NOT a YouTube video id', async () => {
    const extract = await loadHelper();
    expect(extract('https://cdn.example.com/clip.mp4?v=3')).toBeNull();
    expect(extract('https://storage.example.com/a/b/clip.mp4?token=abc&v=2')).toBeNull();
  });

  it('a real YouTube watch URL still yields its id', async () => {
    const extract = await loadHelper();
    expect(extract('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extract('https://youtube.com/watch?v=abc123&t=30s')).toBe('abc123');
    expect(extract('https://m.youtube.com/watch?v=abc123')).toBe('abc123');
  });

  it('a YouTube URL with no v parameter, and unparseable input, yield null', async () => {
    const extract = await loadHelper();
    expect(extract('https://www.youtube.com/watch')).toBeNull();
    expect(extract('https://www.youtube.com/watch?v=')).toBeNull();
    expect(extract('not a url')).toBeNull();
    expect(extract('')).toBeNull();
  });

  it('a look-alike host is not trusted (explicit allow list, no subdomain matching)', async () => {
    const extract = await loadHelper();
    expect(extract('https://youtube.com.evil.example/watch?v=abc')).toBeNull();
    expect(extract('https://notyoutube.com/watch?v=abc')).toBeNull();
  });
});

describe('publish flow routing', () => {
  it('CRITICAL: a `?v=` media file is UPLOADED, not PUT as metadata at video id "3"', async () => {
    stubHealthyUpload();
    const publishToYouTube = await load();

    const result = await publishToYouTube(
      basePost('https://cdn.example.com/clip.mp4?v=3') as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('uploaded-1');
    // The real defect: no metadata PUT at a video the channel does not own.
    expect(metadataUpdates()).toHaveLength(0);
    // And the resumable upload session was actually opened.
    expect(mockPost).toHaveBeenCalledWith(
      'https://www.googleapis.com/upload/youtube/v3/videos',
      expect.anything(),
      expect.anything(),
    );
  });

  it('a genuine YouTube watch URL still takes the metadata-update path (preserved)', async () => {
    mockPut.mockResolvedValue({ status: 200, data: { id: 'dQw4w9WgXcQ' } });
    const publishToYouTube = await load();

    const result = await publishToYouTube(
      basePost('https://www.youtube.com/watch?v=dQw4w9WgXcQ') as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('dQw4w9WgXcQ');
    expect(result.post_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(metadataUpdates()).toHaveLength(1);
    // Nothing was downloaded or uploaded for an already-published video.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('an ordinary media file with no query string is unaffected', async () => {
    stubHealthyUpload();
    const publishToYouTube = await load();

    const result = await publishToYouTube(
      basePost('https://cdn.example.com/clip.mp4') as any,
      ACCOUNT as any,
      TOKEN,
    );

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('uploaded-1');
    expect(metadataUpdates()).toHaveLength(0);
  });
});
