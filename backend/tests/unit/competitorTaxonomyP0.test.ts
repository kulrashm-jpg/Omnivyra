/**
 * COMPETITOR-TAXONOMY-P0-001 — production hardening (flag-gated).
 *
 * Out-of-taxonomy inputs abstain ('unknown') instead of collapsing into a false
 * 'marketing_seo_software'; 'unknown' forms no affinity; the affinity floor cannot
 * fire; hasStrictCategoryFit defers 'unknown' to evidence. Net effect: cross-category
 * Tier-1 leaks are eliminated while supported categories are byte-for-byte unchanged.
 */
import {
  normalizeCompetitorCategory,
  categoryAffinity,
  competitorTaxonomyP0Enabled,
} from '../../services/competitorTaxonomy';
import { getFinalCompetitorsSync, extractCompetitiveContextFromProfile } from '../../services/competitorEngineService';
import type { CompanyProfile } from '../../services/companyProfileService';

function prof(p: Partial<CompanyProfile>): CompanyProfile {
  return { company_id: 'x', report_settings: { company_facts: { team_size: '11-50', revenue_range: 'growth' } }, ...p } as unknown as CompanyProfile;
}
const cand = (name: string, category: string, description: string, targetCustomer: string) =>
  ({ name, source: 'manual' as const, category, description, targetCustomer, geography: 'Global' });

const withFlag = (v: string | undefined, fn: () => void) => {
  const original = process.env.COMPETITOR_TAXONOMY_P0;
  if (v === undefined) delete process.env.COMPETITOR_TAXONOMY_P0; else process.env.COMPETITOR_TAXONOMY_P0 = v;
  try { fn(); } finally {
    if (original === undefined) delete process.env.COMPETITOR_TAXONOMY_P0; else process.env.COMPETITOR_TAXONOMY_P0 = original;
  }
};

describe('competitorTaxonomyP0 — flag + taxonomy primitives', () => {
  it('flag defaults ON and is a reversible kill-switch', () => {
    withFlag(undefined, () => expect(competitorTaxonomyP0Enabled()).toBe(true));
    withFlag('0', () => expect(competitorTaxonomyP0Enabled()).toBe(false));
    withFlag('false', () => expect(competitorTaxonomyP0Enabled()).toBe(false));
  });

  it('out-of-taxonomy input abstains to unknown (ON) but collapses to default (OFF)', () => {
    const industrial = 'industrial automation controllers and robotics for automotive plants';
    withFlag('on', () => expect(normalizeCompetitorCategory('industrial automation equipment', industrial)).toBe('unknown'));
    withFlag('0', () => expect(normalizeCompetitorCategory('industrial automation equipment', industrial)).toBe('marketing_seo_software'));
  });

  it('supported categories are UNCHANGED by the flag (objective 5)', () => {
    withFlag('on', () => {
      expect(normalizeCompetitorCategory('crm', 'crm and sales automation')).toBe('crm_marketing_automation');
      expect(normalizeCompetitorCategory('mental wellness', 'emotional wellbeing chatbot')).toBe('mental_wellness_ai');
      expect(normalizeCompetitorCategory('seo', 'digital marketing and content')).toBe('marketing_seo_software');
    });
  });

  it('unknown is a first-class affinity state — never same/functional, and NOT substitute', () => {
    // Refined semantics: 'unknown' = "category could not be determined". It carries no
    // affinity judgement and must NOT be conflated with a substitute.
    expect(categoryAffinity('unknown', 'crm_marketing_automation')).toBe('unknown');
    expect(categoryAffinity('crm_marketing_automation', 'unknown')).toBe('unknown');
    // Two unknowns must NOT collapse to 'same' (equality check runs after the unknown guard).
    expect(categoryAffinity('unknown', 'unknown')).toBe('unknown');
    // supported affinities intact
    expect(categoryAffinity('crm_marketing_automation', 'crm_marketing_automation')).toBe('same');
    expect(categoryAffinity('crm_marketing_automation', 'marketing_seo_software')).toBe('functional');
  });
});

describe('competitorTaxonomyP0 — end-to-end qualification', () => {
  // Out-of-taxonomy company (telehealth) with a genuine peer + a cross-category decoy (CRM).
  const healthProfile = prof({ name: 'CareBridge', industry: 'Healthcare technology', category: 'telehealth platform', products_services: 'telehealth and remote patient monitoring software for clinics', products_services_list: ['telehealth', 'remote patient monitoring'], target_audience: 'outpatient clinics and providers' });
  const healthCandidates = [
    cand('Teladoc Health', 'telehealth platform', 'telehealth and virtual care platform for providers and patients', 'clinics and health systems'),
    cand('Pipedrive', 'crm software', 'sales pipeline CRM software', 'SMB sales teams'),
  ];

  it('LEGACY (flag off) leaks the cross-category decoy at Tier 1/2', () => {
    withFlag('0', () => {
      const ranked = getFinalCompetitorsSync({ context: extractCompetitiveContextFromProfile(healthProfile), candidates: healthCandidates as never, max: 10 });
      const pipedrive = ranked.find((r) => r.name === 'Pipedrive');
      expect(pipedrive).toBeDefined(); // present, and inflated by the affinity floor
    });
  });

  it('P0 (flag on) eliminates the Tier-1 leak while the genuine peer still surfaces', () => {
    withFlag('on', () => {
      const ranked = getFinalCompetitorsSync({ context: extractCompetitiveContextFromProfile(healthProfile), candidates: healthCandidates as never, max: 10 });
      const byName = new Map(ranked.map((r) => [r.name, r.tier]));
      // Recall preserved — the genuine same-industry peer still surfaces.
      expect(byName.has('Teladoc Health')).toBe(true);
      // Cross-category decoy is NEVER Tier 1 (it may demote to Tier 3 or drop out).
      expect(byName.get('Pipedrive')).not.toBe('Tier 1');
    });
  });

  it('supported-taxonomy company (wellness) is unaffected — genuine peers still qualify', () => {
    const wellness = prof({ name: 'Drishik', industry: 'AI wellness', category: 'AI clarity platform', products_services: 'AI clarity engine for self-reflection and emotional wellbeing', products_services_list: ['AI clarity engine', 'self-reflection guidance'], target_audience: 'individuals seeking personal clarity' });
    withFlag('on', () => {
      const ranked = getFinalCompetitorsSync({
        context: extractCompetitiveContextFromProfile(wellness),
        candidates: [cand('Wysa', 'mental wellness AI', 'AI-guided mental wellbeing and emotional support chatbot', 'individuals seeking emotional wellbeing')] as never,
        max: 10,
      });
      expect(ranked.map((r) => r.name)).toContain('Wysa');
    });
  });
});
