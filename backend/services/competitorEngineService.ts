import type { CompanyProfile } from './companyProfile/types';
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
import {
  categoryAffinity,
  normalizeCompetitorCategory,
  normalizeCompetitorTags,
  type CompetitorSecondaryTag,
  type StandardCompetitorCategory,
} from './competitorTaxonomy';

export type CompetitorSource =
  | 'user'
  | 'manual'
  | 'website'
  | 'social'
  | 'decision_evidence'
  | 'serp_live'
  | 'known_category_dataset'
  | 'profile_ai'
  | 'inferred_keyword_peer'
  | 'serp_unavailable_fallback';

export type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
export type CompetitorRevenueTier = 'startup' | 'growth' | 'scale' | 'enterprise';
export type CompetitorTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export type CompanyCompetitiveContext = {
  marketFocus: string | null;
  primaryService: string | null;
  targetCustomer: string | null;
  idealCustomerProfile: string | null;
  brandPositioning: string | null;
  geography: string | null;
  teamSize: string | null;
  foundedYear: string | null;
  revenueRange: string | null;
  businessModel: string | null;
};

export type CompetitorCandidate = {
  name: string;
  domain?: string | null;
  source: CompetitorSource;
  classification?: CompetitorClassification | null;
  rationale?: string | null;
  category?: string | null;
  tags?: CompetitorSecondaryTag[] | null;
  description?: string | null;
  targetCustomer?: string | null;
  useCase?: string | null;
  geography?: string | null;
  businessModel?: string | null;
  revenueRange?: string | null;
  productSignals?: string[] | null;
  productType?: CompetitorProductType | null;
  scaleSignals?: CompetitorScaleSignals | null;
  confidenceScore?: number | null;
  enrichment?: CompetitorEnrichmentProfile | null;
};

export type RankedCompetitor = {
  name: string;
  domain: string | null;
  category: string;
  tags: CompetitorSecondaryTag[];
  source: CompetitorSource;
  classification: CompetitorClassification;
  relevance_score: number;
  problem_overlap: number;
  icp_overlap: number;
  market_overlap: number;
  revenue_tier: CompetitorRevenueTier;
  product_depth: number;
  final_score: number;
  tier: CompetitorTier;
  enrichment: CompetitorEnrichmentProfile | null;
  enrichment_confidence_score: number;
  rationale: string;
  fit_signals: {
    market_focus?: string | null;
    product_service?: string | null;
    geography?: string | null;
    team_size?: string | null;
    founded_year?: string | null;
    revenue_range?: string | null;
    target_customer?: string | null;
    business_model?: string | null;
  };
};

type ScoredCompetitor = Omit<RankedCompetitor, 'classification'> & {
  classification: CompetitorClassification | null;
};

export type CompetitorScoreBreakdown = Pick<
  RankedCompetitor,
  | 'category'
  | 'tags'
  | 'relevance_score'
  | 'problem_overlap'
  | 'icp_overlap'
  | 'market_overlap'
  | 'revenue_tier'
  | 'product_depth'
  | 'final_score'
  | 'tier'
>;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'your', 'you', 'our', 'are',
  'was', 'have', 'has', 'will', 'can', 'how', 'why', 'what', 'when', 'where', 'who', 'not',
  'all', 'any', 'about', 'service', 'services', 'company', 'business', 'solutions', 'solution',
  'home', 'page', 'contact', 'blog', 'pricing', 'learn', 'more', 'demo', 'free',
  'best', 'employee', 'employees', 'virtual', 'optimal',
]);

const TRUSTED_SOURCES = new Set<CompetitorSource>([
  'user',
  'manual',
  'website',
  'social',
  'decision_evidence',
  'serp_live',
  'known_category_dataset',
]);

const SOURCE_BASE_SCORE: Record<CompetitorSource, number> = {
  user: 70,
  manual: 70,
  website: 64,
  social: 58,
  decision_evidence: 62,
  serp_live: 58,
  known_category_dataset: 58,
  profile_ai: 14,
  inferred_keyword_peer: 28,
  serp_unavailable_fallback: 22,
};

export const FINAL_COMPETITOR_MIN_SCORE = 42;

