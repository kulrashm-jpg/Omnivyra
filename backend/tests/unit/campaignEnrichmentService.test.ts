/**
 * Unit tests for campaign enrichment service.
 * Verifies: duration tiers, weekly guidance, content mix sum, edge cases.
 */

import {
  enrichRecommendation,
  normalizeDurationValue,
  normalizeDurationWeeks,
  type RecommendationEnrichmentInput,
} from '../../services/campaignEnrichmentService';

describe('Campaign enrichment service', () => {
  describe('1. Broad psychological topic → long campaign (8 or 12 weeks)', () => {
    it('psychological context + broad → 12 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Personal growth and career psychology',
        facets: ['mental resilience', 'decision clarity', 'confidence building'],
        sub_angles: ['imposter syndrome', 'work-life balance', 'leadership mindset'],
        audience_personas: ['mid-career professionals'],
        messaging_hooks: ['Why it matters now', 'Key benefit', 'Clear CTA'],
        estimated_reach: 75000,
        formats: ['Blog', 'Video', 'Social'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
      expect(result.duration_suggestion.value).toBe('12_weeks');
    });

    it('50K reach + broad problem (no psychological) → 8 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['topic A', 'topic B', 'topic C'],
        sub_angles: ['angle 1', 'angle 2', 'angle 3'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
      expect(result.duration_suggestion.value).toBe('8_weeks');
    });

    it('high reach + high complexity + facets + sub-angles → 12 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['facet 1', 'facet 2', 'facet 3'],
        sub_angles: ['a', 'b', 'c'],
        audience_personas: ['persona 1'],
        estimated_reach: 60000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
    });

    it('10K reach + 2 facets + broad sub-angles → 8 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['facet 1', 'facet 2'],
        sub_angles: ['a', 'b', 'c'],
        estimated_reach: 10000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
    });
  });

  describe('2. Medium scope topic → 4 weeks', () => {
    it('2 facets + 2 sub-angles → 4 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['product launch', 'customer onboarding'],
        sub_angles: ['pre-launch', 'post-launch'],
        estimated_reach: 5000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
      expect(result.duration_suggestion.value).toBe('4_weeks');
    });

    it('complexity score ≥ 5 → 4 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        audience_personas: ['persona 1'],
        messaging_hooks: ['hook 1', 'hook 2'],
        formats: ['Blog', 'Video'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
    });
  });

  describe('3. Narrow topic → short campaign (2 weeks)', () => {
    it('no facets + minimal signals → 2 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Product tip',
        facets: [],
        estimated_reach: 1000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(2);
      expect(result.duration_suggestion.value).toBe('2_weeks');
    });

    it('minimal input (empty arrays) → 2 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        facets: [],
        sub_angles: [],
        estimated_reach: 0,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(2);
    });

    it('single facet yields 4 weeks (complexity score pushes to medium)', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['narrow focus'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
    });
  });

  describe('4. Weekly guidance is generated', () => {
    it('2 weeks produces 2 weekly guidance entries', () => {
      const input: RecommendationEnrichmentInput = { facets: [] };
      const result = enrichRecommendation(input);
      expect(result.weekly_guidance).toHaveLength(2);
      expect(result.weekly_guidance[0]).toMatchObject({
        week_number: 1,
        intent: expect.any(String),
        psychological_movement: expect.any(String),
        content_objective: expect.any(String),
      });
      expect(result.weekly_guidance[1].week_number).toBe(2);
    });

    it('4 weeks produces 4 weekly guidance entries', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        sub_angles: ['x', 'y'],
      };
      const result = enrichRecommendation(input);
      expect(result.weekly_guidance).toHaveLength(4);
    });

    it('8 weeks produces 8 weekly guidance entries', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.weekly_guidance).toHaveLength(8);
    });

    it('12 weeks produces 12 weekly guidance entries with phase progression', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Personal growth and transformation',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      expect(result.weekly_guidance).toHaveLength(12);
      expect(result.weekly_guidance[0].psychological_movement).toBe('Awareness');
      expect(result.weekly_guidance[2].psychological_movement).toBe('Problem framing');
      expect(result.weekly_guidance[5].psychological_movement).toBe('Authority');
      expect(result.weekly_guidance[11].psychological_movement).toBe('Action / Consolidation');
    });

    it('8 weeks uses Awareness → Education → Trust → Conversion phases', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.weekly_guidance).toHaveLength(8);
      expect(result.weekly_guidance[0].psychological_movement).toBe('Awareness');
      expect(result.weekly_guidance[2].psychological_movement).toBe('Education');
      expect(result.weekly_guidance[5].psychological_movement).toBe('Trust');
      expect(result.weekly_guidance[7].psychological_movement).toBe('Conversion');
    });

    it('each week has intent, psychological_movement, content_objective', () => {
      const input: RecommendationEnrichmentInput = { facets: ['a', 'b'], sub_angles: ['x'] };
      const result = enrichRecommendation(input);
      result.weekly_guidance.forEach((w) => {
        expect(w).toHaveProperty('intent');
        expect(w).toHaveProperty('psychological_movement');
        expect(w).toHaveProperty('content_objective');
        expect(typeof w.intent).toBe('string');
        expect(typeof w.psychological_movement).toBe('string');
        expect(typeof w.content_objective).toBe('string');
        expect(w.intent.length).toBeGreaterThan(0);
      });
    });
  });

  describe('5. Content mix percentages sum to 100%', () => {
    it('educational mode: percentages sum to 100', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      const sum =
        result.content_mix.educational_pct +
        result.content_mix.authority_pct +
        result.content_mix.engagement_pct +
        result.content_mix.conversion_pct;
      expect(sum).toBe(100);
    });

    it('trust_building mode: percentages sum to 100', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        sub_angles: ['x', 'y'],
      };
      const result = enrichRecommendation(input);
      expect(result.progression_model).toBe('trust_building');
      const sum =
        result.content_mix.educational_pct +
        result.content_mix.authority_pct +
        result.content_mix.engagement_pct +
        result.content_mix.conversion_pct;
      expect(sum).toBe(100);
    });

    it('conversion_acceleration mode: percentages sum to 100', () => {
      const input: RecommendationEnrichmentInput = { facets: [] };
      const result = enrichRecommendation(input);
      expect(result.progression_model).toBe('conversion_acceleration');
      const sum =
        result.content_mix.educational_pct +
        result.content_mix.authority_pct +
        result.content_mix.engagement_pct +
        result.content_mix.conversion_pct;
      expect(sum).toBe(100);
    });
  });

  describe('Edge cases', () => {
    it('empty input → 2 weeks, valid structure', () => {
      const result = enrichRecommendation({});
      expect(result.campaign_duration_weeks).toBe(2);
      expect(result.weekly_guidance).toHaveLength(2);
      expect(result.transition_guidelines).toMatchObject({
        start_signal: expect.any(String),
        continuation_signal: expect.any(String),
        transition_signal: expect.any(String),
        closing_signal: expect.any(String),
      });
    });

    it('null/undefined fields are handled', () => {
      const result = enrichRecommendation({
        context: null,
        aspect: undefined,
        facets: undefined,
        estimated_reach: null,
      });
      expect(result.campaign_duration_weeks).toBe(2);
      expect(result.weekly_guidance.length).toBeGreaterThan(0);
    });

    it('reach parsed from "10K" string', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: '10K',
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBeGreaterThanOrEqual(8);
    });

    it('reach parsed from "1M" string', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: '1M',
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
    });

    it('summary derives sub-angles when sub_angles absent', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        summary: 'Angle one; Angle two',
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
    });

    it('transition_guidelines always populated', () => {
      const inputs: RecommendationEnrichmentInput[] = [
        {},
        { facets: ['narrow'] },
        { facets: ['a', 'b'], sub_angles: ['x'] },
        { facets: ['a', 'b', 'c'], estimated_reach: 100000 },
      ];
      inputs.forEach((input) => {
        const result = enrichRecommendation(input);
        expect(result.transition_guidelines.start_signal).toBeTruthy();
        expect(result.transition_guidelines.continuation_signal).toBeTruthy();
        expect(result.transition_guidelines.transition_signal).toBeTruthy();
        expect(result.transition_guidelines.closing_signal).toBeTruthy();
      });
    });

    it('duration_suggestion has rationale', () => {
      const narrow = enrichRecommendation({ facets: ['narrow'] });
      const medium = enrichRecommendation({ facets: ['a', 'b'], sub_angles: ['x'] });
      const broad = enrichRecommendation({
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 60000,
      });
      expect(narrow.duration_suggestion.rationale).toBeTruthy();
      expect(medium.duration_suggestion.rationale).toBeTruthy();
      expect(broad.duration_suggestion.rationale).toBeTruthy();
    });

    it('backward compat: normalizeDurationValue maps 8_12_weeks to 8_weeks', () => {
      expect(normalizeDurationValue('8_12_weeks')).toBe('8_weeks');
      expect(normalizeDurationValue('2_weeks')).toBe('2_weeks');
      expect(normalizeDurationValue('12_weeks')).toBe('12_weeks');
    });

    it('backward compat: normalizeDurationWeeks clamps to 2|4|8|12', () => {
      expect(normalizeDurationWeeks(1)).toBe(2);
      expect(normalizeDurationWeeks(3)).toBe(4);
      expect(normalizeDurationWeeks(6)).toBe(8);
      expect(normalizeDurationWeeks(10)).toBe(12);
      expect(normalizeDurationWeeks(20)).toBe(12);
    });

    it('weeks are always 2, 4, 8, or 12', () => {
      const inputs: RecommendationEnrichmentInput[] = [
        {},
        { facets: ['a', 'b'] },
        { facets: ['a', 'b', 'c'], estimated_reach: 50000 },
        { context: 'Personal growth', facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'] },
      ];
      const allowed = new Set([2, 4, 8, 12]);
      inputs.forEach((input) => {
        const result = enrichRecommendation(input);
        expect(allowed.has(result.campaign_duration_weeks)).toBe(true);
        expect(allowed.has(result.duration_suggestion.weeks)).toBe(true);
      });
    });
  });

  describe('8-week and 12-week campaign enrichment', () => {
    it('1. Broad psychological topic returns 12 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Mindset and resilience for career growth',
        title: 'Leadership confidence',
        facets: ['resilience', 'confidence', 'mindset'],
        sub_angles: ['imposter syndrome', 'feedback', 'growth'],
        estimated_reach: 20000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
      expect(result.duration_suggestion.value).toBe('12_weeks');
    });

    it('2. Strategic business topic (no psychological) returns 8 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Enterprise SaaS go-to-market strategy',
        facets: ['product positioning', 'sales enablement', 'customer success'],
        sub_angles: ['pricing', 'channels', 'onboarding'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
      expect(result.duration_suggestion.value).toBe('8_weeks');
    });

    it('3. Weekly progression length equals campaign duration', () => {
      const twelveWeekInput: RecommendationEnrichmentInput = {
        context: 'Personal transformation',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const eightWeekInput: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 60000,
      };
      const result12 = enrichRecommendation(twelveWeekInput);
      const result8 = enrichRecommendation(eightWeekInput);
      expect(result12.weekly_guidance).toHaveLength(result12.campaign_duration_weeks);
      expect(result12.weekly_guidance).toHaveLength(12);
      expect(result8.weekly_guidance).toHaveLength(result8.campaign_duration_weeks);
      expect(result8.weekly_guidance).toHaveLength(8);
    });

    it('4a. 12-week phases: Awareness (1–3), Education (4–6), Trust (7–9), Decision (10–11), Action (12)', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Wellness and confidence',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      const movements = result.weekly_guidance.map((w) => w.psychological_movement);
      expect(movements[0]).toMatch(/Awareness/);
      expect(movements[1]).toMatch(/Awareness/);
      expect(movements[2]).toMatch(/Problem framing/);
      expect(movements[3]).toMatch(/Education/);
      expect(movements[4]).toMatch(/Authority/);
      expect(movements[5]).toMatch(/Authority/);
      expect(movements[6]).toMatch(/Trust/);
      expect(movements[7]).toMatch(/Application/);
      expect(movements[8]).toMatch(/Trust|Application/);
      expect(movements[9]).toMatch(/Decision/);
      expect(movements[10]).toMatch(/Conversion preparation/);
      expect(movements[11]).toMatch(/Action|Consolidation/);
    });

    it('4b. 8-week phases: Awareness (1–2), Education (3–4), Trust (5–6), Conversion (7–8)', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      const movements = result.weekly_guidance.map((w) => w.psychological_movement);
      expect(movements[0]).toBe('Awareness');
      expect(movements[1]).toBe('Awareness');
      expect(movements[2]).toBe('Education');
      expect(movements[3]).toBe('Education');
      expect(movements[4]).toBe('Trust');
      expect(movements[5]).toBe('Trust');
      expect(movements[6]).toBe('Conversion');
      expect(movements[7]).toBe('Conversion');
    });

    it('4c. Week 12 has Action/Consolidation only for 12-week campaigns', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Career growth',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      const week12 = result.weekly_guidance[11];
      expect(week12.week_number).toBe(12);
      expect(week12.psychological_movement).toBe('Action / Consolidation');
      expect(week12.intent).toMatch(/action|drive/i);
    });

    it('5. Content mix sums to 100% for 8-week and 12-week campaigns', () => {
      const twelveWeekInput: RecommendationEnrichmentInput = {
        context: 'Resilience and mindset',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const eightWeekInput: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 50000,
      };
      const sumContentMix = (m: { educational_pct: number; authority_pct: number; engagement_pct: number; conversion_pct: number }) =>
        m.educational_pct + m.authority_pct + m.engagement_pct + m.conversion_pct;

      const result12 = enrichRecommendation(twelveWeekInput);
      const result8 = enrichRecommendation(eightWeekInput);

      expect(sumContentMix(result12.content_mix)).toBe(100);
      expect(sumContentMix(result8.content_mix)).toBe(100);
    });

    it('each week has intent, psychological_movement, content_objective (no generic labels)', () => {
      const inputs: RecommendationEnrichmentInput[] = [
        { context: 'Growth mindset', facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'] },
        { facets: ['a', 'b', 'c'], estimated_reach: 50000 },
      ];
      inputs.forEach((input) => {
        const result = enrichRecommendation(input);
        result.weekly_guidance.forEach((w, i) => {
          expect(w.intent).toBeTruthy();
          expect(w.psychological_movement).toBeTruthy();
          expect(w.content_objective).toBeTruthy();
          expect(w.intent).not.toMatch(/Week \d+ Theme/i);
        });
      });
    });
  });

  describe('8-week and 12-week edge cases', () => {
    it('high complexity without psychological keywords → 8 weeks (strategic)', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'B2B enterprise software adoption',
        facets: ['integration', 'security', 'compliance'],
        sub_angles: ['migration', 'governance', 'audit'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
    });

    it('psychological + high complexity + personas → 12 weeks', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Leadership confidence and identity',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        audience_personas: ['managers'],
        formats: ['Blog', 'Video'],
        estimated_reach: 80000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
    });

    it('week_number is sequential 1..N', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Personal growth',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      result.weekly_guidance.forEach((w, i) => {
        expect(w.week_number).toBe(i + 1);
      });
    });
  });

  describe('campaign_progression_guard', () => {
    /** Stage order: Awareness(1) → Education(2) → Authority(3) → Trust(4) → Application(5) → Decision(6) → Conversion(7) → Action(8) */
    const STAGE_INDEX: Record<string, number> = {
      Awareness: 1,
      Education: 2,
      Authority: 3,
      Trust: 4,
      Application: 5,
      Decision: 6,
      Conversion: 7,
      Action: 8,
      'Problem framing': 2,
      Interest: 2,
      Consideration: 4,
      Preference: 6,
      'Preference → Action': 8,
      'Trust / Application': 4,
      'Decision preparation': 6,
      'Conversion preparation': 7,
      'Action / Consolidation': 8,
    };

    function stageIndex(movement: string): number {
      const idx = STAGE_INDEX[movement];
      if (idx != null) return idx;
      if (movement.includes('Awareness')) return 1;
      if (movement.includes('Education')) return 2;
      if (movement.includes('Authority')) return 3;
      if (movement.includes('Trust')) return 4;
      if (movement.includes('Application')) return 5;
      if (movement.includes('Decision')) return 6;
      if (movement.includes('Conversion')) return 7;
      if (movement.includes('Action')) return 8;
      return 1;
    }

    function assertNonDecreasing(weekly_guidance: { psychological_movement: string }[]): void {
      const indices = weekly_guidance.map((w) => stageIndex(w.psychological_movement));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
      }
    }

    it('2-week: stage index never decreases', () => {
      const input: RecommendationEnrichmentInput = { facets: [], estimated_reach: 0 };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(2);
      assertNonDecreasing(result.weekly_guidance);
    });

    it('4-week: stage index never decreases', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        sub_angles: ['x', 'y'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
      assertNonDecreasing(result.weekly_guidance);
    });

    it('8-week: stage index never decreases', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
      assertNonDecreasing(result.weekly_guidance);
    });

    it('12-week: stage index never decreases', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Personal growth and mindset',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
      assertNonDecreasing(result.weekly_guidance);
    });
  });

  describe('momentum_level', () => {
    const MOMENTUM_INDEX: Record<string, number> = { low: 1, medium: 2, high: 3, peak: 4 };

    function momentumNeverDecreases(weekly_guidance: { momentum_level: string }[]): void {
      const indices = weekly_guidance.map((w) => MOMENTUM_INDEX[w.momentum_level] ?? 0);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
      }
    }

    it('1. momentum never decreases sharply in later phases', () => {
      const inputs: RecommendationEnrichmentInput[] = [
        { facets: [], estimated_reach: 0 },
        { facets: ['a', 'b'], sub_angles: ['x', 'y'] },
        { facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'], estimated_reach: 50000 },
        { context: 'Personal growth', facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'] },
      ];
      inputs.forEach((input) => {
        const result = enrichRecommendation(input);
        momentumNeverDecreases(result.weekly_guidance);
      });
    });

    it('2. 12-week campaigns end with peak', () => {
      const input: RecommendationEnrichmentInput = {
        context: 'Mindset and resilience',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(12);
      expect(result.weekly_guidance[11].momentum_level).toBe('peak');
    });

    it('3. 8-week campaigns transition low → medium → high → peak', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
        estimated_reach: 50000,
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(8);
      expect(result.weekly_guidance[0].momentum_level).toBe('low');
      expect(result.weekly_guidance[1].momentum_level).toBe('low');
      expect(result.weekly_guidance[2].momentum_level).toBe('medium');
      expect(result.weekly_guidance[3].momentum_level).toBe('medium');
      expect(result.weekly_guidance[4].momentum_level).toBe('high');
      expect(result.weekly_guidance[5].momentum_level).toBe('high');
      expect(result.weekly_guidance[6].momentum_level).toBe('peak');
      expect(result.weekly_guidance[7].momentum_level).toBe('peak');
    });

    it('4a. 2-week: week1 medium, week2 peak', () => {
      const input: RecommendationEnrichmentInput = { facets: [], estimated_reach: 0 };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(2);
      expect(result.weekly_guidance[0].momentum_level).toBe('medium');
      expect(result.weekly_guidance[1].momentum_level).toBe('peak');
    });

    it('4b. 4-week: week1 low, week2 medium, week3 high, week4 peak', () => {
      const input: RecommendationEnrichmentInput = {
        facets: ['a', 'b'],
        sub_angles: ['x', 'y'],
      };
      const result = enrichRecommendation(input);
      expect(result.campaign_duration_weeks).toBe(4);
      expect(result.weekly_guidance[0].momentum_level).toBe('low');
      expect(result.weekly_guidance[1].momentum_level).toBe('medium');
      expect(result.weekly_guidance[2].momentum_level).toBe('high');
      expect(result.weekly_guidance[3].momentum_level).toBe('peak');
    });
  });
});
