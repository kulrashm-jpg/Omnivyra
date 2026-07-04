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

export type CompetitorSource =
  | 'user'
  | 'manual'
  | 'website'
  | 'social'
  | 'decision_evidence'
  | 'serp_live'
  | 'known_category_dataset'
  | 'market_substitute'
  | 'archetype_native_peer'
  | 'profile_ai'
  | 'inferred_keyword_peer'
  | 'serp_unavailable_fallback';

export type CompetitorClassification = 'direct_competitor' | 'seo_competitor' | 'authority_leader';
export type CompetitorRevenueTier = 'startup' | 'growth' | 'scale' | 'enterprise';
export type CompetitorTier = 'Tier 1' | 'Tier 2' | 'Tier 3';
export type CompetitorFundingLevel = 'bootstrap' | 'funded' | 'enterprise';
export type CompetitorBrandStrength = 'low' | 'medium' | 'high';

export type CompetitorAuthoritySignals = {
  traffic_estimate: string | null;
  installs: string | null;
  reviews: string | null;
  funding_level: CompetitorFundingLevel;
  search_visibility: string | null;
  brand_strength: CompetitorBrandStrength;
};

export type CompetitorThreatLevel = 'low' | 'medium' | 'high';

export type CompetitorPositioning = {
  strengths_vs_company: string[];
  weaknesses_vs_company: string[];
  differentiation: string;
  threat_level: CompetitorThreatLevel;
};

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
  entityArchetype?: EntityArchetypeIntelligence | null;
};

export type CompetitorIntelligence = {
  archetype_peer_category?: string | null;
  audience_overlap?: string | null;
  narrative_overlap?: string | null;
  trust_model?: string | null;
  publication_identity?: string | null;
  ecosystem_role?: string | null;
  monetization_adjacency?: string | null;
  creator_operator_identity?: string | null;
  educational_role?: string | null;
  worldview_adjacency?: string | null;
  platform_native_context?: string | null;
  reasoning?: string | null;
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
  competitorIntelligence?: CompetitorIntelligence | null;
  discoverySources?: CompetitorDiscoverySource[] | null;
  capabilityVector?: CompetitorCapabilityVector | null;
};

export type RankedCompetitor = {
  name: string;
  domain: string | null;
  category: string;
  tags: CompetitorSecondaryTag[];
  source: CompetitorSource;
  classification: CompetitorClassification;
  relevance_score: number;
  score_card: CompetitorScoreCard;
  reasoning: string[];
  discoverySources: CompetitorDiscoverySource[];
  capabilityVector: CompetitorCapabilityVector;
  problem_overlap: number;
  icp_overlap: number;
  market_overlap: number;
  revenue_tier: CompetitorRevenueTier;
  product_depth: number;
  authority_score: number;
  authority_signals: CompetitorAuthoritySignals;
  final_score: number;
  tier: CompetitorTier;
  positioning: CompetitorPositioning;
  enrichment: CompetitorEnrichmentProfile | null;
  enrichment_confidence_score: number;
  rationale: string;
  competitor_intelligence: CompetitorIntelligence | null;
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
  | 'score_card'
  | 'reasoning'
  | 'discoverySources'
  | 'capabilityVector'
  | 'problem_overlap'
  | 'icp_overlap'
  | 'market_overlap'
  | 'revenue_tier'
  | 'product_depth'
  | 'authority_score'
  | 'authority_signals'
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
  'serp_live',
  'known_category_dataset',
]);

const SOURCE_BASE_SCORE: Record<CompetitorSource, number> = {
  user: 70,
  manual: 70,
  website: 64,
  social: 58,
  decision_evidence: 0,
  serp_live: 58,
  known_category_dataset: 58,
  market_substitute: 52,
  archetype_native_peer: 50,
  profile_ai: 14,
  inferred_keyword_peer: 0,
  serp_unavailable_fallback: 0,
};

export const FINAL_COMPETITOR_MIN_SCORE = 40;
export const HIGH_CONFIDENCE_NAMED_COMPETITOR_SCORE = 85;
export const MARKET_SUBSTITUTE_MAX_COUNT = 3;
const FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP = 0.4;
const FINAL_COMPETITOR_MIN_ICP_OVERLAP = 0.25;
const FINAL_COMPETITOR_MIN_FINAL_SCORE = 0.4;
const FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE = 0.6;
const FINAL_COMPETITOR_MIN_COUNT = 3;
const FINAL_COMPETITOR_MAX_COUNT = 6;

let latestDebugCompetitorScoring: DebugCompetitorScoring | undefined;

export function getLatestDebugCompetitorScoring(): DebugCompetitorScoring | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return latestDebugCompetitorScoring;
}
const HIGH_AUTHORITY_MISMATCH_AUTHORITY = 0.7;
const HIGH_AUTHORITY_MISMATCH_PROBLEM = 0.4;

const FINAL_BLOCKED_SOURCES = new Set<CompetitorSource>([
  'decision_evidence',
  'inferred_keyword_peer',
  'serp_unavailable_fallback',
]);

const TIER_PRIORITY: Record<CompetitorTier, number> = {
  'Tier 1': 0,
  'Tier 2': 1,
  'Tier 3': 2,
};

const COMPANY_SUFFIX_PATTERN = /\b(private limited|pvt ltd|pvt|limited liability company|llc|llp|incorporated|inc|ltd|limited|plc|corp|corporation|company|co|technologies|technology|solutions|services|service)\b/g;
const UNRELATED_COMPETITOR_TEXT_PATTERN = /\b(staffing|staff augmentation|virtual employee|virtual employees|outsourc(?:e|ing)?|bpo|call center|recruit(?:ing|ment)?|hiring|logistics|freight|shipping|transportation|generic it|managed it|it services|web development services|software development services)\b/i;

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

function toPercentScore(value: number): number {
  return Math.round(roundDimension(value) * 100);
}

function scoreFromPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function competitorIntelligenceTier(score: number): CompetitorIntelligenceTier {
  if (score >= 85) return 'core';
  if (score >= 70) return 'strong';
  if (score >= 55) return 'adjacent';
  return 'strategic';
}

function weightedCompetitorScore(dimensions: CompetitorDimensionScores): number {
  return scoreFromPercent(
    dimensions.productServiceFit * 0.25 +
    dimensions.workflowFit * 0.20 +
    dimensions.icpFit * 0.15 +
    dimensions.customerEvaluationFit * 0.15 +
    dimensions.useCaseFit * 0.10 +
    dimensions.revenueScaleFit * 0.05 +
    dimensions.employeeScaleFit * 0.03 +
    dimensions.geographyFit * 0.02 +
    dimensions.seoIntentFit * 0.05,
  );
}

const CAPABILITY_PATTERNS: Record<string, RegExp[]> = {
  crm: [/\bcrm\b/i, /\bcustomer relationship/i],
  automation: [/\bautomation\b/i, /\bworkflow automation\b/i, /\bautomate\b/i],
  analytics: [/\banalytics?\b/i, /\breporting\b/i, /\bdashboard/i, /\binsights?\b/i],
  ai_assistance: [/\bai\b/i, /\bartificial intelligence\b/i, /\bassistant\b/i, /\bcopilot\b/i],
  growth_marketing: [/\bgrowth\b/i, /\bmarketing\b/i, /\bcampaign\b/i, /\bdemand generation\b/i],
  enterprise_workflows: [/\benterprise\b/i, /\boperations?\b/i, /\bworkflow\b/i, /\bapproval\b/i],
  sales_enablement: [/\bsales\b/i, /\benablement\b/i, /\bdeal\b/i, /\bquota\b/i],
  customer_support: [/\bsupport\b/i, /\bhelp ?desk\b/i, /\bservice desk\b/i, /\bticket/i],
  marketing_automation: [/\bmarketing automation\b/i, /\bemail marketing\b/i, /\blead nurture\b/i],
  pipeline_management: [/\bpipeline\b/i, /\bfunnel\b/i, /\bopportunit(?:y|ies)\b/i],
  lead_scoring: [/\blead scoring\b/i, /\blead qualification\b/i, /\bqualification\b/i],
  seo_intelligence: [/\bseo\b/i, /\bsearch visibility\b/i, /\bkeyword\b/i],
  content_intelligence: [/\bcontent\b/i, /\bcopy\b/i, /\bpost\b/i, /\bbrief\b/i],
  integrations: [/\bintegration/i, /\bconnectors?\b/i, /\bapi\b/i],
};

