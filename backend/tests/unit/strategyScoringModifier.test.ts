/**
 * Strategy scoring modifier unit tests.
 */

import {
  computeStrategyModifier,
  scoreByAlignmentThenPopularity,
} from '../../services/recommendationEngineService';
import type { TrendSignalNormalized } from '../../services/trendProcessingService';
import type { CompanyStrategyDNA } from '../../services/companyStrategyDNAService';

const mkTrend = (
  topic: string,
  volume = 1000,
  frequency = 1
): TrendSignalNormalized => ({
  topic,
  source: 'test',
  geo: 'US',
  volume,
  velocity: 1,
  sentiment: 0.5,
  sources: ['test'],
  frequency,
});

describe('strategyScoringModifier', () => {
  describe('computeStrategyModifier', () => {
    it('returns 1 when strategyDNA is null', () => {
      expect(
        computeStrategyModifier(null, mkTrend('any topic'), { company_id: 'c1' })
      ).toBe(1);
    });

    it('clamps result between 0.85 and 1.25', () => {
      const dna: CompanyStrategyDNA = { mode: 'problem_transformation', growth_motion: 'trust_building', content_style: 'educational', decision_focus: 'awareness_to_trust' };
      const profile = { core_problem_statement: 'prioritization chaos' };
      const trend = mkTrend('teams struggle with prioritization', 100, 1);
      const mod = computeStrategyModifier(dna, trend, profile, {
        alignmentScore: 0.8,
        volumeMax: 10000,
      });
      expect(mod).toBeGreaterThanOrEqual(0.85);
      expect(mod).toBeLessThanOrEqual(1.25);
    });

    it('problem_transformation: +0.15 when topic overlaps core_problem_statement', () => {
      const dna: CompanyStrategyDNA = { mode: 'problem_transformation', growth_motion: 'trust_building', content_style: 'educational', decision_focus: 'awareness_to_trust' };
      const profile = { core_problem_statement: 'prioritization fails' };
      const trend = mkTrend('why prioritization fails', 5000, 3);
      const mod = computeStrategyModifier(dna, trend, profile, {
        alignmentScore: 0.3,
        volumeMax: 10000,
      });
      expect(mod).toBe(1 + 0.15);
    });

    it('problem_transformation: +0.15 when topic overlaps desired_transformation', () => {
      const dna: CompanyStrategyDNA = { mode: 'problem_transformation', growth_motion: 'trust_building', content_style: 'educational', decision_focus: 'awareness_to_trust' };
      const profile = { desired_transformation: 'from chaos to clarity' };
      const trend = mkTrend('how teams achieve clarity', 3000, 5);
      const mod = computeStrategyModifier(dna, trend, profile, { alignmentScore: 0.3 });
      expect(mod).toBe(1 + 0.15);
    });

    it('problem_transformation: +0.10 when alignment high and (frequency low OR volume below median)', () => {
      const dna: CompanyStrategyDNA = { mode: 'problem_transformation', growth_motion: 'trust_building', content_style: 'educational', decision_focus: 'awareness_to_trust' };
      const profile = {};
      const trend = mkTrend('some topic', 500, 1);
      const mod = computeStrategyModifier(dna, trend, profile, {
        alignmentScore: 0.7,
        volumeMax: 10000,
      });
      expect(mod).toBe(1 + 0.10);
    });

    it('authority_positioning: +0.20 when topic overlaps authority_domains', () => {
      const dna: CompanyStrategyDNA = { mode: 'authority_positioning', growth_motion: 'trust_building', content_style: 'authority', decision_focus: 'awareness_to_trust' };
      const profile = { authority_domains: ['saas positioning'] };
      const trend = mkTrend('why saas positioning fails', 5000, 5);
      const mod = computeStrategyModifier(dna, trend, profile);
      expect(mod).toBe(1 + 0.20);
    });

    it('commercial_growth: +0.15 when topic includes commercial tokens', () => {
      const dna: CompanyStrategyDNA = { mode: 'commercial_growth', growth_motion: 'conversion_acceleration', content_style: 'commercial', decision_focus: 'consideration_to_conversion' };
      const trend = mkTrend('pricing strategies for saas', 3000, 2);
      const mod = computeStrategyModifier(dna, trend, {});
      expect(mod).toBe(1 + 0.15);
    });

    it('commercial_growth: -0.10 when awareness-only (no authority/commercial/problem overlap)', () => {
      const dna: CompanyStrategyDNA = { mode: 'commercial_growth', growth_motion: 'conversion_acceleration', content_style: 'commercial', decision_focus: 'consideration_to_conversion' };
      const trend = mkTrend('brand awareness discovery', 5000, 3);
      const mod = computeStrategyModifier(dna, trend, {});
      expect(mod).toBe(1 - 0.10);
    });

    it('audience_engagement: -0.05 when highly technical or authority-heavy', () => {
      const dna: CompanyStrategyDNA = { mode: 'audience_engagement', growth_motion: 'educational', content_style: 'engagement', decision_focus: 'awareness' };
      const profile = { authority_domains: ['kubernetes'] };
      const trend = mkTrend('kubernetes devops best practices', 2000, 2);
      const mod = computeStrategyModifier(dna, trend, profile);
      expect(mod).toBe(1 - 0.05);
    });

    it('educational_default: modifier = 1', () => {
      const dna: CompanyStrategyDNA = { mode: 'educational_default', growth_motion: 'educational', content_style: 'educational', decision_focus: 'awareness' };
      const trend = mkTrend('any topic', 1000, 5);
      const mod = computeStrategyModifier(dna, trend, {});
      expect(mod).toBe(1);
    });
  });

  describe('scoreByAlignmentThenPopularity integration', () => {
    it('applies modifier: finalAlignment = alignmentScore * strategyModifier', () => {
      const profile = {
        authority_domains: ['saas positioning'],
        campaign_focus: 'b2b',
      };
      const A = mkTrend('marketing tools trends', 50000, 10);
      const B = mkTrend('why saas positioning fails', 5000, 3);
      const ranked = scoreByAlignmentThenPopularity([A, B], profile);
      expect(ranked[0].topic).toBe(B.topic);
    });

    it('popularity tie-break unchanged when final alignment equal', () => {
      const profile = { content_themes: 'automation' };
      const A = mkTrend('automation tips', 1000, 5);
      const B = mkTrend('automation guide', 1000, 3);
      const ranked = scoreByAlignmentThenPopularity([A, B], profile);
      expect(ranked[0].frequency).toBeGreaterThanOrEqual(ranked[1].frequency);
    });
  });
});
