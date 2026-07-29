/** Competitor engine — candidate discovery + enrichment — split from competitorEngineServiceEngine.ts (barrel preserved; importers unchanged). */
/** TEMP — split from competitorEngineService.ts (barrel preserved; importers unchanged). */
import type { CompanyProfile } from './companyProfile/types';
import type {
  CompetitorCategory as NormalizedCompetitorCategory,
  CompetitorCapabilityVector,
  CompetitorDimensionScores,
  CompetitorDiscoverySource,
  CompetitorIntelligenceTier,
  CompetitorScoreCard,
  DebugCompetitorScoring,
} from '../../types/competitor';
import { isAudienceLedArchetype, isArchetypeInfluential, isBusinessFirstOnlyArchetype } from './companyProfile/entityArchetype';
import { adoptCompetitorCompanyIdentity } from './companyIntelligence/adoption/consumers/competitorIntelligenceConsumer';
import { isCompanyProjectionAuthoritative } from './companyIntelligence/flags';
import { mayFabricateSparseIdentity } from './competitorIdentityHardening';
import type { EntityArchetypeIntelligence } from './companyProfile/types';
import type { ResolvedReportInput } from './reportInputResolver';
import {
  enrichCompetitorCandidateSync,
  enrichCompetitorCandidates,
} from './competitorEnrichmentService';
import type {
  CompetitorEnrichmentProfile,
  CompetitorProductType,
  CompetitorScaleSignals,
} from './competitorEnrichmentKnowledge';
import { findKnownCompetitorProfile } from './competitorEnrichmentKnowledge';
import {
  categoryAffinity,
  normalizeCompetitorCategory,
  normalizeCompetitorTags,
  type CompetitorSecondaryTag,
  type StandardCompetitorCategory,
} from './competitorTaxonomy';
import {
  applyCompetitorFeedbackBoost,
  buildFeedbackMissingCompetitorCandidates,
  getCompetitorFeedbackDecision,
  loadCompetitorFeedbackMemory,
  type CompetitorFeedbackMemory,
} from './competitorFeedbackService';

import { type CompetitorSource, type CompetitorClassification, type CompetitorTier, type CompetitorThreatLevel, type CompetitorPositioning, type CompanyCompetitiveContext, type CompetitorCandidate, type RankedCompetitor, type ScoredCompetitor, type CompetitorScoreBreakdown, TRUSTED_SOURCES, FINAL_COMPETITOR_MIN_SCORE, MARKET_SUBSTITUTE_MAX_COUNT, FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP, FINAL_COMPETITOR_MIN_ICP_OVERLAP, FINAL_COMPETITOR_MIN_FINAL_SCORE, FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE, FINAL_COMPETITOR_MIN_COUNT, FINAL_COMPETITOR_MAX_COUNT, HIGH_AUTHORITY_MISMATCH_AUTHORITY, HIGH_AUTHORITY_MISMATCH_PROBLEM, FINAL_BLOCKED_SOURCES, TIER_PRIORITY, COMPANY_SUFFIX_PATTERN, UNRELATED_COMPETITOR_TEXT_PATTERN, AI_FEATURE_TOKENS, DELIVERY_MODEL_TOKENS, cleanText, firstFromList, splitToList, normalizeCompetitorDomain, domainToName, tokenizeCompetitorText, overlapRatio, boostedOverlapRatio, roundDimension, inferSegment, classifyRevenueTier, revenueAdjustment, toPercentScore, competitorIntelligenceTier, weightedCompetitorScore, buildCompanyCapabilityVector, buildCandidateCapabilityVector, capabilityVectorOverlap, discoverySourceFromCandidate, candidateDiscoverySources, employeeScaleFitForCandidate, classifyNormalizedCompetitorCategory, MEDIA_CONTENT_BRAND_SIGNALS, classifyProductFirstCompetition, competitorReasoning, failedCompetitorDimensions, computeCompetitorAuthorityScore, candidateSignalText, inferCompetitorIntelligence, competitorIntelligenceText, includesAnyToken, contextLabel } from './competitorEngineServiceModel';