export function extractCapabilityVectorFromText(text: string | null | undefined): CompetitorCapabilityVector {
  const normalized = String(text ?? '').toLowerCase();
  const vector: CompetitorCapabilityVector = {};
  for (const [capability, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
    const matchCount = patterns.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
    if (matchCount > 0) {
      vector[capability] = Math.min(1, 0.45 + (matchCount * 0.18));
    }
  }
  return vector;
}

function mergeCapabilityVectors(...vectors: Array<CompetitorCapabilityVector | null | undefined>): CompetitorCapabilityVector {
  const merged: CompetitorCapabilityVector = {};
  vectors.forEach((vector) => {
    Object.entries(vector ?? {}).forEach(([key, value]) => {
      const score = Number(value);
      if (Number.isFinite(score)) merged[key] = Math.max(merged[key] ?? 0, Math.max(0, Math.min(1, score)));
    });
  });
  return merged;
}

function buildCompanyCapabilityVector(context: CompanyCompetitiveContext): CompetitorCapabilityVector {
  return extractCapabilityVectorFromText([
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' '));
}

function buildCandidateCapabilityVector(candidate: CompetitorCandidate): CompetitorCapabilityVector {
  const enrichment = candidate.enrichment;
  return mergeCapabilityVectors(
    candidate.capabilityVector,
    extractCapabilityVectorFromText([
      candidate.name,
      candidate.domain,
      candidate.category,
      candidate.description,
      candidate.targetCustomer,
      candidate.useCase,
      candidate.businessModel,
      candidate.rationale,
      ...(candidate.productSignals ?? []),
      enrichment?.category,
      enrichment?.description,
      enrichment?.business_model,
      enrichment?.product_type,
      enrichment?.icp.use_case,
      enrichment?.icp.user_intent,
      ...(enrichment?.tags ?? []),
      candidate.competitorIntelligence?.ecosystem_role,
      candidate.competitorIntelligence?.reasoning,
    ].filter(Boolean).join(' ')),
  );
}

function capabilityVectorOverlap(
  target: CompetitorCapabilityVector,
  candidate: CompetitorCapabilityVector,
): number {
  const keys = Array.from(new Set([...Object.keys(target), ...Object.keys(candidate)]));
  if (keys.length === 0) return 0;
  let shared = 0;
  let targetWeight = 0;
  for (const key of keys) {
    const targetScore = Number(target[key] ?? 0);
    const candidateScore = Number(candidate[key] ?? 0);
    targetWeight += targetScore;
    shared += Math.min(targetScore, candidateScore);
  }
  if (targetWeight <= 0) return 0;
  return roundDimension(shared / targetWeight);
}

function discoverySourceFromCandidate(candidate: CompetitorCandidate): CompetitorDiscoverySource {
  if (candidate.source === 'manual' || candidate.source === 'user') return 'manual';
  if (candidate.source === 'website' || candidate.source === 'social') return 'stored';
  if (candidate.source === 'serp_live') return 'serp';
  if (candidate.source === 'profile_ai' || candidate.source === 'archetype_native_peer') return 'ai-inferred';
  if (candidate.source === 'known_category_dataset' || candidate.source === 'market_substitute') return 'ecosystem';
  return 'provider';
}

function candidateDiscoverySources(candidate: CompetitorCandidate): CompetitorDiscoverySource[] {
  return Array.from(new Set([
    ...(candidate.discoverySources ?? []),
    discoverySourceFromCandidate(candidate),
  ]));
}

function employeeScaleFitForCandidate(candidate: CompetitorCandidate, signalText: string): number {
  const explicitScale = [
    scaleSignalValue(candidate, 'notes'),
    scaleSignalValue(candidate, 'funding'),
    candidate.revenueRange,
  ].filter(Boolean).join(' ').toLowerCase();
  const text = `${explicitScale} ${signalText}`.toLowerCase();
  if (/\b(enterprise|public|global|10000\+|5000\+|1000\+)\b/.test(text)) return 60;
  if (/\b(scale|500\+|1000|large)\b/.test(text)) return 72;
  if (/\b(growth|100\+|250\+|mid[-\s]?market)\b/.test(text)) return 84;
  return 88;
}

function classifyNormalizedCompetitorCategory(params: {
  overallScore: number;
  dimensions: CompetitorDimensionScores;
  revenueTier: CompetitorRevenueTier;
  competitor: CompetitorCandidate;
  affinity: 'same' | 'functional' | 'substitute';
}): NormalizedCompetitorCategory | null {
  if (params.overallScore < 40) return null;

  const primaryAverage = (
    params.dimensions.productServiceFit +
    params.dimensions.workflowFit +
    params.dimensions.customerEvaluationFit +
    params.dimensions.useCaseFit
  ) / 4;
  const nameText = `${params.competitor.name} ${params.competitor.description ?? ''} ${params.competitor.businessModel ?? ''}`.toLowerCase();

  if (
    params.overallScore >= 70 &&
    params.revenueTier === 'enterprise' &&
    primaryAverage >= 65
  ) return 'enterprise';

  if (
    params.overallScore >= 55 &&
    /\b(startup|emerging|new|early|seed|series a|indie)\b/.test(nameText)
  ) return 'emerging';

  if (
    params.overallScore >= 55 &&
    params.dimensions.geographyFit >= 80 &&
    params.dimensions.productServiceFit >= 50 &&
    params.affinity !== 'same'
  ) return 'regional';

  if (params.overallScore >= 70) return 'direct';
  if (params.overallScore >= 55) return 'adjacent';
  return 'workflow-alternative';
}

// ── Product-first competition gate (3-part) ──────────────────────────────────
// A candidate is a real competitor ONLY when: (1) it is the same KIND of product
// (not a facilitated outcome/service, nor a media/content producer), (2) it covers
// >= ~70% of our functional surface, and (3) it targets the same segment/positioning.
// Rationale: Omnivyra is a PRODUCT. It generates content, but that does NOT make
// newsletters/creators/news competitors — those are FACILITATED (customers we
// empower). Service agencies are SECONDARY (adjacent market, shown after primary).
// A product with narrow overlap (e.g. a design tool sharing ~15-20%) or a different
// customer segment is EXCLUDED. Mirrors the "we generate content != we compete with
// content creators" and "same category but different segment != competitor" rules.
export const COMPETITOR_FUNCTIONAL_OVERLAP_MIN = 0.7; // >=70% functional/vision overlap
export const COMPETITOR_SEGMENT_ALIGN_MIN = 0.4; // segment/ICP/market alignment floor
export type ProductFirstCompetitionTier = 'primary' | 'secondary' | 'facilitated' | 'excluded';

// Unambiguous media/content-brand signals (newsletters, publications, podcasts, creators).
const MEDIA_CONTENT_BRAND_SIGNALS =
  /\b(newsletter|substack|publication|magazine|podcast|youtuber|editorial|digest|the hustle|morning brew|creator economy)\b/i;

export function classifyProductFirstCompetition(params: {
  productType: CompetitorProductType | null;
  functionalOverlap: number; // 0..1 problem/capability overlap with our product
  segmentOverlap: number; // 0..1 = max(icp_overlap, market_overlap)
  isMediaContent: boolean; // discovered as a media/audience/content brand
  trustedProduct: boolean; // manual/known product competitor — bypass soft gates
}): ProductFirstCompetitionTier {
  const pt = params.productType;
  // Tier 3 — FACILITATED: media/content producers are customers we empower, never competitors.
  if (pt === 'content-based' || params.isMediaContent) return 'facilitated';
  // Tier 2 — SECONDARY: human-led service agencies (adjacent market).
  if (pt === 'human-led') return 'secondary';
  // Explicitly known/manual product competitors always qualify (curated truth).
  if (params.trustedProduct) return 'primary';
  // PRODUCTS (incl. un-enriched SERP hits): require >=70% functional overlap AND segment alignment.
  if (params.functionalOverlap < COMPETITOR_FUNCTIONAL_OVERLAP_MIN) return 'excluded';
  if (params.segmentOverlap < COMPETITOR_SEGMENT_ALIGN_MIN) return 'excluded';
  return 'primary';
}

function competitorReasoning(params: {
  dimensions: CompetitorDimensionScores;
  category: NormalizedCompetitorCategory;
  revenueTier: CompetitorRevenueTier;
  affinity: 'same' | 'functional' | 'substitute';
  competitor: CompetitorCandidate;
}): string[] {
  const reasons: string[] = [];
  if (params.dimensions.productServiceFit >= 70) reasons.push('Strong product/service overlap');
  if (params.dimensions.workflowFit >= 70) reasons.push('Strong operational workflow overlap');
  if (params.dimensions.icpFit >= 65) reasons.push('Shared ICP or buyer segment');
  if (params.dimensions.customerEvaluationFit >= 65) reasons.push('Appears in the same customer evaluation space');
  if (params.dimensions.useCaseFit >= 65) reasons.push('Competes around the same business use case');
  if (
    params.dimensions.productServiceFit >= 65 &&
    params.dimensions.workflowFit >= 65 &&
    params.dimensions.useCaseFit >= 65
  ) reasons.push('Capability vector overlaps across product, workflow, and use case');
  if (params.category === 'enterprise') reasons.push('Enterprise player retained because workflow and problem overlap are strong');
  if (params.category === 'workflow-alternative') reasons.push('Strategic workflow alternative with meaningful overlap');
  if (params.category === 'regional') reasons.push('Regional competitor signal with relevant market overlap');
  if (params.category === 'emerging') reasons.push('Emerging competitor signal with relevant category overlap');
  if (params.affinity === 'same') reasons.push('Same normalized category affinity');
  if (params.affinity === 'functional') reasons.push('Functional category adjacency');
  return Array.from(new Set(reasons)).slice(0, 5);
}

function failedCompetitorDimensions(competitor: Partial<RankedCompetitor>): string[] {
  const scoreCard = competitor.score_card;
  if (!scoreCard) return ['missing score card'];
  const failed = Object.entries(scoreCard.dimensions)
    .filter(([, value]) => Number(value) < 40)
    .map(([key]) => key);
  if (Number(scoreCard.overallScore) < 40) failed.push('overallScore');
  if (!competitor.enrichment) failed.push('enrichment');
  return failed;
}

function scaleSignalText(candidate: CompetitorCandidate): string {
  return [
    candidate.name,
    candidate.domain,
    candidate.source,
    candidate.description,
    candidate.businessModel,
    candidate.revenueRange,
    candidate.productType,
    candidate.enrichment?.description,
    candidate.enrichment?.business_model,
    candidate.enrichment?.product_type,
    candidate.enrichment?.category,
    ...(candidate.enrichment?.sources ?? []),
    ...Object.values(candidate.scaleSignals ?? {}).filter(Boolean),
    ...Object.values(candidate.enrichment?.scale_signals ?? {}).filter(Boolean),
  ].filter(Boolean).join(' ').toLowerCase();
}

function scaleSignalValue(
  candidate: CompetitorCandidate,
  key: keyof CompetitorScaleSignals,
): string | null {
  return cleanText(candidate.scaleSignals?.[key]) ?? cleanText(candidate.enrichment?.scale_signals?.[key]) ?? null;
}

function inferTrafficEstimate(candidate: CompetitorCandidate, signalText: string): string | null {
  const explicit = scaleSignalValue(candidate, 'traffic');
  if (explicit) return explicit;
  if (/\b(very large|public|enterprise-scale|enterprise scale|category leader|global ai platform)\b/.test(signalText)) {
    return '1M+ monthly visits (estimated from scale signals)';
  }
  if (/\b(large|major|substantial|global)\b/.test(signalText)) {
    return '100K-1M monthly visits (estimated from scale signals)';
  }
  if (/\b(known|recognized|venture-backed|venture backed)\b/.test(signalText)) {
    return '10K-100K monthly visits (estimated from scale signals)';
  }
  return null;
}

function inferFundingLevel(signalText: string): CompetitorFundingLevel {
  if (/\b(public|enterprise-scale|enterprise scale|enterprise software|enterprise company|public company|1b|billion)\b/.test(signalText)) {
    return 'enterprise';
  }
  if (/\b(funded|funding|venture-backed|venture backed|backed|series [a-z]|vc)\b/.test(signalText)) {
    return 'funded';
  }
  return 'bootstrap';
}

function inferBrandStrength(signalText: string): CompetitorBrandStrength {
  if (/\b(very large|category leader|major|public|enterprise-scale|enterprise scale|global ai platform|large global)\b/.test(signalText)) {
    return 'high';
  }
  if (/\b(large|known|recognized|substantial|venture-backed|venture backed|global|workplace|enterprise)\b/.test(signalText)) {
    return 'medium';
  }
  return 'low';
}

function inferSearchVisibility(
  candidate: CompetitorCandidate,
  signalText: string,
  brandStrength: CompetitorBrandStrength,
): string | null {
  if (candidate.source === 'serp_live') return 'present in live SERP discovery';
  if (/\b(category leader|major|very large|public|large global|enterprise-scale|enterprise scale)\b/.test(signalText)) {
    return 'high category keyword presence (estimated from scale signals)';
  }
  if (brandStrength === 'medium' || /\b(known|recognized|large|substantial)\b/.test(signalText)) {
    return 'moderate category keyword presence (estimated from scale signals)';
  }
  return null;
}

function signalStrength(value: string | null): number {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (/\b(very large|1m\+|public|enterprise-scale|enterprise scale|category leader|major|high)\b/.test(normalized)) return 1;
  if (/\b(large|100k|substantial|global|strong)\b/.test(normalized)) return 0.75;
  if (/\b(moderate|known|recognized|10k|venture-backed|venture backed)\b/.test(normalized)) return 0.55;
  if (/\b(consumer|mobile app footprint|some|niche)\b/.test(normalized)) return 0.35;
  return 0.25;
}

function fundingScore(level: CompetitorFundingLevel): number {
  if (level === 'enterprise') return 1;
  if (level === 'funded') return 0.65;
  return 0.2;
}

function brandScore(strength: CompetitorBrandStrength): number {
  if (strength === 'high') return 1;
  if (strength === 'medium') return 0.55;
  return 0.2;
}

function buildAuthoritySignals(candidate: CompetitorCandidate): CompetitorAuthoritySignals {
  const signalText = scaleSignalText(candidate);
  const fundingLevel = inferFundingLevel(signalText);
  const brandStrength = inferBrandStrength(signalText);
  return {
    traffic_estimate: inferTrafficEstimate(candidate, signalText),
    installs: scaleSignalValue(candidate, 'installs'),
    reviews: scaleSignalValue(candidate, 'reviews'),
    funding_level: fundingLevel,
    search_visibility: inferSearchVisibility(candidate, signalText, brandStrength),
    brand_strength: brandStrength,
  };
}

export function computeCompetitorAuthorityScore(candidate: CompetitorCandidate): {
  authority_score: number;
  authority_signals: CompetitorAuthoritySignals;
} {
  const authoritySignals = buildAuthoritySignals(candidate);
  const installsReviewsScore = Math.max(
    signalStrength(authoritySignals.installs),
    signalStrength(authoritySignals.reviews),
  );
  const score = roundDimension(
    (0.25 * signalStrength(authoritySignals.traffic_estimate)) +
    (0.20 * installsReviewsScore) +
    (0.15 * fundingScore(authoritySignals.funding_level)) +
    (0.25 * signalStrength(authoritySignals.search_visibility)) +
    (0.15 * brandScore(authoritySignals.brand_strength)),
  );

  return {
    authority_score: score,
    authority_signals: authoritySignals,
  };
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
    candidate.competitorIntelligence?.archetype_peer_category,
    candidate.competitorIntelligence?.audience_overlap,
    candidate.competitorIntelligence?.narrative_overlap,
    candidate.competitorIntelligence?.trust_model,
    candidate.competitorIntelligence?.publication_identity,
    candidate.competitorIntelligence?.ecosystem_role,
    candidate.competitorIntelligence?.monetization_adjacency,
    candidate.competitorIntelligence?.creator_operator_identity,
    candidate.competitorIntelligence?.educational_role,
    candidate.competitorIntelligence?.worldview_adjacency,
    candidate.competitorIntelligence?.platform_native_context,
    ...(candidate.productSignals ?? []),
  ].filter(Boolean).join(' ');
}

