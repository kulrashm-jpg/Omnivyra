/**
 * G-2 and G-3: refusals inside publishToPlatform that sent nothing must say so.
 * Drives the real router, the real platform-content validator and the real
 * outcome classifier. Adapters, token store and queries are recording doubles;
 * no provider is involved.
 */
const mockGetSocialAccount = jest.fn();
const mockGetToken = jest.fn();
const mockLinkedIn = jest.fn();
let mockPlatform = 'linkedin';
let mockUseMock = false;

jest.mock('@/config', () => ({
  config: { get USE_MOCK_PLATFORMS() { return mockUseMock; } },
  getValidatedConfig: () => ({}),
}));
jest.mock('../../db/queries', () => ({
  getScheduledPost: async (id: string) => ({ id, platform: mockPlatform, content_type: 'post', content: 'body', media_urls: [] }),
  getSocialAccount: (...a: unknown[]) => mockGetSocialAccount(...a),
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: unknown[]) => mockGetToken(...a),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: jest.fn(), refreshTwitterTokenIfNeeded: jest.fn() }));
jest.mock('../../adapters/linkedinAdapter', () => ({ publishToLinkedIn: (...a: unknown[]) => mockLinkedIn(...a) }));

import { publishToPlatform } from '../../adapters/platformAdapter';
import { mockPlatformsRefusals } from '../../adapters/mockPlatformGuard';
import { classifyPublishAttempt } from '../../queue/publishOutcome';

const SAVED = { ...process.env };
beforeEach(() => {
  mockPlatform = 'linkedin';
  mockUseMock = false;
  for (const m of [mockGetSocialAccount, mockGetToken, mockLinkedIn]) m.mockReset();
  mockGetSocialAccount.mockImplementation(async () => ({ id: 'a-1', platform: mockPlatform }));
  mockGetToken.mockResolvedValue({ access_token: 't' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...SAVED }; });

describe('G-2: a registered platform with no adapter', () => {
  it.each(['reddit', 'threads'])('%s reports a definite failure, not an uncertain one', async (platform) => {
    mockPlatform = platform;
    const result = await publishToPlatform('sp-1', 'a-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: 'PLATFORM_ADAPTER_MISSING', retryable: false, delivery: 'not_sent',
    });
    expect(classifyPublishAttempt(result)).toBe('not_created');
  });

  it('an adapter that throws after dispatch is still uncertain', async () => {
    mockLinkedIn.mockRejectedValue(new Error('socket hang up'));
    const result = await publishToPlatform('sp-1', 'a-1');
    expect(result.error?.delivery).toBeUndefined();
    expect(classifyPublishAttempt(result)).toBe('ambiguous');
  });
});

describe('G-3: mock platforms are refused in production', () => {
  const base = { NODE_ENV: 'test' };

  it('reasons name each production signal and never carry a value', () => {
    expect(mockPlatformsRefusals(base)).toEqual([]);
    expect(mockPlatformsRefusals({ NODE_ENV: 'development' })).toEqual([]);
    expect(mockPlatformsRefusals({ NODE_ENV: 'production' })).toEqual(['NODE_ENV is production']);
    expect(mockPlatformsRefusals({ ...base, VERCEL_ENV: 'preview' })).toEqual(['deployment marker VERCEL_ENV is set']);
    expect(mockPlatformsRefusals({ ...base, RAILWAY_SERVICE_ID: 'svc' })).toEqual(['deployment marker RAILWAY_SERVICE_ID is set']);
    const local = mockPlatformsRefusals({ ...base, SUPABASE_URL: 'https://klkiseupptzbecbxwrky.supabase.co' });
    expect(local).toEqual(['SUPABASE_URL carries a production marker']);
  });

  it('with the flag on in production, no adapter runs and the refusal is definite', async () => {
    mockUseMock = true;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const result = await publishToPlatform('sp-1', 'a-1');

    expect(mockLinkedIn).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.platform_post_id).toBeUndefined();
    expect(result.error).toMatchObject({ code: 'MOCK_PLATFORMS_REFUSED', retryable: false, delivery: 'not_sent' });
    expect(classifyPublishAttempt(result)).toBe('not_created');
  });

  it('a deployment marker refuses even when NODE_ENV is not production', async () => {
    mockUseMock = true;
    process.env.RAILWAY_SERVICE_ID = 'svc';
    const result = await publishToPlatform('sp-1', 'a-1');
    expect(mockLinkedIn).not.toHaveBeenCalled();
    expect(result.error?.code).toBe('MOCK_PLATFORMS_REFUSED');
  });

  it('with the flag on outside production, the mock adapter path still runs', async () => {
    mockUseMock = true;
    mockLinkedIn.mockResolvedValue({ success: true, platform_post_id: 'mock_linkedin_1' });
    const result = await publishToPlatform('sp-1', 'a-1');
    expect(mockLinkedIn).toHaveBeenCalledTimes(1);
    expect(result.platform_post_id).toBe('mock_linkedin_1');
  });

  it('with the flag off in production, the real adapter path is not refused', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    mockLinkedIn.mockResolvedValue({ success: true, platform_post_id: 'urn:1' });
    const result = await publishToPlatform('sp-1', 'a-1');
    expect(result.platform_post_id).toBe('urn:1');
  });
});
