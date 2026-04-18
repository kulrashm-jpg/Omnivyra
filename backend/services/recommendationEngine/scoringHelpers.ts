import { buildCompanyStrategyDNA, type CompanyStrategyDNA } from '../companyStrategyDNAService';
import type { TrendSignalNormalized } from '../trendProcessingService';
import type { StrategicPayloadInput } from './types';

const normalizeList = (value?: string | null): string[] =>
  String(value || '')
    .split(/[,;/|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

/** Tiered extraction: strategic direction (top) → aspect → offerings → campaign focus → other. Used for weighted alignment. */
type StrategicTokenTiers = {
  strategicDirection: string[];
  aspect: string[];
  offerings: string[];
  campaignFocus: string[];
  other: string[];
};

export function extractStrategicPayloadTokensByTier(
  sp: StrategicPayloadInput | null | undefined
): StrategicTokenTiers {
  const strategicDirection: string[] = [];
  const aspect: string[] = [];
  const offerings: string[] = [];
  const campaignFocus: string[] = [];
  const other: string[] = [];
  if (!sp || typeof sp !== 'object') return { strategicDirection, aspect, offerings, campaignFocus, other };

  if (sp.strategic_text && String(sp.strategic_text).trim())
    strategicDirection.push(...normalizeList(sp.strategic_text));
  if (sp.additional_direction && String(sp.additional_direction).trim())
    strategicDirection.push(...normalizeList(sp.additional_direction));

  if (sp.selected_aspect && String(sp.selected_aspect).trim())
    aspect.push(String(sp.selected_aspect).trim());
  if (Array.isArray(sp.selected_aspects))
    sp.selected_aspects.forEach((a) => a && String(a).trim() && aspect.push(String(a).trim()));

  if (Array.isArray(sp.selected_offerings))
    sp.selected_offerings.forEach((o) => o && offerings.push(String(o).trim()));

  if (Array.isArray(sp.mapped_core_types))
    campaignFocus.push(...sp.mapped_core_types.map((s) => String(s).trim()).filter(Boolean));
  if (sp.primary_campaign_type && String(sp.primary_campaign_type).trim())
    campaignFocus.push(String(sp.primary_campaign_type).trim());
  const secondaries = sp.secondary_campaign_types as string[] | undefined;
  if (Array.isArray(secondaries))
    secondaries.forEach((s) => s && campaignFocus.push(String(s).trim()));

  if (Array.isArray(sp.focused_modules))
    sp.focused_modules.forEach((m) => m && other.push(String(m).trim()));
  const clusterInputs = sp.cluster_inputs as Array<{ problem_domain?: string }> | undefined;
  if (Array.isArray(clusterInputs)) {
    clusterInputs.forEach((c) => {
      if (c?.problem_domain && String(c.problem_domain).trim())
        other.push(String(c.problem_domain).trim());
    });
  }
  const execConfig = sp.execution_config as Record<string, unknown> | undefined;
  if (execConfig && typeof execConfig === 'object') {
    if (execConfig.target_audience && String(execConfig.target_audience).trim())
      other.push(String(execConfig.target_audience).trim());
    if (execConfig.campaign_goal && String(execConfig.campaign_goal).trim())
      other.push(String(execConfig.campaign_goal).trim());
    if (Array.isArray(execConfig.communication_style))
      execConfig.communication_style.forEach((s) => s && other.push(String(s).trim()));
    if (execConfig.content_depth && String(execConfig.content_depth).trim())
      other.push(String(execConfig.content_depth).trim());
  }
  return { strategicDirection, aspect, offerings, campaignFocus, other };
}

/** Flatten all tiers for filtering (buildCoreProblemTokens). */
export function extractStrategicPayloadTokens(sp: StrategicPayloadInput | null | undefined): string[] {
  const tiers = extractStrategicPayloadTokensByTier(sp);
  return [
    ...tiers.strategicDirection,
    ...tiers.aspect,
    ...tiers.offerings,
    ...tiers.campaignFocus,
    ...tiers.other,
  ].filter(Boolean);
}

/**
 * Baseline company identity fields used for theme alignment.
 * Always included so strategic theme cards align to company context even when
 * strategic aspect or offerings are not selected.
 */
export const BASELINE_COMPANY_CONTEXT_KEYS = [
  'industry',
  'industry_list',
  'products_services',
  'products_services_list',
  'target_audience',
  'target_audience_list',
  'category',
  'category_list',
  'campaign_focus',
  'content_themes',
  'content_themes_list',
  'authority_domains',
  'core_problem_statement',
  'pain_symptoms',
  'desired_transformation',
] as const;

export function extractBaselineCompanyTokens(profile: any): string[] {
  const raw: string[] = [];
  for (const key of BASELINE_COMPANY_CONTEXT_KEYS) {
    const val = profile?.[key];
    if (Array.isArray(val)) {
      raw.push(...val.map((s: unknown) => String(s ?? '').trim()).filter(Boolean));
    } else if (typeof val === 'string' && val.trim()) {
      raw.push(...val.split(/[,;]/).map((s) => s.trim()).filter(Boolean));
    }
  }
  return raw;
}

/** Exported for unit testing; used in pre-filter and alignment. */
export const buildCoreProblemTokens = (
  profile: any,
  strategicPayload?: StrategicPayloadInput | null
): Set<string> => {
  const raw = [
    ...extractBaselineCompanyTokens(profile ?? {}),
    ...normalizeList(profile?.campaign_focus),
    ...normalizeList(profile?.content_themes),
    ...(Array.isArray(profile?.content_themes_list) ? profile.content_themes_list : []),
    ...(Array.isArray(profile?.authority_domains) ? profile.authority_domains : []),
    ...(profile?.core_problem_statement ? normalizeList(profile.core_problem_statement) : []),
    ...(Array.isArray(profile?.pain_symptoms) ? profile.pain_symptoms.map((s: string) => String(s).trim()).filter(Boolean) : []),
    ...(profile?.desired_transformation ? normalizeList(profile.desired_transformation) : []),
    ...extractStrategicPayloadTokens(strategicPayload ?? undefined),
  ]
    .filter(Boolean)
    .map((s: string) => s.trim());
  const tokens = new Set(raw.flatMap((s: string) => tokenize(s)));
  return tokens;
};

/**
 * Returns true when the topic has at least one token matching the context set.
 * When tokens is empty (sparse profile, no strategic payload), returns true so all
 * signals pass through — a company with an incomplete profile should still get results,
 * not a blank page.
 */
export const hasOverlapWithTokens = (topic: string, tokens: Set<string>): boolean => {
  if (tokens.size === 0) return true;
  const topicTokens = tokenize(topic);
  return topicTokens.some((t) => tokens.has(t));
};

export const WEIGHT_HIGH = 3;
export const WEIGHT_MEDIUM = 2;
export const WEIGHT_LOW = 1;
/** Trend Campaign priority hierarchy: strategic direction (top) → aspect → offerings → campaign focus → other. */
export const WEIGHT_STRATEGIC_DIRECTION = 6;
export const WEIGHT_ASPECT = 5;
export const WEIGHT_OFFERINGS = 4;
export const WEIGHT_CAMPAIGN = 3;
export const WEIGHT_STRATEGIC_OTHER = 2;

export const GENERIC_TOKEN_BLACKLIST = new Set([
  'tools',
  'software',
  'platform',
  'strategies',
  'tips',
]);

export const DOWNWEIGHT_TOKENS = new Set([
  'marketing',
  'growth',
  'tech',
  'engagement',
]);

/** Exported for unit testing; used in alignment scoring. */
export const buildWeightedAlignmentTokens = (
  profile: any,
  strategicPayload?: StrategicPayloadInput | null
): Map<string, number> => {
  const map = new Map<string, number>();
  const addWithWeight = (values: string[], w: number) => {
    values.forEach((s) =>
      tokenize(s).forEach((t) => {
        if (GENERIC_TOKEN_BLACKLIST.has(t)) return;
        const effectiveWeight = DOWNWEIGHT_TOKENS.has(t) ? w * 0.5 : w;
        const current = map.get(t) ?? 0;
        if (effectiveWeight > current) map.set(t, effectiveWeight);
      })
    );
  };
  addWithWeight(normalizeList(profile?.campaign_focus), WEIGHT_HIGH);
  addWithWeight(normalizeList(profile?.content_themes), WEIGHT_MEDIUM);
  addWithWeight(normalizeList(profile?.growth_priorities), WEIGHT_MEDIUM);
  addWithWeight(normalizeList(profile?.industry), WEIGHT_LOW);
  addWithWeight(normalizeList(profile?.goals), WEIGHT_LOW);
  addWithWeight(
    (Array.isArray(profile?.content_themes_list) ? profile.content_themes_list : []).map(
      (s: string) => String(s).trim()
    ),
    WEIGHT_MEDIUM
  );
  addWithWeight(
    (Array.isArray(profile?.industry_list) ? profile.industry_list : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_LOW
  );
  addWithWeight(
    (Array.isArray(profile?.goals_list) ? profile.goals_list : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_LOW
  );
  addWithWeight(
    (Array.isArray(profile?.authority_domains) ? profile.authority_domains : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_HIGH
  );
  if (profile?.core_problem_statement) {
    addWithWeight(normalizeList(profile.core_problem_statement), WEIGHT_HIGH);
  }
  if (Array.isArray(profile?.pain_symptoms)) {
    addWithWeight(
      profile.pain_symptoms.map((s: string) => String(s).trim()).filter(Boolean),
      WEIGHT_HIGH
    );
  }
  if (profile?.desired_transformation) {
    addWithWeight(normalizeList(profile.desired_transformation), WEIGHT_HIGH);
  }
  const tiers = extractStrategicPayloadTokensByTier(strategicPayload ?? undefined);
  addWithWeight(tiers.strategicDirection, WEIGHT_STRATEGIC_DIRECTION);
  addWithWeight(tiers.aspect, WEIGHT_ASPECT);
  addWithWeight(tiers.offerings, WEIGHT_OFFERINGS);
  addWithWeight(tiers.campaignFocus, WEIGHT_CAMPAIGN);
  addWithWeight(tiers.other, WEIGHT_STRATEGIC_OTHER);
  return map;
};

export const computeAlignmentScore = (topic: string, weightedTokens: Map<string, number>): number => {
  if (weightedTokens.size === 0) return 1;
  const topicTokens = tokenize(topic);
  if (topicTokens.length === 0) return 0;
  const topicSet = new Set(topicTokens);
  let weightedOverlap = 0;
  let maxWeight = 0;
  weightedTokens.forEach((w, t) => {
    maxWeight += w;
    if (topicSet.has(t)) weightedOverlap += w;
  });
  if (maxWeight <= 0) return 1;
  return Number(Math.min(1, (weightedOverlap / maxWeight)).toFixed(4));
};

export const STRATEGY_MODIFIER_MIN = 0.85;
export const STRATEGY_MODIFIER_MAX = 1.25;

export const COMMERCIAL_TOKENS = new Set([
  'pricing',
  'revenue',
  'roi',
  'sales',
  'conversion',
  'pipeline',
  'buyer',
]);
export const AWARENESS_TOPIC_TOKENS = new Set([
  'awareness',
  'discovery',
  'introduction',
  'learn',
  'education',
]);
export const TECHNICAL_OR_AUTHORITY_TOKENS = new Set([
  'api',
  'sdk',
  'kubernetes',
  'terraform',
  'devops',
  'microservice',
  'thought',
  'leadership',
  'expertise',
  'framework',
]);

/** Strategy-aware scoring modifier. Returns value in [0.85, 1.25]. If strategyDNA missing → 1. */
export function computeStrategyModifier(
  strategyDNA: CompanyStrategyDNA | null | undefined,
  trend: TrendSignalNormalized,
  profile: any,
  opts?: { alignmentScore?: number; volumeMedian?: number; volumeMax?: number }
): number {
  if (!strategyDNA) return 1;

  const topic = String(trend.topic || '').toLowerCase();
  const topicTokens = new Set(tokenize(topic));
  const vol = Number(trend.volume ?? 0) || 0;
  const freq = trend.frequency ?? 0;
  const volumeMedian = opts?.volumeMedian ?? 0;
  const volumeMax = opts?.volumeMax ?? 1;
  const alignmentScore = opts?.alignmentScore ?? 0.5;
  const isFrequencyLow = freq <= 2;
  const isVolumeBelowMedian = volumeMedian > 0 && vol < volumeMedian;
  const isAlignmentHigh = alignmentScore >= 0.5;

  let modifier = 1;

  switch (strategyDNA.mode) {
    case 'problem_transformation': {
      const problemTokens = new Set([
        ...(profile?.core_problem_statement
          ? tokenize(String(profile.core_problem_statement))
          : []),
        ...(Array.isArray(profile?.pain_symptoms)
          ? profile.pain_symptoms.flatMap((s: string) => tokenize(s))
          : []),
        ...(profile?.desired_transformation
          ? tokenize(String(profile.desired_transformation))
          : []),
      ].filter((t) => t.length > 2));
      if (problemTokens.size > 0 && [...topicTokens].some((t) => problemTokens.has(t))) modifier += 0.15;
      if (isAlignmentHigh && (isFrequencyLow || isVolumeBelowMedian)) modifier += 0.10;
      break;
    }
    case 'authority_positioning': {
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      if (authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t))) modifier += 0.20;
      if (isFrequencyLow) modifier += 0.05;
      break;
    }
    case 'commercial_growth': {
      const hasCommercial = [...topicTokens].some((t) => COMMERCIAL_TOKENS.has(t));
      if (hasCommercial) modifier += 0.15;
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      const problemTokens = new Set([
        ...(profile?.core_problem_statement
          ? tokenize(String(profile.core_problem_statement))
          : []),
        ...(Array.isArray(profile?.pain_symptoms)
          ? profile.pain_symptoms.flatMap((s: string) => tokenize(s))
          : []),
      ].filter((t) => t.length > 2));
      const hasAuthorityOverlap = authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t));
      const hasProblemOverlap = problemTokens.size > 0 && [...topicTokens].some((t) => problemTokens.has(t));
      const isAwarenessOnly =
        !hasCommercial && !hasAuthorityOverlap && !hasProblemOverlap &&
        [...topicTokens].some((t) => AWARENESS_TOPIC_TOKENS.has(t));
      if (isAwarenessOnly) modifier -= 0.10;
      break;
    }
    case 'audience_engagement': {
      const audienceTokens = new Set(
        [
          ...(profile?.target_audience ? tokenize(String(profile.target_audience)) : []),
          ...(profile?.brand_voice ? tokenize(String(profile.brand_voice)) : []),
        ].filter((t) => t.length > 2)
      );
      if (audienceTokens.size > 0 && [...topicTokens].some((t) => audienceTokens.has(t))) modifier += 0.10;
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      const isTechnicalOrAuthorityHeavy =
        [...topicTokens].some((t) => TECHNICAL_OR_AUTHORITY_TOKENS.has(t)) ||
        (authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t)));
      if (isTechnicalOrAuthorityHeavy) modifier -= 0.05;
      break;
    }
    case 'educational_default':
    default:
      modifier = 1;
  }

  return Math.max(STRATEGY_MODIFIER_MIN, Math.min(STRATEGY_MODIFIER_MAX, modifier));
}

