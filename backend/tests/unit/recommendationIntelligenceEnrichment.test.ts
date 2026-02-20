/**
 * Recommendation Intelligence Enrichment unit tests.
 */

import {
  enrichRecommendationIntelligence,
  type RecommendationIntelligence,
} from '../../services/recommendationIntelligenceService';
import type { CompanyProfile } from '../../services/companyProfileService';
import type { PolishFlags } from '../../services/recommendationPolishService';

const mkRec = (
  topic: string,
  overrides?: Partial<Record<string, unknown>>
): Record<string, unknown> & { topic: string } => ({
  topic,
  source: 'test',
  geo: 'US',
  volume: 1000,
  frequency: 1,
  sources: ['test'],
  ...overrides,
});

describe('recommendationIntelligenceEnrichment', () => {
  describe('intelligence fields', () => {
    it('adds all required intelligence fields to each recommendation', () => {
      const recs = [mkRec('saas positioning')];
      const profile: CompanyProfile | null = {
        company_id: 'c1',
        core_problem_statement: ' positioning confusion',
        target_audience: 'B2B founders',
      };
      const enriched = enrichRecommendationIntelligence(recs, profile);
      expect(enriched).toHaveLength(1);
      const int = enriched[0].intelligence as RecommendationIntelligence;
      expect(int).toHaveProperty('problem_being_solved');
      expect(int).toHaveProperty('gap_being_filled');
      expect(int).toHaveProperty('why_now');
      expect(int).toHaveProperty('authority_reason');
      expect(int).toHaveProperty('expected_transformation');
      expect(int).toHaveProperty('campaign_angle');
    });

    it('RULE A: problem_being_solved uses core_problem_statement > pain_symptoms > campaign_focus > content_themes', () => {
      const profile: CompanyProfile | null = {
        company_id: 'c1',
        core_problem_statement: 'messy positioning',
        target_audience: 'B2B founders',
      };
      const enriched = enrichRecommendationIntelligence([mkRec('test')], profile);
      const int = enriched[0].intelligence as RecommendationIntelligence;
      expect(int.problem_being_solved).toContain('B2B founders');
      expect(int.problem_being_solved).toContain('messy positioning');
      expect(int.problem_being_solved).toMatch(/^Helping .+ overcome .+$/);
    });

    it('RULE B: gap_being_filled is diamond-specific when polish_flags.diamond_candidate', () => {
      const diamond: Record<string, unknown> & { topic: string } = mkRec('niche topic', {
        polish_flags: { diamond_candidate: true } as PolishFlags,
        volume: 100,
      });
      const generic = mkRec('popular topic', { volume: 50000 });
      const profile: CompanyProfile | null = { company_id: 'c1' };
      const enriched = enrichRecommendationIntelligence([diamond, generic], profile);
      expect((enriched[0].intelligence as RecommendationIntelligence).gap_being_filled).toBe(
        'Underserved but high-alignment opportunity.'
      );
      expect((enriched[1].intelligence as RecommendationIntelligence).gap_being_filled).toBe(
        'Existing demand lacking clear authority-driven guidance.'
      );
    });

    it('RULE C: why_now reflects popularity vs alignment', () => {
      const volMax = 10000;
      const highPop = mkRec('trendy', { volume: 8000 });
      const lowPop = mkRec('niche', { volume: 500, diamond_score: 0.7 });
      const profile: CompanyProfile | null = { company_id: 'c1' };
      const enriched = enrichRecommendationIntelligence([highPop, lowPop], profile);
      expect((enriched[0].intelligence as RecommendationIntelligence).why_now).toContain(
        'differentiation'
      );
      expect((enriched[1].intelligence as RecommendationIntelligence).why_now).toContain(
        'Early-stage'
      );
    });

    it('RULE D: authority_reason when polish_flags.authority_elevated', () => {
      const elevated = mkRec('saas positioning', {
        polish_flags: { authority_elevated: true } as PolishFlags,
      });
      const profile: CompanyProfile | null = {
        company_id: 'c1',
        authority_domains: ['saas positioning', 'go-to-market'],
      };
      const enriched = enrichRecommendationIntelligence([elevated], profile);
      const int = enriched[0].intelligence as RecommendationIntelligence;
      expect(int.authority_reason).toContain('saas positioning');
      expect(int.authority_reason).toContain('credibility');
    });

    it('RULE D: authority_reason is null when not authority_elevated', () => {
      const rec = mkRec('random topic');
      const profile: CompanyProfile | null = { company_id: 'c1', authority_domains: ['other'] };
      const enriched = enrichRecommendationIntelligence([rec], profile);
      expect((enriched[0].intelligence as RecommendationIntelligence).authority_reason).toBeNull();
    });

    it('RULE E: expected_transformation uses desired_transformation, life_after_solution, campaign_focus', () => {
      const profile: CompanyProfile | null = {
        company_id: 'c1',
        life_with_problem: 'chaos',
        desired_transformation: 'clarity and focus',
      };
      const enriched = enrichRecommendationIntelligence([mkRec('x')], profile);
      const int = enriched[0].intelligence as RecommendationIntelligence;
      expect(int.expected_transformation).toContain('chaos');
      expect(int.expected_transformation).toContain('clarity and focus');
      expect(int.expected_transformation).toMatch(/^Move audience from .+ toward .+$/);
    });

    it('RULE F: campaign_angle maps deterministically from polish flags', () => {
      const diamond = mkRec('x', { polish_flags: { diamond_candidate: true } as PolishFlags });
      const authority = mkRec('x', { polish_flags: { authority_elevated: true } as PolishFlags });
      const generic = mkRec('x', { polish_flags: { is_generic_reframed: true } as PolishFlags });
      const none = mkRec('x');
      const profile: CompanyProfile | null = { company_id: 'c1' };

      const d = enrichRecommendationIntelligence([diamond], profile)[0]
        .intelligence as RecommendationIntelligence;
      const a = enrichRecommendationIntelligence([authority], profile)[0]
        .intelligence as RecommendationIntelligence;
      const g = enrichRecommendationIntelligence([generic], profile)[0]
        .intelligence as RecommendationIntelligence;
      const n = enrichRecommendationIntelligence([none], profile)[0]
        .intelligence as RecommendationIntelligence;

      expect(d.campaign_angle).toBe('Gap exposure → Education → Conversion');
      expect(a.campaign_angle).toBe('Pain → Awareness → Authority → Solution');
      expect(g.campaign_angle).toBe('Reframe → Differentiation → Trust');
      expect(n.campaign_angle).toBe('Pain → Awareness → Authority → Solution');
    });
  });

  describe('safety', () => {
    it('returns empty array for empty input', () => {
      expect(enrichRecommendationIntelligence([], null)).toEqual([]);
    });

    it('preserves original recommendation shape (topic, volume, etc.)', () => {
      const rec = mkRec('original topic', { volume: 1234, geo: 'UK' });
      const enriched = enrichRecommendationIntelligence([rec], null);
      expect(enriched[0].topic).toBe('original topic');
      expect(enriched[0].volume).toBe(1234);
      expect(enriched[0].geo).toBe('UK');
    });

    it('uses fallback values when profile is null', () => {
      const enriched = enrichRecommendationIntelligence([mkRec('x')], null);
      const int = enriched[0].intelligence as RecommendationIntelligence;
      expect(int.problem_being_solved).toContain('audience');
      expect(int.problem_being_solved).toContain('key challenges');
      expect(int.expected_transformation).toContain('current friction');
      expect(int.expected_transformation).toContain('desired outcome');
    });
  });
});
