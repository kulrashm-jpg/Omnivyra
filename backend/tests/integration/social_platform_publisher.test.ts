/**
 * socialPlatformPublisher — the DEPRECATED external_api_sources publish path.
 *
 * It has zero production importers (asserted by
 * platformCapability.centralization.test.ts) but is still exercised here, so
 * this suite is what would catch a fabricated publication if the module were
 * ever re-wired. Two branches used to fabricate one: X, and any platform with
 * no branch at all. Both now fail truthfully, and this suite asserts that.
 *
 * All HTTP is mocked via global.fetch (safeFetch is delegated to it below).
 * Nothing here contacts a provider and no real credential is used.
 */
import { publishScheduledPost } from '../../services/socialPlatformPublisher';
import {
  getApiConfigByPlatform,
  getApiHealthByPlatform,
} from '../../services/externalApiService';

jest.mock('../../services/externalApiService', () => ({
  getApiConfigByPlatform: jest.fn(),
  getApiHealthByPlatform: jest.fn(),
}));

// HARDEN-005A: the publisher now routes through the SSRF-safe fetcher (undici),
// not global fetch. Delegate safeFetch to the test's global.fetch mock so the
// existing per-test response stubs continue to drive it (validation is covered
// by the dedicated ssrfGuard/safeFetch suites).
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown) => (global as unknown as { fetch: (u: string, i?: unknown) => Promise<unknown> }).fetch(url, init),
}));

const basePost = {
  post_id: 'post-1',
  platform: 'linkedin' as const,
  content: 'Hello world',
  hashtags: ['#test'],
  scheduled_time: '2026-01-01T00:00:00Z',
  campaign_id: 'camp-1',
};

describe('SocialPlatformPublisher', () => {
  beforeEach(() => {
    process.env.LINKEDIN_TOKEN = 'token-linkedin';
    process.env.FACEBOOK_TOKEN = 'token-facebook';
    process.env.YOUTUBE_TOKEN = 'token-youtube';
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-1',
      name: 'LinkedIn API',
      base_url: 'https://example.com',
      purpose: 'posting',
      category: 'linkedin',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'LINKEDIN_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (getApiHealthByPlatform as jest.Mock).mockResolvedValue({
      api_source_id: 'api-1',
      freshness_score: 1,
      reliability_score: 0.8,
    });
  });

  it('returns DRY_RUN for dry run publish', async () => {
    const result = await publishScheduledPost(basePost, { dry_run: true });
    expect(result.status).toBe('DRY_RUN');
    expect(result.platform).toBe('linkedin');
    expect(result.payload_preview).toBeDefined();
  });

  it('skips unreliable API', async () => {
    (getApiHealthByPlatform as jest.Mock).mockResolvedValue({
      api_source_id: 'api-1',
      freshness_score: 1,
      reliability_score: 0.2,
    });
    const result = await publishScheduledPost(basePost, { dry_run: false });
    expect(result.status).toBe('SKIPPED_UNRELIABLE');
  });

  it('returns FORBIDDEN when admin override missing', async () => {
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-1',
      name: 'LinkedIn API',
      base_url: 'https://example.com',
      purpose: 'posting',
      category: 'linkedin',
      is_active: true,
      auth_type: 'none',
      api_key_name: null,
      created_at: '2026-01-01T00:00:00Z',
      requires_admin: true,
    });
    const result = await publishScheduledPost(basePost, {
      dry_run: false,
      admin_override: false,
    });
    expect(result.status).toBe('FORBIDDEN');
  });

  it('publishes successfully when enabled', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ln-1' }),
    });
    const result = await publishScheduledPost(basePost, { dry_run: false, admin_override: true });
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBeDefined();
  });

  it('publishes to Facebook', async () => {
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-2',
      name: 'Facebook API',
      base_url: 'page-123',
      purpose: 'posting',
      category: 'facebook',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'FACEBOOK_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'fb-1' }),
    });

    const result = await publishScheduledPost(
      { ...basePost, platform: 'facebook' as any },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('fb-1');
  });

  it('publishes to LinkedIn', async () => {
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-3',
      name: 'LinkedIn API',
      base_url: 'urn:li:person:abc',
      purpose: 'posting',
      category: 'linkedin',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'LINKEDIN_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ln-2' }),
    });

    const result = await publishScheduledPost(basePost, {
      dry_run: false,
      admin_override: true,
    });
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('ln-2');
  });

  it('publishes to YouTube', async () => {
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-4',
      name: 'YouTube API',
      base_url: 'youtube',
      purpose: 'posting',
      category: 'youtube',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'YOUTUBE_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'yt-1' }),
    });

    const result = await publishScheduledPost(
      { ...basePost, platform: 'youtube' as any },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('yt-1');
  });

  it('CRITICAL: X is reported FAILED, not as a fabricated publication', async () => {
    // Was: `expect(result.status).toBe('PUBLISHED')` and
    // `expect(result.external_post_id).toContain('stub_twitter_')`. That test
    // encoded the defect as the contract: the module returned PUBLISHED with an
    // invented `stub_twitter_<ts>` id WITHOUT calling anything, and
    // publishScheduledPost fed that id to recordPerformance() as genuine
    // platform_api data.
    (global as any).fetch = jest.fn();

    const result = await publishScheduledPost(
      { ...basePost, platform: 'x' as any },
      { dry_run: false, admin_override: true }
    );

    expect(result.status).toBe('FAILED');
    expect(result.external_post_id).toBeUndefined();
    expect(String(result.message)).toMatch(/not implemented/i);
    // And it said so without pretending to contact X.
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('CRITICAL: a platform with no implementation is FAILED, not a stub_<platform>_<hash> id', async () => {
    // 'reddit' is the one member of PublishPlatform with no branch, so it fell
    // through to the payload-hash stub and was reported as published.
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-6',
      name: 'Reddit API',
      base_url: 'https://example.com',
      purpose: 'posting',
      category: 'reddit',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'LINKEDIN_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (global as any).fetch = jest.fn();

    const result = await publishScheduledPost(
      { ...basePost, platform: 'reddit' as any },
      { dry_run: false, admin_override: true }
    );

    expect(result.status).toBe('FAILED');
    expect(result.external_post_id).toBeUndefined();
    expect(String(result.message)).toContain('Unsupported platform: reddit');
    expect(String(result.message)).not.toContain('stub_');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('a real provider id is still reported as PUBLISHED (honest path preserved)', async () => {
    // The three implemented platforms still publish; only the two fabricating
    // branches changed. This keeps the module's real behaviour under test.
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ln-real' }),
    });

    const result = await publishScheduledPost(basePost, { dry_run: false, admin_override: true });

    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toBe('ln-real');
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('returns FAILED on API error', async () => {
    (getApiConfigByPlatform as jest.Mock).mockResolvedValue({
      id: 'api-5',
      name: 'Facebook API',
      base_url: 'page-123',
      purpose: 'posting',
      category: 'facebook',
      is_active: true,
      auth_type: 'none',
      api_key_name: 'FACEBOOK_TOKEN',
      created_at: '2026-01-01T00:00:00Z',
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'fail' } }),
    });

    const result = await publishScheduledPost(
      { ...basePost, platform: 'facebook' as any },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('FAILED');
  });
});