export const computeMedian = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const scoreByAlignmentThenPopularity = (
  signals: TrendSignalNormalized[],
  profile: any,
  strategicPayload?: StrategicPayloadInput | null
): TrendSignalNormalized[] => {
  const weightedTokens = buildWeightedAlignmentTokens(profile, strategicPayload);
  const strategyDNA = profile ? buildCompanyStrategyDNA(profile) : null;
  const volumes = signals.map((s) => Number(s.volume ?? 0) || 0);
  const volumeMax = Math.max(...volumes, 1);
  const volumeMedian = computeMedian(volumes);

  return [...signals].sort((a, b) => {
    const alignA = computeAlignmentScore(a.topic, weightedTokens);
    const alignB = computeAlignmentScore(b.topic, weightedTokens);
    const modA = computeStrategyModifier(strategyDNA, a, profile, {
      alignmentScore: alignA,
      volumeMax,
      volumeMedian,
    });
    const modB = computeStrategyModifier(strategyDNA, b, profile, {
      alignmentScore: alignB,
      volumeMax,
      volumeMedian,
    });
    const finalA = alignA * modA;
    const finalB = alignB * modB;
    if (finalB !== finalA) return finalB - finalA;
    const freqB = b.frequency ?? 0;
    const freqA = a.frequency ?? 0;
    if (freqB !== freqA) return freqB - freqA;
    const volB = b.volume ?? 0;
    const volA = a.volume ?? 0;
    return volB - volA;
  });
};
