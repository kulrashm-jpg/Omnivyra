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
import { isAudienceLedArchetype } from '../../services/companyProfile/entityArchetype';
import {
  buildStructuredCompetitorDimensionBlock,
  shouldUseAudienceLedSynthesis,
} from '../../services/companyProfile/competitorSynthesis';
import {
  applyApprovedStrategicGuidance,
  applyUserGuidedCompetitorSteering,
  buildUserGuidanceContextBlock,
  normalizeUserGuidedIntelligence,
} from '../../services/companyProfile/userGuidance';
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

  it('preserves archetype-native peer metadata through final ranking', () => {
    const context = {
      marketFocus: 'publishing and media for product managers',
      primaryService: 'newsletter and publication with paid community access',
      targetCustomer: 'product managers, founders, and growth leaders',
      idealCustomerProfile: 'product operators seeking trusted editorial advice and community access',
      brandPositioning: 'media/newsletter-led product strategy authority',
      geography: 'Global',
      teamSize: null,
      foundedYear: null,
      revenueRange: null,
      businessModel: 'paid media or membership',
    };
    const finalCompetitors = getFinalCompetitorsSync({
      context,
      candidates: [{
        name: "Lenny's Newsletter",
        source: 'archetype_native_peer',
        category: 'Newsletter and publication peers',
        description: 'Product and growth newsletter/community business competing through expert editorial advice, paid subscriptions, and professional community trust.',
        targetCustomer: 'product managers, founders, and growth leaders',
        useCase: 'newsletter and publication with paid community access',
        businessModel: 'paid media or membership',
        productType: 'content-based',
        productSignals: ['newsletter', 'publication', 'readers', 'subscribers', 'editorial cadence'],
        confidenceScore: 0.74,
        rationale: 'Archetype-native peer inferred from media/newsletter identity and audience overlap.',
      }],
      max: 3,
    });

    expect(finalCompetitors.map((competitor) => competitor.name)).toContain("Lenny's Newsletter");
    const lenny = finalCompetitors.find((competitor) => competitor.name === "Lenny's Newsletter");
    expect(lenny).toMatchObject({
      source: 'archetype_native_peer',
      product_depth: expect.any(Number),
      enrichment_confidence_score: expect.any(Number),
    });
    expect(lenny?.rationale).toContain('Archetype-native peer');
    expect(lenny?.enrichment?.product_type).toBe('content-based');
    assertValidCompetitor(lenny as any);
  });

  it('rejects stale archetype-native peers inside business-first-only final ranking contexts', () => {
    const context = extractCompetitiveContextFromProfile({
      company_id: 'linear-fixture',
      name: 'Linear',
      products_services: 'issue tracking and product development workflow software',
      target_audience: 'software teams and product managers',
      brand_positioning: 'product development system for high-velocity software teams',
      sales_motion: 'software subscription',
      report_settings: {
        entity_archetype: {
          version: 2,
          primary_archetype: 'PRODUCT_COMPANY',
          secondary_archetypes: [],
          confidence: 0.82,
          evidence: [],
          commercial_mode: 'software/platform access',
          primary_value_surface: 'product capability',
          audience_relationship: 'customers/clients',
          identity_owner: 'organization-led',
        },
      },
    } as any);

    const finalCompetitors = getFinalCompetitorsSync({
      context,
      candidates: [{
        name: "Lenny's Newsletter",
        source: 'archetype_native_peer',
        category: 'Newsletter and publication peers',
        description: 'Product newsletter competing for product manager attention.',
        targetCustomer: 'product managers',
        useCase: 'newsletter advice',
        businessModel: 'paid media or membership',
        productType: 'content-based',
        productSignals: ['newsletter', 'publication'],
        confidenceScore: 0.74,
        rationale: 'Stale archetype-native peer from older audience-led refinement.',
      }],
      max: 3,
    });

    expect(finalCompetitors).toHaveLength(0);
  });

  it('preserves peer-aware positioning for publication, creator, educator, thought-leader, community, and operator fixtures', () => {
    const archetype = {
      version: 2,
      primary_archetype: 'HYBRID_ENTITY',
      secondary_archetypes: ['MEDIA_NEWSLETTER', 'CREATOR_EDUCATOR', 'THOUGHT_LEADER', 'COMMUNITY_LED'],
      confidence: 0.78,
      evidence: [],
      commercial_mode: 'hybrid monetization',
      primary_value_surface: 'publishing, education, community, and operator narrative',
      audience_relationship: 'subscribers/readers',
      identity_owner: 'person-led',
    };
    const context = extractCompetitiveContextFromProfile({
      company_id: 'audience-fixture',
      name: 'Audience fixture',
      products_services: 'newsletter, courses, community, frameworks, and public writing',
      target_audience: 'founders, product leaders, operators, and learners',
      brand_positioning: 'audience-led publication and operator education brand',
      sales_motion: 'paid media or membership',
      report_settings: { entity_archetype: archetype },
    } as any);
    const candidates = [
      ['Morning Brew', 'Newsletter and publication peers', 'publication/media peer'],
      ["Lenny's Newsletter", 'Newsletter and publication peers', 'publication/media peer'],
      ['Sahil Bloom', 'Operator creator peers', 'operator public-writing peer'],
      ['Ali Abdaal', 'Creator education peers', 'creator educator peer'],
      ['Simon Sinek', 'Thought-leader peers', 'author and worldview peer'],
      ['Reforge', 'Community and membership peers', 'education community peer'],
      ['Packy McCormick', 'Operator creator peers', 'operator-builder ecosystem peer'],
    ].map(([name, category, narrative]) => ({
      name,
      source: 'archetype_native_peer' as const,
      category,
      description: `${name} is a ${narrative} with audience trust and adjacent monetization.`,
      targetCustomer: 'founders, product leaders, operators, and learners',
      useCase: 'publishing, education, community, and operator narrative',
      businessModel: 'paid media or membership',
      productType: 'content-based' as const,
      productSignals: ['newsletter', 'community', 'creator', 'operator', 'worldview'],
      confidenceScore: 0.74,
      rationale: `Archetype-native peer inferred from ${category}.`,
      competitorIntelligence: {
        archetype_peer_category: category,
        audience_overlap: 'founders, product leaders, operators, and learners',
        narrative_overlap: narrative,
        trust_model: 'audience trust through publishing, education, and community',
        publication_identity: category.includes('Newsletter') ? category : null,
        ecosystem_role: category,
        monetization_adjacency: 'paid media or membership',
        worldview_adjacency: narrative,
        reasoning: 'Fixture-validated archetype-native relevance.',
      },
    }));

    const finalCompetitors = getFinalCompetitorsSync({ context, candidates, max: 5 });

    expect(finalCompetitors.some((competitor) => competitor.source === 'archetype_native_peer')).toBe(true);
    expect(finalCompetitors.every((competitor) => competitor.competitor_intelligence?.archetype_peer_category)).toBe(true);
    expect(finalCompetitors.some((competitor) => competitor.positioning.differentiation.includes('audience promise'))).toBe(true);
    assertValidCompetitorList(finalCompetitors as any[]);
  });

  it('keeps commercial competitors when trusted inline enrichment is available without cached enrichment', () => {
    const context = extractCompetitiveContextFromProfile({
      company_id: 'linear-inline-fixture',
      name: 'Linear',
      products_services: 'issue tracking and product development workflow software',
      target_audience: 'software teams and product managers',
      brand_positioning: 'product development system for high-velocity software teams',
      sales_motion: 'software subscription',
      report_settings: {
        entity_archetype: {
          version: 2,
          primary_archetype: 'PRODUCT_COMPANY',
          secondary_archetypes: [],
          confidence: 0.84,
          evidence: [],
          commercial_mode: 'software/platform access',
          primary_value_surface: 'product capability',
          audience_relationship: 'customers/clients',
          identity_owner: 'organization-led',
        },
      },
    } as any);

    const finalCompetitors = getFinalCompetitorsSync({
      context,
      candidates: [{
        name: 'Jira',
        source: 'website',
        category: 'Project management software',
        description: 'Issue tracking and agile planning software for engineering teams.',
        targetCustomer: 'software teams and product managers',
        useCase: 'issue tracking and agile planning',
        businessModel: 'software subscription',
        productType: 'software platform',
        productSignals: ['issue tracking', 'software platform', 'project management'],
        confidenceScore: 0.78,
        rationale: 'Fixture commercial competitor from website evidence.',
      }],
      max: 3,
    });

    expect(finalCompetitors.map((competitor) => competitor.name)).toContain('Jira');
    expect(finalCompetitors[0]?.enrichment_confidence_score).toBeGreaterThanOrEqual(0.7);
    assertValidCompetitor(finalCompetitors[0] as any);
  });

  it('activates audience-led synthesis for narrative operators reinforced by competitor intelligence', () => {
    const archetype = {
      version: 2,
      primary_archetype: 'CONSULTANT_OPERATOR',
      secondary_archetypes: ['THOUGHT_LEADER'],
      confidence: 0.51,
      evidence: [],
      commercial_mode: 'consulting or advisory and creator monetization',
      primary_value_surface: 'public-building narrative and operating system',
      audience_relationship: 'followers/audience',
      identity_owner: 'person-led',
    };
    const competitorIntelligence = [{
      name: 'Sahil Bloom',
      source: 'archetype_native_peer',
      category: 'productivity_self_improvement',
      archetype_peer_category: 'Operator creator peers',
      audience_overlap: 'founders, operators, builders, reflective entrepreneurs',
      narrative_overlap: 'public writing and personal operating systems',
      trust_model: 'person-led authority and audience trust',
      ecosystem_role: 'operator creator peers',
      monetization_adjacency: 'hybrid monetization',
      creator_operator_identity: 'operator creator',
      worldview_adjacency: 'systems thinking and public-building narrative',
      reasoning: 'Fixture-validated narrative operator peer.',
    }];

    expect(isAudienceLedArchetype(archetype as any, competitorIntelligence as any)).toBe(true);
    expect(shouldUseAudienceLedSynthesis(archetype as any, competitorIntelligence as any)).toBe(true);
    expect(buildStructuredCompetitorDimensionBlock(competitorIntelligence as any)).toContain('Narrative territories');
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

  it('adds professional and category substitutes when no named competitor reaches 85', () => {
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

  it('preserves user-pinned competitors and suppresses rejected competitors before ranking', () => {
    const profile: CompanyProfile = {
      ...drishikProfile,
      report_settings: {
        ...drishikProfile.report_settings,
        user_guidance: normalizeUserGuidedIntelligence({
          competitors: [
            { name: 'Real Strategic Peer', state: 'pinned', rationale: 'Actual strategic substitute.' },
            { name: 'Reflectly', state: 'rejected', rationale: 'Not a real peer.' },
          ],
        }),
      },
    };

    const steered = applyUserGuidedCompetitorSteering(profile, [
      { name: 'Reflectly', source: 'profile_ai' },
      { name: 'Wysa', source: 'profile_ai' },
    ]);

    expect(steered.map((candidate) => candidate.name)).toContain('Real Strategic Peer');
    expect(steered.map((candidate) => candidate.name)).toContain('Wysa');
    expect(steered.map((candidate) => candidate.name)).not.toContain('Reflectly');
    expect(steered[0]?.source).toBe('manual');
  });

  it('applies approved strategic guidance without overwriting the stored AI baseline metadata', () => {
    const profile: CompanyProfile = {
      ...drishikProfile,
      brand_positioning: 'AI-generated baseline positioning',
      report_settings: {
        ...drishikProfile.report_settings,
        user_guidance: normalizeUserGuidedIntelligence({
          messaging: {
            positioning: {
              ai_value: 'AI-generated baseline positioning',
              approved_value: 'Founder-approved clarity positioning',
              status: 'approved',
            },
          },
          guidance_notes: [{ id: 'note-1', text: 'Avoid generic wellness tone.', category: 'tone' }],
        }),
      },
    };

    const guided = applyApprovedStrategicGuidance(profile);
    expect(guided.brand_positioning).toBe('Founder-approved clarity positioning');
    expect(profile.report_settings?.user_guidance?.messaging?.positioning?.ai_value).toBe('AI-generated baseline positioning');
    expect(buildUserGuidanceContextBlock(guided)).toContain('Founder-approved clarity positioning');
    expect(buildUserGuidanceContextBlock(guided)).toContain('Avoid generic wellness tone');
  });
});