function targetLabel(context: CompanyCompetitiveContext): string {
  return cleanText(context.targetCustomer) ?? cleanText(context.idealCustomerProfile) ?? 'target users';
}

function readableLabel(value: unknown, fallback: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return fallback;
  return cleaned
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueNonEmpty(values: string[], max = 3): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(cleaned);
    if (results.length >= max) break;
  }
  return results;
}

function threatLevelForCompetitor(breakdown: CompetitorScoreBreakdown): CompetitorThreatLevel {
  const lowOverlap = breakdown.problem_overlap < 0.45 || breakdown.icp_overlap < 0.3;
  if (breakdown.tier === 'Tier 3' || lowOverlap) return 'low';
  if (breakdown.tier === 'Tier 1' && breakdown.authority_score >= 0.55 && breakdown.icp_overlap >= 0.55) return 'high';
  if ((breakdown.tier === 'Tier 1' || breakdown.tier === 'Tier 2') && breakdown.authority_score >= 0.35) return 'medium';
  return 'low';
}

export function buildCompetitorPositioning(
  candidate: CompetitorCandidate,
  breakdown: CompetitorScoreBreakdown,
  context: CompanyCompetitiveContext,
): CompetitorPositioning {
  const competitorName = readableLabel(candidate.name, 'This competitor');
  const companyFocus = readableLabel(context.primaryService ?? context.marketFocus, 'the company core offer');
  const target = readableLabel(context.targetCustomer ?? context.idealCustomerProfile, 'the target users');
  const category = readableLabel(breakdown.category, 'the category');
  const threatLevel = threatLevelForCompetitor(breakdown);
  const brandStrength = breakdown.authority_signals.brand_strength;
  const searchVisibility = breakdown.authority_signals.search_visibility ?? `${brandStrength} brand visibility`;
  const intelligence = inferCompetitorIntelligence(candidate, context);
  const intelligenceSummary = competitorIntelligenceText(intelligence);
  const audienceLedPeer = candidate.source === 'archetype_native_peer' && Boolean(intelligenceSummary);

  const strengths = uniqueNonEmpty([
    audienceLedPeer && intelligence?.publication_identity
      ? `${competitorName} competes as a ${intelligence.publication_identity}, with pressure from recurring media attention and audience trust.`
      : '',
    audienceLedPeer && intelligence?.worldview_adjacency
      ? `${competitorName} overlaps on worldview or thesis territory: ${intelligence.worldview_adjacency}.`
      : '',
    audienceLedPeer && intelligence?.ecosystem_role
      ? `${competitorName} occupies an adjacent ecosystem role: ${intelligence.ecosystem_role}.`
      : '',
    breakdown.authority_score >= 0.65
      ? `${competitorName} has stronger market authority through ${brandStrength} brand strength and ${searchVisibility}.`
      : '',
    breakdown.authority_score >= 0.45 && breakdown.authority_score < 0.65
      ? `${competitorName} has recognizable category authority with an authority score of ${breakdown.authority_score.toFixed(2)}.`
      : '',
    breakdown.product_depth >= 0.65
      ? `${competitorName} shows broader product depth across ${category} workflows.`
      : '',
    breakdown.market_overlap >= 0.65 || brandStrength === 'high'
      ? `${competitorName} has wider market reach for ${target} through ${searchVisibility}.`
      : '',
    breakdown.problem_overlap >= 0.68
      ? `${competitorName} addresses a closely overlapping problem in ${category}.`
      : '',
  ]);

  const weaknesses = uniqueNonEmpty([
    audienceLedPeer && intelligence?.monetization_adjacency
      ? `${competitorName} may monetize through ${intelligence.monetization_adjacency}, so the company can separate through a sharper offer and trust promise.`
      : '',
    breakdown.icp_overlap < 0.5
      ? `${competitorName} is less aligned to ${target} than the company's focused ICP.`
      : '',
    breakdown.problem_overlap < 0.55
      ? `${competitorName} is less focused on ${companyFocus} and solves a more adjacent problem.`
      : '',
    breakdown.product_depth < 0.45
      ? `${competitorName} has less visible product depth around ${companyFocus}.`
      : '',
    breakdown.tier === 'Tier 2'
      ? `${competitorName} is a functional alternative, not a fully direct substitute for ${companyFocus}.`
      : '',
    breakdown.tier === 'Tier 3'
      ? `${competitorName} is an indirect substitute, so its pressure is weaker outside broad ${category} demand.`
      : '',
    breakdown.tier === 'Tier 1' && breakdown.icp_overlap >= 0.5 && breakdown.problem_overlap >= 0.55
      ? `${competitorName} is broader than the company's sharper ${companyFocus} focus.`
      : '',
  ]);

  const differentiation = (() => {
    if (audienceLedPeer) {
      const peerCategory = readableLabel(intelligence?.archetype_peer_category, category);
      const trustModel = readableLabel(intelligence?.trust_model, 'audience trust');
      const overlap = readableLabel(intelligence?.narrative_overlap ?? intelligence?.audience_overlap, target);
      return `${competitorName} overlaps as a ${peerCategory} through ${trustModel} around ${overlap}, while the company can differentiate by combining ${companyFocus} with a sharper audience promise, worldview, and ecosystem role.`;
    }
    if (breakdown.tier === 'Tier 3') {
      return `${competitorName} is a broader ${category} substitute, while the company can win on ${companyFocus} for ${target} instead of general-purpose demand.`;
    }
    if (threatLevel === 'high') {
      return `${competitorName} competes directly in ${category} with stronger authority, while the company must differentiate through sharper ${companyFocus} execution for ${target}.`;
    }
    if (breakdown.tier === 'Tier 2') {
      return `${competitorName} overlaps functionally in ${category}, but the company can separate by owning ${companyFocus} for ${target}.`;
    }
    return `${competitorName} overlaps on ${category}, while the company can defend through focused ${companyFocus} positioning and clearer ICP fit.`;
  })();

  return {
    strengths_vs_company: strengths.length > 0
      ? strengths
      : [`${competitorName} has measurable competitive pressure from ${category} relevance.`],
    weaknesses_vs_company: weaknesses.length > 0
      ? weaknesses
      : [`${competitorName} has less specific ownership of ${companyFocus} than the company can claim.`],
    differentiation,
    threat_level: threatLevel,
  };
}

