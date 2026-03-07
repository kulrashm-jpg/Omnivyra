/**
 * Unit tests for Language Refinement Service — Tone Engine (Production Hardened)
 */
import { refineLanguageOutput } from '../../services/languageRefinementService';

const REFINEMENT_MARKER = '\u200Blanguage_refined\u200B';

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, LANGUAGE_REFINEMENT_ENABLED: 'true' };
});

afterAll(() => {
  process.env = originalEnv;
});

const EXAMPLE_INPUT =
  'AI tools are helping marketing teams in many different ways to be able to execute campaigns faster.';

describe('languageRefinementService', () => {
  describe('when LANGUAGE_REFINEMENT_ENABLED=true', () => {
    it('removes filler and shortens verbose text', async () => {
      const result = await refineLanguageOutput({
        content: EXAMPLE_INPUT,
        card_type: 'general',
      });
      expect(result.metadata?.applied).toBe(true);
      const refined = result.refined as string;
      expect(refined).not.toContain('in many different ways');
      expect(refined).not.toContain('to be able to');
      expect(refined.length).toBeLessThanOrEqual(EXAMPLE_INPUT.length);
      expect(refined.trim().length).toBeGreaterThan(0);
    });

    it('returns original when refinement disabled', async () => {
      process.env.LANGUAGE_REFINEMENT_ENABLED = 'false';
      const input = 'Some content that would be refined.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'general',
      });
      expect(result.metadata?.applied).toBe(false);
      expect(result.refined).toBe(input);
    });

    it('refines array of strings in single pass (batch)', async () => {
      const input = [
        'Topic one in order to achieve goals.',
        'Topic two for the purpose of driving growth.',
      ];
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'weekly_plan',
      });
      expect(result.metadata?.applied).toBe(true);
      expect(Array.isArray(result.refined)).toBe(true);
      expect((result.refined as string[]).length).toBe(2);
    });

    it('stringifies and refines non-string input without throwing', async () => {
      const input = 123 as unknown as string;
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'general',
      });
      expect(result.metadata?.applied).toBe(true);
      expect(typeof result.refined).toBe('string');
    });

    it('preserves empty strings', async () => {
      const result = await refineLanguageOutput({
        content: '',
        card_type: 'general',
      });
      expect(result.refined).toBe('');
    });
  });

  describe('idempotency guard', () => {
    it('prevents double mutation when content has marker', async () => {
      const once = await refineLanguageOutput({
        content: 'Short instruction.',
        card_type: 'general',
      });
      const refinedOnce = once.refined as string;
      const withMarker = refinedOnce + REFINEMENT_MARKER;
      const twice = await refineLanguageOutput({
        content: withMarker,
        card_type: 'general',
      });
      expect(twice.metadata?.applied).toBe(false);
      expect((twice.refined as string).trim()).toBe(refinedOnce.trim());
      expect((twice.refined as string)).not.toContain(REFINEMENT_MARKER);
    });
  });

  describe('tone bands', () => {
    it('applies conversational tone', async () => {
      const result = await refineLanguageOutput({
        content: EXAMPLE_INPUT,
        card_type: 'general',
        campaign_tone: 'conversational',
      });
      const refined = result.refined as string;
      expect(refined).toContain('run');
      expect(refined).not.toContain('execute');
    });

    it('applies educational tone', async () => {
      const result = await refineLanguageOutput({
        content: EXAMPLE_INPUT,
        card_type: 'general',
        campaign_tone: 'educational',
      });
      const refined = result.refined as string;
      expect(refined).toContain('more efficiently');
    });

    it('applies professional tone (neutral vocabulary)', async () => {
      const input = 'This strategy is awesome and great for teams.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'general',
        campaign_tone: 'professional',
      });
      const refined = result.refined as string;
      expect(refined).toContain('effective');
      expect(refined).toContain('strong');
    });

    it('applies inspirational tone for weekly_plan', async () => {
      const result = await refineLanguageOutput({
        content: EXAMPLE_INPUT,
        card_type: 'weekly_plan',
        campaign_tone: 'inspirational',
      });
      const refined = (result.refined as string).toLowerCase();
      expect(refined).toContain('unlocking');
    });
  });

  describe('inspirational tone safety', () => {
    it('skips inspirational rewrite for repurpose_card (keeps instructional)', async () => {
      const input = 'Turn this blog into 5 LinkedIn posts explaining AI marketing workflows.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'repurpose_card',
        campaign_tone: 'inspirational',
      });
      const refined = result.refined as string;
      expect(refined).toContain('Turn');
      expect(refined).toContain('LinkedIn');
      expect(refined).toContain('explaining');
    });

    it('skips inspirational rewrite for platform_variant', async () => {
      const input = 'Adapt this content for Instagram with hashtags and emoji.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'platform_variant',
        campaign_tone: 'inspirational',
      });
      const refined = result.refined as string;
      expect(refined).toContain('Adapt');
      expect(refined).toContain('Instagram');
    });
  });

  describe('tone inheritance fallback', () => {
    it('uses professional when campaign_tone not provided', async () => {
      const result = await refineLanguageOutput({
        content: 'Awesome strategy.',
        card_type: 'general',
      });
      const refined = result.refined as string;
      expect(refined).toContain('effective');
    });

    it('falls back to professional for unknown tone', async () => {
      const result = await refineLanguageOutput({
        content: 'Awesome strategy.',
        card_type: 'general',
        campaign_tone: 'unknown_tone',
      });
      const refined = result.refined as string;
      expect(refined).toContain('effective');
    });
  });

  describe('card type formatting', () => {
    it('truncates weekly_plan theme to 12 words max', async () => {
      const input =
        'Introduce the three pillar stress reduction framework and share customer success stories about overcoming anxiety and building resilience.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'weekly_plan',
      });
      const refined = result.refined as string;
      const words = refined.split(/\s+/);
      expect(words.length).toBeLessThanOrEqual(13);
    });

    it('truncates daily_slot to ~10 words', async () => {
      const input =
        'How to identify personal challenges and overcome them with actionable steps and support from the community.';
      const result = await refineLanguageOutput({
        content: input,
        card_type: 'daily_slot',
      });
      const refined = result.refined as string;
      const words = refined.split(/\s+/);
      expect(words.length).toBeLessThanOrEqual(11);
    });
  });
});
