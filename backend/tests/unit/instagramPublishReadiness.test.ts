/**
 * Instagram publishing readiness — the container → poll → publish sequence.
 *
 * Instagram has never published successfully from this platform. These tests
 * pin the parts of the Graph contract the adapter is responsible for, using a
 * recording axios double so the ORDER and SHAPE of the calls is asserted, not
 * just the return value:
 *
 *   1. POST /{ig-user-id}/media          → container id
 *   2. GET  /{container-id}?status_code  → FINISHED (required before publish)
 *   3. POST /{ig-user-id}/media_publish  → media id
 *   4. GET  /{media-id}?permalink        → the real post URL
 *
 * Nothing here reaches Instagram. The adapter's outward calls are the unit
 * under test, so axios is replaced wholesale and every request is recorded.
 */

type Recorded = { method: 'post' | 'get'; url: string; body?: any; params?: any };

const calls: Recorded[] = [];
/** Queue of responses (or thrown errors), consumed in call order. */
let queue: Array<{ data?: any; throws?: any }> = [];

function nextResponse(): any {
  const entry = queue.shift();
  if (!entry) throw new Error(`Unexpected extra HTTP call #${calls.length}: ${JSON.stringify(calls[calls.length - 1])}`);
  if (entry.throws) throw entry.throws;
  return { data: entry.data };
}

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(async (url: string, body: any, cfg: any) => {
      calls.push({ method: 'post', url, body, params: cfg?.params });
      return nextResponse();
    }),
    get: jest.fn(async (url: string, cfg: any) => {
      calls.push({ method: 'get', url, params: cfg?.params });
      return nextResponse();
    }),
  },
}));

// The branded-cover helper reaches Supabase storage; the publish sequence is
// what is under test, so it is stubbed to the "no branded cover" answer.
jest.mock('../../adapters/mediaCover', () => ({
  generateHostedBrandedCover: jest.fn(async () => null),
  resolveCoverBrand: jest.fn(async () => ({})),
}));

jest.mock('@/config', () => ({
  config: { USE_MOCK_PLATFORMS: false },
}));

import { publishToInstagram, classifyInstagramPublishError } from '../../adapters/instagramAdapter';

/** Build a Graph API failure exactly as axios surfaces it. */
function graphError(status: number, error: Record<string, unknown>) {
  return { response: { status, data: { error } }, message: 'Request failed' };
}

const ACCOUNT = { id: 'sa-1', platform: 'instagram', platform_user_id: '17841400000000000', username: 'omnivyra' };
const TOKEN = { access_token: 'redacted-test-token' };

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sp-1',
    platform: 'instagram',
    content: 'Launch day.',
    hashtags: ['#launch'],
    media_urls: ['https://cdn.example.com/hero.jpg'],
    scheduled_for: '2026-09-20T10:00:00.000Z',
    ...overrides,
  } as any;
}

