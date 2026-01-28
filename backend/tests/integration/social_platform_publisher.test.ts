import { publishScheduledPost } from '../../services/socialPlatformPublisher';
import {
  getApiConfigByPlatform,
  getApiHealthByPlatform,
} from '../../services/externalApiService';

jest.mock('../../services/externalApiService', () => ({
  getApiConfigByPlatform: jest.fn(),
  getApiHealthByPlatform: jest.fn(),
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

  it('uses twitter stub', async () => {
    const result = await publishScheduledPost(
      { ...basePost, platform: 'x' as any },
      { dry_run: false, admin_override: true }
    );
    expect(result.status).toBe('PUBLISHED');
    expect(result.external_post_id).toContain('stub_twitter_');
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
