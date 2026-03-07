/**
 * Unit tests for Strategic Theme Engine
 */
import { getHeadlinePrefix } from '../../services/headlineStructureEngine';
import { generateThemesForCampaignWeeks } from '../../services/strategicThemeEngine';

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('getHeadlinePrefix', () => {
  it('extracts first word lowercase', () => {
    expect(getHeadlinePrefix('Why AI Marketing Matters')).toBe('why');
    expect(getHeadlinePrefix('The Future of AI Marketing')).toBe('the');
    expect(getHeadlinePrefix('How AI Marketing Is Transforming')).toBe('how');
  });
});

describe('generateThemesForCampaignWeeks', () => {
  describe('headline structure collision guard', () => {
    it('prevents consecutive identical prefixes when alternatives exist', async () => {
      const themes = await generateThemesForCampaignWeeks('AI marketing', 6);
      expect(themes).toHaveLength(6);
      const prefixes = themes.map((t) => getHeadlinePrefix(t));
      for (let i = 1; i < prefixes.length; i++) {
        expect(prefixes[i]).not.toBe(prefixes[i - 1]);
      }
    });

    it('preserves determinism', async () => {
      const r1 = await generateThemesForCampaignWeeks('AI marketing', 5);
      const r2 = await generateThemesForCampaignWeeks('AI marketing', 5);
      expect(r1).toEqual(r2);
    });

    it('falls back correctly when no alternative templates exist', async () => {
      const themes = await generateThemesForCampaignWeeks('content strategy', 4);
      expect(themes).toHaveLength(4);
      expect(themes.every((t) => t.length > 0)).toBe(true);
    });
  });
});
