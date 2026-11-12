/**
 * Unread-error census, publishNowService: on the validation-failure paths the error CODE now lands
 * in the same single write as the failed status (updateScheduledPostOnFailure, which throws on
 * error). The separate error_code write was unread, so a failure there left a code-less failed row
 * (read as uncertain on thread nodes). Harness copied from publishNowService.capability.test.ts.
 */
jest.mock('../../db/queries', () => ({
  getScheduledPost: jest.fn(),
  updateScheduledPostOnPublish: jest.fn(),
  // As the real one answers: a moved row. (A bare jest.fn() answered undefined, which the real one never does.)
  updateScheduledPostOnFailure: jest.fn(async () => ({ applied: true })),
  // Post-level claim protocol (#151): the call-started marker and the
  // uncertain-outcome record. The marker lands, so the adapter is reachable.
  markScheduledPostPlatformCallStarted: jest.fn(async () => true),
  markScheduledPostOutcomeUncertain: jest.fn(async () => true),
}));
jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn(),
}));
// A chainable write builder: every filtered UPDATE (the post-level claim's
// compare-and-set included) matches the one post, so publishNow takes the
// claim and reaches capability validation. The previous double only allowed
// `.update().eq()` and could not express the claim at all.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['update', 'insert', 'eq', 'neq', 'in', 'is', 'lt', 'lte', 'gt', 'gte', 'select']) {
      builder[m] = () => builder;
    }
    builder.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 'sp-1' }], error: null }).then(ok, err);
    return builder;
  },
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
    // A status the scheduled_posts CHECK constraint allows AND the post-level
    // claim accepts ('PENDING' is neither: the claim refused it, so every
    // test here stopped at 'not_claimable' before capability validation).
    status: 'scheduled',
    error_code: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Awaited<ReturnType<typeof getScheduledPost>>;
}

beforeEach(() => { jest.clearAllMocks(); });

test('a capability rejection records status AND code in ONE failure write (4th argument = the code), pinned to the claim of this run', async () => {
  mockedGetScheduledPost.mockResolvedValue(fakePost({ platform: 'instagram', content_type: 'post', media_urls: [] }));
  const result = await publishNow({ scheduled_post_id: 'sp-1', social_account_id: 'acct-1', user_id: 'user-1', publish_source: 'queue' });
  expect(result.status).toBe('FAILED');
  expect(mockedPublishToPlatform).not.toHaveBeenCalled();
  expect(mockedUpdateOnFailure).toHaveBeenCalledTimes(1);
  const [postId, message, expectedFrom, code, expectedErrorCode] = mockedUpdateOnFailure.mock.calls[0];
  expect(postId).toBe('sp-1');
  expect(typeof message).toBe('string');
  // CLASS-2 D5: only while THIS execution holds its claim (status publishing AND its claim code).
  expect(expectedFrom).toBe('publishing');
  expect(String(expectedErrorCode)).toMatch(/^PUBLISH_CLAIMED:.+/);
  expect(typeof code).toBe('string');
  expect(String(code).length).toBeGreaterThan(0);
}, 60_000);

test('CLASS-2 D5: the claim was taken over before the pre-call failure write -> nothing written over the new holder; the run reports it was superseded', async () => {
  mockedGetScheduledPost.mockResolvedValue(fakePost({ platform: 'instagram', content_type: 'post', media_urls: [] }));
  mockedUpdateOnFailure.mockResolvedValueOnce({ applied: false, reason: 'cas_mismatch' } as never);
  const result = await publishNow({ scheduled_post_id: 'sp-1', social_account_id: 'acct-1', user_id: 'user-1', publish_source: 'queue' });
  expect(result).toMatchObject({ status: 'FAILED', suppressed: true, refusal: 'held_by_another_execution' });
  expect(mockedPublishToPlatform).not.toHaveBeenCalled();
}, 60_000);
