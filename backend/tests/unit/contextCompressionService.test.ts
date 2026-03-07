/**
 * Unit tests for Context Compression Service
 */
import {
  buildCampaignContext,
  getCampaignContext,
  setCampaignContext,
  clearCampaignContext,
  type CampaignContext,
  type CampaignContextInput,
} from '../../services/contextCompressionService';

describe('contextCompressionService', () => {
  beforeEach(() => {
    clearCampaignContext('test-campaign-1');
    clearCampaignContext('test-campaign-2');
  });

  describe('buildCampaignContext', () => {
    it('builds compact context from minimal input', () => {
      const input: CampaignContextInput = { topic: 'Product launch' };
      const result = buildCampaignContext(input);

      expect(result).toEqual({
        topic: 'Product launch',
        tone: 'professional',
        themes: [],
        top_platforms: [],
        top_content_types: [],
      });
    });

    it('builds compact context with strategy memory arrays only', () => {
      const input: CampaignContextInput = {
        topic: 'Brand awareness',
        tone: 'conversational',
        strategyMemory: {
          preferred_platforms: ['linkedin', 'x'],
          preferred_content_types: ['post', 'video'],
        },
      };
      const result = buildCampaignContext(input);

      expect(result.topic).toBe('Brand awareness');
      expect(result.tone).toBe('conversational');
      expect(result.themes).toEqual([]);
      expect(result.top_platforms).toContain('linkedin');
      expect(result.top_platforms).toContain('x');
      expect(result.top_content_types).toContain('post');
      expect(result.top_content_types).toContain('video');
    });

    it('compresses performance insights to top 3 platforms and content types', () => {
      const input: CampaignContextInput = {
        topic: 'Campaign',
        companyPerformanceInsights: {
          high_performing_platforms: [
            { value: 'linkedin' },
            { value: 'instagram' },
            { value: 'x' },
            { value: 'tiktok' },
          ],
          high_performing_content_types: [
            { value: 'post' },
            { value: 'video' },
            { value: 'carousel' },
            { value: 'reel' },
          ],
        },
      };
      const result = buildCampaignContext(input);

      expect(result.top_platforms.length).toBeLessThanOrEqual(3);
      expect(result.top_content_types.length).toBeLessThanOrEqual(3);
      expect(result.top_platforms).toContain('linkedin');
      expect(result.top_platforms).toContain('instagram');
      expect(result.top_platforms).toContain('x');
      expect(result.top_content_types).toContain('post');
      expect(result.top_content_types).toContain('video');
      expect(result.top_content_types).toContain('carousel');
    });

    it('extracts themes from string array', () => {
      const input: CampaignContextInput = {
        topic: 'Q1 campaign',
        themes: ['Lead gen', 'Authority building', 'Community'],
      };
      const result = buildCampaignContext(input);

      expect(result.themes).toEqual(['Lead gen', 'Authority building', 'Community']);
    });

    it('extracts themes from full theme objects', () => {
      const input: CampaignContextInput = {
        topic: 'Campaign',
        themes: [
          { topicTitle: 'Week 1 theme' },
          { title: 'Week 2 topic' },
          { topic: 'Week 3 angle' },
        ],
      };
      const result = buildCampaignContext(input);

      expect(result.themes).toContain('Week 1 theme');
      expect(result.themes).toContain('Week 2 topic');
      expect(result.themes).toContain('Week 3 angle');
    });

    it('removes unused fields — output has only expected keys', () => {
      const input: CampaignContextInput = {
        topic: 'X',
        companyPerformanceInsights: {
          high_performing_platforms: [{ value: 'linkedin' }],
          high_performing_content_types: [{ value: 'post' }],
        },
      };
      const result = buildCampaignContext(input);

      const keys = Object.keys(result);
      expect(keys).toEqual(['topic', 'tone', 'themes', 'top_platforms', 'top_content_types']);
      expect(keys).not.toContain('companyPerformanceInsights');
      expect(keys).not.toContain('strategyMemory');
      expect(keys).not.toContain('avgEngagement');
      expect(keys).not.toContain('signalCount');
    });

    it('produces deterministic output for same input', () => {
      const input: CampaignContextInput = {
        topic: 'Deterministic test',
        strategyMemory: { preferred_platforms: ['x', 'linkedin'], preferred_content_types: ['video'] },
      };

      const result1 = buildCampaignContext(input);
      const result2 = buildCampaignContext(input);

      expect(result1).toEqual(result2);
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });

    it('normalizes twitter to x', () => {
      const input: CampaignContextInput = {
        topic: 'X',
        strategyMemory: { preferred_platforms: ['twitter', 'linkedin'] },
      };
      const result = buildCampaignContext(input);

      expect(result.top_platforms).toContain('x');
      expect(result.top_platforms).not.toContain('twitter');
    });

    it('deduplicates sources — strategy memory and performance insights merged', () => {
      const input: CampaignContextInput = {
        topic: 'Merge test',
        strategyMemory: { preferred_platforms: ['linkedin'], preferred_content_types: ['post'] },
        companyPerformanceInsights: {
          high_performing_platforms: [{ value: 'linkedin' }],
          high_performing_content_types: [{ value: 'post' }],
        },
      };
      const result = buildCampaignContext(input);

      expect(result.top_platforms).toContain('linkedin');
      expect(result.top_content_types).toContain('post');
      expect(result.top_platforms.length).toBe(1);
      expect(result.top_content_types.length).toBe(1);
    });
  });

  describe('campaign context cache', () => {
    it('getCampaignContext returns null for uncached campaign', () => {
      expect(getCampaignContext('nonexistent')).toBeNull();
    });

    it('setCampaignContext and getCampaignContext roundtrip', () => {
      const ctx: CampaignContext = {
        topic: 'Cached',
        tone: 'professional',
        themes: ['A', 'B'],
        top_platforms: ['linkedin'],
        top_content_types: ['post'],
      };
      setCampaignContext('test-campaign-1', ctx);
      const retrieved = getCampaignContext('test-campaign-1');
      expect(retrieved).toEqual(ctx);
    });

    it('clearCampaignContext removes cached context', () => {
      const ctx: CampaignContext = {
        topic: 'To clear',
        tone: 'professional',
        themes: [],
        top_platforms: [],
        top_content_types: [],
      };
      setCampaignContext('test-campaign-2', ctx);
      expect(getCampaignContext('test-campaign-2')).not.toBeNull();
      clearCampaignContext('test-campaign-2');
      expect(getCampaignContext('test-campaign-2')).toBeNull();
    });
  });
});
