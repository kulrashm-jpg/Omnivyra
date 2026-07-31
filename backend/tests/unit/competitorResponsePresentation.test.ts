/**
 * COMPETITOR-RESPONSE-001 — presentation helpers expose existing evidence without
 * fabricating. Verifies Evidence Summary / Why Included / Evidence Sources derive
 * from fields already on RankedCompetitor, and that rankedCompetitorDetailsForProfile
 * emits the full response contract including a Freshness timestamp.
 */
import {
  buildCompetitorEvidenceSummary,
  buildCompetitorWhyIncluded,
  buildCompetitorEvidenceSources,
  readableCompetitorCategory,
} from '../../services/competitorResponsePresentation';
import { rankedCompetitorDetailsForProfile } from '../../services/companyProfileServiceRest1Enrich';
import type { RankedCompetitor } from '../../services/competitorEngineServiceModel';

function makeRanked(overrides: Partial<RankedCompetitor> = {}): RankedCompetitor {
  return {
    name: 'HubSpot',
    domain: 'hubspot.com',
    category: 'marketing_automation',
    tags: [],
    source: 'serp_live',
    classification: 'direct_competitor',
    relevance_score: 82,
    score_card: { overallScore: 82, category: 'direct', tier: 'strong', dimensions: {}, reasoning: [], confidence: 80, discoverySources: ['serp'], capabilityVector: {} } as unknown as RankedCompetitor['score_card'],
    reasoning: ['Competes across the marketing workflow for SMB buyers.'],
    discoverySources: ['serp', 'stored'],
    capabilityVector: {} as RankedCompetitor['capabilityVector'],
    problem_overlap: 0.5,
    icp_overlap: 0.7,
    market_overlap: 0.4,
    revenue_tier: 'enterprise',
    product_depth: 0.6,
    authority_score: 0.5,
    authority_signals: { funding_level: 'high', brand_strength: 'high' } as unknown as RankedCompetitor['authority_signals'],
    final_score: 0.7,
    tier: 'Tier 1',
    positioning: { threat_level: 'high', strengths_vs_company: ['brand'], weaknesses_vs_company: ['price'], differentiation: 'x' } as RankedCompetitor['positioning'],
    enrichment: {
      name: 'HubSpot', domain: 'hubspot.com', category: 'marketing_automation', tags: [],
      description: 'Marketing automation and CRM platform focused on SMBs. It also does many other things.',
      icp: { age_group: null, use_case: 'marketing automation', user_intent: null },
      business_model: 'SaaS subscription', geography: 'Global', product_type: 'platform',
      scale_signals: {} as never, confidence_score: 0.8, sources: ['hubspot.com'],
    } as unknown as RankedCompetitor['enrichment'],
    enrichment_confidence_score: 0.8,
    rationale: 'Validated as a likely competitor through shared market, offering, and ICP signals.',
    competitor_intelligence: null,
    fit_signals: { product_service: 'Marketing platform', business_model: 'SaaS', target_customer: 'SMBs' },
    ...overrides,
  } as RankedCompetitor;
}

describe('competitorResponsePresentation', () => {
  it('readableCompetitorCategory humanizes slugs and preserves acronyms', () => {
    expect(readableCompetitorCategory('mental_wellness_ai')).toBe('Mental wellness AI');
    expect(readableCompetitorCategory('crm_platform')).toBe('CRM platform');
    expect(readableCompetitorCategory('')).toBe('');
  });

  it('Evidence Summary prefers the grounded description (first sentence, no fabrication)', () => {
    const summary = buildCompetitorEvidenceSummary(makeRanked());
    expect(summary).toBe('Marketing automation and CRM platform focused on SMBs.');
  });

  it('Evidence Summary falls back to category + fit signals when no description exists', () => {
    const summary = buildCompetitorEvidenceSummary(
      makeRanked({ enrichment: null, fit_signals: { business_model: 'SaaS', target_customer: 'SMBs' } }),
    );
    expect(summary).toContain('Marketing automation');
    expect(summary).toContain('SMBs');
  });

  it('Evidence Summary is empty (never invented) when there is nothing to summarize', () => {
    const summary = buildCompetitorEvidenceSummary(
      makeRanked({ enrichment: null, category: '', fit_signals: {} }),
    );
    expect(summary).toBe('');
  });

  it('Why Included reflects the dominant overlap signal', () => {
    // icp_overlap (0.7) is the strongest → same customer segment.
    expect(buildCompetitorWhyIncluded(makeRanked())).toContain('same customer segment');
  });

  it('Evidence Sources map provenance to human labels, deduped', () => {
    const sources = buildCompetitorEvidenceSources(makeRanked());
    expect(sources).toContain('SERP');
    expect(sources).toContain('Company Website'); // from discoverySources 'stored'
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('rankedCompetitorDetailsForProfile emits the full COMPETITOR-RESPONSE-001 contract', () => {
    const [row] = rankedCompetitorDetailsForProfile([makeRanked()], '2026-07-30T00:00:00.000Z');
    expect(row).toMatchObject({
      name: 'HubSpot',
      tier: 'Tier 1',
      confidence: 0.8,
      observed_at: '2026-07-30T00:00:00.000Z',
    });
    expect(typeof row.evidence_summary).toBe('string');
    expect(typeof row.why_included).toBe('string');
    expect(Array.isArray(row.evidence_sources)).toBe(true);
  });
});