const FINAL_BLOCKED_SOURCES = new Set<CompetitorSource>([
  'decision_evidence',
  'inferred_keyword_peer',
  'serp_unavailable_fallback',
]);

const REVENUE_TIER_RANK: Record<CompetitorRevenueTier, number> = {
  startup: 0,
  growth: 1,
  scale: 2,
  enterprise: 3,
};

const AI_FEATURE_TOKENS = new Set([
  'ai',
  'ml',
  'llm',
  'agent',
  'agents',
  'assistant',
  'automation',
  'personalization',
  'recommendation',
  'analytics',
  'intelligence',
  'predictive',
  'workflow',
  'chatbot',
  'platform',
  'api',
  'integrations',
]);

const DELIVERY_MODEL_TOKENS = new Set([
  'app',
  'saas',
  'software',
  'platform',
  'marketplace',
  'service',
  'services',
  'agency',
  'consulting',
  'assistant',
  'engine',
]);

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstFromList(value?: string[] | null): string | null {
  if (!Array.isArray(value)) return null;
  return cleanText(value.find((item) => cleanText(item)) ?? null);
}

function splitToList(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeCompetitorDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const input = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    return hostname.includes('.') ? hostname : null;
  } catch {
    return null;
  }
}

function domainToName(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const root = domain.split('.')[0] ?? '';
  return root
    .split(/[-_]+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim() || null;
}

export function tokenizeCompetitorText(value: string | null | undefined): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => (token.length >= 3 || token === 'ai' || token === 'ml') && !STOPWORDS.has(token));
}

function tokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens));
}

