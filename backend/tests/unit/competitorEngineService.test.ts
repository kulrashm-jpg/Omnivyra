import {
  evaluateCompetitorCandidate,
  extractCompetitiveContextFromProfile,
  filterProfileCompetitorNames,
  getFinalCompetitors,
  getFinalCompetitorsSync,
  rankCompetitorCandidates,
} from '../../services/competitorEngineService';
import { enrichCompetitorCandidates } from '../../services/competitorEnrichmentService';
import type { CompanyProfile } from '../../services/companyProfileService';
import {
  assertSortedByScoreDesc,
  assertValidCompetitor,
  assertValidCompetitorList,
} from '../helpers/assertValidCompetitor';

const drishikProfile: CompanyProfile = {
  company_id: 'drishik',
  name: 'Drishik',
  industry: 'AI wellness and decision intelligence',
  category: 'AI clarity platform',
  products_services: 'AI clarity engine for self-reflection, emotional wellbeing, and life decisions',
  products_services_list: [
    'AI clarity engine',
    'self-reflection guidance',
    'emotional wellbeing decision support',
  ],
  target_audience: 'individuals seeking personal clarity and guided self-reflection',
  geography: 'Global',
  report_settings: {
    company_facts: {
      team_size: '1-10',
      revenue_range: 'Pre-revenue',
      founded_year: '2024',
    },
  },
};

