/**
 * Closure-002 R5 — which adapter outcomes prove that no post was created.
 *
 * Pure tests of backend/queue/publishOutcome.ts, plus the evidence the shared
 * adapter entry point (publishToPlatform) attaches: a failure BEFORE dispatch to
 * a platform adapter is marked delivery:'not_sent'; one after it is not.
 */
export {};

const mockGetScheduledPost = jest.fn();
const mockGetSocialAccount = jest.fn();
const mockPublishToLinkedIn = jest.fn();
const mockValidate = jest.fn();

jest.mock('../../db/queries', () => ({
  getScheduledPost: (...a: unknown[]) => mockGetScheduledPost(...a),
  getSocialAccount: (...a: unknown[]) => mockGetSocialAccount(...a),
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: jest.fn(async () => ({ access_token: 'tok', expires_at: null })),
  isTokenExpiringSoon: jest.fn(() => false),
  markSocialAccountNeedsReauth: jest.fn(async () => undefined),
}));
jest.mock('../../auth/tokenRefresh', () => ({
  refreshPlatformToken: jest.fn(async () => null),
  refreshTwitterTokenIfNeeded: jest.fn(async () => null),
}));
jest.mock('../../adapters/linkedinAdapter', () => ({ publishToLinkedIn: (...a: unknown[]) => mockPublishToLinkedIn(...a) }));
jest.mock('../../adapters/xAdapter', () => ({ publishToX: jest.fn() }));
jest.mock('../../adapters/instagramAdapter', () => ({ publishToInstagram: jest.fn() }));
jest.mock('../../adapters/facebookAdapter', () => ({ publishToFacebook: jest.fn() }));
jest.mock('../../adapters/youtubeAdapter', () => ({ publishToYouTube: jest.fn() }));
jest.mock('../../adapters/tiktokAdapter', () => ({ publishToTikTok: jest.fn() }));
jest.mock('../../adapters/spotifyAdapter', () => ({ publishToSpotify: jest.fn() }));
jest.mock('../../adapters/starmakerAdapter', () => ({ publishToStarMaker: jest.fn() }));
jest.mock('../../adapters/sunoAdapter', () => ({ publishToSuno: jest.fn() }));
jest.mock('../../adapters/pinterestAdapter', () => ({ publishToPinterest: jest.fn() }));
jest.mock('../../services/platformContentValidator', () => ({
  validatePlatformContentCompatibility: (...a: unknown[]) => mockValidate(...a),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  classifyPublishAttempt,
  hasUncertainOutcome,
  isPreCallClaim,
  isUncertainFailedPost,
  publishClaimCode,
  publishOutcomeBlocksAttempt,
} from '../../queue/publishOutcome';
import { publishToPlatform } from '../../adapters/platformAdapter';

describe('classifyPublishAttempt', () => {
  const notCreated = [
    'MEDIA_WOULD_BE_STRIPPED', 'LINKEDIN_NO_USER_ID', 'LINKEDIN_MEDIA_FETCH_FAILED', 'LINKEDIN_VIDEO_PROCESSING_FAILED',
    'LINKEDIN_UNAUTHORIZED', 'LINKEDIN_FORBIDDEN', 'LINKEDIN_VALIDATION', 'LINKEDIN_RATE_LIMIT', 'LINKEDIN_VERSION_EXPIRED',
    'TWITTER_UNAUTHORIZED', 'TWITTER_VALIDATION_ERROR', 'TWITTER_RATE_LIMIT',
    'FACEBOOK_NO_PAGE_TARGET', 'FACEBOOK_UNAUTHORIZED', 'FACEBOOK_PERMISSION_DENIED', 'FACEBOOK_VALIDATION_ERROR', 'FACEBOOK_RATE_LIMIT',
    'INSTAGRAM_UNAUTHORIZED', 'INSTAGRAM_VALIDATION_ERROR', 'INSTAGRAM_RATE_LIMIT',
    'YOUTUBE_NO_TITLE', 'YOUTUBE_QUOTA_EXCEEDED', 'YOUTUBE_RATE_LIMIT', 'YOUTUBE_VALIDATION_ERROR', 'API_NOT_AVAILABLE',
  ];
  it.each(notCreated)('%s proves nothing was created', (code) => {
    expect(classifyPublishAttempt({ success: false, error: { code } })).toBe('not_created');
  });

  const ambiguous = [
    'LINKEDIN_NETWORK_ERROR', 'LINKEDIN_API_ERROR', 'TWITTER_API_ERROR', 'FACEBOOK_API_ERROR', 'INSTAGRAM_API_ERROR',
    'YOUTUBE_API_ERROR', 'API_ERROR', 'RATE_LIMIT', 'AUTH_ERROR', 'PUBLISH_ERROR', 'PUBLISH_THREW', 'RATE_LIMITED', 'UNKNOWN_ERROR', '',
  ];
  it.each(ambiguous)('%s is ambiguous (the post may exist)', (code) => {
    expect(classifyPublishAttempt({ success: false, error: { code } })).toBe('ambiguous');
  });

  it('retryable: true is not evidence', () => {
    const adapterResult = { success: false, error: { code: 'TWITTER_API_ERROR', message: '503', retryable: true } };
    expect(classifyPublishAttempt(adapterResult)).toBe('ambiguous');
  });

  it("delivery: 'not_sent' is evidence, whatever the code", () => {
    expect(classifyPublishAttempt({ success: false, error: { code: 'PUBLISH_ERROR', delivery: 'not_sent' } })).toBe('not_created');
  });

  it('success needs a non-empty platform post id', () => {
    expect(classifyPublishAttempt({ success: true, platform_post_id: 'abc' })).toBe('published');
    expect(classifyPublishAttempt({ success: true, platform_post_id: undefined })).toBe('ambiguous');
    expect(classifyPublishAttempt({ success: true, platform_post_id: '  ' })).toBe('ambiguous');
  });

  it('missing or malformed results are ambiguous', () => {
    expect(classifyPublishAttempt(null)).toBe('ambiguous');
    expect(classifyPublishAttempt(undefined)).toBe('ambiguous');
    expect(classifyPublishAttempt({ success: false })).toBe('ambiguous');
    expect(classifyPublishAttempt({ success: false, error: null })).toBe('ambiguous');
  });
});

describe('publishOutcomeBlocksAttempt / isUncertainFailedPost', () => {
  it('blocks in-flight and uncertain rows; never a published one', () => {
    expect(publishOutcomeBlocksAttempt({ status: 'publishing' })).toBe('in_flight');
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe('uncertain');
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: 'PUBLISH_CALL_STARTED' })).toBe('uncertain');
    expect(publishOutcomeBlocksAttempt({ status: 'FAILED', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe('uncertain');
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: 'p' })).toBeNull();
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: 'LINKEDIN_RATE_LIMIT' })).toBeNull();
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED' })).toBeNull();
    expect(publishOutcomeBlocksAttempt({ status: 'scheduled' })).toBeNull();
    expect(publishOutcomeBlocksAttempt({ status: 'blocked' })).toBeNull();
  });

  it('a code-less failed row is uncertain only when the caller says so (thread nodes)', () => {
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: null })).toBeNull();
    expect(publishOutcomeBlocksAttempt({ status: 'failed', error_code: null }, { missingCodeIsUncertain: true })).toBe('uncertain');
  });

  it('isUncertainFailedPost', () => {
    expect(isUncertainFailedPost({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe(true);
    expect(isUncertainFailedPost({ status: 'failed', error_code: 'PUBLISH_CALL_STARTED' })).toBe(true);
    expect(isUncertainFailedPost({ status: 'failed', error_code: 'X' })).toBe(false);
    expect(isUncertainFailedPost({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' })).toBe(false);
    expect(isUncertainFailedPost({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: 'p' })).toBe(false);
  });
});

describe("publishToPlatform — 'not_sent' evidence", () => {
  const post = { id: 'sp-1', platform: 'linkedin', content_type: 'post', content: 'hi', media_urls: [] };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetScheduledPost.mockResolvedValue(post);
    mockGetSocialAccount.mockResolvedValue({ id: 'acct-1', platform: 'linkedin', user_id: 'u-1' });
    mockValidate.mockReturnValue({ ok: true });
  });

  it('a throw before dispatch (no social account) is not_sent — retry-safe', async () => {
    mockGetSocialAccount.mockResolvedValue(null);
    const r = await publishToPlatform('sp-1', 'acct-1');
    expect(r.success).toBe(false);
    expect(r.error).toMatchObject({ code: 'PUBLISH_ERROR', delivery: 'not_sent' });
    expect(classifyPublishAttempt(r)).toBe('not_created');
    expect(mockPublishToLinkedIn).not.toHaveBeenCalled();
  });

  it('a capability rejection is not_sent', async () => {
    mockValidate.mockReturnValue({ ok: false, code: 'MEDIA_REQUIRED', message: 'needs media', platform: 'linkedin', capability: 'x' });
    const r = await publishToPlatform('sp-1', 'acct-1');
    expect(r.error).toMatchObject({ code: 'MEDIA_REQUIRED', delivery: 'not_sent' });
  });

  it('a throw that escapes the platform adapter (after dispatch) carries no not_sent — ambiguous', async () => {
    mockPublishToLinkedIn.mockRejectedValue(new Error('socket hang up'));
    const r = await publishToPlatform('sp-1', 'acct-1');
    expect(mockPublishToLinkedIn).toHaveBeenCalledTimes(1);
    expect(r.error?.code).toBe('PUBLISH_ERROR');
    expect(r.error?.delivery).toBeUndefined();
    expect(classifyPublishAttempt(r)).toBe('ambiguous');
  });
});

describe('Closure-003 — claim evidence helpers', () => {
  it('isPreCallClaim: only publishing + PUBLISH_CLAIMED:<token>', () => {
    expect(isPreCallClaim({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:abc' })).toBe(true);
    expect(isPreCallClaim({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:' })).toBe(false);
    expect(isPreCallClaim({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' })).toBe(false);
    expect(isPreCallClaim({ status: 'publishing', error_code: null })).toBe(false);
    expect(isPreCallClaim({ status: 'failed', error_code: 'PUBLISH_CLAIMED:abc' })).toBe(false);
  });

  it('hasUncertainOutcome is decided by the code, not the status (except publishing / published)', () => {
    for (const status of ['failed', 'scheduled', 'draft', 'blocked', 'cancelled']) {
      expect(hasUncertainOutcome({ status, error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe(true);
      expect(hasUncertainOutcome({ status, error_code: 'PUBLISH_CALL_STARTED' })).toBe(true);
    }
    expect(hasUncertainOutcome({ status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' })).toBe(false);
    expect(hasUncertainOutcome({ status: 'published', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe(false);
    expect(hasUncertainOutcome({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: 'p' })).toBe(false);
    expect(hasUncertainOutcome({ status: 'failed', error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED' })).toBe(false);
    expect(publishOutcomeBlocksAttempt({ status: 'scheduled', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' })).toBe('uncertain');
  });

  it('publishClaimCode round-trips through isPreCallClaim', () => {
    expect(isPreCallClaim({ status: 'publishing', error_code: publishClaimCode('t-1') })).toBe(true);
  });
});
