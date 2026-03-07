/**
 * Unit tests for Theme Angle Engine
 */
import { generateThemeFromTopic } from '../../services/themeAngleEngine';
import { generateThemeFromTopic as generateThemeWithRefinement } from '../../services/strategicThemeEngine';

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('themeAngleEngine', () => {
  describe('generateThemeFromTopic', () => {
    it('generates theme for topic', () => {
      const result = generateThemeFromTopic('AI marketing');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('AI');
      expect(result).toContain('Marketing');
    });

    it('produces diverse angles', () => {
      const topics = [
        'AI marketing',
        'Content automation',
        'Social selling',
        'Video marketing',
        'Influencer campaigns',
        'Email personalization',
      ];
      const results = new Set<string>();
      for (const topic of topics) {
        results.add(generateThemeFromTopic(topic));
      }
      expect(results.size).toBeGreaterThan(1);
    });

    it('never returns "The Rise of X"', () => {
      const topics = [
        'AI marketing',
        'Content automation',
        'B2B social',
        'Marketing analytics',
        'Customer data platforms',
      ];
      for (const topic of topics) {
        const result = generateThemeFromTopic(topic);
        expect(result).not.toMatch(/^The Rise of\s+/i);
      }
    });

    it('handles empty topics safely', () => {
      expect(generateThemeFromTopic('')).toBe('Strategic Theme');
      expect(generateThemeFromTopic('   ')).toBe('Strategic Theme');
    });

    it('is deterministic for same topic', () => {
      const r1 = generateThemeFromTopic('AI marketing');
      const r2 = generateThemeFromTopic('AI marketing');
      expect(r1).toBe(r2);
    });

    it('normalizes topic trailing punctuation', () => {
      const r1 = generateThemeFromTopic('AI marketing.');
      const r2 = generateThemeFromTopic('AI marketing');
      expect(r1).toBe(r2);
    });

    it('executes in under 1ms', () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        generateThemeFromTopic(`Topic ${i}`);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it('prevents duplicate domain words', () => {
      const result = generateThemeFromTopic('content strategy');
      expect(result).not.toMatch(/\bcontent\s+content\b/i);
      expect(result).not.toMatch(/\bstrategy\s+strategy\b/i);
    });

    it('preserves acronyms (AI, API)', () => {
      const aiResult = generateThemeFromTopic('AI marketing');
      expect(aiResult).toContain('AI');
      expect(aiResult).not.toContain('Ai ');
      const apiResult = generateThemeFromTopic('API integration');
      expect(apiResult).toContain('API');
      expect(apiResult).not.toContain('Api ');
    });

    it('angle changes when diversity_seed changes', () => {
      const r0 = generateThemeFromTopic('AI marketing', undefined, 0);
      const r1 = generateThemeFromTopic('AI marketing', undefined, 1);
      const r2 = generateThemeFromTopic('AI marketing', undefined, 2);
      const seeds = new Set([r0, r1, r2]);
      expect(seeds.size).toBeGreaterThan(1);
    });

    it('same seed produces deterministic output', () => {
      const r1 = generateThemeFromTopic('B2B social', undefined, 3);
      const r2 = generateThemeFromTopic('B2B social', undefined, 3);
      expect(r1).toBe(r2);
    });
  });

  describe('integration with language refinement', () => {
    it('strategicThemeEngine passes theme through language refinement', async () => {
      const { theme_title } = await generateThemeWithRefinement('AI marketing');
      expect(theme_title).not.toMatch(/^The Rise of\s+/i);
      expect(theme_title.length).toBeGreaterThan(0);
      expect(typeof theme_title).toBe('string');
    });

    it('returns theme_title and theme_description in expected shape', async () => {
      const result = await generateThemeWithRefinement('Content automation');
      expect(result).toHaveProperty('theme_title');
      expect(result).toHaveProperty('theme_description');
      expect(typeof result.theme_title).toBe('string');
      expect(typeof result.theme_description).toBe('string');
      expect(result.theme_description).toContain('Content automation');
    });
  });
});