describe('competitorEngineService', () => {
  it('filters weak profile AI competitor guesses that do not match product, market, or ICP', () => {
    const filtered = filterProfileCompetitorNames(drishikProfile, [
      'Optimal Virtual Employee',
      'Wysa',
      'Headspace',
    ]);

    expect(filtered).not.toContain('Optimal Virtual Employee');
    expect(filtered).toEqual(expect.arrayContaining(['Wysa', 'Headspace']));
  });

  it('returns fit signals used by reports and profile paths from the same context', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [{ name: 'Wysa', source: 'manual' }],
      minScore: 42,
    });

    assertValidCompetitor(ranked[0] as any);
    expect(ranked[0]?.fit_signals.product_service).toBe('AI clarity engine');
    expect(ranked[0]?.fit_signals.revenue_range).toBe('Pre-revenue');
    expect(ranked[0]?.problem_overlap).toBeGreaterThan(0);
    expect(ranked[0]?.final_score).toBeGreaterThan(0);
    expect(ranked[0]?.tier).toMatch(/^Tier [123]$/);
    expect(ranked[0]?.rationale).toContain('Fit signals used');
  });

  it('computes multidimensional scores without using revenue as an elimination rule', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = rankCompetitorCandidates({
      context,
      candidates: [{
        name: 'Wysa',
        source: 'manual',
        category: 'mental wellness AI',
        description: 'AI-guided mental health and emotional wellbeing support app with chatbot-led self-care and coaching pathways.',
        targetCustomer: 'adults seeking private emotional support and structured wellbeing guidance',
        geography: 'Global',
        revenueRange: '$1B+',
        productSignals: ['AI chatbot', 'self-care', 'emotional wellbeing support'],
      }],
      minScore: 0,
    });

    expect(ranked[0]).toMatchObject({
      category: 'mental_wellness_ai',
      revenue_tier: 'enterprise',
      tier: 'Tier 1',
    });
    expect(ranked[0]?.problem_overlap).toBeGreaterThanOrEqual(0.65);
    expect(ranked[0]?.icp_overlap).toBeGreaterThanOrEqual(0.55);
    expect(ranked[0]?.final_score).toBeGreaterThan(0.5);
  });

  it('keeps irrelevant profile AI competitors below the acceptance threshold', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const score = evaluateCompetitorCandidate(
      { name: 'Optimal Virtual Employee', source: 'profile_ai' },
      context,
    );

    expect(score.problem_overlap).toBe(0);
    expect(score.icp_overlap).toBeLessThan(0.2);
    expect(score.final_score).toBeLessThan(0.42);
  });

  it('blocks inferred and fallback candidates from the final output gate', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const finalCompetitors = getFinalCompetitorsSync({
      context,
      candidates: [
        { name: 'Wysa', source: 'inferred_keyword_peer' },
        { name: 'Headspace', source: 'serp_unavailable_fallback' },
        { name: 'Wysa', source: 'manual' },
      ],
      max: 5,
    });

    expect(finalCompetitors.map((competitor) => competitor.name)).toEqual(['Wysa']);
    assertValidCompetitorList(finalCompetitors as any[]);
  });

  it('enriches raw competitor names into structured intelligence profiles before scoring', async () => {
    const enriched = await enrichCompetitorCandidates({
      candidates: [
        { name: 'Wysa' },
        { name: 'Woebot Health' },
        { name: 'Calm' },
        { name: 'Headspace' },
        { name: 'BetterHelp' },
      ],
      useNetwork: false,
      useStoredCache: false,
    });

    expect(enriched).toHaveLength(5);
    expect(enriched.every((candidate) => candidate.enrichment?.confidence_score && candidate.enrichment.confidence_score >= 0.8)).toBe(true);
    expect(enriched.map((candidate) => candidate.enrichment?.product_type)).toEqual(expect.arrayContaining(['AI chatbot', 'content-based', 'marketplace']));

    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = rankCompetitorCandidates({
      context,
      candidates: enriched.map((candidate) => ({ ...candidate, source: 'profile_ai' })),
      max: 5,
      minScore: 0,
    });

    expect(ranked[0]?.enrichment_confidence_score).toBeGreaterThanOrEqual(0.8);
    expect(ranked.some((competitor) => competitor.name === 'Wysa')).toBe(true);
    assertValidCompetitor(ranked[0] as any);
    assertSortedByScoreDesc(ranked as any[]);
  });

  it('revalidates cached competitors by re-enriching and re-scoring before reuse', async () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const finalCompetitors = await getFinalCompetitors({
      context,
      candidates: [
        {
          name: 'Wysa',
          domain: 'wysa.com',
          source: 'manual',
          category: 'virtual staffing and outsourcing',
          confidenceScore: 0.01,
          enrichment: {
            name: 'Stale cached Wysa',
            domain: 'wysa.com',
            category: 'productivity_self_improvement',
            tags: [],
            description: 'Outdated cache entry that should not be trusted.',
            icp: {
              age_group: 'business buyers',
              use_case: 'staff augmentation',
              user_intent: 'hire remote staff',
            },
            business_model: 'B2B services',
            geography: 'global',
            product_type: 'human-led',
            scale_signals: {},
            confidence_score: 0.01,
            sources: ['stale_cache'],
          },
        },
      ],
      useNetwork: false,
      useStoredCache: false,
    });

    expect(finalCompetitors).toHaveLength(1);
    expect(finalCompetitors[0]?.enrichment?.name).toBe('Wysa');
    expect(finalCompetitors[0]?.enrichment_confidence_score).toBeGreaterThanOrEqual(0.8);
    assertValidCompetitor(finalCompetitors[0] as any);
  });

  it('removes irrelevant competitors after scoring', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const finalCompetitors = getFinalCompetitorsSync({
      context,
      candidates: [{ name: 'Optimal Virtual Employee', source: 'manual' }],
    });

    expect(finalCompetitors).toHaveLength(0);
  });

  it('normalizes categories and classifies Drishiq competitors by tier', async () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = await getFinalCompetitors({
      context,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Replika', source: 'manual' },
        { name: 'Headspace', source: 'manual' },
        { name: 'Calm', source: 'manual' },
        { name: 'Optimal Virtual Employee', source: 'manual' },
      ],
      max: 5,
      useNetwork: false,
      useStoredCache: false,
    });
    const byName = new Map(ranked.map((competitor) => [competitor.name, competitor]));

    expect(byName.get('Wysa')).toMatchObject({ category: 'mental_wellness_ai', tier: 'Tier 1' });
    expect(byName.get('Replika')).toMatchObject({ category: 'ai_companion', tier: 'Tier 2' });
    expect(byName.get('Headspace')).toMatchObject({ category: 'meditation_mindfulness', tier: 'Tier 3' });
    expect(byName.get('Calm')).toMatchObject({ category: 'meditation_mindfulness', tier: 'Tier 3' });
    expect(byName.has('Optimal Virtual Employee')).toBe(false);
    expect(byName.get('Wysa')?.tags).toEqual(expect.arrayContaining(['chatbot']));
    assertValidCompetitorList(ranked as any[]);
    assertSortedByScoreDesc(ranked as any[]);
  });
});
