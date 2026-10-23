/**
 * API-B — the X adapter's media contract, exercised as BEHAVIOUR.
 *
 * `publishMediaHonesty.test.ts` pins the P3-A invariant by reading the adapter
 * SOURCE. This suite pins the same invariant by actually calling `publishToX`,
 * so the decision survives a refactor that keeps the strings but loses the
 * control flow.
 *
 * THE DECISION UNDER TEST (xAdapter.ts:153 — "refuse to post text-only")
 * ---------------------------------------------------------------------
 * A post that asked for media and got no media_ids is a FAILURE, not a
 * text-only success. That stays true after the v1.1 → v2 media migration:
 *
 *  - Publishing text-only is IRREVERSIBLE and user-visible: the reviewed image
 *    campaign is live on X as bare text and cannot be un-published.
 *  - Failing is RECOVERABLE: the failure is marked `retryable: true`, so the
 *    existing BullMQ retry/DLQ path gets another attempt with no new mechanism.
 *  - The migration changes the failure *rate*, not the right response to a
 *    failure. Against the sunset v1.1 endpoint the upload failed every time, so
 *    the refusal looked like a blanket block; on v2 it fires only on a genuine
 *    provider error.
 *
 * Also asserts that the id handoff to POST /2/tweets uses the documented
 * `media: { media_ids: [...] }` shape
 * (https://docs.x.com/x-api/media/introduction).
 */

export {};

const mockPost = jest.fn();
const mockUploadXMedia = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...args: any[]) => mockPost(...args) },
}));
jest.mock('@/config', () => ({
  config: { USE_MOCK_PLATFORMS: false },
  getValidatedConfig: () => ({}),
}));
// Only the upload is mocked; the composition pre-check (planXMediaComposition)
// stays real so publishToX's refusal ordering is exercised too.
jest.mock('../../adapters/xMedia', () => ({
  ...jest.requireActual('../../adapters/xMedia'),
  uploadXMedia: (...args: any[]) => mockUploadXMedia(...args),
}));

import { PipelineErrorCode } from '../../../lib/shared/pipelineErrorCodes';

const load = () => require('../../adapters/xAdapter');

const POST = {
  id: 'post-1',
  platform: 'x',
  content: 'Launch day.',
  media_urls: ['https://cdn.example.com/a.jpg'],
  scheduled_for: new Date().toISOString(),
};
const ACCOUNT = { id: 'acc-1', platform: 'x', platform_user_id: '9', username: 'omnivyra' };
const TOKEN = { access_token: 'user-context-bearer' };

beforeEach(() => {
  jest.resetModules();
  mockPost.mockReset();
  mockUploadXMedia.mockReset();
  mockPost.mockResolvedValue({ data: { data: { id: '1750000000000000000' } } });
});

describe('media requested but no media_ids came back', () => {
  it('EMPTY ids → structured failure, and NOTHING is published', async () => {
    mockUploadXMedia.mockResolvedValue([]);
    const result = await load().publishToX(POST, ACCOUNT, TOKEN);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(result.error.message).toMatch(/TEXT ONLY/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('THROWN upload error → structured failure, and NOTHING is published', async () => {
    mockUploadXMedia.mockRejectedValue(new Error('X media processing failed: InvalidMedia'));
    const result = await load().publishToX(POST, ACCOUNT, TOKEN);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('both shapes are RETRYABLE, so the existing BullMQ retry/DLQ path applies', async () => {
    mockUploadXMedia.mockResolvedValue([]);
    expect((await load().publishToX(POST, ACCOUNT, TOKEN)).error.retryable).toBe(true);
    jest.resetModules();
    mockUploadXMedia.mockRejectedValue(new Error('boom'));
    expect((await load().publishToX(POST, ACCOUNT, TOKEN)).error.retryable).toBe(true);
  });

  it('the failure never leaks the bearer token into the message', async () => {
    mockUploadXMedia.mockRejectedValue(new Error('401 for Bearer user-context-bearer'));
    const result = await load().publishToX(POST, ACCOUNT, TOKEN);
    expect(JSON.stringify(result)).not.toContain('user-context-bearer');
  });
});

describe('the successful paths are unchanged by the migration', () => {
  it('uploaded ids attach as media.media_ids on POST /2/tweets', async () => {
    mockUploadXMedia.mockResolvedValue(['111', '222']);
    const result = await load().publishToX(POST, ACCOUNT, TOKEN);
    expect(result.success).toBe(true);
    const [url, payload, cfg] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.twitter.com/2/tweets');
    expect(payload.media).toEqual({ media_ids: ['111', '222'] });
    expect(cfg.headers.Authorization).toBe('Bearer user-context-bearer');
    expect(result.platform_post_id).toBe('1750000000000000000');
  });

  it('a genuinely text-only post never calls the media uploader', async () => {
    const result = await load().publishToX({ ...POST, media_urls: [] }, ACCOUNT, TOKEN);
    expect(result.success).toBe(true);
    expect(mockUploadXMedia).not.toHaveBeenCalled();
    expect(mockPost.mock.calls[0][1].media).toBeUndefined();
  });

  it('thread chaining still sets reply.in_reply_to_tweet_id', async () => {
    await load().publishToX({ ...POST, media_urls: [] }, ACCOUNT, TOKEN, {
      replyToPlatformPostId: '1700000000000000000',
    });
    expect(mockPost.mock.calls[0][1].reply).toEqual({ in_reply_to_tweet_id: '1700000000000000000' });
  });

  it('a 401 from tweet-create is still reported as a non-retryable reconnect', async () => {
    const err: any = new Error('unauthorized');
    err.response = { status: 401, data: {} };
    mockPost.mockRejectedValue(err);
    const result = await load().publishToX({ ...POST, media_urls: [] }, ACCOUNT, TOKEN);
    expect(result.error.code).toBe('TWITTER_UNAUTHORIZED');
    expect(result.error.retryable).toBe(false);
  });
});