beforeEach(() => {
  calls.length = 0;
  queue = [];
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Run a publish while letting the poller's timers fire immediately. */
async function runPublish(p: any) {
  const promise = publishToInstagram(p, ACCOUNT as any, TOKEN);
  // Drain pending sleeps until the publish settles.
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 400 && !settled; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
  }
  return promise;
}

describe('image publish: container → status poll → publish → permalink', () => {
  it('runs the four calls in order and returns the real permalink', async () => {
    queue = [
      { data: { id: 'container-1' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: '17999888877766655' } },
      { data: { permalink: 'https://www.instagram.com/p/Cxyz123/' } },
    ];

    const result = await runPublish(post());

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('17999888877766655');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'post https://graph.facebook.com/v22.0/17841400000000000/media',
      'get https://graph.facebook.com/v22.0/container-1',
      'post https://graph.facebook.com/v22.0/17841400000000000/media_publish',
      'get https://graph.facebook.com/v22.0/17999888877766655',
    ]);
    // The container is created as an image: image_url, and NO media_type —
    // Meta's reference defines media_type only for CAROUSEL/REELS/STORIES.
    expect(calls[0].body).toMatchObject({ image_url: 'https://cdn.example.com/hero.jpg' });
    expect(calls[0].body).not.toHaveProperty('media_type');
    // Status is polled for status_code before publishing.
    expect(calls[1].params).toMatchObject({ fields: 'status_code' });
    // media_publish carries creation_id = the container id.
    expect(calls[2].body).toEqual({ creation_id: 'container-1' });
  });

  it('never publishes a container that is not FINISHED', async () => {
    queue = [
      { data: { id: 'container-1' } },
      { data: { status_code: 'IN_PROGRESS' } },
      { data: { status_code: 'IN_PROGRESS' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: 'media-1' } },
      { data: { permalink: 'https://www.instagram.com/p/Cabc/' } },
    ];

    const result = await runPublish(post());

    expect(result.success).toBe(true);
    const publishIndex = calls.findIndex((c) => c.url.endsWith('/media_publish'));
    const statusPolls = calls.filter((c) => c.method === 'get' && c.params?.fields === 'status_code');
    expect(statusPolls).toHaveLength(3);
    // Every poll happened before the publish call.
    expect(calls.slice(0, publishIndex).filter((c) => c.params?.fields === 'status_code')).toHaveLength(3);
  });

  it('reports a container Instagram rejected as non-retryable, without publishing', async () => {
    queue = [
      { data: { id: 'container-1' } },
      { data: { status_code: 'ERROR' } },
    ];

    const result = await runPublish(post());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INSTAGRAM_MEDIA_REJECTED');
    expect(result.error?.retryable).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/media_publish'))).toBe(false);
  });

  it('does not fabricate a post URL when the permalink cannot be read', async () => {
    queue = [
      { data: { id: 'container-1' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: '17999888877766655' } },
      { throws: graphError(400, { message: 'nope', code: 100 }) },
    ];

    const result = await runPublish(post());

    expect(result.success).toBe(true);
    expect(result.platform_post_id).toBe('17999888877766655');
    // The numeric media id is NOT an instagram.com/p/ shortcode — a URL built
    // from it 404s, so no URL is better than a fake one.
    expect(result.post_url).toBeUndefined();
  });
});

describe('video / REELS handling', () => {
  it('creates a REELS container for a video URL and polls it to FINISHED', async () => {
    queue = [
      { data: { id: 'container-v' } },
      { data: { status_code: 'IN_PROGRESS' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: 'media-v' } },
      { data: { permalink: 'https://www.instagram.com/reel/Cvid/' } },
    ];

    const result = await runPublish(post({ media_urls: ['https://cdn.example.com/clip.mp4'] }));

    expect(result.success).toBe(true);
    expect(result.post_url).toBe('https://www.instagram.com/reel/Cvid/');
    expect(calls[0].body).toMatchObject({
      media_type: 'REELS',
      video_url: 'https://cdn.example.com/clip.mp4',
      share_to_feed: true,
    });
    expect(calls[0].body).not.toHaveProperty('image_url');
  });

  it('classifies a SIGNED video URL as video, not as an image', async () => {
    // Regression: publish media reaches this adapter as a Supabase signed URL
    // with a ?token= query string. A `$`-anchored extension test classified it
    // as an image and posted an .mp4 to image_url.
    queue = [
      { data: { id: 'container-v' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: 'media-v' } },
      { data: { permalink: 'https://www.instagram.com/reel/Csigned/' } },
    ];

    const signed = 'https://proj.supabase.co/storage/v1/object/sign/media/clip.mp4?token=eyJhbGciOi';
    const result = await runPublish(post({ media_urls: [signed] }));

    expect(result.success).toBe(true);
    expect(calls[0].body).toMatchObject({ media_type: 'REELS', video_url: signed });
    expect(calls[0].body).not.toHaveProperty('image_url');
  });

  it('honours share_to_feed:false from publish_settings.instagram', async () => {
    queue = [
      { data: { id: 'container-v' } },
      { data: { status_code: 'FINISHED' } },
      { data: { id: 'media-v' } },
      { data: { permalink: 'https://www.instagram.com/reel/Cx/' } },
    ];

    await runPublish(post({
      media_urls: ['https://cdn.example.com/clip.mov'],
      publish_settings: { instagram: { share_to_feed: false, cover_url: 'https://cdn.example.com/cover.jpg' } },
    }));

    expect(calls[0].body).toMatchObject({
      share_to_feed: false,
      cover_url: 'https://cdn.example.com/cover.jpg',
    });
  });
});