function compactText(value: unknown, max = 180): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max).trim() : null;
}

function inferCompetitorIntelligence(candidate: CompetitorCandidate, context: CompanyCompetitiveContext): CompetitorIntelligence | null {
  const sourceIntelligence = candidate.competitorIntelligence ?? null;
  const evidence = candidateSignalText(candidate, normalizeCompetitorDomain(candidate.domain ?? candidate.name)).toLowerCase();
  if (candidate.source !== 'archetype_native_peer' && !sourceIntelligence) return null;
  const category = compactText(sourceIntelligence?.archetype_peer_category ?? candidate.category);
  const productSignals = (candidate.productSignals ?? []).filter(Boolean).join(', ');
  const contextAudience = compactText(context.targetCustomer ?? context.idealCustomerProfile);
  const useCase = compactText(candidate.useCase ?? candidate.enrichment?.icp?.use_case);
  const businessModel = compactText(candidate.businessModel ?? candidate.enrichment?.business_model);
  const description = compactText(candidate.description ?? candidate.enrichment?.description);
  const isPublication = /\b(newsletter|publication|editorial|media|podcast|readers?|subscribers?)\b/.test(evidence);
  const isCreator = /\b(creator|founder|operator|public builder|public building|personal brand|writer)\b/.test(evidence);
  const isEducation = /\b(course|education|educator|learners?|students?|workshop|cohort|community|membership)\b/.test(evidence);
  const isWorldview = /\b(worldview|thesis|framework|belief|manifesto|why|narrative|philosophy|systems thinking)\b/.test(evidence);
  const isPlatformNative = /\b(substack|youtube|linkedin|podcast|newsletter|platform-native)\b/.test(evidence);
  return {
    archetype_peer_category: category,
    audience_overlap: compactText(sourceIntelligence?.audience_overlap ?? contextAudience ?? candidate.targetCustomer),
    narrative_overlap: compactText(sourceIntelligence?.narrative_overlap ?? (isWorldview ? description ?? productSignals : candidate.rationale)),
    trust_model: compactText(sourceIntelligence?.trust_model ?? (isPublication ? 'recurring audience trust through publishing cadence' : isCreator ? 'person-led authority and audience trust' : isEducation ? 'expert-led learning trust' : null)),
    publication_identity: compactText(sourceIntelligence?.publication_identity ?? (isPublication ? category ?? 'publication/media peer' : null)),
    ecosystem_role: compactText(sourceIntelligence?.ecosystem_role ?? (isCreator ? 'creator/operator peer in the same audience ecosystem' : isEducation ? 'education/community peer' : null)),
    monetization_adjacency: compactText(sourceIntelligence?.monetization_adjacency ?? businessModel),
    creator_operator_identity: compactText(sourceIntelligence?.creator_operator_identity ?? (isCreator ? category ?? candidate.name : null)),
    educational_role: compactText(sourceIntelligence?.educational_role ?? (isEducation ? useCase ?? category : null)),
    worldview_adjacency: compactText(sourceIntelligence?.worldview_adjacency ?? (isWorldview ? useCase ?? description : null)),
    platform_native_context: compactText(sourceIntelligence?.platform_native_context ?? (isPlatformNative ? productSignals || category : null)),
    reasoning: compactText(sourceIntelligence?.reasoning ?? candidate.rationale),
  };
}

