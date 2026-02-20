/**
 * Unit tests for weighted alignment scoring.
 * Verifies: campaign_focus vs industry, content_themes vs goals, order flip vs equal-weight, fallback.
 */

import {
  buildWeightedAlignmentTokens,
  computeAlignmentScore,
} from '../../services/recommendationEngineService';

describe('Weighted alignment scoring', () => {
  describe('1. campaign_focus match outranks industry-only match', () => {
    it('campaign_focus (×3) scores higher than industry (×1) for same number of matches', () => {
      const profile = {
        campaign_focus: 'saas',
        content_themes: 'automation',
        industry: 'retail',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      const scoreCampaignFocus = computeAlignmentScore('saas automation platform', tokens);
      const scoreIndustry = computeAlignmentScore('retail automation solutions', tokens);
      // saas(3)+automation(2)=5, max=3+2+1=6 → 5/6 ≈ 0.8333
      // retail(1)+automation(2)=3, max=6 → 3/6 = 0.5
      expect(scoreCampaignFocus).toBeGreaterThan(scoreIndustry);
      expect(scoreCampaignFocus).toBeGreaterThan(0.8);
      expect(scoreIndustry).toBeLessThan(0.6);
    });
  });

  describe('2. content_themes match outranks goals-only match', () => {
    it('content_themes (×2) scores higher than goals (×1)', () => {
      const profile = {
        campaign_focus: 'marketing',
        content_themes: 'automation',
        goals: 'growth',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      const scoreContentThemes = computeAlignmentScore('marketing automation platform', tokens);
      const scoreGoals = computeAlignmentScore('marketing growth strategies', tokens);
      // automation(2)+marketing(3)=5, max=3+2+1=6 → 5/6 ≈ 0.8333
      // growth(1)+marketing(3)=4, max=6 → 4/6 ≈ 0.6667
      expect(scoreContentThemes).toBeGreaterThan(scoreGoals);
      expect(scoreContentThemes).toBeGreaterThan(0.8);
      expect(scoreGoals).toBeLessThan(0.7);
    });
  });

  describe('3. Weighted alignment changes order vs previous equal-weight logic', () => {
    it('high-weight single match outranks low-weight multi-match (order flip)', () => {
      const profile = {
        campaign_focus: 'saas',
        industry: 'retail',
        goals: 'growth',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      const topicA = 'saas solutions';
      const topicB = 'retail growth strategy';
      const scoreA = computeAlignmentScore(topicA, tokens);
      const scoreB = computeAlignmentScore(topicB, tokens);
      // Topic A: 1 match (saas, weight 3). Weighted: 3/4.5 ≈ 0.6667
      // Topic B: 2 matches (retail 1, growth 0.5). Weighted: 1.5/4.5 ≈ 0.3333
      expect(scoreA).toBeGreaterThan(scoreB);
      expect(scoreA).toBe(0.6667);
      expect(scoreB).toBe(0.3333);
      // Under OLD equal-weight: matches/topicLen → A=1/2=0.5, B=2/3≈0.67 → B would rank first
      // Under NEW weighted: A (0.6) > B (0.3) → order FLIPS
    });
  });

  describe('4. Fallback when no tokens exist', () => {
    it('returns 1 when weightedTokens is empty (fallback to popularity)', () => {
      const emptyTokens = buildWeightedAlignmentTokens({});
      const score = computeAlignmentScore('any topic', emptyTokens);
      expect(score).toBe(1);
    });

    it('returns 1 when profile has only category (no alignment fields)', () => {
      const tokens = buildWeightedAlignmentTokens({
        category: 'marketing',
        company_id: 'c-1',
      });
      expect(tokens.size).toBe(0);
      const score = computeAlignmentScore('AI marketing', tokens);
      expect(score).toBe(1);
    });
  });

  describe('Token hygiene', () => {
    it('1. generic token alone does not produce high alignment (blacklisted → empty map)', () => {
      const tokens = buildWeightedAlignmentTokens({
        campaign_focus: 'tools',
        content_themes: 'software platform',
      });
      expect(tokens.size).toBe(0);
      const score = computeAlignmentScore('tools software platform strategies', tokens);
      expect(score).toBe(1);
    });

    it('2. campaign_focus token still dominates over content_themes (non-generic)', () => {
      const profile = {
        campaign_focus: 'saas',
        content_themes: 'automation',
        industry: 'retail',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      const scoreCampaignFocus = computeAlignmentScore('saas solutions', tokens);
      const scoreContentThemes = computeAlignmentScore('automation solutions', tokens);
      expect(scoreCampaignFocus).toBeGreaterThan(scoreContentThemes);
      expect(tokens.get('saas')).toBe(3);
      expect(tokens.get('automation')).toBe(2);
    });

    it('3. downweighted token reduces score compared to non-downweighted', () => {
      const profile = {
        campaign_focus: 'marketing',
        content_themes: 'automation',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      expect(tokens.get('marketing')).toBe(1.5);
      expect(tokens.get('automation')).toBe(2);
      const scoreMarketingOnly = computeAlignmentScore('marketing solutions', tokens);
      const scoreAutomationOnly = computeAlignmentScore('automation solutions', tokens);
      expect(scoreAutomationOnly).toBeGreaterThan(scoreMarketingOnly);
    });

    it('4. profile with only blacklisted tokens triggers fallback (empty map)', () => {
      const tokens = buildWeightedAlignmentTokens({
        campaign_focus: 'tools software',
        content_themes: 'platform strategies tips',
      });
      expect(tokens.size).toBe(0);
      const score = computeAlignmentScore('any topic here', tokens);
      expect(score).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('empty topic returns 0', () => {
      const tokens = buildWeightedAlignmentTokens({ campaign_focus: 'marketing' });
      const score = computeAlignmentScore('', tokens);
      expect(score).toBe(0);
    });

    it('topic with only short tokens (<3 chars) returns 0', () => {
      const tokens = buildWeightedAlignmentTokens({ campaign_focus: 'marketing' });
      const score = computeAlignmentScore('a b c', tokens);
      expect(score).toBe(0);
    });

    it('all profile tokens match returns 1', () => {
      const profile = { campaign_focus: 'marketing', goals: 'growth' };
      const tokens = buildWeightedAlignmentTokens(profile);
      const score = computeAlignmentScore('marketing growth strategies', tokens);
      expect(score).toBe(1);
    });

    it('no overlap returns 0', () => {
      const tokens = buildWeightedAlignmentTokens({
        campaign_focus: 'AI',
        content_themes: 'automation',
      });
      const score = computeAlignmentScore('sports playoffs championship', tokens);
      expect(score).toBe(0);
    });

    it('token in multiple fields takes max weight', () => {
      const profile = {
        campaign_focus: 'automation',
        content_themes: 'automation',
        industry: 'automation',
      };
      const tokens = buildWeightedAlignmentTokens(profile);
      expect(tokens.get('automation')).toBe(3);
      const score = computeAlignmentScore('automation solutions', tokens);
      expect(score).toBe(1);
    });
  });
});
