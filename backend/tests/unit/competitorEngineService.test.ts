import {
  evaluateCompetitorCandidate,
  extractCompetitiveContextFromProfile,
  filterProfileCompetitorNames,
  getFinalCompetitors,
  getFinalCompetitorsSync,
  rankCompetitorCandidates,
  splitRankedCompetitorsForOutput,
} from '../../services/competitorEngineService';
import { enrichCompetitorCandidates } from '../../services/competitorEnrichmentService';
import { buildCompetitorFeedbackMemory } from '../../services/competitorFeedbackService';
import type { CompanyProfile } from '../../services/companyProfileService';
import {
  assertNoMarketSubstituteCompetitors,
  assertOnlyMarketSubstituteAlternatives,
  assertSortedByTierThenScore,
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
      'Woebot Health',
      'Reflectly',
      'Headspace',
    ]);

    expect(filtered).not.toContain('Optimal Virtual Employee');
    expect(filtered).not.toContain('Headspace');
    expect(filtered).toEqual(expect.arrayContaining(['Wysa', 'Woebot Health', 'Reflectly']));
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
    expect(ranked[0]?.authority_score).toBeGreaterThan(0);
    expect(ranked[0]?.authority_signals).toMatchObject({
      funding_level: expect.any(String),
      brand_strength: expect.any(String),
    });
  });

  it('adds market authority without letting authority override relevance', () => {
    const wellnessContext = extractCompetitiveContextFromProfile(drishikProfile);
    const marketingContext = {
      marketFocus: 'AI marketing automation and growth intelligence',
      primaryService: 'AI marketing command center for campaign planning and revenue growth',
      targetCustomer: 'B2B founders, marketers, and growth teams',
      idealCustomerProfile: 'lean growth teams managing campaigns and customer acquisition',
      brandPositioning: 'AI-powered marketing operations and growth intelligence platform',
      geography: 'Global',
      teamSize: '1-10',
      foundedYear: '2025',
      revenueRange: 'Pre-revenue',
      businessModel: 'B2B SaaS',
    };

    const hubSpot = evaluateCompetitorCandidate({ name: 'HubSpot', source: 'manual' }, marketingContext);
    const wysa = evaluateCompetitorCandidate({ name: 'Wysa', source: 'manual' }, wellnessContext);
    const irrelevantEnterprise = evaluateCompetitorCandidate({ name: 'HubSpot', source: 'manual' }, wellnessContext);

    expect(hubSpot.authority_score).toBeGreaterThan(0.7);
    expect(hubSpot.authority_signals).toMatchObject({
      funding_level: 'enterprise',
      brand_strength: 'high',
    });
    expect(wysa.authority_score).toBeLessThan(hubSpot.authority_score);
    expect(wysa.final_score).toBeGreaterThanOrEqual(0.7);
    expect(irrelevantEnterprise.authority_score).toBeGreaterThan(0.7);
    expect(getFinalCompetitorsSync({
      context: wellnessContext,
      candidates: [{ name: 'HubSpot', source: 'manual' }],
    })).toHaveLength(0);

    const marketingFinal = getFinalCompetitorsSync({
      context: marketingContext,
      candidates: [
        { name: 'HubSpot', source: 'manual' },
        { name: 'Salesforce', source: 'manual' },
      ],
      max: 2,
    });
    expect(marketingFinal.map((competitor) => competitor.name)).toEqual(expect.arrayContaining(['HubSpot', 'Salesforce']));
    expect(marketingFinal.every((competitor) => competitor.positioning.threat_level === 'high')).toBe(true);

    const wysaFinal = getFinalCompetitorsSync({
      context: wellnessContext,
      candidates: [{ name: 'Wysa', source: 'manual' }],
    });
    expect(wysaFinal[0]?.positioning.threat_level).toBe('high');
    expect(wysaFinal[0]?.positioning.differentiation).toContain('AI clarity engine');
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
    assertSortedByTierThenScore(ranked as any[]);
  });

  it('deduplicates legal-name variants before final output and keeps the strongest enriched entity', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [
        { name: 'Wysa Private Limited', source: 'manual' },
        { name: 'Wysa', source: 'manual' },
        { name: 'Woebot Health Inc', source: 'manual', domain: 'woebothealth.com' },
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
      ],
      max: 6,
    });

    expect(ranked.map((competitor) => competitor.name)).toEqual(['Wysa', 'Woebot Health', 'Reflectly']);
    assertValidCompetitorList(ranked as any[]);
    assertSortedByTierThenScore(ranked as any[]);
  });

  it('enforces hard relevance, category, authority-mismatch, confidence, and max-count limits', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
        { name: 'Replika', source: 'manual' },
        { name: 'Headspace', source: 'manual' },
        { name: 'Calm', source: 'manual' },
        { name: 'BetterHelp', source: 'manual' },
        { name: 'HubSpot', source: 'manual' },
        { name: 'Optimal Virtual Employee', source: 'manual' },
      ],
      max: 10,
    });
    const names = ranked.map((competitor) => competitor.name);

    expect(ranked.length).toBeLessThanOrEqual(6);
    expect(names).toEqual(expect.arrayContaining(['Wysa', 'Woebot Health', 'Reflectly']));
    expect(names).not.toEqual(expect.arrayContaining(['Replika', 'Headspace', 'Calm', 'BetterHelp', 'HubSpot', 'Optimal Virtual Employee']));
    assertValidCompetitorList(ranked as any[]);
    assertSortedByTierThenScore(ranked as any[]);
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
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
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
    expect(byName.get('Woebot Health')).toMatchObject({ category: 'mental_wellness_ai', tier: 'Tier 1' });
    expect(byName.get('Reflectly')).toMatchObject({ category: 'journaling_self_reflection', tier: 'Tier 2' });
    expect(byName.has('Replika')).toBe(false);
    expect(byName.has('Headspace')).toBe(false);
    expect(byName.has('Calm')).toBe(false);
    expect(byName.has('Optimal Virtual Employee')).toBe(false);
    expect(byName.get('Wysa')?.tags).toEqual(expect.arrayContaining(['chatbot']));
    assertValidCompetitorList(ranked as any[]);
    assertSortedByTierThenScore(ranked as any[]);
  });

  it('adds professional and category substitutes when no named competitor reaches 90', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [
        { name: 'Wysa', source: 'profile_ai' },
        { name: 'Woebot Health', source: 'profile_ai' },
        { name: 'Reflectly', source: 'profile_ai' },
      ],
      max: 6,
      includeMarketSubstitutes: true,
    });
    const names = ranked.map((competitor) => competitor.name);

    expect(ranked.some((competitor) => competitor.relevance_score >= 90 && competitor.source !== 'market_substitute')).toBe(false);
    expect(names).toEqual(expect.arrayContaining([
      'Wysa',
      'Woebot Health',
      'Reflectly',
      'Life coaches and clarity consultants',
    ]));
    expect(ranked.find((competitor) => competitor.name === 'Life coaches and clarity consultants')).toMatchObject({
      source: 'market_substitute',
      category: 'coaching_consulting',
      tier: 'Tier 2',
    });
    const split = splitRankedCompetitorsForOutput(ranked, 3, 3);
    expect(split.competitors.map((competitor) => competitor.name)).toEqual(expect.arrayContaining([
      'Wysa',
      'Woebot Health',
      'Reflectly',
    ]));
    assertNoMarketSubstituteCompetitors(split.competitors as any[]);
    expect(split.market_alternatives).toHaveLength(3);
    assertOnlyMarketSubstituteAlternatives(split.market_alternatives as any[]);
    assertValidCompetitorList(ranked as any[]);
    assertSortedByTierThenScore(ranked as any[]);
  });

  it('suppresses competitors rejected by company feedback before final output', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const feedbackMemory = buildCompetitorFeedbackMemory([
      {
        company_id: 'drishik',
        competitor_name: 'Wysa',
        category: 'mental_wellness_ai',
        feedback_type: 'incorrect',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ], {
      companyId: 'drishik',
      categories: ['mental_wellness_ai'],
    });

    const ranked = getFinalCompetitorsSync({
      context,
      feedbackMemory,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
      ],
    });

    expect(ranked.map((competitor) => competitor.name)).not.toContain('Wysa');
    expect(ranked.map((competitor) => competitor.name)).toEqual(expect.arrayContaining(['Woebot Health', 'Reflectly']));
    assertValidCompetitorList(ranked as any[]);
  });

  it('boosts confirmed competitors without bypassing hard validation', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const base = getFinalCompetitorsSync({
      context,
      candidates: [{ name: 'Wysa', source: 'manual' }],
    })[0];
    const feedbackMemory = buildCompetitorFeedbackMemory([
      {
        company_id: 'drishik',
        competitor_name: 'Wysa',
        category: 'mental_wellness_ai',
        feedback_type: 'correct',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ], {
      companyId: 'drishik',
      categories: ['mental_wellness_ai'],
    });
    const boosted = getFinalCompetitorsSync({
      context,
      feedbackMemory,
      candidates: [{ name: 'Wysa', source: 'manual' }],
    })[0];

    assertValidCompetitor(boosted as any);
    expect(boosted?.final_score).toBeGreaterThan(base?.final_score ?? 0);
    expect(boosted?.relevance_score).toBeGreaterThan(base?.relevance_score ?? 0);
    expect(boosted?.rationale).toContain('Feedback learning');
  });

  it('revalidates missing competitor feedback through enrichment and scoring before inclusion', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const feedbackMemory = buildCompetitorFeedbackMemory([
      {
        company_id: 'drishik',
        competitor_name: 'Woebot Health',
        category: 'mental_wellness_ai',
        feedback_type: 'missing',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ], {
      companyId: 'drishik',
      categories: ['mental_wellness_ai'],
    });

    const ranked = getFinalCompetitorsSync({
      context,
      feedbackMemory,
      candidates: [{ name: 'Wysa', source: 'manual' }],
      max: 3,
    });

    expect(ranked.map((competitor) => competitor.name)).toEqual(expect.arrayContaining(['Wysa', 'Woebot Health']));
    assertValidCompetitorList(ranked as any[]);
  });

  it('applies category-level rejection memory across companies', () => {
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const feedbackMemory = buildCompetitorFeedbackMemory([
      {
        company_id: 'company-a',
        competitor_name: 'Reflectly',
        category: 'mental_wellness_ai',
        feedback_type: 'incorrect',
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        company_id: 'company-b',
        competitor_name: 'Reflectly',
        category: 'mental_wellness_ai',
        feedback_type: 'incorrect',
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        company_id: 'company-c',
        competitor_name: 'Reflectly',
        category: 'mental_wellness_ai',
        feedback_type: 'incorrect',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ], {
      companyId: 'drishik',
      categories: ['mental_wellness_ai'],
    });

    const ranked = getFinalCompetitorsSync({
      context,
      feedbackMemory,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
      ],
    });

    expect(ranked.map((competitor) => competitor.name)).not.toContain('Reflectly');
    expect(ranked.map((competitor) => competitor.name)).toEqual(expect.arrayContaining(['Wysa', 'Woebot Health']));
  });
});
