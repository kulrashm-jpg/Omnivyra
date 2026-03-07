/**
 * Unit tests for BOLT Optimization Service
 */
import {
  applyBoltOptimizations,
  type SlotInput,
  type CompanyPerformanceInsights,
} from '../../services/boltOptimizationService';

describe('boltOptimizationService', () => {
  describe('applyBoltOptimizations', () => {
    it('prioritizes high-performing platforms', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'post' },
        { day_index: 2, platform: 'x', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        high_performing_platforms: [{ value: 'x', avgEngagement: 50, signalCount: 10 }],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result).toHaveLength(2);
      expect(result[0]?.platform).toBe('x');
      expect(result[1]?.platform).toBe('x');
    });

    it('boosts high-performing content types', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'blog' },
        { day_index: 2, platform: 'linkedin', content_type: 'carousel' },
        { day_index: 3, platform: 'linkedin', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        high_performing_content_types: [{ value: 'carousel', avgEngagement: 80, signalCount: 12 }],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result).toHaveLength(3);
      expect(result[0]?.content_type).toBe('carousel');
    });

    it('reduces low-performing patterns', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'blog' },
        { day_index: 2, platform: 'linkedin', content_type: 'carousel' },
        { day_index: 3, platform: 'linkedin', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        low_performing_patterns: [
          { content_type: 'blog', reason: 'Below-average engagement on content type' },
        ],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result).toHaveLength(3);
      expect(result[result.length - 1]?.content_type).toBe('blog');
    });

    it('deterministic behavior maintained', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'post' },
        { day_index: 2, platform: 'linkedin', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        high_performing_platforms: [{ value: 'linkedin' }],
      };
      const run1 = applyBoltOptimizations(slots, insights);
      const run2 = applyBoltOptimizations(slots, insights);
      expect(run1).toEqual(run2);
    });

    it('swaps platform to high-performer when content_type supports alternatives', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        high_performing_platforms: [{ value: 'x' }],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result[0]?.platform).toBe('x');
      expect(result[0]?.content_type).toBe('post');
    });

    it('empty insights returns slots unchanged in order', () => {
      const slots: SlotInput[] = [
        { day_index: 3, platform: 'linkedin', content_type: 'carousel' },
        { day_index: 1, platform: 'blog', content_type: 'blog' },
      ];
      const result = applyBoltOptimizations(slots, {});
      expect(result).toHaveLength(2);
      expect(result[0]?.day_index).toBe(3);
      expect(result[1]?.day_index).toBe(1);
    });

    it('low-performing platform deprioritized', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'x', content_type: 'thread' },
        { day_index: 2, platform: 'linkedin', content_type: 'post' },
      ];
      const insights: CompanyPerformanceInsights = {
        low_performing_patterns: [{ platform: 'x', reason: 'Low engagement' }],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[1]?.platform).toBe('x');
    });

    it('combined high and low: high wins', () => {
      const slots: SlotInput[] = [
        { day_index: 1, platform: 'linkedin', content_type: 'blog' },
        { day_index: 2, platform: 'x', content_type: 'carousel' },
      ];
      const insights: CompanyPerformanceInsights = {
        high_performing_platforms: [{ value: 'linkedin' }],
        high_performing_content_types: [{ value: 'carousel' }],
        low_performing_patterns: [{ content_type: 'blog', reason: 'Low' }],
      };
      const result = applyBoltOptimizations(slots, insights);
      expect(result[0]?.content_type).toBe('carousel');
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[1]?.content_type).toBe('blog');
    });
  });
});