function competitorIntelligenceText(intelligence: CompetitorIntelligence | null | undefined): string {
  if (!intelligence) return '';
  return [
    intelligence.archetype_peer_category,
    intelligence.audience_overlap,
    intelligence.narrative_overlap,
    intelligence.trust_model,
    intelligence.publication_identity,
    intelligence.ecosystem_role,
    intelligence.monetization_adjacency,
    intelligence.creator_operator_identity,
    intelligence.educational_role,
    intelligence.worldview_adjacency,
    intelligence.platform_native_context,
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

function buildCompetitorPositioning(
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

function withArchetypeEnrichment(candidate: CompetitorCandidate): CompetitorCandidate {
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
      candidate.source === 'archetype_native_peer'
        ? 'archetype_native_peer'
        : candidate.source === 'market_substitute'
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
    `Competitive scoring: normalized category ${breakdown.score_card.category}, category ${breakdown.category}, tags ${breakdown.tags.join(', ') || 'none'}, product/service ${breakdown.score_card.dimensions.productServiceFit}, workflow ${breakdown.score_card.dimensions.workflowFit}, ICP ${breakdown.score_card.dimensions.icpFit}, customer evaluation ${breakdown.score_card.dimensions.customerEvaluationFit}, use case ${breakdown.score_card.dimensions.useCaseFit}, revenue scale ${breakdown.score_card.dimensions.revenueScaleFit}, employee scale ${breakdown.score_card.dimensions.employeeScaleFit}, geography ${breakdown.score_card.dimensions.geographyFit}, SEO intent ${breakdown.score_card.dimensions.seoIntentFit}; weighted score ${breakdown.score_card.overallScore} (${breakdown.tier}).`,
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

function isAuthorityDominatedMismatch(competitor: {
  authority_score?: number | null;
  problem_overlap?: number | null;
  icp_overlap?: number | null;
}): boolean {
  return (
    Number(competitor.authority_score ?? 0) > HIGH_AUTHORITY_MISMATCH_AUTHORITY &&
    Number(competitor.problem_overlap ?? 0) < HIGH_AUTHORITY_MISMATCH_PROBLEM
  );
}

function sourceEvidenceBoost(source: CompetitorSource): number {
  if (source === 'manual' || source === 'user') return 0.55;
  if (source === 'website' || source === 'social') return 0.45;
  if (source === 'serp_live' || source === 'known_category_dataset') return 0.35;
  if (source === 'market_substitute') return 0.35;
  if (source === 'archetype_native_peer') return 0.32;
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
    icpOverlap = roundDimension(Math.max(icpOverlap, FINAL_COMPETITOR_MIN_ICP_OVERLAP));
  }
  if (
    enrichedCandidate.source === 'archetype_native_peer' &&
    hasArchetypeNativePeerEvidence(candidateSignalText(enrichedCandidate, domain)) &&
    hasArchetypeNativeContextEvidence(context)
  ) {
    problemOverlap = roundDimension(Math.max(problemOverlap, FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP));
    icpOverlap = roundDimension(Math.max(icpOverlap, FINAL_COMPETITOR_MIN_ICP_OVERLAP));
  }
  const marketOverlap = roundDimension((geographyOverlap * 0.55) + (segmentOverlap * 0.45));
  const productDepth = roundDimension(featureDepth);
  const revenue = revenueAdjustment(companyRevenueTier, competitorRevenueTier);
  const authority = computeCompetitorAuthorityScore(enrichedCandidate);
  const targetCapabilityVector = buildCompanyCapabilityVector(context);
  const candidateCapabilityVector = buildCandidateCapabilityVector(enrichedCandidate);
  const vectorOverlap = capabilityVectorOverlap(targetCapabilityVector, candidateCapabilityVector);
  const workflowFit = roundDimension((marketFocusOverlap * 0.45) + (productOverlap * 0.35) + (intentOverlap * 0.20));
  const customerEvaluationFit = roundDimension(
    (intentOverlap * 0.45) +
    (targetOverlap * 0.30) +
    ((affinity === 'same' ? 1 : affinity === 'functional' ? 0.72 : 0.35) * 0.25),
  );
  const useCaseFit = roundDimension((productDepth * 0.60) + (problemOverlap * 0.40));
  const seoIntentFit = roundDimension((intentOverlap * 0.55) + (authority.authority_score * 0.45));
  const dimensions: CompetitorDimensionScores = {
    productServiceFit: toPercentScore((problemOverlap * 0.60) + (vectorOverlap * 0.40)),
    workflowFit: toPercentScore((workflowFit * 0.55) + (vectorOverlap * 0.45)),
    icpFit: toPercentScore(icpOverlap),
    customerEvaluationFit: toPercentScore(customerEvaluationFit),
    useCaseFit: toPercentScore((useCaseFit * 0.60) + (vectorOverlap * 0.40)),
    revenueScaleFit: toPercentScore(revenue),
    employeeScaleFit: employeeScaleFitForCandidate(enrichedCandidate, candidateSignalText(enrichedCandidate, domain)),
    geographyFit: toPercentScore(geographyOverlap),
    seoIntentFit: toPercentScore(seoIntentFit),
  };
  let overallScore = weightedCompetitorScore(dimensions);
  let finalScore = roundDimension(overallScore / 100);
  if (
    enrichedCandidate.source === 'archetype_native_peer' &&
    hasArchetypeNativePeerEvidence(candidateSignalText(enrichedCandidate, domain)) &&
    hasArchetypeNativeContextEvidence(context)
  ) {
    finalScore = roundDimension(Math.max(finalScore, FINAL_COMPETITOR_MIN_SCORE / 100));
    overallScore = Math.max(overallScore, FINAL_COMPETITOR_MIN_SCORE);
  }

  const tags = enrichedCandidate.tags ?? normalizeCompetitorTags({
    productType: enrichedCandidate.productType,
    businessModel: enrichedCandidate.businessModel,
    description: enrichedCandidate.description,
    category: competitorCategory,
  });

  const tier = classifyCompetitiveTier({ problemOverlap, icpOverlap, affinity });
  const normalizedCategory = classifyNormalizedCompetitorCategory({
    overallScore,
    dimensions,
    revenueTier: competitorRevenueTier,
    competitor: enrichedCandidate,
    affinity,
  }) ?? 'workflow-alternative';
  const reasoning = competitorReasoning({
    dimensions,
    category: normalizedCategory,
    revenueTier: competitorRevenueTier,
    affinity,
    competitor: enrichedCandidate,
  });
  const discoverySources = candidateDiscoverySources(enrichedCandidate);
  const intelligenceTier = competitorIntelligenceTier(overallScore);

  return {
    category: competitorCategory,
    tags,
    relevance_score: overallScore,
    score_card: {
      overallScore,
      category: normalizedCategory,
      tier: intelligenceTier,
      dimensions,
      reasoning,
      confidence: Math.round((enrichedCandidate.confidenceScore ?? enrichedCandidate.enrichment?.confidence_score ?? 0.15) * 100),
      discoverySources,
      capabilityVector: candidateCapabilityVector,
    },
    reasoning,
    discoverySources,
    capabilityVector: candidateCapabilityVector,
    problem_overlap: problemOverlap,
    icp_overlap: icpOverlap,
    market_overlap: marketOverlap,
    revenue_tier: competitorRevenueTier,
    product_depth: productDepth,
    authority_score: authority.authority_score,
    authority_signals: authority.authority_signals,
    final_score: finalScore,
    tier,
  };
}

export function scoreCompetitorCandidate(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
): number {
  const enrichedCandidate = enrichCompetitorCandidateSync(candidate);
  return evaluateCompetitorCandidate(enrichedCandidate, context).score_card.overallScore;
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
      const businessFirstOnly = isBusinessFirstOnlyArchetype(params.context.entityArchetype);
      const explicitlyValidatedArchetypePeer = Boolean(enrichedCandidate.competitorIntelligence?.reasoning);
      if (
        enrichedCandidate.source === 'archetype_native_peer' &&
        businessFirstOnly &&
        !explicitlyValidatedArchetypePeer
      ) return null;
      const domain = normalizeCompetitorDomain(enrichedCandidate.domain ?? enrichedCandidate.name);
      const name = cleanText(enrichedCandidate.enrichment?.name) ?? cleanText(enrichedCandidate.name) ?? domainToName(domain);
      if (!name) return null;
      const breakdown = evaluateCompetitorCandidate(enrichedCandidate, params.context);
      if (isAuthorityDominatedMismatch(breakdown)) return null;
      // Product-first competition gate — applies ONLY to product/business-first companies
      // (e.g. Omnivyra). For a PRODUCT company, media/content producers (newsletters,
      // creators, publications) are FACILITATED customers, not competitors; narrow-overlap
      // (<70% functional) and off-segment products are EXCLUDED. Audience-led companies keep
      // their peer competitors (unchanged), since for them those peers ARE the competition.
      if (businessFirstOnly) {
        const gateProductType = enrichedCandidate.enrichment?.product_type ?? enrichedCandidate.productType ?? null;
        const gateText = [
          enrichedCandidate.name,
          enrichedCandidate.domain,
          enrichedCandidate.category,
          enrichedCandidate.description,
          enrichedCandidate.businessModel,
          enrichedCandidate.enrichment?.description,
          enrichedCandidate.enrichment?.category,
        ].filter(Boolean).join(' ');
        const competitionTier = classifyProductFirstCompetition({
          productType: gateProductType,
          functionalOverlap: breakdown.problem_overlap,
          segmentOverlap: Math.max(breakdown.icp_overlap, breakdown.market_overlap),
          isMediaContent:
            MEDIA_CONTENT_BRAND_SIGNALS.test(gateText) ||
            enrichedCandidate.source === 'archetype_native_peer',
          trustedProduct: TRUSTED_SOURCES.has(enrichedCandidate.source),
        });
        if (competitionTier === 'facilitated' || competitionTier === 'excluded') return null;
      }
      const positioning = buildCompetitorPositioning(enrichedCandidate, breakdown, params.context);
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
        positioning,
        relevance_score: score,
        source: enrichedCandidate.source,
        classification: enrichedCandidate.classification ?? null,
        enrichment: enrichedCandidate.enrichment ?? null,
        enrichment_confidence_score: enrichedCandidate.confidenceScore ?? enrichedCandidate.enrichment?.confidence_score ?? 0.15,
        rationale: buildScoringRationale(baseRationale, breakdown),
        competitor_intelligence: inferCompetitorIntelligence(enrichedCandidate, params.context),
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
    includeMarketSubstitutes: false,
  }).map((competitor) => competitor.name);
}

function normalizeCompetitorEntityName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(COMPANY_SUFFIX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainRootKey(value: string | null | undefined): string | null {
  const domain = normalizeCompetitorDomain(value);
  if (!domain) return null;
  return normalizeCompetitorEntityName(domain.split('.')[0] ?? domain);
}

function finalCompetitorKey(candidate: Pick<CompetitorCandidate, 'name' | 'domain'>): string {
  const nameKey = normalizeCompetitorEntityName(cleanText(candidate.name));
  const domainKey = domainRootKey(candidate.domain ?? candidate.name);
  return nameKey || domainKey || '';
}

function candidateDedupeQuality(candidate: Partial<CompetitorCandidate>): number {
  const confidence = Number(candidate.confidenceScore ?? candidate.enrichment?.confidence_score ?? 0);
  const knownProfile = findKnownCompetitorProfile(candidate.name, candidate.domain);
  return (
    ((knownProfile?.confidence_score ?? 0) * 120) +
    (Number.isFinite(confidence) ? confidence * 100 : 0) +
    (candidate.enrichment ? 20 : 0) +
    (candidate.category ? 8 : 0) +
    (candidate.description ? 8 : 0) +
    (candidate.domain ? 6 : 0) +
    ((candidate.productSignals?.length ?? 0) > 0 ? 5 : 0)
  );
}

export function dedupeCompetitorCandidates<T extends Pick<CompetitorCandidate, 'name' | 'domain' | 'source'>>(
  candidates: T[],
): T[] {
  const byKey = new Map<string, T & { name: string; domain: string | null }>();
  const keysByEntity = new Map<string, string>();

  for (const candidate of candidates) {
    if (FINAL_BLOCKED_SOURCES.has(candidate.source)) continue;
    const name = cleanText(candidate.name);
    const nameKey = normalizeCompetitorEntityName(name);
    const domainKey = domainRootKey(candidate.domain ?? candidate.name);
    const entityKeys = [nameKey ? `name:${nameKey}` : null, domainKey ? `domain:${domainKey}` : null].filter(Boolean) as string[];
    const key = entityKeys.map((entityKey) => keysByEntity.get(entityKey)).find(Boolean) ?? finalCompetitorKey(candidate);
    if (!name || !key || entityKeys.length === 0) continue;
    const normalizedCandidate = {
      ...candidate,
      name,
      domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    };
    const existing = byKey.get(key);
    const mergedDiscoverySources = Array.from(new Set([
      ...((existing as Partial<CompetitorCandidate> | undefined)?.discoverySources ?? []),
      ...((normalizedCandidate as Partial<CompetitorCandidate>).discoverySources ?? []),
      discoverySourceFromCandidate(normalizedCandidate as CompetitorCandidate),
    ]));
    const winner = !existing || candidateDedupeQuality(normalizedCandidate) > candidateDedupeQuality(existing)
      ? normalizedCandidate
      : existing;
    byKey.set(key, {
      ...winner,
      discoverySources: mergedDiscoverySources,
    });
    for (const entityKey of entityKeys) {
      keysByEntity.set(entityKey, key);
    }
  }

  return Array.from(byKey.values());
}

function detectedCompanyCategories(context: CompanyCompetitiveContext): StandardCompetitorCategory[] {
  const joinedContext = [
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' ');
  const weightedFields: Array<[string | null, number]> = [
    [context.marketFocus, 4],
    [context.primaryService, 4],
    [context.brandPositioning, 3],
    [context.targetCustomer, 2],
    [context.idealCustomerProfile, 2],
    [context.businessModel, 1],
  ];
  const scores = new Map<StandardCompetitorCategory, number>();
  for (const [value, weight] of weightedFields) {
    if (!cleanText(value)) continue;
    const category = normalizeCompetitorCategory(value, joinedContext);
    scores.set(category, (scores.get(category) ?? 0) + weight);
  }
  if (scores.size === 0 && cleanText(joinedContext)) {
    const category = normalizeCompetitorCategory(null, joinedContext);
    scores.set(category, 1);
  }
  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([category]) => category);
}

function competitorEvidenceText(competitor: Partial<RankedCompetitor>): string {
  return [
    competitor.name,
    competitor.domain,
    competitor.category,
    competitor.rationale,
    competitor.enrichment?.category,
    competitor.enrichment?.description,
    competitor.enrichment?.business_model,
    competitor.enrichment?.product_type,
    competitor.enrichment?.icp?.age_group,
    competitor.enrichment?.icp?.use_case,
    competitor.enrichment?.icp?.user_intent,
  ].filter(Boolean).join(' ');
}

function hasArchetypeNativePeerEvidence(value: string | null | undefined): boolean {
  return /\b(newsletter|publication|podcast|creator|course|community|membership|author|speaker|thesis|worldview|operator|public builder|public building|audience-led|trust substitute|editorial|subscribers?|readers?)\b/.test(
    String(value ?? '').toLowerCase(),
  );
}

function hasArchetypeNativeContextEvidence(context: CompanyCompetitiveContext): boolean {
  return hasArchetypeNativePeerEvidence([
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' '));
}

function hasStrictCategoryFit(
  competitor: Partial<RankedCompetitor>,
  context: CompanyCompetitiveContext,
): boolean {
  if (UNRELATED_COMPETITOR_TEXT_PATTERN.test(competitorEvidenceText(competitor))) return false;
  if (competitor.source === 'archetype_native_peer') {
    const archetypePeerEvidence = hasArchetypeNativePeerEvidence(competitorEvidenceText(competitor));
    if (
      archetypePeerEvidence &&
      hasArchetypeNativeContextEvidence(context) &&
      Number(competitor.problem_overlap ?? 0) >= FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP &&
      Number(competitor.icp_overlap ?? 0) >= FINAL_COMPETITOR_MIN_ICP_OVERLAP
    ) return true;
  }
  const topCategories = detectedCompanyCategories(context);
  if (topCategories.length === 0) return true;
  const competitorCategory = normalizeCompetitorCategory(
    competitor.category,
    competitorEvidenceText(competitor),
  );
  return topCategories.some((companyCategory) => {
    if (companyCategory === 'mental_wellness_ai' && competitorCategory === 'ai_companion') {
      const evidence = competitorEvidenceText(competitor).toLowerCase();
      const wellnessUseCase =
        /\b(mental wellness|mental wellbeing|mental health|therapy|therapeutic|clarity|decision[-\s]?making|decision support|self[-\s]?reflection|guided journaling)\b/.test(evidence);
      const companionUseCase =
        /\b(companionship|relationship|conversation partner|romantic|friend|connection)\b/.test(evidence);
      return wellnessUseCase && !companionUseCase;
    }
    const affinity = categoryAffinity(companyCategory, competitorCategory);
    return affinity === 'same' || affinity === 'functional';
  });
}

function rankedCompetitorQuality(competitor: RankedCompetitor): number {
  return (
    Number(competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0) * 100 +
    Number(competitor.final_score ?? 0) * 10 +
    Number(competitor.problem_overlap ?? 0) * 5 +
    Number(competitor.icp_overlap ?? 0) * 5
  );
}

function dedupeRankedCompetitors(competitors: RankedCompetitor[]): RankedCompetitor[] {
  const byKey = new Map<string, RankedCompetitor>();
  for (const competitor of competitors) {
    const key = finalCompetitorKey(competitor);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || rankedCompetitorQuality(competitor) > rankedCompetitorQuality(existing)) {
      byKey.set(key, competitor);
    }
  }
  return Array.from(byKey.values());
}

