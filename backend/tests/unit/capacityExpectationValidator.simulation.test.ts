/**
 * Capacity validation simulation tests.
 * Flow: 1) Determine if user wants unique (no sharing) or open to share.
 *       2) Per content type: supply = available + (capacity × weeks), demand based on sharing choice.
 * Valid when supply >= demand for EVERY content type.
 */

import { validateCapacityVsExpectation } from '../../services/capacityExpectationValidator';

const POSTS = (platform: string, count: number) => ({ platform, content_type: 'post', count_per_week: count });
const VIDEOS = (platform: string, count: number) => ({ platform, content_type: 'video', count_per_week: count });

describe('Capacity validation simulation', () => {
  describe('Flow: User choice (unique vs share) → per-type calculation', () => {
    it('Scenario 1: UNIQUE - 2 platforms, 2 posts each = 4 unique/week. Supply 4 (2 avail + 2 cap×1 week) → valid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
        ],
        cross_platform_sharing: { enabled: false },
        campaign_duration_weeks: 1,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
      expect(r!.deficit).toBe(0);
    });

    it('Scenario 2: UNIQUE - 4 unique needed, supply 3 → invalid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 1 },
        weekly_capacity: { post: 0 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
        ],
        cross_platform_sharing: { enabled: false },
        campaign_duration_weeks: 1,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('invalid');
      expect(r!.deficit).toBeGreaterThan(0);
    });

    it('Scenario 3: SHARING - 2 platforms × 2 posts, max 2 unique/week. 4 weeks → 8 unique needed. Supply 10 → valid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
        ],
        cross_platform_sharing: { enabled: true },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
      expect(r!.deficit).toBe(0);
    });

    it('Scenario 4: SHARING - User example: 2 available + 2/week × 4 weeks = 10. 4 posts/week, 2 platforms → 4 unique/week × 4 = 16 postings → 8 unique. 10 >= 8 → valid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
        ],
        cross_platform_sharing: { enabled: true },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
    });

    it('Scenario 5: SHARING - 4 platforms (LinkedIn, FB, IG, X) × 2 posts = 8 postings, max 2. 1 post fills 4 slots. Unique = 2/week × 4 weeks = 8. Supply 2 + 2×4 = 10 → valid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
          POSTS('instagram', 2),
          POSTS('x', 2),
        ],
        cross_platform_sharing: { enabled: true },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
    });

    it('Scenario 6: SHARING - 8 posts/week across 4 platforms → 2 unique/week. 4 weeks = 8 unique. Supply 6 → invalid', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 0 },
        weekly_capacity: { post: 1 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
          POSTS('instagram', 2),
          POSTS('x', 2),
        ],
        cross_platform_sharing: { enabled: true },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('invalid');
      expect(r!.deficit).toBeGreaterThan(0);
    });

    it('Scenario 7: UNIQUE - Posts only on LinkedIn+FB (no YouTube). YouTube has videos. Per-type isolation.', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2, video: 0 },
        weekly_capacity: { post: 2, video: 1 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
          VIDEOS('youtube', 2),
        ],
        cross_platform_sharing: { enabled: false },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('invalid');
      expect(r!.deficit).toBeGreaterThan(0);
    });

    it('Scenario 8: Mixed types - posts pass, videos fail (per-type validation)', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 10, video: 0 },
        weekly_capacity: { post: 5, video: 0 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
          VIDEOS('youtube', 2),
        ],
        cross_platform_sharing: { enabled: false },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('invalid');
    });

    it('Scenario 9: Mixed types - both pass (post 16 unique, video 8 unique over 4 weeks)', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2, video: 2 },
        weekly_capacity: { post: 4, video: 2 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
          VIDEOS('youtube', 2),
        ],
        cross_platform_sharing: { enabled: false },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
    });

    it('Scenario 10: Planning labels (Text posts, Videos) parsed correctly', () => {
      const r = validateCapacityVsExpectation({
        available_content: { 'Text posts': 2 },
        weekly_capacity: { 'Text posts': 2, Videos: 1 },
        platform_content_requests: [
          POSTS('linkedin', 2),
          POSTS('facebook', 2),
        ],
        cross_platform_sharing: { enabled: true },
        campaign_duration_weeks: 4,
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
    });

    it('Scenario 11: Default campaign_duration=1 when missing', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [POSTS('linkedin', 2), POSTS('facebook', 2)],
        cross_platform_sharing: { enabled: true },
      });
      expect(r).not.toBeNull();
      expect(r!.status).toBe('valid');
    });

    it('Scenario 12: Returns null when no demand', () => {
      const r = validateCapacityVsExpectation({
        available_content: { post: 2 },
        weekly_capacity: { post: 2 },
        platform_content_requests: [],
        cross_platform_sharing: { enabled: false },
      });
      expect(r).toBeNull();
    });
  });
});
