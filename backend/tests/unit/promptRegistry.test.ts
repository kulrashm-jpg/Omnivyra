/**
 * Unit tests for Prompt Registry
 */
import { PROMPT_REGISTRY, type DailyDistributionPromptContext } from '../../prompts';
import type { CampaignContext } from '../../services/contextCompressionService';

describe('promptRegistry', () => {
  const baseContext: CampaignContext = {
    topic: 'Product launch Q2',
    tone: 'professional',
    themes: ['Lead generation', 'Authority building'],
    top_platforms: ['linkedin', 'x'],
    top_content_types: ['post', 'video', 'article'],
  };

  describe('registry returns prompt builders', () => {
    it('strategic_themes has build function', () => {
      expect(typeof PROMPT_REGISTRY.strategic_themes.build).toBe('function');
    });
    it('weekly_plan has build function', () => {
      expect(typeof PROMPT_REGISTRY.weekly_plan.build).toBe('function');
    });
    it('daily_distribution has build function', () => {
      expect(typeof PROMPT_REGISTRY.daily_distribution.build).toBe('function');
    });
    it('content_generation has build function', () => {
      expect(typeof PROMPT_REGISTRY.content_generation.build).toBe('function');
    });
  });

  describe('registry entries include metadata', () => {
    it('each entry has metadata', () => {
      for (const key of Object.keys(PROMPT_REGISTRY) as (keyof typeof PROMPT_REGISTRY)[]) {
        const entry = PROMPT_REGISTRY[key];
        expect(entry).toHaveProperty('metadata');
        expect(entry.metadata).toHaveProperty('name');
        expect(entry.metadata).toHaveProperty('version');
      }
    });
    it('metadata contains version', () => {
      expect(PROMPT_REGISTRY.weekly_plan.metadata.version).toBe(2);
      expect(PROMPT_REGISTRY.daily_distribution.metadata.version).toBe(1);
    });
    it('metadata name matches registry key', () => {
      expect(PROMPT_REGISTRY.weekly_plan.metadata.name).toBe('weekly_plan');
      expect(PROMPT_REGISTRY.daily_distribution.metadata.name).toBe('daily_distribution');
      expect(PROMPT_REGISTRY.strategic_themes.metadata.name).toBe('strategic_themes');
      expect(PROMPT_REGISTRY.content_generation.metadata.name).toBe('content_generation');
    });
  });

  describe('prompt builders include topic', () => {
    it('strategic_themes output includes topic', () => {
      const out = PROMPT_REGISTRY.strategic_themes.build(baseContext);
      expect(out).toContain('Product launch Q2');
    });
    it('weekly_plan output includes topic', () => {
      const out = PROMPT_REGISTRY.weekly_plan.build(baseContext);
      expect(out).toContain('Product launch Q2');
    });
  });

  describe('prompt builders include tone', () => {
    it('strategic_themes output includes tone', () => {
      const out = PROMPT_REGISTRY.strategic_themes.build(baseContext);
      expect(out).toContain('professional');
    });
    it('weekly_plan output includes tone', () => {
      const out = PROMPT_REGISTRY.weekly_plan.build(baseContext);
      expect(out).toContain('professional');
    });
    it('content_generation output includes tone', () => {
      const out = PROMPT_REGISTRY.content_generation.build(baseContext);
      expect(out).toContain('professional');
    });
  });

  describe('deterministic output for same context', () => {
    it('strategic_themes produces identical output for same input', () => {
      const a = PROMPT_REGISTRY.strategic_themes.build(baseContext);
      const b = PROMPT_REGISTRY.strategic_themes.build(baseContext);
      expect(a).toBe(b);
    });
    it('weekly_plan produces identical output for same input', () => {
      const a = PROMPT_REGISTRY.weekly_plan.build(baseContext);
      const b = PROMPT_REGISTRY.weekly_plan.build(baseContext);
      expect(a).toBe(b);
    });
    it('daily_distribution produces identical output for same input', () => {
      const ctx: DailyDistributionPromptContext = {
        ...baseContext,
        weekly_topics: ['Week 1 theme'],
        week_number: 1,
        theme: 'Launch awareness',
        content_types_available: ['post', 'video'],
        target_region: 'US',
        campaign_mode: 'STRATEGIC',
        minimum_slots: 5,
        distribution_instruction: 'Generate at least 5 slots.',
      };
      const a = PROMPT_REGISTRY.daily_distribution.build(ctx);
      const b = PROMPT_REGISTRY.daily_distribution.build(ctx);
      expect(a).toBe(b);
    });
  });

  describe('weekly_plan strategic theme mapping', () => {
    it('includes strategic theme mapping when strategic_themes provided', () => {
      const ctx: CampaignContext = {
        ...baseContext,
        strategic_themes: ['Awareness', 'Authority', 'Engagement', 'Conversion'],
        campaign_duration_weeks: 8,
      };
      const out = PROMPT_REGISTRY.weekly_plan.build(ctx);
      expect(out).toContain('STRATEGIC THEME MAPPING');
      expect(out).toContain('Awareness');
      expect(out).toContain('Authority');
      expect(out).toContain('strategic_theme');
      expect(out).toContain('theme_for_week');
    });
    it('includes strategy learning block when strategy_learning_profile provided', () => {
      const ctx: CampaignContext = {
        ...baseContext,
        strategy_learning_profile: {
          high_performing_formats: ['video', 'carousel'],
          high_performing_topics: ['Product tips'],
          weak_formats: ['long-form'],
        },
      };
      const out = PROMPT_REGISTRY.weekly_plan.build(ctx);
      expect(out).toContain('STRATEGY LEARNING PROFILE');
      expect(out).toContain('video');
      expect(out).toContain('do NOT override strategic theme progression');
    });
  });
});
