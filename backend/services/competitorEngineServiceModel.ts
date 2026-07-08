/** Competitor engine — types, gates, classification model — split from competitorEngineService.ts (barrel preserved; importers unchanged). */
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

export type ScoredCompetitor = Omit<RankedCompetitor, 'classification'> & {
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

export const TRUSTED_SOURCES = new Set<CompetitorSource>([
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
export const FINAL_COMPETITOR_MIN_PROBLEM_OVERLAP = 0.4;
export const FINAL_COMPETITOR_MIN_ICP_OVERLAP = 0.25;
export const FINAL_COMPETITOR_MIN_FINAL_SCORE = 0.4;
export const FINAL_COMPETITOR_MIN_ENRICHMENT_CONFIDENCE = 0.6;
export const FINAL_COMPETITOR_MIN_COUNT = 3;
export const FINAL_COMPETITOR_MAX_COUNT = 6;

export const HIGH_AUTHORITY_MISMATCH_AUTHORITY = 0.7;
export const HIGH_AUTHORITY_MISMATCH_PROBLEM = 0.4;

export const FINAL_BLOCKED_SOURCES = new Set<CompetitorSource>([
  'decision_evidence',
  'inferred_keyword_peer',
  'serp_unavailable_fallback',
]);

export const TIER_PRIORITY: Record<CompetitorTier, number> = {
  'Tier 1': 0,
  'Tier 2': 1,
  'Tier 3': 2,
};

export const COMPANY_SUFFIX_PATTERN = /\b(private limited|pvt ltd|pvt|limited liability company|llc|llp|incorporated|inc|ltd|limited|plc|corp|corporation|company|co|technologies|technology|solutions|services|service)\b/g;
export const UNRELATED_COMPETITOR_TEXT_PATTERN = /\b(staffing|staff augmentation|virtual employee|virtual employees|outsourc(?:e|ing)?|bpo|call center|recruit(?:ing|ment)?|hiring|logistics|freight|shipping|transportation|generic it|managed it|it services|web development services|software development services)\b/i;

const REVENUE_TIER_RANK: Record<CompetitorRevenueTier, number> = {
  startup: 0,
  growth: 1,
  scale: 2,
  enterprise: 3,
};

export const AI_FEATURE_TOKENS = new Set([
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

export const DELIVERY_MODEL_TOKENS = new Set([
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

export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function firstFromList(value?: string[] | null): string | null {
  if (!Array.isArray(value)) return null;
  return cleanText(value.find((item) => cleanText(item)) ?? null);
}

export function splitToList(value?: string | null): string[] {
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

export function domainToName(domain: string | null | undefined): string | null {
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

export function overlapRatio(candidateTokens: string[], contextTokensValue: string[]): number {
  const contextUnique = uniqueTokens(contextTokensValue);
  if (candidateTokens.length === 0 || contextUnique.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  const matches = contextUnique.filter((token) => candidateSet.has(token)).length;
  return Math.max(0, Math.min(1, matches / contextUnique.length));
}

export function boostedOverlapRatio(candidateTokens: string[], contextTokensValue: string[], boost: number): number {
  const ratio = overlapRatio(candidateTokens, contextTokensValue);
  return Math.max(ratio, ratio > 0 ? boost : 0);
}

export function roundDimension(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

export function inferSegment(value: string | null | undefined): 'b2b' | 'b2c' | 'niche' | null {
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

export function revenueAdjustment(companyTier: CompetitorRevenueTier, competitorTier: CompetitorRevenueTier): number {
  const distance = Math.abs(REVENUE_TIER_RANK[companyTier] - REVENUE_TIER_RANK[competitorTier]);
  if (distance === 0) return 1;
  if (distance === 1) return 0.85;
  if (distance === 2) return 0.7;
  return 0.6;
}

export function toPercentScore(value: number): number {
  return Math.round(roundDimension(value) * 100);
}

function scoreFromPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function competitorIntelligenceTier(score: number): CompetitorIntelligenceTier {
  if (score >= 85) return 'core';
  if (score >= 70) return 'strong';
  if (score >= 55) return 'adjacent';
  return 'strategic';
}

export function weightedCompetitorScore(dimensions: CompetitorDimensionScores): number {
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

export function buildCompanyCapabilityVector(context: CompanyCompetitiveContext): CompetitorCapabilityVector {
  return extractCapabilityVectorFromText([
    context.marketFocus,
    context.primaryService,
    context.targetCustomer,
    context.idealCustomerProfile,
    context.brandPositioning,
    context.businessModel,
  ].filter(Boolean).join(' '));
}

export function buildCandidateCapabilityVector(candidate: CompetitorCandidate): CompetitorCapabilityVector {
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

export function capabilityVectorOverlap(
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

export function discoverySourceFromCandidate(candidate: CompetitorCandidate): CompetitorDiscoverySource {
  if (candidate.source === 'manual' || candidate.source === 'user') return 'manual';
  if (candidate.source === 'website' || candidate.source === 'social') return 'stored';
  if (candidate.source === 'serp_live') return 'serp';
  if (candidate.source === 'profile_ai' || candidate.source === 'archetype_native_peer') return 'ai-inferred';
  if (candidate.source === 'known_category_dataset' || candidate.source === 'market_substitute') return 'ecosystem';
  return 'provider';
}

export function candidateDiscoverySources(candidate: CompetitorCandidate): CompetitorDiscoverySource[] {
  return Array.from(new Set([
    ...(candidate.discoverySources ?? []),
    discoverySourceFromCandidate(candidate),
  ]));
}

export function employeeScaleFitForCandidate(candidate: CompetitorCandidate, signalText: string): number {
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

export function classifyNormalizedCompetitorCategory(params: {
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
export const MEDIA_CONTENT_BRAND_SIGNALS =
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

export function competitorReasoning(params: {
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

export function failedCompetitorDimensions(competitor: Partial<RankedCompetitor>): string[] {
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

export function candidateSignalText(candidate: CompetitorCandidate, domain: string | null): string {
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

export function inferCompetitorIntelligence(candidate: CompetitorCandidate, context: CompanyCompetitiveContext): CompetitorIntelligence | null {
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

export function competitorIntelligenceText(intelligence: CompetitorIntelligence | null | undefined): string {
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

export function includesAnyToken(context: CompanyCompetitiveContext, tokens: string[]): boolean {
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

export function contextLabel(context: CompanyCompetitiveContext): string {
  return cleanText(context.marketFocus) ?? cleanText(context.primaryService) ?? 'Market peer';
}

