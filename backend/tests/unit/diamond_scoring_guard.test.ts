/**
 * Diamond Scoring Guard
 * Ensures diamonds (high-value under-served opportunities) outrank generic coal topics.
 */

import {
  buildWeightedAlignmentTokens,
  computeAlignmentScore,
  scoreByAlignmentThenPopularity,
} from '../../services/recommendationEngineService';
import type { TrendSignalNormalized } from '../../services/trendProcessingService';

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

describe('diamond_scoring_guard', () => {
  describe('TEST 1 — Authority diamond beats popular generic', () => {
    it('B (why saas positioning fails) ranks above A (marketing tools trends) when authority_domains = ["saas positioning"]', () => {
      const profile = { authority_domains: ['saas positioning'] };
      const A = mkTrend('marketing tools trends', 50000, 10);
      const B = mkTrend('why saas positioning fails', 5000, 3);

      const ranked = scoreByAlignmentThenPopularity([A, B], profile);
      expect(ranked[0].topic).toBe(B.topic);
      expect(ranked[1].topic).toBe(A.topic);
    });
  });

  describe('TEST 2 — Awareness gap boosts ranking', () => {
    it('"hidden mistake in enterprise automation" ranks above "automation software tools" when core_problem_statement includes awareness-gap language', () => {
      const profile = {
        core_problem_statement: 'hidden mistake enterprise automation',
        content_themes: 'automation',
      };
      const generic = mkTrend('automation software tools', 20000, 8);
      const diamond = mkTrend('hidden mistake in enterprise automation', 3000, 2);

      const ranked = scoreByAlignmentThenPopularity([generic, diamond], profile);
      expect(ranked[0].topic).toBe(diamond.topic);
    });
  });

  describe('TEST 3 — Generic penalty works', () => {
    it('Topics with generic tokens only (marketing tools platform) receive lower alignment score', () => {
      const profile = {
        campaign_focus: 'b2b sales',
        authority_domains: ['sales enablement'],
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      const genericScore = computeAlignmentScore('marketing tools platform', tokens);
      const authorityScore = computeAlignmentScore('sales enablement for b2b', tokens);

      expect(authorityScore).toBeGreaterThan(genericScore);
    });

    it('Generic tokens (tools, platform) are blacklisted from adding alignment', () => {
      const profile = { campaign_focus: 'tools platform strategies' };
      const tokens = buildWeightedAlignmentTokens(profile);
      const score = computeAlignmentScore('marketing tools platform', tokens);
      expect(tokens.size).toBe(0);
      expect(score).toBe(1);
    });
  });

  describe('TEST 4 — Backward compatibility', () => {
    it('Profile without authority/problem fields: ranking follows alignment + popularity', () => {
      const profile = { content_themes: 'automation', industry: 'tech' };
      const A = mkTrend('tech automation trends', 10000, 5);
      const B = mkTrend('unrelated sports news', 50000, 10);

      const ranked = scoreByAlignmentThenPopularity([A, B], profile);
      expect(ranked[0].topic).toBe(A.topic);
    });
  });

  describe('TEST 5 — Diamond score range', () => {
    it('Alignment score is always 0 <= score <= 1', () => {
      const profile = {
        authority_domains: ['saas'],
        campaign_focus: 'positioning',
      };
      const tokens = buildWeightedAlignmentTokens(profile);

      const topics = [
        'saas positioning mastery',
        'marketing tools platform',
        'random unrelated topic',
        '',
      ];
      topics.forEach((topic) => {
        const score = computeAlignmentScore(topic, tokens);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });
  });
});
