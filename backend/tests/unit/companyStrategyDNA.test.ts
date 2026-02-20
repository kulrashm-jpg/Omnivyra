/**
 * Company Strategy DNA unit tests.
 */

import { buildCompanyStrategyDNA, type CompanyStrategyDNA } from '../../services/companyStrategyDNAService';
import type { CompanyProfile } from '../../services/companyProfileService';

const mkProfile = (overrides: Partial<CompanyProfile>): CompanyProfile => ({
  company_id: 'c1',
  ...overrides,
});

describe('companyStrategyDNA', () => {
  describe('mode resolution (priority order)', () => {
    it('1. problem_transformation when core_problem_statement exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ core_problem_statement: 'teams struggle with prioritization' })
      );
      expect(dna.mode).toBe('problem_transformation');
    });

    it('1. problem_transformation when desired_transformation exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ desired_transformation: 'from chaos to clarity' })
      );
      expect(dna.mode).toBe('problem_transformation');
    });

    it('2. authority_positioning when authority_domains exists and non-empty', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ authority_domains: ['saas positioning'] })
      );
      expect(dna.mode).toBe('authority_positioning');
    });

    it('3. commercial_growth when pricing_model exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ pricing_model: 'subscription' })
      );
      expect(dna.mode).toBe('commercial_growth');
    });

    it('3. commercial_growth when sales_motion exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ sales_motion: 'self-serve' })
      );
      expect(dna.mode).toBe('commercial_growth');
    });

    it('3. commercial_growth when key_metrics exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ key_metrics: 'MRR growth' })
      );
      expect(dna.mode).toBe('commercial_growth');
    });

    it('4. audience_engagement when target_audience exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ target_audience: 'B2B founders' })
      );
      expect(dna.mode).toBe('audience_engagement');
    });

    it('4. audience_engagement when brand_voice exists', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ brand_voice: 'professional yet approachable' })
      );
      expect(dna.mode).toBe('audience_engagement');
    });

    it('5. educational_default when no trigger fields', () => {
      const dna = buildCompanyStrategyDNA(
        mkProfile({ industry: 'tech', content_themes: 'automation' })
      );
      expect(dna.mode).toBe('educational_default');
    });

    it('5. educational_default when profile is null', () => {
      const dna = buildCompanyStrategyDNA(null);
      expect(dna.mode).toBe('educational_default');
    });
  });

  describe('mode → growth_motion / content_style / decision_focus', () => {
    const expected: Array<{
      mode: CompanyStrategyDNA['mode'];
      growth_motion: CompanyStrategyDNA['growth_motion'];
      content_style: CompanyStrategyDNA['content_style'];
      decision_focus: CompanyStrategyDNA['decision_focus'];
    }> = [
      {
        mode: 'problem_transformation',
        growth_motion: 'trust_building',
        content_style: 'educational',
        decision_focus: 'awareness_to_trust',
      },
      {
        mode: 'authority_positioning',
        growth_motion: 'trust_building',
        content_style: 'authority',
        decision_focus: 'awareness_to_trust',
      },
      {
        mode: 'commercial_growth',
        growth_motion: 'conversion_acceleration',
        content_style: 'commercial',
        decision_focus: 'consideration_to_conversion',
      },
      {
        mode: 'audience_engagement',
        growth_motion: 'educational',
        content_style: 'engagement',
        decision_focus: 'awareness',
      },
      {
        mode: 'educational_default',
        growth_motion: 'educational',
        content_style: 'educational',
        decision_focus: 'awareness',
      },
    ];

    expected.forEach(({ mode, growth_motion, content_style, decision_focus }) => {
      it(`${mode} → growth_motion=${growth_motion}, content_style=${content_style}, decision_focus=${decision_focus}`, () => {
        const overrides: Partial<CompanyProfile> =
          mode === 'problem_transformation' ? { core_problem_statement: 'x' } :
          mode === 'authority_positioning' ? { authority_domains: ['x'] } :
          mode === 'commercial_growth' ? { pricing_model: 'x' } :
          mode === 'audience_engagement' ? { target_audience: 'x' } :
          { industry: 'tech' };
        const profile = mkProfile(overrides);
        const dna = buildCompanyStrategyDNA(profile);
        expect(dna.mode).toBe(mode);
        expect(dna.growth_motion).toBe(growth_motion);
        expect(dna.content_style).toBe(content_style);
        expect(dna.decision_focus).toBe(decision_focus);
      });
    });
  });

  describe('output shape', () => {
    it('returns all required fields', () => {
      const dna = buildCompanyStrategyDNA(mkProfile({ core_problem_statement: 'x' }));
      expect(dna).toHaveProperty('mode');
      expect(dna).toHaveProperty('growth_motion');
      expect(dna).toHaveProperty('content_style');
      expect(dna).toHaveProperty('decision_focus');
    });
  });
});
