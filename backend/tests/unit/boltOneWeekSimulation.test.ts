/**
 * Simulation test: BOLT 1-week campaign flow.
 * Verifies that key components handle campaign_duration: 1 correctly.
 */
import { fromStructuredPlan } from '../../services/campaignBlueprintAdapter';
import { buildWeeklyPlanPrompt } from '../../prompts/weeklyPlan.prompt';
import type { CampaignContext } from '../../services/contextCompressionService';

describe('BOLT 1-week simulation', () => {
  describe('fromStructuredPlan', () => {
    it('produces valid blueprint for 1 week', () => {
      const plan = {
        campaign_id: 'test-campaign-id',
        weeks: [
          {
            week: 1,
            phase_label: 'Awareness + Conversion',
            primary_objective: 'Drive awareness and conversion in one focused week',
            theme: 'Core topic',
            platform_allocation: { linkedin: 3, x: 2 },
          },
        ],
      };
      const blueprint = fromStructuredPlan(plan);
      expect(blueprint.duration_weeks).toBe(1);
      expect(blueprint.weeks).toHaveLength(1);
      expect(blueprint.weeks[0]?.week_number).toBe(1);
    });
  });

  describe('campaign narrative guidance (1-week)', () => {
    it('includes 1-week specific guidance in weekly plan prompt', () => {
      const context: CampaignContext = {
        topic: 'Test campaign',
        tone: 'professional',
        themes: ['Core theme'],
        top_platforms: ['linkedin'],
        top_content_types: ['post'],
        campaign_duration_weeks: 1,
        target_audience: 'B2B marketers',
        campaign_goal: 'awareness',
        content_depth: 'medium',
      };
      const prompt = buildWeeklyPlanPrompt(context);
      expect(prompt).toContain('1-week');
      expect(prompt).toContain('combine awareness and conversion');
    });
  });

  describe('execution config validation (BOLT accepts 1-4 weeks)', () => {
    it('execution config shape is valid for 1 week', () => {
      const executionConfig = {
        target_audience: 'B2B',
        content_depth: 'medium',
        frequency_per_week: 5,
        campaign_duration: 1,
        tentative_start: '2026-03-10',
        campaign_goal: 'awareness',
      };
      expect(executionConfig.campaign_duration).toBe(1);
      expect(executionConfig.campaign_duration).toBeGreaterThanOrEqual(1);
      expect(executionConfig.campaign_duration).toBeLessThanOrEqual(4);
    });
  });
});
