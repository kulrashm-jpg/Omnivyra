/**
 * Company Context Foundation Fix unit tests.
 * Verifies wiring of problem_transformation fields into mission context,
 * alignment tokens, trend keywords, intelligence layer, and forced context.
 */

import { buildCompanyMissionContext } from '../../services/companyMissionContext';
import { buildProfileKeywords } from '../../services/trends/trendAlignmentService';
import { buildCoreProblemTokens, buildWeightedAlignmentTokens } from '../../services/recommendationEngineService';
import { enrichRecommendationIntelligence } from '../../services/recommendationIntelligenceService';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  FORCED_CONTEXT_FIELD_LABELS,
} from '../../services/companyContextService';
import type { CompanyProfile } from '../../services/companyProfileService';

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));

const { getProfile } = require('../../services/companyProfileService');

const mkProfile = (overrides: Partial<CompanyProfile> & { company_id?: string }): CompanyProfile => ({
  company_id: 'c1',
  ...overrides,
});

describe('companyContextFoundationFix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Mission context includes problem_transformation fields', () => {
    it('core_problem_domains includes core_problem_statement, pain_symptoms, authority_domains', async () => {
      const profile = mkProfile({
        company_id: 'c1',
        core_problem_statement: 'prioritization chaos',
        pain_symptoms: ['scope creep', 'resource conflicts'],
        authority_domains: ['agile transformation'],
      });
      (getProfile as jest.Mock).mockResolvedValue(profile);

      const ctx = await buildCompanyMissionContext('c1', 'FULL');
      expect(ctx).not.toBeNull();
      expect(ctx!.core_problem_domains).toBeDefined();
      expect(ctx!.core_problem_domains.length).toBeGreaterThan(0);
      expect(ctx!.core_problem_domains.some((d) => d.toLowerCase().includes('prioritization'))).toBe(true);
      expect(ctx!.core_problem_domains.some((d) => d.toLowerCase().includes('scope') || d.toLowerCase().includes('creep'))).toBe(true);
      expect(ctx!.core_problem_domains.some((d) => d.toLowerCase().includes('agile'))).toBe(true);
    });
  });

  describe('2. Transformation outcome prefers desired_transformation', () => {
    it('transformation_outcome uses desired_transformation when present', async () => {
      const profile = mkProfile({
        company_id: 'c1',
        desired_transformation: 'from chaos to clarity and focus',
      });
      (getProfile as jest.Mock).mockResolvedValue(profile);

      const ctx = await buildCompanyMissionContext('c1', 'FULL');
      expect(ctx).not.toBeNull();
      expect(ctx!.transformation_outcome).toContain('chaos to clarity');
      expect(ctx!.transformation_outcome).toBe('from chaos to clarity and focus');
    });

    it('transformation_outcome uses life_after_solution when desired_transformation empty', async () => {
      const profile = mkProfile({
        company_id: 'c1',
        life_after_solution: 'calm execution and predictable delivery',
        campaign_focus: 'other focus',
      });
      (getProfile as jest.Mock).mockResolvedValue(profile);

      const ctx = await buildCompanyMissionContext('c1', 'FULL');
      expect(ctx).not.toBeNull();
      expect(ctx!.transformation_outcome).toContain('calm execution');
    });
  });

  describe('3. Core problem tokens include pain_symptoms + desired_transformation', () => {
    it('tokens include pain_symptoms and desired_transformation', () => {
      const profile = mkProfile({
        pain_symptoms: ['scope creep', 'delayed delivery'],
        desired_transformation: 'predictable outcomes',
      });
      const tokens = buildCoreProblemTokens(profile);
      expect(tokens.size).toBeGreaterThan(0);
      expect([...tokens].some((t) => t.includes('scope') || t.includes('creep') || t.includes('delayed') || t.includes('delivery'))).toBe(true);
      expect([...tokens].some((t) => t.includes('predictable') || t.includes('outcomes'))).toBe(true);
    });
  });

  describe('4. Weighted tokens include new fields', () => {
    it('weighted map includes pain_symptoms and desired_transformation with high weight', () => {
      const profile = mkProfile({
        pain_symptoms: ['resource conflicts'],
        desired_transformation: 'clarity and focus',
      });
      const map = buildWeightedAlignmentTokens(profile);
      expect(map.size).toBeGreaterThan(0);
      const tokens = [...map.keys()];
      expect(tokens.some((t) => t.includes('resource') || t.includes('conflicts') || t.includes('clarity') || t.includes('focus'))).toBe(true);
    });
  });

  describe('5. buildProfileKeywords includes problem fields', () => {
    it('keywords include core_problem_statement, pain_symptoms, authority_domains, desired_transformation', () => {
      const profile = mkProfile({
        core_problem_statement: 'decision paralysis',
        pain_symptoms: ['analysis overload'],
        authority_domains: ['strategic planning'],
        desired_transformation: 'decisive execution',
      });
      const keywords = buildProfileKeywords(profile);
      expect(keywords.length).toBeGreaterThan(0);
      expect(keywords.some((k) => k.includes('decision') || k.includes('paralysis'))).toBe(true);
      expect(keywords.some((k) => k.includes('analysis') || k.includes('overload'))).toBe(true);
      expect(keywords.some((k) => k.includes('strategic') || k.includes('planning'))).toBe(true);
      expect(keywords.some((k) => k.includes('decisive') || k.includes('execution'))).toBe(true);
    });
  });

  describe('6. awareness_gap updates intelligence.gap_being_filled', () => {
    it('gap_being_filled uses awareness_gap when present', () => {
      const profile = mkProfile({
        awareness_gap: 'hidden cost of context switching',
      });
      const recs = [{ topic: 'Productivity', source: 'test', geo: 'US', volume: 100 }];
      const enriched = enrichRecommendationIntelligence(recs, profile);
      expect(enriched).toHaveLength(1);
      expect(enriched[0].intelligence.gap_being_filled).toBe(
        'Audience lacks awareness of: hidden cost of context switching'
      );
    });

    it('gap_being_filled falls back to diamond/default when awareness_gap empty', () => {
      const profile = mkProfile({});
      const diamond = [{ topic: 'Niche', source: 'test', geo: 'US', volume: 100, polish_flags: { diamond_candidate: true } }];
      const enriched = enrichRecommendationIntelligence(diamond, profile);
      expect(enriched[0].intelligence.gap_being_filled).toBe('Underserved but high-alignment opportunity.');
    });
  });

  describe('7. Forced context can select awareness_gap individually', () => {
    it('awareness_gap has a display label (so it is selectable)', () => {
      expect(FORCED_CONTEXT_FIELD_LABELS.awareness_gap).toBe('Awareness Gap');
    });

    it('buildForcedCompanyContext includes awareness_gap when forced and profile has value', () => {
      const profile = mkProfile({
        awareness_gap: 'benefits of automation',
      });
      const companyContext = buildCompanyContext(profile);
      const { forced_context, forced_context_enabled_fields } = buildForcedCompanyContext(
        companyContext,
        { awareness_gap: true }
      );
      expect(forced_context_enabled_fields).toContain('awareness_gap');
      expect(forced_context.awareness_gap).toBe('benefits of automation');
    });

    it('desired_transformation, transformation_mechanism, life_with_problem, life_after_solution have labels (individually selectable)', () => {
      expect(FORCED_CONTEXT_FIELD_LABELS.desired_transformation).toBe('Desired Transformation');
      expect(FORCED_CONTEXT_FIELD_LABELS.transformation_mechanism).toBe('Transformation Mechanism');
      expect(FORCED_CONTEXT_FIELD_LABELS.life_with_problem).toBe('Life With Problem');
      expect(FORCED_CONTEXT_FIELD_LABELS.life_after_solution).toBe('Life After Solution');
      expect(FORCED_CONTEXT_FIELD_LABELS.problem_impact).toBe('Problem Impact');
    });
  });

  describe('8. buildCompanyContext includes all problem_transformation fields', () => {
    it('maps every problem_transformation field from profile', () => {
      const profile = mkProfile({
        core_problem_statement: 'prioritization chaos',
        pain_symptoms: ['scope creep', 'missed deadlines'],
        awareness_gap: 'cost of context switching',
        problem_impact: 'delivery delays and burnout',
        life_with_problem: 'constant firefighting',
        life_after_solution: 'predictable delivery',
        desired_transformation: 'focused execution',
        transformation_mechanism: 'weekly planning rituals',
        authority_domains: ['agile operations'],
      });
      const ctx = buildCompanyContext(profile);
      expect(ctx.problem_transformation).toEqual({
        core_problem_statement: 'prioritization chaos',
        pain_symptoms: ['scope creep', 'missed deadlines'],
        awareness_gap: 'cost of context switching',
        problem_impact: 'delivery delays and burnout',
        life_with_problem: 'constant firefighting',
        life_after_solution: 'predictable delivery',
        desired_transformation: 'focused execution',
        transformation_mechanism: 'weekly planning rituals',
        authority_domains: ['agile operations'],
      });
    });
  });

  describe('9. Forced context supports problem_transformation section', () => {
    it('includes full problem_transformation section when forced', () => {
      const profile = mkProfile({
        core_problem_statement: 'clarity gap',
        desired_transformation: 'confident decisions',
      });
      const companyContext = buildCompanyContext(profile);
      const { forced_context, forced_context_enabled_fields } = buildForcedCompanyContext(
        companyContext,
        { problem_transformation: true }
      );
      expect(forced_context_enabled_fields).toContain('problem_transformation');
      expect(forced_context.problem_transformation).toBeDefined();
      expect((forced_context.problem_transformation as Record<string, unknown>).core_problem_statement).toBe(
        'clarity gap'
      );
    });
  });
});