describe('media precondition', () => {
  /**
   * The precondition itself is CORRECT and lives upstream, in the capability
   * registry (`requiresMediaForPublish: true`) enforced by
   * validatePlatformContentCompatibility. The centralization invariant in
   * platformCapability.centralization.test.ts forbids the adapter from
   * carrying a second copy, so these tests pin the adapter's side of that
   * contract: it must not re-implement the rule, and it must not CRASH when a
   * media-less payload somehow reaches it.
   */
  it('does not re-implement the media-required rule', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../adapters/instagramAdapter.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/code:\s*'INSTAGRAM_NO_MEDIA'/);
    expect(src).not.toContain('requiresMediaForPublish');
  });

  it('does not throw a TypeError when media_urls is undefined', async () => {
    // Regression: `post.media_urls[0]` on an undefined array threw, landed in
    // the catch-all, and was reported as a RETRYABLE INSTAGRAM_API_ERROR — so
    // a permanently unpublishable row would have been retried forever.
    queue = [{ throws: graphError(400, { message: 'image_url is required', code: 100 }) }];

    const result = await runPublish(post({ media_urls: undefined }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INSTAGRAM_VALIDATION_ERROR');
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.message).not.toMatch(/Cannot read (?:property|properties)/);
  });
});

describe('error surfacing', () => {
  it('turns an expired token (HTTP 400 + OAuthException 190) into an actionable reconnect', async () => {
    // Meta does NOT return 401 for an expired token. This is the production
    // state of the Instagram connection: the token expired on 2026-07-03.
    const result = classifyInstagramPublishError(graphError(400, {
      message: 'Error validating access token: Session has expired.',
      type: 'OAuthException',
      code: 190,
      error_subcode: 463,
    }));

    expect(result.error?.code).toBe('INSTAGRAM_UNAUTHORIZED');
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.message).toMatch(/reconnect the account/i);
    expect(result.error?.message).toMatch(/instagram_content_publish/);
  });

  it('surfaces the expired token through a real publish attempt', async () => {
    queue = [{ throws: graphError(400, { message: 'Session has expired', type: 'OAuthException', code: 190 }) }];

    const result = await runPublish(post());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INSTAGRAM_UNAUTHORIZED');
    expect(result.error?.retryable).toBe(false);
  });

  it('never leaks the access token into an error message', async () => {
    queue = [{ throws: graphError(400, { message: 'Session has expired', type: 'OAuthException', code: 190 }) }];

    const result = await runPublish(post());

    expect(JSON.stringify(result)).not.toContain(TOKEN.access_token);
  });

  it('treats the publishing limit (code 9) as retryable rate limiting', async () => {
    const result = classifyInstagramPublishError(graphError(400, {
      message: 'The user is over the number of posts',
      type: 'OAuthException',
      code: 9,
    }));

    expect(result.error?.code).toBe('INSTAGRAM_RATE_LIMIT');
    expect(result.error?.retryable).toBe(true);
    expect(result.error?.message).toMatch(/100 API-published posts/);
  });

  it.each([4, 17, 32, 613, 80007])('treats throttle code %i as retryable', (code) => {
    const result = classifyInstagramPublishError(graphError(400, { message: 'throttled', code }));
    expect(result.error?.code).toBe('INSTAGRAM_RATE_LIMIT');
    expect(result.error?.retryable).toBe(true);
  });

  it('separates a missing permission from a dead credential', async () => {
    const result = classifyInstagramPublishError(graphError(400, {
      message: '(#200) Requires instagram_content_publish permission',
      type: 'OAuthException',
      code: 200,
    }));

    expect(result.error?.code).toBe('INSTAGRAM_PERMISSION_DENIED');
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.message).toMatch(/Business\/Creator account/);
  });

  it('keeps a genuine payload rejection non-retryable and reports Instagram’s own message', async () => {
    const result = classifyInstagramPublishError(graphError(400, {
      message: 'The submitted image cannot be processed',
      type: 'IGApiException',
      code: 2207052,
    }));

    expect(result.error?.code).toBe('INSTAGRAM_VALIDATION_ERROR');
    expect(result.error?.retryable).toBe(false);
    expect(result.error?.message).toBe('The submitted image cannot be processed');
  });

  it('falls back to a retryable API error for an unclassified failure', () => {
    const result = classifyInstagramPublishError(new Error('socket hang up'));
    expect(result.error?.code).toBe('INSTAGRAM_API_ERROR');
    expect(result.error?.retryable).toBe(true);
  });
});
