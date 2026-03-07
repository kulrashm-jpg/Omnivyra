/**
 * Unit tests for Weekly Angle Distribution Engine
 */
import { generateWeeklyAngles, classifyTopic, getAngleOffset } from '../../services/angleDistributionEngine';
import { getDiversitySeedForAngle, generateThemeFromTopic } from '../../services/themeAngleEngine';
import { generateThemesForCampaignWeeks } from '../../services/strategicThemeEngine';

const TREND_SEQUENCE = ['trend', 'future', 'opportunity', 'strategy', 'problem', 'contrarian'];
const OPERATIONAL_SEQUENCE = ['problem', 'strategy', 'opportunity', 'future', 'trend', 'contrarian'];
const THOUGHT_LEADERSHIP_SEQUENCE = ['contrarian', 'problem', 'strategy', 'future', 'opportunity', 'trend'];

function isCyclicRotation(angles: string[], base: string[]): boolean {
  if (angles.length === 0) return base.length === 0;
  const start = base.indexOf(angles[0]);
  if (start < 0) return false;
  for (let i = 0; i < angles.length; i++) {
    if (angles[i] !== base[(start + i) % base.length]) return false;
  }
  return true;
}

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('angleDistributionEngine', () => {
  describe('getAngleOffset (Angle Diversity Guard)', () => {
    it('same topic always produces same offset', () => {
      const o1 = getAngleOffset('AI marketing');
      const o2 = getAngleOffset('AI marketing');
      expect(o1).toBe(o2);
    });

    it('different topics can produce different offsets', () => {
      const topics = ['AI marketing', 'marketing automation', 'content automation', 'B2B social'];
      const offsets = new Set(topics.map(getAngleOffset));
      expect(offsets.size).toBeGreaterThan(1);
    });

    it('offset is in range 0–2', () => {
      for (const topic of ['x', 'AI marketing', 'workflow', 'strategy']) {
        const o = getAngleOffset(topic);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(3);
      }
    });
  });

  describe('classifyTopic', () => {
    it('returns trend for AI/automation/technology topics', () => {
      expect(classifyTopic('AI marketing')).toBe('trend');
      expect(classifyTopic('content automation')).toBe('trend');
      expect(classifyTopic('emerging technology')).toBe('trend');
    });

    it('returns operational for workflow/planning topics', () => {
      expect(classifyTopic('campaign planning workflow')).toBe('operational');
      expect(classifyTopic('execution process')).toBe('operational');
      expect(classifyTopic('optimization')).toBe('operational');
    });

    it('returns thought_leadership for strategy/leadership topics', () => {
      expect(classifyTopic('leadership mindset')).toBe('thought_leadership');
      expect(classifyTopic('company culture')).toBe('thought_leadership');
    });

    it('defaults to thought_leadership for unknown topics', () => {
      expect(classifyTopic('content marketing')).toBe('thought_leadership');
    });
  });

  describe('generateWeeklyAngles', () => {
    it('trend topics use trend sequence (with possible offset)', () => {
      const angles = generateWeeklyAngles(4, 'AI marketing');
      expect(angles).toHaveLength(4);
      expect(isCyclicRotation(angles, TREND_SEQUENCE)).toBe(true);
    });

    it('operational topics use operational sequence (with possible offset)', () => {
      const angles = generateWeeklyAngles(4, 'campaign planning workflow');
      expect(angles).toHaveLength(4);
      expect(isCyclicRotation(angles, OPERATIONAL_SEQUENCE)).toBe(true);
    });

    it('thought leadership topics use thought_leadership sequence (with possible offset)', () => {
      const angles = generateWeeklyAngles(4, 'leadership mindset');
      expect(angles).toHaveLength(4);
      expect(isCyclicRotation(angles, THOUGHT_LEADERSHIP_SEQUENCE)).toBe(true);
    });

    it('offset shifts starting angle', () => {
      const topic = 'AI marketing';
      const angles = generateWeeklyAngles(4, topic);
      const offset = getAngleOffset(topic);
      const expectedFirst = TREND_SEQUENCE[offset % TREND_SEQUENCE.length];
      expect(angles[0]).toBe(expectedFirst);
    });

    it('narrative sequence preserved (cyclic order)', () => {
      const angles = generateWeeklyAngles(6, 'AI marketing');
      expect(isCyclicRotation(angles, TREND_SEQUENCE)).toBe(true);
    });

    it('defaults to trend sequence with no offset when no topic provided', () => {
      const angles = generateWeeklyAngles(4);
      expect(angles).toEqual(['trend', 'future', 'opportunity', 'strategy']);
    });

    it('rotates when weeks exceed sequence length', () => {
      const angles = generateWeeklyAngles(8, 'AI marketing');
      expect(angles).toHaveLength(8);
      expect(isCyclicRotation(angles, TREND_SEQUENCE)).toBe(true);
    });

    it('returns empty array for 0 weeks', () => {
      expect(generateWeeklyAngles(0)).toEqual([]);
    });

    it('deterministic: same topic produces same angles', () => {
      const r1 = generateWeeklyAngles(4, 'AI marketing');
      const r2 = generateWeeklyAngles(4, 'AI marketing');
      expect(r1).toEqual(r2);
    });
  });

  describe('integration with theme generation', () => {
    it('each week produces different angle (different theme string)', async () => {
      const themes = await generateThemesForCampaignWeeks('AI marketing', 4);
      expect(themes).toHaveLength(4);
      const unique = new Set(themes);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('is deterministic for same topic + weeks', async () => {
      const r1 = await generateThemesForCampaignWeeks('Content automation', 4);
      const r2 = await generateThemesForCampaignWeeks('Content automation', 4);
      expect(r1).toEqual(r2);
    });

    it('same week_index produces same theme across runs', async () => {
      const topic = 'B2B social selling';
      const all1 = await generateThemesForCampaignWeeks(topic, 6);
      const all2 = await generateThemesForCampaignWeeks(topic, 6);
      for (let i = 0; i < 6; i++) {
        expect(all1[i]).toBe(all2[i]);
      }
    });

    it('determinism maintained with topic-type awareness', async () => {
      const r1 = await generateThemesForCampaignWeeks('campaign planning workflow', 4);
      const r2 = await generateThemesForCampaignWeeks('campaign planning workflow', 4);
      expect(r1).toEqual(r2);
    });
  });

  describe('getDiversitySeedForAngle', () => {
    it('seed produces the expected angle in generateThemeFromTopic', () => {
      const topic = 'AI marketing';
      const angles = ['trend', 'problem', 'strategy', 'opportunity', 'contrarian', 'future'];

      for (const angleName of angles) {
        const seed = getDiversitySeedForAngle(topic, angleName);
        const theme = generateThemeFromTopic(topic, undefined, seed);
        expect(theme.length).toBeGreaterThan(0);
        expect(theme).not.toMatch(/^The Rise of\s+/i);
      }
    });
  });
});