function sortFinalCompetitors(left: RankedCompetitor, right: RankedCompetitor): number {
  const tierDelta = (TIER_PRIORITY[left.tier] ?? 99) - (TIER_PRIORITY[right.tier] ?? 99);
  if (tierDelta !== 0) return tierDelta;
  const finalDelta = Number(right.final_score ?? 0) - Number(left.final_score ?? 0);
  if (finalDelta !== 0) return finalDelta;
  const relevanceDelta = Number(right.relevance_score ?? 0) - Number(left.relevance_score ?? 0);
  if (relevanceDelta !== 0) return relevanceDelta;
  return left.name.localeCompare(right.name);
}

function finalCompetitorOutputLimit(max?: number): number {
  return Math.min(max ?? FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MAX_COUNT);
}

function applyHybridCompositionPreservation(
  sorted: RankedCompetitor[],
  context: CompanyCompetitiveContext,
  max?: number,
): RankedCompetitor[] {
  const limit = finalCompetitorOutputLimit(max);
  const selected = sorted.slice(0, limit);
  const archetype = context.entityArchetype ?? null;
  if (!isArchetypeInfluential(archetype) || archetype?.primary_archetype !== 'HYBRID_ENTITY') return selected;
  const hasAudiencePeer = selected.some((competitor) => competitor.source === 'archetype_native_peer');
  const hasCommercialPeer = selected.some((competitor) => competitor.source !== 'archetype_native_peer' && competitor.source !== 'market_substitute');
  const nextAudiencePeer = sorted.find((competitor) => competitor.source === 'archetype_native_peer' && !selected.includes(competitor));
  const nextCommercialPeer = sorted.find((competitor) => competitor.source !== 'archetype_native_peer' && competitor.source !== 'market_substitute' && !selected.includes(competitor));
  const replacement = !hasAudiencePeer ? nextAudiencePeer : !hasCommercialPeer ? nextCommercialPeer : null;
  if (!replacement || selected.length === 0) return selected;
  const last = selected[selected.length - 1];
  if (Number(replacement.final_score ?? 0) + 0.08 < Number(last.final_score ?? 0)) return selected;
  return [...selected.slice(0, -1), replacement].sort(sortFinalCompetitors);
}