export function inferCompetitorArchetypeCandidates(
  context: CompanyCompetitiveContext,
  source: CompetitorSource = 'market_substitute',
): CompetitorCandidate[] {
  const market = contextLabel(context);
  const target = targetLabel(context);
  const geography = context.geography;
  const revenueRange = context.revenueRange;
  const isGuidanceOrWellness = includesAnyToken(context, [
    'clarity',
    'self-reflection',
    'reflection',
    'wellbeing',
    'wellness',
    'emotional',
    'life',
    'direction',
    'guidance',
    'decision',
    'miseries',
  ]);
  const isMarketingOrSaas = includesAnyToken(context, [
    'marketing',
    'saas',
    'software',
    'growth',
    'readiness',
    'seo',
    'campaign',
  ]);

  const base: CompetitorCandidate[] = [];

  if (isGuidanceOrWellness) {
    base.push(
      {
        name: 'AI self-reflection and clarity apps',
        category: 'AI clarity and self-reflection',
        source,
        classification: 'direct_competitor',
        description: 'Apps that help people process personal confusion, life decisions, emotional wellbeing, and self-reflection through AI-guided prompts or conversations.',
        targetCustomer: target,
        useCase: 'personal clarity, emotional support, life direction, guided self-reflection, decision support',
        geography,
        revenueRange,
        businessModel: 'B2C app subscription',
        productSignals: ['AI assistant', 'clarity engine', 'self-reflection guidance', 'personal decision support'],
        rationale: 'Inferred as a direct competitive bracket because it solves the same personal clarity and self-reflection problem for the same user intent.',
      },
      {
        name: 'Life coaches and clarity consultants',
        category: 'Human guidance and coaching',
        source,
        classification: 'direct_competitor',
        description: 'Independent consultants, coaches, mentors, and clarity advisors who help individuals resolve life direction, emotional blocks, personal decisions, and purpose questions.',
        targetCustomer: target,
        useCase: 'life clarity, personal coaching, emotional guidance, decision support, purpose discovery',
        geography,
        revenueRange,
        businessModel: 'individual consultants and advisory sessions',
        productSignals: ['guided support', 'human coaching', 'consultation', 'decision clarity'],
        rationale: 'Inferred as a direct substitute bracket because users can solve the same problem through human consultants instead of an AI product.',
      },
      {
        name: 'Mental wellness chatbots and support apps',
        category: 'Mental wellness technology',
        source,
        classification: 'seo_competitor',
        description: 'Digital wellbeing tools and AI chatbots that support emotional regulation, stress reflection, mood tracking, and guided mental wellness conversations.',
        targetCustomer: target,
        useCase: 'emotional wellbeing, reflective support, guided conversation, stress and mood support',
        geography,
        revenueRange,
        businessModel: 'B2C wellness app subscription',
        productSignals: ['AI chatbot', 'wellness app', 'guided conversation', 'mood support'],
        rationale: 'Inferred as an adjacent competitive bracket because it overlaps on emotional support and guided reflection, even when the positioning is wellness rather than clarity.',
      },
      {
        name: 'Therapists, counsellors, and emotional wellbeing platforms',
        category: 'Professional emotional support',
        source,
        classification: 'authority_leader',
        description: 'Professional counselling marketplaces, therapists, and emotional wellbeing providers that people turn to when they need deeper emotional guidance or support.',
        targetCustomer: target,
        useCase: 'emotional support, counselling, personal issues, wellbeing guidance',
        geography,
        revenueRange,
        businessModel: 'professional services and marketplace sessions',
        productSignals: ['counselling', 'therapy', 'wellbeing support', 'guided emotional support'],
        rationale: 'Inferred as an indirect substitute bracket because it can capture the same user need at a higher-support depth.',
      },
      {
        name: 'Spiritual guidance, astrology, and life-direction advisors',
        category: 'Alternative life guidance',
        source,
        classification: 'authority_leader',
        description: 'Astrology, spiritual guidance, tarot, manifestation, and life-direction advisors that users consult for clarity, reassurance, and personal decision-making.',
        targetCustomer: target,
        useCase: 'life direction, reassurance, clarity, personal decisions, meaning-making',
        geography,
        revenueRange,
        businessModel: 'individual consultants, creator-led communities, and advisory sessions',
        productSignals: ['life guidance', 'personal clarity', 'advisor', 'consultation'],
        rationale: 'Inferred as an indirect substitute bracket because users seeking clarity may choose alternative advisors even if the product category differs.',
      },
    );
  }

  if (!isGuidanceOrWellness && (isMarketingOrSaas || base.length === 0)) {
    const product = cleanText(context.primaryService) ?? market;
    base.push(
      {
        name: `${product} software platforms`,
        category: market,
        source,
        classification: 'direct_competitor',
        description: `Software products and platforms that provide ${product} for ${target}.`,
        targetCustomer: target,
        useCase: `${product}, workflow automation, analytics, execution support`,
        geography,
        revenueRange,
        businessModel: context.businessModel ?? 'software subscription',
        productSignals: [product, 'software platform', 'automation', 'analytics'],
        rationale: 'Inferred as a direct software bracket from product, ICP, and market context.',
      },
      {
        name: `${market} specialist consultants`,
        category: 'Consulting and specialist services',
        source,
        classification: 'direct_competitor',
        description: `Consultants, agencies, and specialists that help ${target} solve ${market} problems through advisory or execution services.`,
        targetCustomer: target,
        useCase: `${market}, advisory, consulting, implementation support`,
        geography,
        revenueRange,
        businessModel: 'consulting and managed services',
        productSignals: ['consulting', 'advisory', 'implementation', market],
        rationale: 'Inferred as a service substitute bracket because customers can buy consulting instead of software.',
      },
      {
        name: `${market} education and creator-led communities`,
        category: 'Education and community substitutes',
        source,
        classification: 'authority_leader',
        description: `Courses, creator communities, newsletters, and expert-led programs that help ${target} learn and solve ${market} problems independently.`,
        targetCustomer: target,
        useCase: `${market}, learning, templates, community advice, self-serve execution`,
        geography,
        revenueRange,
        businessModel: 'education, community, and creator-led subscription',
        productSignals: ['education', 'templates', 'community', market],
        rationale: 'Inferred as an indirect substitute bracket because users can self-educate instead of purchasing a product or consultant.',
      },
    );
  }

  const seen = new Set<string>();
  return base.filter((candidate) => {
    const key = candidate.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((candidate) => withArchetypeEnrichment(candidate));
}

function inferArchetypeProductType(candidate: CompetitorCandidate): CompetitorProductType {
  const text = candidateSignalText(candidate, null).toLowerCase();
  if (/\b(chatbot|chat bot|assistant|ai companion|wellness app)\b/.test(text)) return 'AI chatbot';
  if (/\b(consultant|consulting|coach|coaching|advisor|therapist|counsellor|counselor|mentor|professional services)\b/.test(text)) return 'human-led';
  if (/\b(course|education|community|newsletter|creator|content|journal|journaling)\b/.test(text)) return 'content-based';
  if (/\b(marketplace|platforms?|directory|network)\b/.test(text)) return 'marketplace';
  if (/\b(software|saas|app|apps|tool|tools|platform)\b/.test(text)) return 'software platform';
  return 'unknown';
}

export function withArchetypeEnrichment(candidate: CompetitorCandidate): CompetitorCandidate {
  const productType = candidate.productType ?? inferArchetypeProductType(candidate);
  const category = normalizeCompetitorCategory(candidate.category, candidateSignalText(candidate, null));
  const description = cleanText(candidate.description);
  const businessModel = cleanText(candidate.businessModel);
  const productSignals = [
    productType,
    category,
    ...(candidate.productSignals ?? []),
    candidate.useCase,
  ].filter((item): item is string => Boolean(cleanText(item)));
  const enrichment: CompetitorEnrichmentProfile = {
    name: candidate.name,
    domain: candidate.domain ?? null,
    category,
    tags: normalizeCompetitorTags({
      rawTags: candidate.tags ?? undefined,
      productType,
      businessModel,
      description,
      category,
    }),
    description,
    icp: {
      age_group: cleanText(candidate.targetCustomer),
      use_case: cleanText(candidate.useCase),
      user_intent: cleanText(candidate.rationale) ?? cleanText(candidate.useCase),
    },
    business_model: businessModel,
    geography: cleanText(candidate.geography),
    product_type: productType,
    scale_signals: candidate.scaleSignals ?? {
      notes: 'category-level substitute derived from company market, problem, and ICP context',
    },
    confidence_score: Number(candidate.confidenceScore ?? 0) >= FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE
      ? Number(candidate.confidenceScore)
      : 0.72,
    sources: [
      candidate.source === 'market_substitute'
        ? 'market_substitute_archetype'
        : 'trusted_inline_candidate',
    ],
  };

  return {
    ...candidate,
    category,
    tags: candidate.tags ?? enrichment.tags,
    productType,
    productSignals,
    confidenceScore: enrichment.confidence_score,
    enrichment,
  };
}

export function contextTokens(context: CompanyCompetitiveContext): {
  all: string[];
  market: string[];
  product: string[];
  target: string[];
  geography: string[];
  intent: string[];
  segment: string[];
} {
  const market = tokenizeCompetitorText([context.marketFocus, context.businessModel].filter(Boolean).join(' '));
  const product = tokenizeCompetitorText(context.primaryService);
  const target = tokenizeCompetitorText([context.targetCustomer, context.idealCustomerProfile].filter(Boolean).join(' '));
  const geography = tokenizeCompetitorText(context.geography);
  const intent = tokenizeCompetitorText([context.brandPositioning, context.primaryService, context.targetCustomer].filter(Boolean).join(' '));
  const segment = tokenizeCompetitorText(inferSegment([context.targetCustomer, context.businessModel, context.marketFocus].filter(Boolean).join(' ')));
  return {
    all: Array.from(new Set([...market, ...product, ...target, ...geography, ...intent, ...segment])),
    market,
    product,
    target,
    geography,
    intent,
    segment,
  };
}

export function extractCompetitiveContextFromProfile(profile: CompanyProfile | null | undefined): CompanyCompetitiveContext {
  // U3·Consumer-8 (FINAL): competitor search obtains the OWNER company's projection-owned identity
  // (category / business_model / operating_model / domain_role) through the canonical seam before shaping
  // discovery. Flag OFF (default) ⇒ same profile, byte-identical. Competitor evidence (named_competitors /
  // competitor_details) and all other fields are preserved — identity flows in, competitor results never
  // flow back into identity.
  profile = adoptCompetitorCompanyIdentity(profile, (profile as { company_id?: string } | null | undefined)?.company_id ?? '', new Date().toISOString());
  const companyFacts = profile?.report_settings?.company_facts ?? null;
  const marketPulse = profile?.report_settings?.market_pulse ?? null;
  const entityArchetype = profile?.report_settings?.entity_archetype ?? null;
  const audienceLed = isAudienceLedArchetype(entityArchetype);
  const archetypeInfluential = isArchetypeInfluential(entityArchetype);
  const archetypeValueSurface = archetypeInfluential ? cleanText(entityArchetype?.primary_value_surface) : null;
  const archetypeAudience = archetypeInfluential ? cleanText(entityArchetype?.audience_relationship) : null;
  const archetypeCommercialMode = archetypeInfluential ? cleanText(entityArchetype?.commercial_mode) : null;
  const archetypePositioning = archetypeInfluential
    ? [
        entityArchetype?.primary_archetype,
        archetypeValueSurface,
        archetypeAudience,
      ].filter(Boolean).join('; ')
    : null;
  const campaignPurpose = profile?.campaign_purpose_intent ?? null;
  const classification = profile?.business_classification ?? null;
  const classificationDomains = Array.isArray(classification?.level_3)
    ? classification.level_3.map((item) => cleanText(item)).filter((item): item is string => Boolean(item))
    : [];
  const solutionDomains = Array.isArray(marketPulse?.solution_domains)
    ? marketPulse.solution_domains.map((item) => cleanText(item)).filter((item): item is string => Boolean(item))
    : [];
  const solutionDomain = solutionDomains[0] ?? null;
  const providerType = cleanText(marketPulse?.provider_type);
  const domainRole = cleanText(marketPulse?.domain_role);
  const operatingModel = cleanText(marketPulse?.operating_model);
  const domainSignals = [
    domainRole,
    providerType,
    ...solutionDomains,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
  const businessModel = [
    cleanText(classification?.level_1),
    cleanText(classification?.level_2),
    cleanText(marketPulse?.business_model),
    operatingModel,
    providerType,
    domainRole,
  ]
    .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)
    .join('; ') || null;
  const primaryOffering =
    firstFromList(profile?.products_services_list) ??
    firstFromList(marketPulse?.core_offerings ?? null) ??
    cleanText(profile?.products_services) ??
    (audienceLed ? archetypeValueSurface : null) ??
    null;
  const primaryService = [
    primaryOffering,
    ...domainSignals,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)
    .join('; ') || null;
  const brandPositioning = [
    cleanText(profile?.brand_positioning),
    cleanText(profile?.unique_value),
    cleanText(campaignPurpose?.brand_positioning_angle),
    archetypePositioning,
    ...solutionDomains,
    domainRole,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)
    .join('; ') || null;
  const idealCustomerProfile = [
    cleanText(profile?.ideal_customer_profile),
    audienceLed ? archetypeAudience : null,
    ...solutionDomains,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index)
    .join('; ') || null;

  return {
    marketFocus:
      cleanText(profile?.campaign_focus) ??
      cleanText(profile?.category) ??
      firstFromList(profile?.category_list) ??
      (audienceLed ? archetypeValueSurface : null) ??
      classificationDomains[0] ??
      cleanText(profile?.industry) ??
      firstFromList(profile?.industry_list) ??
      solutionDomain ??
      domainRole ??
      null,
    primaryService,
    targetCustomer:
      cleanText(profile?.target_customer_segment) ??
      cleanText(profile?.target_audience) ??
      firstFromList(profile?.target_audience_list) ??
      (audienceLed ? archetypeAudience : null) ??
      null,
    idealCustomerProfile,
    brandPositioning,
    geography:
      cleanText(profile?.geography) ??
      firstFromList(profile?.geography_list) ??
      firstFromList(marketPulse?.primary_operating_markets ?? null) ??
      null,
    teamSize: cleanText(companyFacts?.team_size),
    foundedYear: cleanText(companyFacts?.founded_year),
    revenueRange: cleanText(companyFacts?.revenue_range),
    businessModel:
      businessModel ??
      (audienceLed ? archetypeCommercialMode : null) ??
      cleanText(profile?.sales_motion) ??
      cleanText(profile?.pricing_model) ??
      null,
    entityArchetype,
  };
}

export function extractCompetitiveContextFromResolvedInput(
  resolvedInput?: ResolvedReportInput | null,
): CompanyCompetitiveContext {
  const profileContext = extractCompetitiveContextFromProfile(resolvedInput?.profile);
  const context = resolvedInput?.resolved.companyContext;
  const primaryService =
    context?.productServices?.[0] ??
    profileContext.primaryService ??
    null;

  const extractedContext = {
    marketFocus:
      cleanText(context?.marketFocus) ??
      cleanText(resolvedInput?.resolved.businessType) ??
      profileContext.marketFocus,
    primaryService,
    targetCustomer:
      cleanText(context?.targetCustomer) ??
      profileContext.targetCustomer,
    idealCustomerProfile:
      cleanText(context?.idealCustomerProfile) ??
      profileContext.idealCustomerProfile,
    brandPositioning:
      cleanText(context?.brandPositioning) ??
      profileContext.brandPositioning,
    geography:
      cleanText(resolvedInput?.resolved.geography) ??
      profileContext.geography,
    teamSize:
      cleanText(context?.teamSize) ??
      profileContext.teamSize,
    foundedYear:
      cleanText(context?.foundedYear) ??
      profileContext.foundedYear,
    revenueRange:
      cleanText(context?.revenueRange) ??
      profileContext.revenueRange,
    businessModel: profileContext.businessModel,
  };

  const hasSpecificContext = [
    extractedContext.marketFocus,
    extractedContext.primaryService,
    extractedContext.targetCustomer,
    extractedContext.idealCustomerProfile,
    extractedContext.brandPositioning,
    extractedContext.businessModel,
  ].some((value) => Boolean(cleanText(value)));
  const sparseGenericContext =
    !cleanText(extractedContext.primaryService) &&
    !cleanText(extractedContext.targetCustomer) &&
    !cleanText(extractedContext.idealCustomerProfile) &&
    !cleanText(extractedContext.brandPositioning) &&
    /\b(b2b services|business services|services|business|company)\b/i.test(extractedContext.marketFocus ?? '');

  if (hasSpecificContext && !sparseGenericContext) return extractedContext;

  // U4 Hardening: Competitor Intelligence must not FABRICATE the owner's identity from a hardcoded template.
  // When the canonical projection is authoritative, abstain and rely on canonical identity (supplied
  // upstream via resolveCompanyProjection); flag OFF (default) preserves the legacy sparse-context fallback.
  if (!mayFabricateSparseIdentity(isCompanyProjectionAuthoritative())) return extractedContext;

  return {
    ...extractedContext,
    marketFocus: 'business software and marketing automation',
    primaryService: 'marketing automation software',
    targetCustomer: 'business growth teams and marketers',
    idealCustomerProfile: 'B2B teams evaluating growth, CRM, and campaign software',
    brandPositioning: 'software platform for growth and customer acquisition',
    businessModel: 'B2B SaaS',
  };
}

export function buildCompetitorFitSignals(
  context: CompanyCompetitiveContext,
  geography: string | null = context.geography,
  productService: string | null = context.primaryService,
): RankedCompetitor['fit_signals'] {
  return {
    market_focus: context.marketFocus,
    product_service: productService ?? context.primaryService,
    geography,
    team_size: context.teamSize,
    founded_year: context.foundedYear,
    revenue_range: context.revenueRange,
    target_customer: context.targetCustomer,
    business_model: context.businessModel,
  };
}

