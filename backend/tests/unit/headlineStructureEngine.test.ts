/**
 * Unit tests for Headline Structure Rotation Engine
 */
import {
  getHeadlineStructureOffset,
  getHeadlineStructure,
} from '../../services/headlineStructureEngine';
import { generateThemesForCampaignWeeks } from '../../services/strategicThemeEngine';

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('headlineStructureEngine', () => {
  describe('getHeadlineStructureOffset', () => {
    it('deterministic structure per topic', () => {
      const o1 = getHeadlineStructureOffset('AI marketing');
      const o2 = getHeadlineStructureOffset('AI marketing');
      expect(o1).toBe(o2);
    });

    it('different topics can produce different offsets', () => {
      const topics = ['AI marketing', 'Content automation', 'B2B social', 'workflow optimization'];
      const offsets = new Set(topics.map(getHeadlineStructureOffset));
      expect(offsets.size).toBeGreaterThan(1);
    });

    it('offset is in range 0–4', () => {
      for (const topic of ['x', 'AI marketing', 'strategy']) {
        const o = getHeadlineStructureOffset(topic);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(5);
      }
    });
  });

  describe('getHeadlineStructure', () => {
    it('rotation across weeks', () => {
      const structures: string[] = [];
      for (let i = 0; i < 5; i++) {
        structures.push(getHeadlineStructure('AI marketing', i));
      }
      const unique = new Set(structures);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('deterministic for same topic + weekIndex', () => {
      expect(getHeadlineStructure('AI marketing', 0)).toBe(getHeadlineStructure('AI marketing', 0));
      expect(getHeadlineStructure('content automation', 3)).toBe(getHeadlineStructure('content automation', 3));
    });
  });

  describe('integration with theme generation', () => {
    it('generateThemesForCampaignWeeks produces varied headline structures', async () => {
      const themes = await generateThemesForCampaignWeeks('AI marketing', 5);
      expect(themes).toHaveLength(5);
      const starts = themes.map((t) => {
        if (/^How\b/i.test(t)) return 'how';
        if (/^Why\b/i.test(t)) return 'why';
        if (/^What\b/i.test(t)) return 'what';
        if (/The Future/i.test(t)) return 'future';
        if (/Hidden Cost/i.test(t)) return 'hidden_cost';
        return 'other';
      });
      const uniqueStarts = new Set(starts);
      expect(uniqueStarts.size).toBeGreaterThan(1);
    });

    it('deterministic: same topic + weeks produces same themes', async () => {
      const r1 = await generateThemesForCampaignWeeks('AI marketing', 5);
      const r2 = await generateThemesForCampaignWeeks('AI marketing', 5);
      expect(r1).toEqual(r2);
    });
  });
});