function finalCompetitorRankingPoolSize(candidateCount: number, max?: number): number {
  return Math.min(
    candidateCount,
    Math.max(max ?? FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MAX_COUNT, FINAL_COMPETITOR_MIN_COUNT * 3),
  );
}

function filterFinalCompetitorsWithAudit(params: {
  competitors: RankedCompetitor[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  feedbackMemory?: CompetitorFeedbackMemory | null;
}): RankedCompetitor[] {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const audit = {
    initial_candidates: params.competitors.length,
    removed_due_to_threshold: 0,
    removed_due_to_category: 0,
    removed_due_to_confidence: 0,
    suppressed_by_feedback: [] as string[],
    boosted_by_feedback: [] as string[],
    final_count: 0,
    debugCompetitorScoring: undefined as DebugCompetitorScoring | undefined,
  };
  const filtered: RankedCompetitor[] = [];
  const fallbackFiltered: RankedCompetitor[] = [];
  const rejected: DebugCompetitorScoring['rejected'] = [];

  for (const competitor of dedupeRankedCompetitors(params.competitors)) {
    const feedbackDecision = getCompetitorFeedbackDecision(params.feedbackMemory, competitor);
    if (feedbackDecision?.suppressed) {
      audit.suppressed_by_feedback.push(competitor.name);
      continue;
    }
    const enrichmentConfidence = Number(
      competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0,
    );
    if (!Number.isFinite(enrichmentConfidence) || enrichmentConfidence < FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE) {
      audit.removed_due_to_confidence += 1;
      rejected.push({
        company: competitor.name,
        score: competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0,
        failedDimensions: failedCompetitorDimensions(competitor),
      });
      continue;
    }
    if (!hasStrictCategoryFit(competitor, params.context)) {
      audit.removed_due_to_category += 1;
      rejected.push({
        company: competitor.name,
        score: competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0,
        failedDimensions: ['categoryFit', ...failedCompetitorDimensions(competitor)],
      });
      continue;
    }
    const gateCandidate: Partial<RankedCompetitor> = competitor;
    if (!hasPassedFinalCompetitorGate(gateCandidate, FINAL_COMPETITOR_MIN_SCORE)) {
      audit.removed_due_to_threshold += 1;
      rejected.push({
        company: gateCandidate.name ?? 'unknown',
        score: gateCandidate.score_card?.overallScore ?? gateCandidate.relevance_score ?? 0,
        failedDimensions: failedCompetitorDimensions(gateCandidate),
      });
      continue;
    }
    const boosted = applyCompetitorFeedbackBoost(competitor, feedbackDecision);
    if (boosted !== competitor) audit.boosted_by_feedback.push(competitor.name);
    if (Number(boosted.score_card?.overallScore ?? boosted.relevance_score ?? 0) >= minScore) {
      filtered.push(boosted);
    } else {
      fallbackFiltered.push(boosted);
    }
  }

  const accepted = filtered.length > 0 ? filtered : fallbackFiltered;
  const sortedCompetitors = accepted
    .sort(sortFinalCompetitors)
    .filter((competitor, _index, sorted) => {
      if (competitor.source !== 'market_substitute') return true;
      return sorted.filter((item) => item.source === 'market_substitute').indexOf(competitor) < MARKET_SUBSTITUTE_MAX_COUNT;
    });
  const finalCompetitors = applyHybridCompositionPreservation(sortedCompetitors, params.context, params.max);
  audit.final_count = finalCompetitors.length;
  if (process.env.NODE_ENV !== 'production') {
    audit.debugCompetitorScoring = { rejected };
    latestDebugCompetitorScoring = audit.debugCompetitorScoring;
  } else {
    latestDebugCompetitorScoring = undefined;
  }
  console.info('[competitor-final-filter][audit]', audit);
  console.info('[competitor-feedback][trace]', {
    suppressed_by_feedback: audit.suppressed_by_feedback,
    boosted_by_feedback: audit.boosted_by_feedback,
  });
  return finalCompetitors;
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
  const scoreCard = competitor.score_card;
  if (!scoreCard || !scoreCard.dimensions || Number(scoreCard.overallScore ?? 0) < 40) return false;
  const primaryDominance = Math.max(
    Number(scoreCard.dimensions.productServiceFit ?? 0),
    Number(scoreCard.dimensions.workflowFit ?? 0),
    Number(scoreCard.dimensions.useCaseFit ?? 0),
    Number(scoreCard.dimensions.customerEvaluationFit ?? 0),
  );
  if (primaryDominance < 40) return false;
  if (
    Number(competitor.problem_overlap ?? 0) < FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP &&
    Number(scoreCard.dimensions.workflowFit ?? 0) < 50 &&
    Number(scoreCard.dimensions.useCaseFit ?? 0) < 50
  ) return false;
  if (
    Number(competitor.icp_overlap ?? 0) < FINAL_COMPETITOR_MIN_ICP_OVERLAP &&
    Number(scoreCard.dimensions.customerEvaluationFit ?? 0) < 50
  ) return false;
  if (Number(competitor.final_score ?? 0) < FINAL_COMPETITOR_MIN_FINAL_SCORE) return false;
  if (!Number.isFinite(competitor.authority_score) || Number(competitor.authority_score) < 0) return false;
  if (!competitor.authority_signals || typeof competitor.authority_signals !== 'object') return false;
  const positioning = competitor.positioning;
  if (!positioning || typeof positioning !== 'object') return false;
  if (!['low', 'medium', 'high'].includes(String(positioning.threat_level))) return false;
  if (!Array.isArray(positioning.strengths_vs_company) || positioning.strengths_vs_company.length === 0) return false;
  if (!Array.isArray(positioning.weaknesses_vs_company) || positioning.weaknesses_vs_company.length === 0) return false;
  if (!cleanText(positioning.differentiation)) return false;
  if (isAuthorityDominatedMismatch(competitor)) return false;
  const enrichmentConfidence = Number(
    competitor.enrichment_confidence_score ?? competitor.enrichment?.confidence_score ?? 0,
  );
  if (
    !competitor.enrichment ||
    !Number.isFinite(enrichmentConfidence) ||
    enrichmentConfidence < FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE
  ) return false;
  return true;
}

function toRevalidationCandidate(candidate: CompetitorCandidate): CompetitorCandidate {
  const hasStrategicInlineEvidence = Boolean(
    cleanText(candidate.category) &&
    (cleanText(candidate.description) || cleanText(candidate.useCase) || (candidate.productSignals?.length ?? 0) > 0) &&
    (cleanText(candidate.targetCustomer) || cleanText(candidate.businessModel)),
  );
  const preserveInlineEnrichment =
    candidate.source === 'market_substitute' ||
    candidate.source === 'archetype_native_peer' ||
    (TRUSTED_SOURCES.has(candidate.source) && hasStrategicInlineEvidence);
  const revalidationCandidate = {
    ...candidate,
    name: candidate.name,
    domain: normalizeCompetitorDomain(candidate.domain ?? candidate.name),
    source: candidate.source,
    classification: candidate.classification ?? undefined,
    rationale: preserveInlineEnrichment ? candidate.rationale : undefined,
    category: preserveInlineEnrichment ? candidate.category : undefined,
    tags: preserveInlineEnrichment ? candidate.tags : undefined,
    description: preserveInlineEnrichment ? candidate.description : undefined,
    targetCustomer: preserveInlineEnrichment ? candidate.targetCustomer : undefined,
    useCase: preserveInlineEnrichment ? candidate.useCase : undefined,
    geography: preserveInlineEnrichment ? candidate.geography : undefined,
    businessModel: preserveInlineEnrichment ? candidate.businessModel : undefined,
    revenueRange: preserveInlineEnrichment ? candidate.revenueRange : undefined,
    productSignals: preserveInlineEnrichment ? candidate.productSignals : undefined,
    productType: preserveInlineEnrichment ? candidate.productType : undefined,
    scaleSignals: preserveInlineEnrichment ? candidate.scaleSignals : undefined,
    confidenceScore: preserveInlineEnrichment ? candidate.confidenceScore : undefined,
    enrichment: preserveInlineEnrichment ? candidate.enrichment : undefined,
    competitorIntelligence: preserveInlineEnrichment ? candidate.competitorIntelligence : undefined,
  };
  return preserveInlineEnrichment && !revalidationCandidate.enrichment
    ? withArchetypeEnrichment(revalidationCandidate)
    : revalidationCandidate;
}

function hasStrongNamedCompetitor(competitors: RankedCompetitor[]): boolean {
  return competitors.some((competitor) =>
    competitor.source !== 'market_substitute' &&
    Number(competitor.score_card?.overallScore ?? competitor.relevance_score ?? 0) >= 70
  );
}

function addMarketSubstitutesWhenNeeded(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  finalCompetitors: RankedCompetitor[];
  max?: number;
  includeMarketSubstitutes?: boolean;
}): CompetitorCandidate[] {
  if (params.includeMarketSubstitutes !== true) return params.candidates;
  if (params.finalCompetitors.length === 0) return params.candidates;
  if (params.finalCompetitors.length >= finalCompetitorOutputLimit(params.max)) return params.candidates;
  if (hasStrongNamedCompetitor(params.finalCompetitors)) return params.candidates;
  if (params.candidates.some((candidate) => candidate.source === 'market_substitute')) return params.candidates;
  const substitutes = inferCompetitorArchetypeCandidates(params.context, 'market_substitute');
  if (substitutes.length === 0) return params.candidates;
  console.info('[competitor-final-filter][market-substitutes-added]', {
    reason: 'no_strong_named_competitor_at_or_above_70',
    substitute_count: substitutes.length,
    substitutes: substitutes.map((candidate) => candidate.name),
  });
  return dedupeCompetitorCandidates([...params.candidates, ...substitutes]).map(toRevalidationCandidate);
}

