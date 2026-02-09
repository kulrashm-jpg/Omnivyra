import { __testUtils } from '../../services/campaignIntelligenceService';

const { normalizeStatus, normalizeTopic, uniqueStrings } = __testUtils;

describe('campaignIntelligenceService', () => {
  describe('status normalization', () => {
    it('raw active -> active', () => {
      const result = normalizeStatus({
        rawStatus: 'active',
        readinessState: null,
        executionSummary: {
          scheduled_posts_total: 0,
          scheduled_posts_by_status: {},
          scheduled_posts: 0,
          published_posts: 0,
          failed_posts: 0,
        },
      });
      expect(result).toBe('active');
    });

    it('raw completed -> completed', () => {
      const result = normalizeStatus({
        rawStatus: 'completed',
        readinessState: null,
        executionSummary: {
          scheduled_posts_total: 0,
          scheduled_posts_by_status: {},
          scheduled_posts: 0,
          published_posts: 0,
          failed_posts: 0,
        },
      });
      expect(result).toBe('completed');
    });

    it('raw pending_approval + no posts -> planned', () => {
      const result = normalizeStatus({
        rawStatus: 'pending_approval',
        readinessState: null,
        executionSummary: {
          scheduled_posts_total: 0,
          scheduled_posts_by_status: {},
          scheduled_posts: 0,
          published_posts: 0,
          failed_posts: 0,
        },
      });
      expect(result).toBe('planned');
    });

    it('raw missing + published posts -> active', () => {
      const result = normalizeStatus({
        rawStatus: null,
        readinessState: null,
        executionSummary: {
          scheduled_posts_total: 2,
          scheduled_posts_by_status: { published: 2 },
          scheduled_posts: 0,
          published_posts: 2,
          failed_posts: 0,
        },
      });
      expect(result).toBe('active');
    });

    it('raw paused -> abandoned', () => {
      const result = normalizeStatus({
        rawStatus: 'paused',
        readinessState: null,
        executionSummary: {
          scheduled_posts_total: 0,
          scheduled_posts_by_status: {},
          scheduled_posts: 0,
          published_posts: 0,
          failed_posts: 0,
        },
      });
      expect(result).toBe('abandoned');
    });
  });

  describe('topic normalization and de-duplication', () => {
    it('normalizes, trims, strips punctuation, and de-dupes', () => {
      const rawTopics = [
        '  AI Strategy  ',
        'ai strategy.',
        'AI strategy',
        'Growth. ',
        '  growth',
      ];
      const normalized = rawTopics.map((topic) => normalizeTopic(topic));
      const collapsed = uniqueStrings(normalized);
      expect(collapsed).toEqual(['AI Strategy', 'Growth']);
    });

    it('collapses multiple sources into one list', () => {
      const weeklyThemes = ['Product Launch', 'Market Entry'];
      const dailyTopics = ['product launch.', '  MARKET entry  ', 'Growth'];
      const trendTopics = ['growth', 'Market Entry.'];

      const combined = [
        ...weeklyThemes.map((t) => normalizeTopic(t)),
        ...dailyTopics.map((t) => normalizeTopic(t)),
        ...trendTopics.map((t) => normalizeTopic(t)),
      ];

      const collapsed = uniqueStrings(combined);
      expect(collapsed).toEqual(['Product Launch', 'Market Entry', 'Growth']);
    });
  });
});
