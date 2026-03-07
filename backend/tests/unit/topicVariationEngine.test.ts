/**
 * Unit tests for Topic Variation Engine
 */
import { generateTopicVariants } from '../../services/topicVariationEngine';
import { generateThemesForCampaignWeeks } from '../../services/strategicThemeEngine';

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('topicVariationEngine', () => {
  describe('generateTopicVariants', () => {
    it('generates multiple variants for AI topics', () => {
      const variants = generateTopicVariants('AI marketing');
      expect(variants.length).toBeGreaterThan(1);
      expect(variants).toContain('AI marketing');
      expect(variants.some((v) => v.includes('AI-driven'))).toBe(true);
      expect(variants.some((v) => v.includes('AI-powered'))).toBe(true);
    });

    it('removes duplicate variants', () => {
      const variants = generateTopicVariants('AI marketing');
      const seen = new Set(variants.map((v) => v.toLowerCase()));
      expect(seen.size).toBe(variants.length);
    });

    it('deterministic output', () => {
      const r1 = generateTopicVariants('AI marketing');
      const r2 = generateTopicVariants('AI marketing');
      expect(r1).toEqual(r2);
    });

    it('works with non-AI topics', () => {
      const variants = generateTopicVariants('content strategy');
      expect(variants).toHaveLength(1);
      expect(variants[0]).toBe('content strategy');
    });

    it('returns original for empty or unknown patterns', () => {
      expect(generateTopicVariants('B2B social')).toEqual(['B2B social']);
      expect(generateTopicVariants('')).toEqual([]);
    });

    it('includes marketing automation variant when topic has marketing', () => {
      const variants = generateTopicVariants('AI marketing');
      expect(variants.some((v) => v.includes('marketing automation'))).toBe(true);
    });
  });

  describe('integration with theme generation', () => {
    it('generateThemesForCampaignWeeks uses topic variants across weeks', async () => {
      const themes = await generateThemesForCampaignWeeks('AI marketing', 4);
      expect(themes).toHaveLength(4);
      const unique = new Set(themes);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('deterministic: same topic + weeks produces same themes', async () => {
      const r1 = await generateThemesForCampaignWeeks('AI marketing', 4);
      const r2 = await generateThemesForCampaignWeeks('AI marketing', 4);
      expect(r1).toEqual(r2);
    });
  });
});