export function splitRankedCompetitorsForOutput(
  competitors: RankedCompetitor[],
  competitorMax = FINAL_COMPETITOR_MAX_COUNT,
  alternativeMax = MARKET_SUBSTITUTE_MAX_COUNT,
): { competitors: RankedCompetitor[]; market_alternatives: RankedCompetitor[] } {
  const sorted = [...competitors].sort(sortFinalCompetitors);
  return {
    competitors: sorted
      .filter((competitor) => competitor.source !== 'market_substitute')
      .slice(0, competitorMax),
    market_alternatives: sorted
      .filter((competitor) => competitor.source === 'market_substitute')
      .slice(0, alternativeMax),
  };
}

export function buildCompetitorIntelligenceContext(
  competitors: Array<Pick<RankedCompetitor, 'name' | 'source' | 'category' | 'tier' | 'relevance_score' | 'rationale' | 'competitor_intelligence'>>,
  options?: { max?: number; includeBusinessFirst?: boolean },
): string {
  const items = competitors
    .filter((competitor) => options?.includeBusinessFirst || competitor.source === 'archetype_native_peer' || competitor.competitor_intelligence)
    .slice(0, options?.max ?? 5)
    .map((competitor) => {
      const intelligence = competitor.competitor_intelligence;
      return [
        `${competitor.name} (${competitor.source}, ${competitor.category}, ${competitor.tier}, score ${competitor.relevance_score})`,
        intelligence?.archetype_peer_category ? `peer category: ${intelligence.archetype_peer_category}` : null,
        intelligence?.audience_overlap ? `audience overlap: ${intelligence.audience_overlap}` : null,
        intelligence?.narrative_overlap ? `narrative overlap: ${intelligence.narrative_overlap}` : null,
        intelligence?.trust_model ? `trust model: ${intelligence.trust_model}` : null,
        intelligence?.publication_identity ? `publication identity: ${intelligence.publication_identity}` : null,
        intelligence?.ecosystem_role ? `ecosystem role: ${intelligence.ecosystem_role}` : null,
        intelligence?.monetization_adjacency ? `monetization adjacency: ${intelligence.monetization_adjacency}` : null,
        intelligence?.creator_operator_identity ? `creator/operator identity: ${intelligence.creator_operator_identity}` : null,
        intelligence?.educational_role ? `educational role: ${intelligence.educational_role}` : null,
        intelligence?.worldview_adjacency ? `worldview adjacency: ${intelligence.worldview_adjacency}` : null,
        intelligence?.platform_native_context ? `platform/native context: ${intelligence.platform_native_context}` : null,
      ].filter(Boolean).join('; ');
    });
  return items.join('\n');
}

