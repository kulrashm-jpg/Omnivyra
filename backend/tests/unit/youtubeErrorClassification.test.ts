/**
 * YouTube Data API v3 adapter — provider errors must be classified honestly.
 *
 * SCOPE: error handling only. The API stays on v3 and no request shape,
 * endpoint or auth flow is changed here. Nothing in this file demonstrates that
 * live YouTube publishing works — every call is mocked.
 *
 * WHY THIS EXISTS
 * ---------------
 * 1. THE QUOTA BRANCH WAS DEAD CODE. YouTube reports quota exhaustion as HTTP
 *    403. The adapter's generic 403 branch returned first, so the quota branch
 *    written below it could never run. A temporary, self-healing condition was
 *    therefore reported as YOUTUBE_PERMISSION_DENIED with retryable: false —
 *    the post was never retried — under a message telling the operator to check
 *    a youtube.upload scope that was not missing.
 *
 * 2. THE UPLOAD PATH THREW AWAY THE PROVIDER STATUS. uploadVideoToYouTube uses
 *    `validateStatus: () => true`, so axios never throws; failures were
 *    re-raised as a bare `new Error(message)` with no `.response`. The
 *    classifier reads `error.response?.status`, so EVERY upload failure — 401
 *    auth, 403 quota, 400 validation — collapsed into YOUTUBE_API_ERROR with
 *    retryable: true. A revoked token was retried forever.
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

const basePost = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  platform: 'youtube',
  title: 'A title',
  content: 'A title\n\nA description body',
  media_urls: ['https://cdn.example.com/clip.mp4'],
  scheduled_for: new Date().toISOString(),
  ...over,
});

const quotaBody = {
  error: {
    message: 'The request cannot be completed because you have exceeded your quota.',
    errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }],
  },
};

const load = async () => (await import('../../adapters/youtubeAdapter')).publishToYouTube;

/** The video download that precedes any upload. */
function stubDownload() {
  mockGet.mockResolvedValue({
    data: new ArrayBuffer(16),
    headers: { 'content-type': 'video/mp4' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Quota is no longer dead code
 * ────────────────────────────────────────────────────────────────────────── */
describe('quota exhaustion', () => {
  it('CRITICAL: a 403/quotaExceeded is YOUTUBE_QUOTA_EXCEEDED and retryable, not a permission failure', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 403, headers: {}, data: quotaBody });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('YOUTUBE_QUOTA_EXCEEDED');
    expect(r.error?.retryable).toBe(true);
  });

  it('CRITICAL: the message no longer blames a missing youtube.upload scope', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 403, headers: {}, data: quotaBody });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.message).toMatch(/quota/i);
    expect(r.error?.message).not.toMatch(/youtube\.upload scope/);
  });

  it('a 403 that is NOT a quota reason is still a permission failure', async () => {
    stubDownload();
    mockPost.mockResolvedValue({
      status: 403,
      headers: {},
      data: { error: { message: 'Insufficient permission', errors: [{ reason: 'insufficientPermissions' }] } },
    });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_PERMISSION_DENIED');
    expect(r.error?.retryable).toBe(false);
  });

  it('a 403 with no reasons array at all is still a permission failure', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 403, headers: {}, data: { error: { message: 'Forbidden' } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_PERMISSION_DENIED');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. The upload path keeps the provider status
 * ────────────────────────────────────────────────────────────────────────── */
describe('resumable upload failures keep their status', () => {
  it('CRITICAL: a 401 on upload INIT is an auth failure, not a retryable generic error', async () => {
    stubDownload();
    mockPost.mockResolvedValue({
      status: 401,
      headers: {},
      data: { error: { message: 'Invalid Credentials' } },
    });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_UNAUTHORIZED');
    // The point: a revoked token must stop, not be retried forever.
    expect(r.error?.retryable).toBe(false);
  });

  it('CRITICAL: a 403/quota on the upload PUT reaches the quota branch', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 200, headers: { location: 'https://upload.example/session' }, data: {} });
    mockPut.mockResolvedValue({ status: 403, data: quotaBody });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_QUOTA_EXCEEDED');
    expect(r.error?.retryable).toBe(true);
  });

  it('CRITICAL: a 400 on the upload PUT is a non-retryable validation failure', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 200, headers: { location: 'https://upload.example/session' }, data: {} });
    mockPut.mockResolvedValue({ status: 400, data: { error: { message: 'Invalid video format' } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_VALIDATION_ERROR');
    expect(r.error?.retryable).toBe(false);
  });

  it('a 5xx on the upload PUT stays a retryable generic API error', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 200, headers: { location: 'https://upload.example/session' }, data: {} });
    mockPut.mockResolvedValue({ status: 503, data: { error: { message: 'Backend Error' } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_API_ERROR');
    expect(r.error?.retryable).toBe(true);
  });

  it('a successful upload is still reported as published (happy path preserved)', async () => {
    stubDownload();
    mockPost.mockResolvedValue({ status: 200, headers: { location: 'https://upload.example/session' }, data: {} });
    mockPut.mockResolvedValue({ status: 200, data: { id: 'vid-123' } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.success).toBe(true);
    expect(r.platform_post_id).toBe('vid-123');
    expect(r.post_url).toBe('https://www.youtube.com/watch?v=vid-123');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. API version and the other classifications are untouched
 * ────────────────────────────────────────────────────────────────────────── */
describe('scope protection', () => {
  it('the adapter still targets YouTube Data API v3 only', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../adapters/youtubeAdapter.ts'),
      'utf8',
    );
    expect(src).toContain('https://www.googleapis.com/upload/youtube/v3/videos');
    expect(src).toContain('https://www.googleapis.com/youtube/v3/videos');
    expect(src).not.toMatch(/youtube\/v[^3]/);
  });

  it('a missing title is still rejected before any network call', async () => {
    const r = await (await load())(
      basePost({ title: '', content: '' }) as any,
      ACCOUNT as any,
      TOKEN as any,
    );

    expect(r.error?.code).toBe('YOUTUBE_NO_TITLE');
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a 429 is still the retryable rate-limit failure', async () => {
    stubDownload();
    mockGet.mockRejectedValueOnce({ response: { status: 429, data: { error: { message: 'slow down' } } } });

    const r = await (await load())(basePost() as any, ACCOUNT as any, TOKEN as any);

    expect(r.error?.code).toBe('YOUTUBE_RATE_LIMIT');
    expect(r.error?.retryable).toBe(true);
  });
});
