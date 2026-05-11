/**
 * Queue / Scheduled publish validation tests (Round 2 Phase 5).
 *
 * publishNowService is the lowest-shared publish orchestration layer used by:
 *   - /api/social/publish (super-admin & user direct publish)
 *   - the queue worker / publishProcessor (scheduled posts firing on cron)
 *   - any future internal caller
 *
 * The capability validation moved INTO publishNowService in Round-2 Phase 2,
 * so this test exercises the lower-layer guarantee: incompatible publishes
 * are rejected at the orchestration layer, before adapter selection.
 */

jest.mock('../../db/queries', () => ({
  getScheduledPost: jest.fn(),
  updateScheduledPostOnPublish: jest.fn(),
  updateScheduledPostOnFailure: jest.fn(),
}));
jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  }),
}));
jest.mock('../../services/errorRecoveryService', () => ({
  categorizeError: jest.fn(() => ({ code: 'UNKNOWN', message: 'Unknown error', user_message: 'Unknown error' })),
}));
jest.mock('../../services/analyticsService', () => ({ recordPostAnalytics: jest.fn() }));
jest.mock('../../services/activityLogger', () => ({ logActivity: jest.fn() }));
jest.mock('../../services/CampaignCompletionService', () => ({
  checkAndCompleteCampaignIfEligible: jest.fn(),
}));

import { publishNow } from '../../services/publishNowService';
import { getScheduledPost, updateScheduledPostOnFailure } from '../../db/queries';
import { publishToPlatform } from '../../adapters/platformAdapter';

const mockedGetScheduledPost = getScheduledPost as jest.MockedFunction<typeof getScheduledPost>;
const mockedPublishToPlatform = publishToPlatform as jest.MockedFunction<typeof publishToPlatform>;
const mockedUpdateOnFailure = updateScheduledPostOnFailure as jest.MockedFunction<typeof updateScheduledPostOnFailure>;

function fakePost(overrides: Partial<Awaited<ReturnType<typeof getScheduledPost>>> = {}) {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    social_account_id: 'acct-1',
    platform: 'instagram',
    content_type: 'post',
    content: 'Hello world',
    hashtags: [],
    media_urls: [],
    scheduled_for: new Date().toISOString(),
    status: 'PENDING',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Awaited<ReturnType<typeof getScheduledPost>>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('publishNowService — capability validation (queue/scheduled path)', () => {
  test('Instagram + text-only post is rejected BEFORE adapter is called', async () => {
    mockedGetScheduledPost.mockResolvedValue(fakePost({ platform: 'instagram', content_type: 'post', media_urls: [] }));

    const result = await publishNow({
      scheduled_post_id: 'sp-1',
      social_account_id: 'acct-1',
      user_id: 'user-1',
      publish_source: 'queue',
    });

    expect(result.status).toBe('FAILED');
    expect(mockedPublishToPlatform).not.toHaveBeenCalled();
    expect(mockedUpdateOnFailure).toHaveBeenCalled();
    // The failure message comes from the validator/registry, not the adapter.
    expect(result.message).toMatch(/instagram|media/i);
  });

  test('Instagram + image post WITH media reaches the adapter', async () => {
    mockedGetScheduledPost.mockResolvedValue(
      fakePost({
        platform: 'instagram',
        content_type: 'carousel',
        media_urls: ['https://example.com/photo.jpg'],
      }),
    );
    mockedPublishToPlatform.mockResolvedValue({
      success: true,
      platform_post_id: 'ig-xyz',
      post_url: 'https://www.instagram.com/p/xyz',
      published_at: new Date(),
    });

    const result = await publishNow({
      scheduled_post_id: 'sp-1',
      social_account_id: 'acct-1',
      user_id: 'user-1',
      publish_source: 'queue',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(mockedPublishToPlatform).toHaveBeenCalledTimes(1);
  });

  test('LinkedIn + text post passes validation and reaches the adapter', async () => {
    mockedGetScheduledPost.mockResolvedValue(fakePost({ platform: 'linkedin', content_type: 'post' }));
    mockedPublishToPlatform.mockResolvedValue({
      success: true,
      platform_post_id: 'li-1',
      post_url: 'https://www.linkedin.com/p/1',
      published_at: new Date(),
    });

    const result = await publishNow({
      scheduled_post_id: 'sp-1',
      social_account_id: 'acct-1',
      user_id: 'user-1',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(mockedPublishToPlatform).toHaveBeenCalledTimes(1);
  });

  test('Unresolved capability (unknown content_type) rejects publish', async () => {
    mockedGetScheduledPost.mockResolvedValue(fakePost({ platform: 'linkedin', content_type: 'mystery-format' }));

    const result = await publishNow({
      scheduled_post_id: 'sp-1',
      social_account_id: 'acct-1',
      user_id: 'user-1',
    });

    expect(result.status).toBe('FAILED');
    expect(mockedPublishToPlatform).not.toHaveBeenCalled();
  });
});