function overlapRatio(candidateTokens: string[], contextTokensValue: string[]): number {
  const contextUnique = uniqueTokens(contextTokensValue);
  if (candidateTokens.length === 0 || contextUnique.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  const matches = contextUnique.filter((token) => candidateSet.has(token)).length;
  return Math.max(0, Math.min(1, matches / contextUnique.length));
}

function boostedOverlapRatio(candidateTokens: string[], contextTokensValue: string[], boost: number): number {
  const ratio = overlapRatio(candidateTokens, contextTokensValue);
  return Math.max(ratio, ratio > 0 ? boost : 0);
}

function roundDimension(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function inferSegment(value: string | null | undefined): 'b2b' | 'b2c' | 'niche' | null {
  const normalized = String(value ?? '').toLowerCase();
  if (!normalized) return null;
  if (/\b(b2b|enterprise|smb|teams|companies|businesses|brands|agencies|founders|sales|marketing)\b/.test(normalized)) {
    return 'b2b';
  }
  if (/\b(b2c|consumer|individuals|people|users|students|parents|creators|personal|wellness|self)\b/.test(normalized)) {
    return 'b2c';
  }
  if (/\b(niche|vertical|specialized|specific|community)\b/.test(normalized)) {
    return 'niche';
  }
  return null;
}

export function classifyRevenueTier(value: string | null | undefined): CompetitorRevenueTier {
  const normalized = String(value ?? '').toLowerCase().replace(/[$,]/g, '');
  if (/\b(1b|1\s*billion|billion|bn|enterprise)\b/.test(normalized)) return 'enterprise';
  if (/\b(100m|100\s*million|500m|scale)\b/.test(normalized) || /100\s*-\s*1000m/.test(normalized)) return 'scale';
  if (/\b(10m|10\s*million|50m|growth)\b/.test(normalized) || /10\s*-\s*100m/.test(normalized)) return 'growth';
  return 'startup';
}

function revenueAdjustment(companyTier: CompetitorRevenueTier, competitorTier: CompetitorRevenueTier): number {
  const distance = Math.abs(REVENUE_TIER_RANK[companyTier] - REVENUE_TIER_RANK[competitorTier]);
  if (distance === 0) return 1;
  if (distance === 1) return 0.85;
  if (distance === 2) return 0.7;
  return 0.6;
}

function candidateSignalText(candidate: CompetitorCandidate, domain: string | null): string {
  return [
    candidate.name,
    domainToName(domain),
    domain,
    candidate.category,
    candidate.description,
    candidate.targetCustomer,
    candidate.useCase,
    candidate.geography,
    candidate.businessModel,
    candidate.revenueRange,
    candidate.rationale,
    candidate.productType,
    candidate.enrichment?.product_type,
    candidate.enrichment?.category,
    candidate.enrichment?.description,
    candidate.enrichment?.business_model,
    candidate.enrichment?.geography,
    candidate.enrichment?.icp.age_group,
    candidate.enrichment?.icp.use_case,
    candidate.enrichment?.icp.user_intent,
    ...(candidate.productSignals ?? []),
  ].filter(Boolean).join(' ');
}

function includesAnyToken(context: CompanyCompetitiveContext, tokens: string[]): boolean {
  const haystack = [
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' ').toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function contextLabel(context: CompanyCompetitiveContext): string {
  return cleanText(context.marketFocus) ?? cleanText(context.primaryService) ?? 'Market peer';
}

function targetLabel(context: CompanyCompetitiveContext): string {
  return cleanText(context.targetCustomer) ?? cleanText(context.idealCustomerProfile) ?? 'target users';
}

export function inferCompetitorArchetypeCandidates(
  context: CompanyCompetitiveContext,
  source: CompetitorSource = 'inferred_keyword_peer',
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

  if (isMarketingOrSaas || base.length === 0) {
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
  });
}

function contextTokens(context: CompanyCompetitiveContext): {
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
  const companyFacts = profile?.report_settings?.company_facts ?? null;
  const marketPulse = profile?.report_settings?.market_pulse ?? null;
  const campaignPurpose = profile?.campaign_purpose_intent ?? null;
  const primaryService =
    firstFromList(profile?.products_services_list) ??
    firstFromList(marketPulse?.core_offerings ?? null) ??
    cleanText(profile?.products_services) ??
    null;

  return {
    marketFocus:
      cleanText(profile?.campaign_focus) ??
      cleanText(profile?.category) ??
      firstFromList(profile?.category_list) ??
      cleanText(profile?.industry) ??
      firstFromList(profile?.industry_list) ??
      null,
    primaryService,
    targetCustomer:
      cleanText(profile?.target_customer_segment) ??
      cleanText(profile?.target_audience) ??
      firstFromList(profile?.target_audience_list) ??
      null,
    idealCustomerProfile: cleanText(profile?.ideal_customer_profile),
    brandPositioning:
      cleanText(profile?.brand_positioning) ??
      cleanText(profile?.unique_value) ??
      cleanText(campaignPurpose?.brand_positioning_angle) ??
      null,
    geography:
      cleanText(profile?.geography) ??
      firstFromList(profile?.geography_list) ??
      firstFromList(marketPulse?.primary_operating_markets ?? null) ??
      null,
    teamSize: cleanText(companyFacts?.team_size),
    foundedYear: cleanText(companyFacts?.founded_year),
    revenueRange: cleanText(companyFacts?.revenue_range),
    businessModel:
      cleanText(marketPulse?.business_model) ??
      cleanText(profile?.sales_motion) ??
      cleanText(profile?.pricing_model) ??
      null,
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

  return {
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

export function buildCompetitorFitRationale(
  context: CompanyCompetitiveContext,
  geography: string | null,
  fallback: string,
): string {
  const parts: string[] = [];
  if (context.marketFocus) parts.push(`market focus: ${context.marketFocus}`);
  if (context.primaryService) parts.push(`product/service: ${context.primaryService}`);
  if (context.targetCustomer) parts.push(`buyer fit: ${context.targetCustomer}`);
  if (geography ?? context.geography) parts.push(`region: ${geography ?? context.geography}`);
  if (context.teamSize) parts.push(`team size: ${context.teamSize}`);
  if (context.revenueRange) parts.push(`revenue: ${context.revenueRange}`);
  return parts.length > 0 ? `${fallback} Fit signals used: ${parts.slice(0, 5).join('; ')}.` : fallback;
}

function buildScoringRationale(
  base: string,
  breakdown: CompetitorScoreBreakdown,
): string {
  return [
    base,
    `Competitive scoring: category ${breakdown.category}, tags ${breakdown.tags.join(', ') || 'none'}, problem overlap ${breakdown.problem_overlap.toFixed(2)}, ICP overlap ${breakdown.icp_overlap.toFixed(2)}, market overlap ${breakdown.market_overlap.toFixed(2)}, product depth ${breakdown.product_depth.toFixed(2)}, revenue tier ${breakdown.revenue_tier}; final score ${breakdown.final_score.toFixed(2)} (${breakdown.tier}).`,
  ].join(' ');
}

function classifyCompetitiveTier(params: {
  problemOverlap: number;
  icpOverlap: number;
  affinity: 'same' | 'functional' | 'substitute';
}): CompetitorTier {
  if (params.affinity === 'same' && params.problemOverlap >= 0.6 && params.icpOverlap >= 0.5) return 'Tier 1';
  if (params.problemOverlap >= 0.45 && params.affinity !== 'substitute') return 'Tier 2';
  if (params.problemOverlap >= 0.55) return 'Tier 2';
  return 'Tier 3';
}

function classificationFromTier(tier: CompetitorTier): CompetitorClassification {
  if (tier === 'Tier 1') return 'direct_competitor';
  if (tier === 'Tier 2') return 'seo_competitor';
  return 'authority_leader';
}

function sourceEvidenceBoost(source: CompetitorSource): number {
  if (source === 'manual' || source === 'user') return 0.55;
  if (source === 'decision_evidence' || source === 'website' || source === 'social') return 0.45;
  if (source === 'serp_live' || source === 'known_category_dataset') return 0.35;
  if (source === 'inferred_keyword_peer') return 0.3;
  return 0;
}

export function evaluateCompetitorCandidate(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): CompetitorScoreBreakdown {
  const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
  const companyCategory = normalizeCompetitorCategory(context.marketFocus, [
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' '));
  const competitorCategory = normalizeCompetitorCategory(enrichedCandidate.category, candidateSignalText(enrichedCandidate, null));
  const affinity = categoryAffinity(companyCategory, competitorCategory);
  const domain = normalizeCompetitorDomain(enrichedCandidate.domain ?? enrichedCandidate.name);
  const candidateTokens = tokenizeCompetitorText(candidateSignalText(enrichedCandidate, domain));
  const tokens = contextTokens(context);
  const evidenceBoost = sourceEvidenceBoost(enrichedCandidate.source);
  const companyRevenueTier = classifyRevenueTier(context.revenueRange);
  const competitorRevenueTier = classifyRevenueTier(enrichedCandidate.revenueRange ?? context.revenueRange);

  const productOverlap = boostedOverlapRatio(candidateTokens, tokens.product, evidenceBoost);
  const marketFocusOverlap = boostedOverlapRatio(candidateTokens, tokens.market, Math.max(0.25, evidenceBoost - 0.1));
  const targetOverlap = boostedOverlapRatio(candidateTokens, tokens.target, Math.max(0.2, evidenceBoost - 0.15));
  const intentOverlap = overlapRatio(candidateTokens, tokens.intent);
  const geographyOverlap = tokens.geography.length > 0
    ? boostedOverlapRatio(candidateTokens, tokens.geography, enrichedCandidate.geography ? 0.55 : 0)
    : 0.45;
  const companySegment = inferSegment([context.targetCustomer, context.businessModel, context.marketFocus].filter(Boolean).join(' '));
  const competitorSegment = inferSegment([
    enrichedCandidate.targetCustomer,
    enrichedCandidate.businessModel,
    enrichedCandidate.description,
    enrichedCandidate.category,
    enrichedCandidate.name,
  ].filter(Boolean).join(' '));
  const segmentOverlap = companySegment && competitorSegment ? (companySegment === competitorSegment ? 1 : 0.25) : 0.45;
  const aiDepth = candidateTokens.filter((token) => AI_FEATURE_TOKENS.has(token)).length;
  const deliveryDepth = candidateTokens.filter((token) => DELIVERY_MODEL_TOKENS.has(token)).length;
  const featureDepth = Math.min(1, ((aiDepth * 0.18) + (deliveryDepth * 0.12) + (enrichedCandidate.productSignals?.length ?? 0) * 0.08) + evidenceBoost * 0.4);

  let problemOverlap = roundDimension(
    (Math.max(productOverlap, marketFocusOverlap) * 0.75) +
    (Math.min(productOverlap, marketFocusOverlap) * 0.25),
  );
  let icpOverlap = roundDimension((targetOverlap * 0.7) + (intentOverlap * 0.3));
  if (affinity === 'same') {
    problemOverlap = roundDimension(Math.max(problemOverlap, 0.68));
    icpOverlap = roundDimension(Math.max(icpOverlap, 0.58));
  } else if (affinity === 'functional') {
    problemOverlap = roundDimension(Math.max(problemOverlap, 0.58));
    icpOverlap = roundDimension(Math.max(icpOverlap, 0.35));
  }
  const marketOverlap = roundDimension((geographyOverlap * 0.55) + (segmentOverlap * 0.45));
  const productDepth = roundDimension(featureDepth);
  const revenue = revenueAdjustment(companyRevenueTier, competitorRevenueTier);
  const finalScore = roundDimension(
    (0.35 * problemOverlap) +
    (0.25 * icpOverlap) +
    (0.15 * marketOverlap) +
    (0.15 * productDepth) +
    (0.10 * revenue),
  );

  const tags = enrichedCandidate.tags ?? normalizeCompetitorTags({
    productType: enrichedCandidate.productType,
    businessModel: enrichedCandidate.businessModel,
    description: enrichedCandidate.description,
    category: competitorCategory,
  });

  return {
    category: competitorCategory,
    tags,
    relevance_score: Math.round(finalScore * 100),
    problem_overlap: problemOverlap,
    icp_overlap: icpOverlap,
    market_overlap: marketOverlap,
    revenue_tier: competitorRevenueTier,
    product_depth: productDepth,
    final_score: finalScore,
    tier: classifyCompetitiveTier({ problemOverlap, icpOverlap, affinity }),
  };
}

export function scoreCompetitorCandidate(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): number {
  const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
  const legacySourceFloor = SOURCE_BASE_SCORE[enrichedCandidate.source] ?? 10;
  const score = evaluateCompetitorCandidate(enrichedCandidate, context).relevance_score;
  if (TRUSTED_SOURCES.has(enrichedCandidate.source)) return Math.max(score, Math.min(70, legacySourceFloor));
  return score;
}

function classifyByIndex(index: number): CompetitorClassification {
  if (index === 0) return 'direct_competitor';
  if (index === 1) return 'seo_competitor';
  return 'authority_leader';
}

export function rankCompetitorCandidates(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  allowTrustedBelowThreshold?: boolean;
}): RankedCompetitor[] {
  const max = params.max ?? 5;
  const minScore = params.minScore ?? 42;
  const allowTrustedBelowThreshold = params.allowTrustedBelowThreshold ?? true;
  const seen = new Set<string>();

  return params.candidates
    .map((candidate) => {
      const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
      const domain = normalizeCompetitorDomain(enrichedCandidate.domain ?? enrichedCandidate.name);
      const name = cleanText(enrichedCandidate.name) ?? domainToName(domain);
      if (!name) return null;
      const breakdown = evaluateCompetitorCandidate(enrichedCandidate, params.context);
      const score = scoreCompetitorCandidate(enrichedCandidate, params.context);
      const trusted = TRUSTED_SOURCES.has(enrichedCandidate.source);
      if (score < minScore && !(allowTrustedBelowThreshold && trusted)) return null;
      const baseRationale =
        cleanText(enrichedCandidate.rationale) ??
        buildCompetitorFitRationale(
          params.context,
          params.context.geography,
          trusted
            ? 'Validated as a competitor from a trusted source.'
            : 'Validated as a likely competitor through shared market, offering, and ICP signals.',
        );
      return {
        name,
        domain,
        ...breakdown,
        relevance_score: score,
        source: enrichedCandidate.source,
        classification: enrichedCandidate.classification ?? null,
        enrichment: enrichedCandidate.enrichment ?? null,
        enrichment_confidence_score: enrichedCandidate.confidenceScore ?? enrichedCandidate.enrichment?.confidence_score ?? 0.15,
        rationale: buildScoringRationale(baseRationale, breakdown),
        fit_signals: buildCompetitorFitSignals(params.context),
      } satisfies ScoredCompetitor;
    })
    .filter((item): item is ScoredCompetitor => Boolean(item))
    .sort((left, right) => right.relevance_score - left.relevance_score)
    .filter((item) => {
      const key = `${item.domain ?? item.name}`.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map((item, index) => ({
      ...item,
      classification: item.classification ?? classificationFromTier(item.tier) ?? classifyByIndex(index),
    }));
}

export function filterProfileCompetitorNames(profile: CompanyProfile, competitors: string[], max = 5): string[] {
  const context = extractCompetitiveContextFromProfile(profile);
  return getFinalCompetitorsSync({
    candidates: competitors.map((name) => ({ name, source: 'profile_ai' })),
    context,
    max,
    minScore: 42,
  }).map((competitor) => competitor.name);
}

function finalCompetitorKey(candidate: Pick<CompetitorCandidate, 'name' | 'domain'>): string {
  const domain = normalizeCompetitorDomain(candidate.domain ?? candidate.name);
  return (domain ?? cleanText(candidate.name) ?? '').toLowerCase();
}

export function dedupeCompetitorCandidates<T extends Pick<CompetitorCandidate, 'name' | 'domain' | 'source'>>(
  candidates: T[],
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const candidate of candidates) {
    if (FINAL_BLOCKED_SOURCES.has(candidate.source)) continue;
    const name = cleanText(candidate.name);
    const key = finalCompetitorKey(candidate);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...candidate,
      name,
      domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    });
  }

  return deduped;
}

export function hasPassedFinalCompetitorGate(
  competitor: Partial<RankedCompetitor> | null | undefined,
  minScore = FINAL_COMPETITOR_MIN_SCORE,
): competitor is RankedCompetitor {
  if (!competitor) return false;
  if (!competitor.name || typeof competitor.name !== 'string') return false;
  if (!competitor.source || FINAL_BLOCKED_SOURCES.has(competitor.source)) return false;
  if (!cleanText(competitor.category)) return false;
  if (!Number.isFinite(competitor.relevance_score) || Number(competitor.relevance_score) < minScore) return false;
  if (!Number.isFinite(competitor.final_score) || Number(competitor.final_score) <= 0) return false;
  if (Math.round(Number(competitor.final_score) * 100) < minScore) return false;
  const enrichmentConfidence = Number(
    competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0,
  );
  if (!competitor.enrichment || !Number.isFinite(enrichmentConfidence) || enrichmentConfidence < 0.5) return false;
  return true;
}

function toRevalidationCandidate(candidate: CompetitorCandidate): CompetitorCandidate {
  return {
    name: candidate.name,
    domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    source: candidate.source,
    classification: candidate.classification ?? undefined,
  };
}

export async function getFinalCompetitors(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  useNetwork?: boolean;
  useStoredCache?: boolean;
}): Promise<RankedCompetitor[]> {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const candidates = dedupeCompetitorCandidates(params.candidates).map(toRevalidationCandidate);
  if (candidates.length === 0) return [];

  const enriched = await enrichCompetitorCandidates({
    candidates,
    useNetwork: params.useNetwork,
    useStoredCache: params.useStoredCache,
  });

  return rankCompetitorCandidates({
    candidates: enriched,
    context: params.context,
    max: params.max,
    minScore,
    allowTrustedBelowThreshold: false,
  }).filter((competitor) => hasPassedFinalCompetitorGate(competitor, minScore));
}

export function getFinalCompetitorsSync(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
}): RankedCompetitor[] {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const candidates = dedupeCompetitorCandidates(params.candidates).map(toRevalidationCandidate);
  if (candidates.length === 0) return [];

  return rankCompetitorCandidates({
    candidates,
    context: params.context,
    max: params.max,
    minScore,
    allowTrustedBelowThreshold: false,
  }).filter((competitor) => hasPassedFinalCompetitorGate(competitor, minScore));
}

export function buildCandidatesFromNames(
  names: string[],
  source: CompetitorSource,
): CompetitorCandidate[] {
  return Array.from(new Set(names.map((name) => cleanText(name)).filter((name): name is string => Boolean(name))))
    .map((name) => ({
      name,
      domain: normalizeCompetitorDomain(name),
      source,
    }));
}

export function splitCompetitorNames(value?: string | string[] | null): string[] {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter((item): item is string => Boolean(item));
  return splitToList(value);
}
