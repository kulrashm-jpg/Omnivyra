/**
 * Unit tests for the engagement capability map.
 *
 * The map is the single boundary decision: every user-initiated engagement
 * send is rejected unless its (platform, action) pair is `api_verified`.
 * These tests enforce the shape and the specific trust decisions so a
 * regression can't silently re-enable an unsupported pair.
 */

import {
  ENGAGEMENT_CAPABILITY_MATRIX,
  ENGAGEMENT_PLATFORMS,
  VERIFIED_ENGAGEMENT_PLATFORMS,
  VERIFIED_PUBLISH_PLATFORMS,
  isEngagementPlatformVerified,
  isPublishPlatformVerified,
  resolveEngagementCapability,
} from '../../services/engagementCapabilityMap';

describe('engagementCapabilityMap', () => {
  describe('matrix shape', () => {
    it('defines every action for every platform (no implicit undefined rows)', () => {
      for (const platform of ENGAGEMENT_PLATFORMS) {
        const row = ENGAGEMENT_CAPABILITY_MATRIX[platform];
        expect(row).toBeDefined();
        expect(row.reply).toBeDefined();
        expect(row.like).toBeDefined();
        expect(row.dm).toBeDefined();
        expect(row.post_create).toBeDefined();
      }
    });

    it('uses only the two allowed status values', () => {
      const allowed = new Set(['api_verified', 'unsupported']);
      for (const platform of ENGAGEMENT_PLATFORMS) {
        for (const action of ['reply', 'like', 'dm', 'post_create'] as const) {
          const cap = ENGAGEMENT_CAPABILITY_MATRIX[platform][action];
          expect(allowed.has(cap.status)).toBe(true);
        }
      }
    });

    it('every verified row declares an execution mode', () => {
      for (const platform of ENGAGEMENT_PLATFORMS) {
        for (const action of ['reply', 'like', 'dm', 'post_create'] as const) {
          const cap = ENGAGEMENT_CAPABILITY_MATRIX[platform][action];
          if (cap.status === 'api_verified') {
            expect(['api', 'browser']).toContain(cap.mode);
          }
        }
      }
    });

    it('every unsupported row has a human-readable reason', () => {
      for (const platform of ENGAGEMENT_PLATFORMS) {
        for (const action of ['reply', 'like', 'dm', 'post_create'] as const) {
          const cap = ENGAGEMENT_CAPABILITY_MATRIX[platform][action];
          if (cap.status === 'unsupported') {
            expect(typeof cap.reason).toBe('string');
            expect((cap.reason ?? '').length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('locked-in trust decisions', () => {
    // These assertions encode the decisions we made during the hardening
    // pass. If any of them flip, someone should have to write a migration
    // and update this test, not silently widen the trust surface.
    it('DM browser dispatch is verified where extension handlers exist', () => {
      for (const platform of ['linkedin', 'facebook', 'instagram', 'twitter'] as const) {
        expect(ENGAGEMENT_CAPABILITY_MATRIX[platform].dm.status).toBe('api_verified');
        expect(ENGAGEMENT_CAPABILITY_MATRIX[platform].dm.mode).toBe('browser');
      }
    });

    it('TikTok and Pinterest have no verified inbox actions (reply/like/dm)', () => {
      for (const platform of ['tiktok', 'pinterest'] as const) {
        expect(ENGAGEMENT_CAPABILITY_MATRIX[platform].reply.status).toBe('unsupported');
        expect(ENGAGEMENT_CAPABILITY_MATRIX[platform].like.status).toBe('unsupported');
        expect(ENGAGEMENT_CAPABILITY_MATRIX[platform].dm.status).toBe('unsupported');
      }
    });

    it('TikTok and Pinterest have verified post_create', () => {
      expect(ENGAGEMENT_CAPABILITY_MATRIX.tiktok.post_create.status).toBe('api_verified');
      expect(ENGAGEMENT_CAPABILITY_MATRIX.pinterest.post_create.status).toBe('api_verified');
    });

    it('Facebook and Instagram engagement actions require a business account', () => {
      for (const platform of ['facebook', 'instagram'] as const) {
        const reply = ENGAGEMENT_CAPABILITY_MATRIX[platform].reply;
        expect(reply.status).toBe('api_verified');
        expect(reply.account_type).toBe('business');
      }
    });

    it('YouTube like on comments is unsupported (no like-of-comment via API)', () => {
      expect(ENGAGEMENT_CAPABILITY_MATRIX.youtube.like.status).toBe('unsupported');
    });

    it('Reddit post_create is unsupported (adapter is a stub today)', () => {
      expect(ENGAGEMENT_CAPABILITY_MATRIX.reddit.post_create.status).toBe('unsupported');
    });
  });

  describe('VERIFIED_ENGAGEMENT_PLATFORMS', () => {
    it('includes only platforms with at least one verified inbox action', () => {
      for (const platform of VERIFIED_ENGAGEMENT_PLATFORMS) {
        const row = ENGAGEMENT_CAPABILITY_MATRIX[platform as (typeof ENGAGEMENT_PLATFORMS)[number]];
        const hasInbox =
          row.reply.status === 'api_verified' ||
          row.like.status === 'api_verified' ||
          row.dm.status === 'api_verified';
        expect(hasInbox).toBe(true);
      }
    });

    it('excludes TikTok and Pinterest (they only have publish)', () => {
      expect(VERIFIED_ENGAGEMENT_PLATFORMS).not.toContain('tiktok');
      expect(VERIFIED_ENGAGEMENT_PLATFORMS).not.toContain('pinterest');
    });

    it('includes the six inbox platforms', () => {
      for (const platform of ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'reddit']) {
        expect(VERIFIED_ENGAGEMENT_PLATFORMS).toContain(platform);
      }
    });
  });

  describe('VERIFIED_PUBLISH_PLATFORMS', () => {
    it('includes TikTok and Pinterest (publish-only platforms)', () => {
      expect(VERIFIED_PUBLISH_PLATFORMS).toContain('tiktok');
      expect(VERIFIED_PUBLISH_PLATFORMS).toContain('pinterest');
    });

    it('excludes Reddit (post_create is stubbed)', () => {
      expect(VERIFIED_PUBLISH_PLATFORMS).not.toContain('reddit');
    });
  });

  describe('resolveEngagementCapability', () => {
    it('maps "x" to twitter for backward compatibility', () => {
      const cap = resolveEngagementCapability('x', 'reply');
      expect(cap.status).toBe('api_verified');
    });

    it('returns unsupported with a reason for a totally unknown platform', () => {
      const cap = resolveEngagementCapability('myspace', 'reply');
      expect(cap.status).toBe('unsupported');
      expect(cap.reason).toMatch(/not a verified engagement surface/i);
    });

    it('returns unsupported for null/undefined/empty platform', () => {
      for (const input of [null, undefined, '', '   ']) {
        expect(resolveEngagementCapability(input, 'reply').status).toBe('unsupported');
      }
    });
  });

  describe('trust boundary: fail-closed by construction', () => {
    // No fallback, no default-allow. A platform must appear by name in the
    // matrix to be considered verified. Freeze this invariant explicitly so
    // a future refactor can't introduce a catch-all permit.
    it('returns unsupported for a platform that is NOT in the matrix', () => {
      const unknownPlatforms = ['myspace', 'bluesky', 'mastodon', 'threads', ''];
      for (const platform of unknownPlatforms) {
        for (const action of ['reply', 'like', 'dm', 'post_create'] as const) {
          const cap = resolveEngagementCapability(platform, action);
          expect(cap.status).toBe('unsupported');
        }
      }
    });

    it('returns unsupported (never undefined) for garbage inputs', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const garbage: any[] = [null, undefined, 42, {}, [], true];
      for (const input of garbage) {
        const cap = resolveEngagementCapability(input, 'reply');
        expect(cap).toBeDefined();
        expect(cap.status).toBe('unsupported');
        expect(typeof cap.reason).toBe('string');
      }
    });

    it('rejects unsupported actions for known platforms without permissive fallback', () => {
      for (const platform of ['youtube', 'reddit']) {
        const cap = resolveEngagementCapability(platform, 'dm');
        expect(cap.status).toBe('unsupported');
      }
    });
  });

  describe('is*PlatformVerified helpers', () => {
    it('isEngagementPlatformVerified returns true only for inbox platforms', () => {
      expect(isEngagementPlatformVerified('linkedin')).toBe(true);
      expect(isEngagementPlatformVerified('x')).toBe(true); // aliased to twitter
      expect(isEngagementPlatformVerified('tiktok')).toBe(false);
      expect(isEngagementPlatformVerified('myspace')).toBe(false);
    });

    it('isPublishPlatformVerified returns true for publish platforms including TikTok/Pinterest', () => {
      expect(isPublishPlatformVerified('tiktok')).toBe(true);
      expect(isPublishPlatformVerified('pinterest')).toBe(true);
      expect(isPublishPlatformVerified('linkedin')).toBe(true);
      expect(isPublishPlatformVerified('reddit')).toBe(false);
      expect(isPublishPlatformVerified('myspace')).toBe(false);
    });
  });
});