export function assertCompetitorOutputPartition(
  partition: { competitors: Array<{ name?: string | null; source?: string | null }>; market_alternatives?: Array<{ name?: string | null; source?: string | null }> },
  context = 'competitor_output',
): void {
  const substituteCompetitors = partition.competitors
    .filter((competitor) => competitor.source === 'market_substitute')
    .map((competitor) => competitor.name || 'unnamed');
  if (substituteCompetitors.length > 0) {
    throw new Error(`${context}_market_substitute_in_competitors:${substituteCompetitors.join(',')}`);
  }

  const nonSubstituteAlternatives = (partition.market_alternatives ?? [])
    .filter((competitor) => competitor.source !== 'market_substitute')
    .map((competitor) => competitor.name || 'unnamed');
  if (nonSubstituteAlternatives.length > 0) {
    throw new Error(`${context}_named_competitor_in_market_alternatives:${nonSubstituteAlternatives.join(',')}`);
  }
}

export async function getFinalCompetitors(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  useNetwork?: boolean;
  useStoredCache?: boolean;
  companyId?: string | null;
  feedbackMemory?: CompetitorFeedbackMemory | null;
  includeMarketSubstitutes?: boolean;
}): Promise<RankedCompetitor[]> {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const feedbackMemory = params.feedbackMemory ?? (params.companyId
    ? await loadCompetitorFeedbackMemory({
        companyId: params.companyId,
        categories: detectedCompanyCategories(params.context),
      })
    : null);
  const candidates = dedupeCompetitorCandidates([
    ...params.candidates,
    ...buildFeedbackMissingCompetitorCandidates(feedbackMemory),
  ]).map(toRevalidationCandidate);

  const runPipeline = async (pipelineCandidates: CompetitorCandidate[]): Promise<RankedCompetitor[]> => {
    if (pipelineCandidates.length === 0) return [];
    const enriched = await enrichCompetitorCandidates({
      candidates: pipelineCandidates,
      useNetwork: params.useNetwork,
      useStoredCache: params.useStoredCache,
    });

    const ranked = rankCompetitorCandidates({
      candidates: enriched,
      context: params.context,
      max: finalCompetitorRankingPoolSize(enriched.length, params.max),
      minScore: FINAL_COMPETITOR_MIN_SCORE,
      allowTrustedBelowThreshold: false,
    });
    return filterFinalCompetitorsWithAudit({
      competitors: ranked,
      context: params.context,
      max: params.max,
      minScore,
      feedbackMemory,
    });
  };

  let finalCompetitors = await runPipeline(candidates);
  const expandedCandidates = addMarketSubstitutesWhenNeeded({
    candidates,
    context: params.context,
    finalCompetitors,
    max: params.max,
    includeMarketSubstitutes: params.includeMarketSubstitutes,
  });
  if (expandedCandidates.length !== candidates.length) {
    finalCompetitors = await runPipeline(expandedCandidates);
  } else if (candidates.length === 0) {
    finalCompetitors = await runPipeline(expandedCandidates);
  }
  return finalCompetitors;
}

export function getFinalCompetitorsSync(params: {
  candidates: CompetitorCandidate[];
  context: CompanyCompetitiveContext;
  max?: number;
  minScore?: number;
  feedbackMemory?: CompetitorFeedbackMemory | null;
  includeMarketSubstitutes?: boolean;
}): RankedCompetitor[] {
  const minScore = params.minScore ?? FINAL_COMPETITOR_MIN_SCORE;
  const candidates = dedupeCompetitorCandidates([
    ...params.candidates,
    ...buildFeedbackMissingCompetitorCandidates(params.feedbackMemory),
  ]).map(toRevalidationCandidate);
  const runPipeline = (pipelineCandidates: CompetitorCandidate[]): RankedCompetitor[] => {
    if (pipelineCandidates.length === 0) return [];
    const ranked = rankCompetitorCandidates({
      candidates: pipelineCandidates,
      context: params.context,
      max: finalCompetitorRankingPoolSize(pipelineCandidates.length, params.max),
      minScore: FINAL_COMPETITOR_MIN_SCORE,
      allowTrustedBelowThreshold: false,
    });
    return filterFinalCompetitorsWithAudit({
      competitors: ranked,
      context: params.context,
      max: params.max,
      minScore,
      feedbackMemory: params.feedbackMemory,
    });
  };

  let finalCompetitors = runPipeline(candidates);
  const expandedCandidates = addMarketSubstitutesWhenNeeded({
    candidates,
    context: params.context,
    finalCompetitors,
    max: params.max,
    includeMarketSubstitutes: params.includeMarketSubstitutes,
  });
  if (expandedCandidates.length !== candidates.length) {
    finalCompetitors = runPipeline(expandedCandidates);
  } else if (candidates.length === 0) {
    finalCompetitors = runPipeline(expandedCandidates);
  }
  return finalCompetitors;
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
