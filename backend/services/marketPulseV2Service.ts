import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';
import { buildCompanyContext } from './companyContextService';
import { getCompanyContextIntelligence } from './companyContextIntelligenceService';
import { ownedDbTable } from '../db/writeOwner';
import { buildExecutorContext, type MarketPulseExecutorContext } from './marketPulse/executorContext';
import { scoreFinding } from './marketPulse/scoringService';
import { sendIntelligenceAlert } from './intelligenceAlertService';
import { computeTrust } from './marketPulse/trustScoringService';
import { generateFindingInterpretation, generateExecutiveSummary } from './marketPulse/interpretationService';
import { computeChangeSummary } from './marketPulse/changeIntelligenceService';
import {
  classifyClusterRole,
  correlateFindings,
  countContradictingPeers,
} from './marketPulse/correlationEnrichmentService';
import { bucketAlerts, classifyFindingAlert } from './marketPulse/alertClassifierService';
import { enrichFindingsCrossProduct } from './marketPulse/crossProductCorrelationService';
import { deriveEscalationLevel, evolveMemoryAfterFinding } from './marketPulse/marketMemoryEvolutionService';
import { buildExecutivePanels } from './marketPulse/executivePanelsService';
import { sendDeterministicIntelligenceAlert } from './intelligenceAlertService';
import {
  buildSignalFromFinding,
  getAdaptiveMarketPulseFeed,
  persistMarketPulseSignalForCompany,
} from './marketPulseIntelligenceService';
import {
  getMarketPulseSynthesis,
  synthesizeMarketPulseIntelligence,
} from './marketPulseSynthesisService';
import {
  getMarketPulseBusinessImpact,
  synthesizeMarketPulseBusinessImpact,
} from './marketPulseBusinessImpactService';
import {
  getMarketPulseExecutiveExperience,
  synthesizeMarketPulseExecutiveExperience,
} from './marketPulseExecutiveExperienceService';
import { getMarketPulseCollaborationContext } from './marketPulseCollaborationService';
import {
  getMarketPulseProductionHardening,
  synthesizeMarketPulseProductionHardening,
} from './marketPulseProductionHardeningService';

export const MARKET_PULSE_CATEGORIES = [
  'competitor_moves',
  'product_positioning',
  'partnerships_alliances',
  'growth_expansion',
  'hiring_talent',
  'regulatory_policy',
  'capital_business_health',
  'demand_category_momentum',
  'technology_platform_shifts',
] as const;

export type MarketPulseCategory = (typeof MARKET_PULSE_CATEGORIES)[number];

export type MarketPulseProfileSettings = {
  primary_operating_markets?: string[] | null;
  target_expansion_markets?: string[] | null;
  named_competitors?: string[] | null;
  business_model?: string | null;
  provider_type?: string | null;
  domain_role?: string | null;
  operating_model?: string | null;
  solution_domains?: string[] | null;
  competitor_details?: Array<{
    name: string;
    category?: string | null;
    tier?: string | null;
    score?: number | null;
    confidence?: number | null;
    rationale?: string | null;
  }> | null;
  competitor_quality?: {
    highest_score?: number | null;
    threshold?: number | null;
    threshold_met?: boolean | null;
    detail_mode?: 'high_confidence' | 'expanded_context' | null;
  } | null;
  market_alternatives?: Array<{
    name: string;
    category?: string | null;
    tier?: string | null;
    score?: number | null;
    confidence?: number | null;
    rationale?: string | null;
    use_case?: string | null;
    business_model?: string | null;
  }> | null;
  core_offerings?: string[] | null;
  growth_priorities?: string[] | null;
  partnership_priorities?: string[] | null;
  critical_hiring_functions?: string[] | null;
  regulatory_policy_sensitivity?: string[] | null;
  default_categories?: string[] | null;
  exclusions?: string[] | null;
  preferred_regions?: string[] | null;
  updated_at?: string | null;
};

export type MarketPulseObjective =
  | 'growth'
  | 'expansion'
  | 'hiring'
  | 'partnerships'
  | 'product'
  | 'risk';

export type MarketPulseRunInput = {
  mode: 'one_time' | 'automated';
  objective: MarketPulseObjective;
  categories: string[];
  region_scope: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom';
  custom_regions?: string[];
  competitor_scope: 'profile_only' | 'auto_discover' | 'combined';
  source_strategy?: 'ai' | 'api' | 'hybrid';
  custom_direction?: string | null;
  delivery_mode?: 'page_only' | 'daily_digest';
  credit_acknowledged?: boolean;
};

type LegacyConsolidatedResult = {
  global_topics?: Array<{
    topic: string;
    spike_reason?: string;
    risk_level?: string;
    regions?: string[];
    primary_category?: string;
    narrative_phase?: string;
    momentum_score?: number;
  }>;
  strategic_summary?: string;
  risk_alerts?: string[];
  /** Phase 1A: previously-dropped fields, now surfaced via getMarketPulseRun. */
  arbitrage_opportunities?: unknown[];
  localized_risk_pockets?: unknown[];
  region_divergence_score?: number;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function uniqueStringArray(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    )
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type MarketPulseExecutiveViewType = 'executive' | 'operational' | 'compliance' | 'workforce' | 'funding';

export async function getMarketPulseContext(
  companyId: string,
  executiveViewType: MarketPulseExecutiveViewType = 'executive',
  options?: { limit?: number; offset?: number }
) {
  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const intelligenceContext = await getCompanyContextIntelligence(companyId).catch(() => null);
  const adaptiveFeed = await getAdaptiveMarketPulseFeed(companyId, 'executive').catch(() => []);
  const synthesis = await getMarketPulseSynthesis(companyId, 'executive').catch(() => null);
  const businessImpact = await getMarketPulseBusinessImpact(companyId).catch(() => null);
  const executiveExperience = await getMarketPulseExecutiveExperience(companyId, executiveViewType).catch(() => null);
  const collaborationContext = await getMarketPulseCollaborationContext({ companyId }).catch(() => null);
  const productionHardening = await getMarketPulseProductionHardening(companyId, options).catch(() => null);
  const companyContext = buildCompanyContext(profile, { intelligence: intelligenceContext });
  const settings = (profile?.report_settings?.market_pulse ?? {}) as MarketPulseProfileSettings;
  const operatingMarkets = normalizeStringArray(settings.primary_operating_markets);
  const expansionMarkets = normalizeStringArray(settings.target_expansion_markets);
  const preferredRegions = normalizeStringArray(settings.preferred_regions);
  const excludedCategories = normalizeStringArray(settings.exclusions);
  const defaultCategories = uniqueStringArray(
    normalizeStringArray(settings.default_categories).filter(
      (category) => MARKET_PULSE_CATEGORIES.includes(category as MarketPulseCategory)
    )
  ).filter((category) => !excludedCategories.includes(category));

  // Phase 1A: stop hardcoding empty competitor arrays. Hydrate from settings
  // so both the frontend Profile-backed-defaults panel and the executor
  // (via buildExecutorContext) see the same data.
  const competitorDetails = Array.isArray(settings.competitor_details) ? settings.competitor_details : [];
  const namedCompetitors = uniqueStringArray([
    ...normalizeStringArray(settings.named_competitors),
    ...competitorDetails.map((c) => c?.name ?? ''),
  ]);

  return {
    companyId,
    profile: {
      name: profile?.name ?? null,
      industry: profile?.industry ?? null,
      industry_list: profile?.industry_list ?? [],
      geography: profile?.geography ?? null,
      geography_list: profile?.geography_list ?? [],
      competitors: null,
      competitors_list: [],
      website_url: profile?.website_url ?? null,
    },
    companyContext,
    adaptiveFeed,
    synthesis,
    businessImpact,
    executiveExperience,
    collaborationContext,
    productionHardening,
    marketPulseProfile: {
      primary_operating_markets: operatingMarkets,
      target_expansion_markets: expansionMarkets,
      named_competitors: namedCompetitors,
      business_model: settings.business_model ?? '',
      provider_type: settings.provider_type ?? '',
      domain_role: settings.domain_role ?? '',
      operating_model: settings.operating_model ?? '',
      solution_domains: normalizeStringArray(settings.solution_domains),
      competitor_details: competitorDetails,
      competitor_quality: settings.competitor_quality ?? null,
      market_alternatives: Array.isArray(settings.market_alternatives) ? settings.market_alternatives : [],
      core_offerings: normalizeStringArray(settings.core_offerings),
      growth_priorities: normalizeStringArray(settings.growth_priorities),
      partnership_priorities: normalizeStringArray(settings.partnership_priorities),
      critical_hiring_functions: normalizeStringArray(settings.critical_hiring_functions),
      regulatory_policy_sensitivity: normalizeStringArray(settings.regulatory_policy_sensitivity),
      default_categories: defaultCategories,
      exclusions: excludedCategories,
      preferred_regions: preferredRegions,
      effective_market_focus: operatingMarkets.length
        ? operatingMarkets
        : Array.isArray(profile?.geography_list) && profile.geography_list.length > 0
          ? profile.geography_list
          : profile?.geography
            ? [profile.geography]
            : [],
      effective_competitors: namedCompetitors,
      updated_at: settings.updated_at ?? null,
    },
    /**
     * Raw profile settings — preserved on the context so callers (run.ts,
     * cron) can pass them straight into `buildExecutorContext` without
     * re-loading the profile.
     */
    rawSettings: settings,
  };
}

/**
 * Build the prompt-safe + scoring-ready executor context for a resolved run.
 * Wrapping `buildExecutorContext` here keeps callers from importing the
 * marketPulse subdirectory directly.
 */
export function buildMarketPulseExecutorContext(
  context: Awaited<ReturnType<typeof getMarketPulseContext>>,
  resolvedInput: MarketPulseRunInput,
): MarketPulseExecutorContext {
  const settings = (context as { rawSettings?: MarketPulseProfileSettings | null }).rawSettings ?? null;
  return buildExecutorContext(settings, resolvedInput);
}

export async function resolveMarketPulseRunInput(companyId: string, input: MarketPulseRunInput) {
  const context = await getMarketPulseContext(companyId);
  const profileSettings = context.marketPulseProfile;
  const excludedCategories = normalizeStringArray(profileSettings.exclusions);
  const baseCategories = input.categories.length > 0
    ? input.categories
    : (profileSettings.default_categories?.length
        ? profileSettings.default_categories
        : ['competitor_moves', 'growth_expansion', 'regulatory_policy']);
  const resolvedCategories = uniqueStringArray(
    baseCategories.filter((category) => MARKET_PULSE_CATEGORIES.includes(category as MarketPulseCategory))
  ).filter((category) => !excludedCategories.includes(category));
  const fallbackCategories =
    resolvedCategories.length > 0 ? resolvedCategories : ['competitor_moves', 'growth_expansion', 'regulatory_policy'];

  const operatingMarkets = normalizeStringArray(profileSettings.primary_operating_markets);
  const expansionMarkets = normalizeStringArray(profileSettings.target_expansion_markets);
  const preferredRegions = normalizeStringArray(profileSettings.preferred_regions);
  const geographyList = normalizeStringArray(context.profile.geography_list);
  const profileGeography = context.profile.geography ? [context.profile.geography] : [];

  const resolvedRegions = uniqueStringArray(
    input.region_scope === 'custom'
      ? normalizeStringArray(input.custom_regions)
      : input.region_scope === 'expansion_markets'
        ? (expansionMarkets.length ? expansionMarkets : preferredRegions)
        : input.region_scope === 'all_defaults'
          ? [...operatingMarkets, ...expansionMarkets, ...preferredRegions]
          : operatingMarkets.length
            ? operatingMarkets
            : preferredRegions.length
              ? preferredRegions
              : geographyList.length
                ? geographyList
                : profileGeography
  );
  const fallbackRegions = resolvedRegions.length > 0 ? resolvedRegions : ['Global'];

  return {
    context,
    resolvedInput: {
      ...input,
      categories: fallbackCategories,
      custom_regions: fallbackRegions,
    },
  };
}

export async function createMarketPulseRun(
  companyId: string,
  input: MarketPulseRunInput,
  legacyJobId: string | null,
) {
  const context = await getMarketPulseContext(companyId);
  // Phase 1A: persist `rawSettings` alongside the snapshot so `syncLegacyJobIntoRun`
  // can rebuild the executor context for scoring without re-loading the
  // profile (and without race-conditions if the profile is edited mid-run).
  const rawSettings = (context as { rawSettings?: MarketPulseProfileSettings | null }).rawSettings ?? null;
  const { data, error } = await ownedDbTable('market_pulse_runs')
    .insert({
      company_id: companyId,
      mode: input.mode,
      objective: input.objective,
      categories: input.categories,
      region_scope: input.region_scope,
      custom_regions: input.custom_regions ?? [],
      competitor_scope: input.competitor_scope,
      custom_direction: input.custom_direction ?? null,
      delivery_mode: input.delivery_mode ?? 'page_only',
      credits_consumed: 0,
      status: 'pending',
      started_at: new Date().toISOString(),
      context_snapshot: {
        ...context,
        legacy_job_id: legacyJobId,
        run_input: input,
        rawSettings,
      },
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create Market Pulse run');
  }

  return data;
}

type MovementDirection = 'Emerging' | 'Growing' | 'Stable' | 'Declining' | 'Accelerating';
type MovementMomentum = 'Low' | 'Moderate' | 'High';
type MarketPulseFindingRow = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asRegions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((region) => String(region).trim()).filter(Boolean)
    : [];
}

function uniqueRegionCount(value: unknown): number {
  return new Set(asRegions(value).map((region) => region.toLowerCase())).size;
}

function confidenceComponents(row: MarketPulseFindingRow): Record<string, unknown> {
  const breakdown = row.confidence_breakdown;
  if (!breakdown || typeof breakdown !== 'object') return {};
  const components = (breakdown as Record<string, unknown>).components;
  return components && typeof components === 'object'
    ? (components as Record<string, unknown>)
    : {};
}

function sourceCount(row: MarketPulseFindingRow): number | null {
  return asNumber(row.source_count) ?? asNumber(confidenceComponents(row).source_count);
}

function mentionCount(row: MarketPulseFindingRow): number | null {
  const components = confidenceComponents(row);
  return asNumber(components.mention_count)
    ?? asNumber(components.mentions_count)
    ?? asNumber(components.mention_volume)
    ?? asNumber(row.mention_count)
    ?? asNumber(row.mention_volume);
}

function explicitRoleSourceCount(row: MarketPulseFindingRow, role: 'analyst' | 'competitor'): number {
  const sources = row.sources_json;
  if (!Array.isArray(sources)) return 0;

  const matched = new Set<string>();
  sources.forEach((source, index) => {
    if (!source || typeof source !== 'object') return;
    const record = source as Record<string, unknown>;
    const text = ['role', 'source_role', 'source_type', 'type', 'kind', 'category', 'label']
      .map((field) => record[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase();
    if (!text.includes(role)) return;
    matched.add(String(record.id ?? record.url ?? record.name ?? record.title ?? index));
  });

  return matched.size;
}

const TIER_RANK_FOR_MOVEMENT: Record<string, number> = { P0: 3, P1: 2, P2: 1 };

function tierRank(row: MarketPulseFindingRow): number {
  const tier = typeof row.priority_tier === 'string' ? row.priority_tier : '';
  return TIER_RANK_FOR_MOVEMENT[tier] ?? 0;
}

function rowCreatedAtMs(row: MarketPulseFindingRow): number | null {
  const createdAt = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : NaN;
  return Number.isFinite(createdAt) ? createdAt : null;
}

function movementLine(label: string, current: number, previous: number, unit: string): string | null {
  const delta = current - previous;
  if (delta === 0) return null;
  const direction = delta > 0 ? 'increased' : 'decreased';
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${label} ${direction} by ${Math.abs(delta)} ${unit}${Math.abs(delta) === 1 ? '' : 's'}`;
}

function buildMovementSummary(
  current: MarketPulseFindingRow,
  previous: MarketPulseFindingRow | null,
): {
  direction: MovementDirection;
  momentum: MovementMomentum;
  changes: string[];
  first_observation: boolean;
  compared_to_finding_id: string | null;
} {
  if (!previous) {
    return {
      direction: 'Emerging',
      momentum: 'Low',
      changes: ['First observation.'],
      first_observation: true,
      compared_to_finding_id: null,
    };
  }

  const changes: string[] = [];
  const currentSourceCount = sourceCount(current);
  const previousSourceCount = sourceCount(previous);
  const currentMentionCount = mentionCount(current);
  const previousMentionCount = mentionCount(previous);
  const currentRegionCount = uniqueRegionCount(current.regions);
  const previousRegionCount = uniqueRegionCount(previous.regions);
  const currentCompetitorCount = explicitRoleSourceCount(current, 'competitor');
  const previousCompetitorCount = explicitRoleSourceCount(previous, 'competitor');
  const tierDelta = tierRank(current) - tierRank(previous);

  const sourceLine = currentSourceCount !== null && previousSourceCount !== null
    ? movementLine('Source count', currentSourceCount, previousSourceCount, 'source')
    : null;
  if (sourceLine) changes.push(sourceLine);

  const regionLine = movementLine('Geographic spread', currentRegionCount, previousRegionCount, 'region');
  if (regionLine) changes.push(regionLine);

  const competitorLine = movementLine('Competitor references', currentCompetitorCount, previousCompetitorCount, 'reference');
  if (competitorLine) changes.push(competitorLine);

  const mentionLine = currentMentionCount !== null && previousMentionCount !== null
    ? movementLine('Mention volume', currentMentionCount, previousMentionCount, 'mention')
    : null;
  if (mentionLine) changes.push(mentionLine);

  if (tierDelta > 0) changes.push('↑ Priority tier escalated');
  if (tierDelta < 0) changes.push('↓ Priority tier softened');
  if (changes.length === 0) changes.push('No measurable change from previous observation.');

  const positiveSignals = [
    currentSourceCount !== null && previousSourceCount !== null && currentSourceCount > previousSourceCount,
    currentMentionCount !== null && previousMentionCount !== null && currentMentionCount > previousMentionCount,
    currentRegionCount > previousRegionCount,
    currentCompetitorCount > previousCompetitorCount,
    tierDelta > 0,
  ].filter(Boolean).length;
  const negativeSignals = [
    currentSourceCount !== null && previousSourceCount !== null && currentSourceCount < previousSourceCount,
    currentMentionCount !== null && previousMentionCount !== null && currentMentionCount < previousMentionCount,
    currentRegionCount < previousRegionCount,
    currentCompetitorCount < previousCompetitorCount,
    tierDelta < 0,
  ].filter(Boolean).length;

  const trajectory = typeof current.trajectory === 'string' ? current.trajectory : null;
  const escalationLevel = typeof current.escalation_level === 'string' ? current.escalation_level : null;
  const direction: MovementDirection =
    trajectory === 'accelerating' || escalationLevel === 'escalating_pattern' || (tierDelta > 0 && positiveSignals >= 2)
      ? 'Accelerating'
      : positiveSignals > negativeSignals
        ? 'Growing'
        : negativeSignals > positiveSignals
          ? 'Declining'
          : 'Stable';

  const momentum: MovementMomentum =
    direction === 'Accelerating' || positiveSignals >= 3
      ? 'High'
      : direction === 'Growing' || positiveSignals >= 1 || negativeSignals >= 1
        ? 'Moderate'
        : 'Low';

  return {
    direction,
    momentum,
    changes: changes.slice(0, 4),
    first_observation: false,
    compared_to_finding_id: typeof previous.id === 'string' ? previous.id : null,
  };
}

async function attachMovementSummaries(
  findings: MarketPulseFindingRow[],
  companyId: string,
  runId: string,
): Promise<MarketPulseFindingRow[]> {
  const keys = Array.from(new Set(
    findings
      .map((finding) => typeof finding.canonical_event_key === 'string' ? finding.canonical_event_key : '')
      .filter(Boolean),
  ));
  if (keys.length === 0) {
    return findings.map((finding) => ({
      ...finding,
      movement_summary: buildMovementSummary(finding, null),
    }));
  }

  const { data: previousRows, error } = await ownedDbTable('market_pulse_findings')
    .select('*')
    .eq('company_id', companyId)
    .neq('run_id', runId)
    .in('canonical_event_key', keys)
    .order('created_at', { ascending: false });

  if (error) {
    return findings.map((finding) => ({
      ...finding,
      movement_summary: buildMovementSummary(finding, null),
    }));
  }

  const previousRowsByKey = new Map<string, MarketPulseFindingRow[]>();
  for (const row of (previousRows ?? []) as MarketPulseFindingRow[]) {
    const key = typeof row.canonical_event_key === 'string' ? row.canonical_event_key : '';
    if (!key) continue;
    const rows = previousRowsByKey.get(key) ?? [];
    rows.push(row);
    previousRowsByKey.set(key, rows);
  }

  return findings.map((finding) => {
    const key = typeof finding.canonical_event_key === 'string' ? finding.canonical_event_key : '';
    const currentCreatedAt = rowCreatedAtMs(finding);
    const previous = key
      ? (previousRowsByKey.get(key) ?? []).find((row) => {
          const previousCreatedAt = rowCreatedAtMs(row);
          return currentCreatedAt === null || previousCreatedAt === null || previousCreatedAt < currentCreatedAt;
        }) ?? null
      : null;
    return {
      ...finding,
      movement_summary: buildMovementSummary(finding, previous),
    };
  });
}

function summarizeFindingForDelta(row: MarketPulseFindingRow): { id: string | null; title: string; canonical_event_key: string | null; category: string | null } {
  return {
    id: typeof row.id === 'string' ? row.id : null,
    title: typeof row.title === 'string' && row.title.trim() ? row.title : 'Untitled signal',
    canonical_event_key: typeof row.canonical_event_key === 'string' ? row.canonical_event_key : null,
    category: typeof row.category === 'string' ? row.category : null,
  };
}

async function buildMarketDeltaSummary(
  run: Record<string, unknown>,
  currentFindings: MarketPulseFindingRow[],
  companyId: string,
): Promise<{
  baseline: boolean;
  previous_run_id: string | null;
  market_direction: 'Expanding' | 'Stable' | 'Shifting' | 'Volatile';
  new_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category: string | null }>;
  strengthening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category: string | null }>;
  weakening_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category: string | null }>;
  retired_signals: Array<{ id: string | null; title: string; canonical_event_key: string | null; category: string | null }>;
}> {
  const currentCreatedAt = typeof run.created_at === 'string' ? run.created_at : new Date().toISOString();
  const { data: previousRun } = await ownedDbTable('market_pulse_runs')
    .select('id, created_at')
    .eq('company_id', companyId)
    .in('status', ['completed', 'completed_with_warnings'])
    .lt('created_at', currentCreatedAt)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!previousRun?.id) {
    return {
      baseline: true,
      previous_run_id: null,
      market_direction: 'Stable',
      new_signals: [],
      strengthening_signals: [],
      weakening_signals: [],
      retired_signals: [],
    };
  }

  const { data: previousFindings } = await ownedDbTable('market_pulse_findings')
    .select('*')
    .eq('run_id', previousRun.id);

  const previousByKey = new Map<string, MarketPulseFindingRow>();
  for (const row of (previousFindings ?? []) as MarketPulseFindingRow[]) {
    const key = typeof row.canonical_event_key === 'string' ? row.canonical_event_key : '';
    if (key && !previousByKey.has(key)) previousByKey.set(key, row);
  }

  const currentByKey = new Map<string, MarketPulseFindingRow>();
  for (const row of currentFindings) {
    const key = typeof row.canonical_event_key === 'string' ? row.canonical_event_key : '';
    if (key && !currentByKey.has(key)) currentByKey.set(key, row);
  }

  const newSignals: MarketPulseFindingRow[] = [];
  const strengtheningSignals: MarketPulseFindingRow[] = [];
  const weakeningSignals: MarketPulseFindingRow[] = [];

  for (const row of currentFindings) {
    const key = typeof row.canonical_event_key === 'string' ? row.canonical_event_key : '';
    const movement = row.movement_summary && typeof row.movement_summary === 'object'
      ? (row.movement_summary as { direction?: string; momentum?: string; first_observation?: boolean })
      : null;
    const previous = key ? previousByKey.get(key) ?? null : null;
    if (!previous || movement?.first_observation) {
      newSignals.push(row);
      continue;
    }

    const tierDelta = tierRank(row) - tierRank(previous);
    if (tierDelta > 0 || movement?.direction === 'Growing' || movement?.direction === 'Accelerating' || movement?.momentum === 'High') {
      strengtheningSignals.push(row);
    } else if (tierDelta < 0 || movement?.direction === 'Declining') {
      weakeningSignals.push(row);
    }
  }

  const retiredSignals = Array.from(previousByKey.entries())
    .filter(([key]) => !currentByKey.has(key))
    .map(([, row]) => row);

  const expansionPressure = newSignals.length + strengtheningSignals.length;
  const contractionPressure = weakeningSignals.length + retiredSignals.length;
  const marketDirection =
    expansionPressure > 0 && contractionPressure > 0
      ? 'Volatile'
      : expansionPressure > contractionPressure
        ? 'Expanding'
        : contractionPressure > expansionPressure
          ? 'Shifting'
          : 'Stable';

  return {
    baseline: false,
    previous_run_id: previousRun.id as string,
    market_direction: marketDirection,
    new_signals: newSignals.map(summarizeFindingForDelta),
    strengthening_signals: strengtheningSignals.map(summarizeFindingForDelta),
    weakening_signals: weakeningSignals.map(summarizeFindingForDelta),
    retired_signals: retiredSignals.map(summarizeFindingForDelta),
  };
}

export async function getMarketPulseRun(runId: string, companyId: string) {
  const { data: run, error } = await ownedDbTable('market_pulse_runs')
    .select('*')
    .eq('id', runId)
    .eq('company_id', companyId)
    .single();

  if (error || !run) {
    throw new Error(error?.message || 'Market Pulse run not found');
  }

  const { data: findings } = await ownedDbTable('market_pulse_findings')
    .select('*')
    .eq('run_id', runId)
    .order('relevance_score', { ascending: false });
  const findingsWithMovement = await attachMovementSummaries(
    (findings ?? []) as MarketPulseFindingRow[],
    companyId,
    runId,
  );
  const marketDeltaSummary = await buildMarketDeltaSummary(
    run as Record<string, unknown>,
    findingsWithMovement,
    companyId,
  );

  const legacyJob = run?.context_snapshot?.legacy_job ?? null;
  const consolidated = (legacyJob?.consolidated_result ?? null) as
    | (LegacyConsolidatedResult & {
        arbitrage_opportunities?: unknown[];
        localized_risk_pockets?: unknown[];
        region_divergence_score?: number;
      })
    | null;

  // Phase 1B: passthrough run-level intelligence persisted by syncLegacyJobIntoRun.
  const runRow = run as Record<string, unknown>;

  return {
    run: {
      ...run,
      progress_stage: legacyJob?.progress_stage ?? null,
      confidence_index: typeof legacyJob?.confidence_index === 'number' ? legacyJob.confidence_index : null,
      legacy_status: legacyJob?.status ?? null,
      legacy_error: legacyJob?.error ?? null,
      // Phase 1A: surface previously-dropped consolidator outputs so the UI
      // can render the executive summary, regional intelligence, and risk
      // alerts that the legacy pipeline already produced.
      strategic_summary: consolidated?.strategic_summary ?? null,
      risk_alerts: Array.isArray(consolidated?.risk_alerts) ? consolidated.risk_alerts : [],
      arbitrage_opportunities: Array.isArray(consolidated?.arbitrage_opportunities)
        ? consolidated.arbitrage_opportunities
        : [],
      localized_risk_pockets: Array.isArray(consolidated?.localized_risk_pockets)
        ? consolidated.localized_risk_pockets
        : [],
      region_divergence_score: typeof consolidated?.region_divergence_score === 'number'
        ? consolidated.region_divergence_score
        : null,
      // Phase 1B: run-level intelligence layer outputs.
      executive_summary: (runRow.executive_summary as string | null) ?? null,
      top_takeaways: Array.isArray(runRow.top_takeaways) ? (runRow.top_takeaways as string[]) : [],
      immediate_attention_items: Array.isArray(runRow.immediate_attention_items)
        ? (runRow.immediate_attention_items as Array<{ finding_id: string | null; title: string; reason: string; priority_tier: string }>)
        : [],
      strategic_shift_assessment: (runRow.strategic_shift_assessment as string | null) ?? null,
      market_direction: (runRow.market_direction as 'expanding' | 'contracting' | 'mixed' | 'stable' | null) ?? null,
      opportunity_pressure: typeof runRow.opportunity_pressure === 'number' ? (runRow.opportunity_pressure as number) : null,
      risk_pressure: typeof runRow.risk_pressure === 'number' ? (runRow.risk_pressure as number) : null,
      change_summary: (runRow.change_summary as Record<string, unknown> | null) ?? null,
      prior_run_id: (runRow.prior_run_id as string | null) ?? null,
      market_delta_summary: marketDeltaSummary,
      // Phase 2 executive panels.
      momentum_overview: (runRow.momentum_overview as Record<string, unknown> | null) ?? null,
      category_acceleration: (runRow.category_acceleration as Record<string, unknown> | null) ?? null,
      competitor_pressure: (runRow.competitor_pressure as Record<string, unknown> | null) ?? null,
      escalation_timeline: (runRow.escalation_timeline as Record<string, unknown> | null) ?? null,
      propagation_map: (runRow.propagation_map as Record<string, unknown> | null) ?? null,
      trend_persistence: (runRow.trend_persistence as Record<string, unknown> | null) ?? null,
    },
    findings: findingsWithMovement,
  };
}

function mapLegacyCategory(primaryCategory?: string): string {
  const normalized = String(primaryCategory ?? '').toUpperCase();
  switch (normalized) {
    case 'COMPETITOR_INTELLIGENCE':
      return 'competitor_moves';
    case 'BUYING_INTENT':
      return 'demand_category_momentum';
    case 'REGIONAL_SIGNAL':
      return 'growth_expansion';
    case 'SEASONAL_SIGNAL':
      return 'demand_category_momentum';
    case 'INFLUENCER_ACTIVITY':
      return 'partnerships_alliances';
    case 'MARKET_TREND':
    default:
      return 'technology_platform_shifts';
  }
}

function buildImpactType(riskLevel?: string): 'opportunity' | 'risk' | 'watch' {
  const normalized = String(riskLevel ?? '').toUpperCase();
  if (normalized === 'HIGH') return 'risk';
  if (normalized === 'MEDIUM') return 'watch';
  return 'opportunity';
}

async function insertMarketPulseFindingWithSchemaFallback(payload: Record<string, unknown>) {
  const retryPayload = { ...payload };
  const droppedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await ownedDbTable('market_pulse_findings')
      .insert(retryPayload)
      .select('id')
      .single();

    if (!error && data) return { data, error: null, droppedColumns };

    const missingColumn = String(error?.message ?? '').match(/Could not find the '([^']+)' column/)?.[1];
    if (!missingColumn || !(missingColumn in retryPayload)) {
      return { data: null, error, droppedColumns };
    }

    delete retryPayload[missingColumn];
    droppedColumns.push(missingColumn);
  }

  return {
    data: null,
    error: new Error(`Market Pulse finding insert exceeded schema fallback attempts; dropped ${droppedColumns.join(', ')}`),
    droppedColumns,
  };
}

function buildWhyItMatters(
  title: string,
  summary: string,
  objective: MarketPulseObjective,
  regions: string[],
): string {
  const regionText = regions.length > 0 ? ` in ${regions.join(', ')}` : '';
  return `This signal matters for ${objective}${regionText} because ${summary || title.toLowerCase()} may change timing, positioning, or execution decisions.`;
}

function buildRecommendedAction(
  impactType: 'opportunity' | 'risk' | 'watch',
  objective: MarketPulseObjective,
): string {
  if (impactType === 'risk') {
    return `Review this with a ${objective}-focused lens and decide whether timing, market entry, hiring, or messaging should be adjusted.`;
  }
  if (impactType === 'watch') {
    return `Track this signal over the next few days and confirm whether it materially affects your ${objective} plans.`;
  }
  return `Evaluate whether this creates a stronger opening for your current ${objective} priorities and act if it aligns.`;
}

function findingHash(title: string, summary: string, category: string, regions: string[]): string {
  return `${slugify(title)}::${slugify(summary)}::${category}::${regions.join('|').toLowerCase()}`;
}

async function upsertMemory(
  companyId: string,
  canonicalEventKey: string,
  latestFindingHash: string,
  changeStatus: 'new' | 'updated' | 'unchanged' | 'resolved',
) {
  const { data: existing } = await ownedDbTable('market_pulse_memory')
    .select('*')
    .eq('company_id', companyId)
    .eq('canonical_event_key', canonicalEventKey)
    .maybeSingle();

  if (!existing) {
    await ownedDbTable('market_pulse_memory').insert({
      company_id: companyId,
      canonical_event_key: canonicalEventKey,
      latest_finding_hash: latestFindingHash,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      last_change_status: changeStatus,
      times_seen: 1,
      is_resolved: changeStatus === 'resolved',
    });
    return;
  }

  const nextStatus =
    existing.latest_finding_hash === latestFindingHash && changeStatus !== 'resolved'
      ? 'unchanged'
      : changeStatus;

  await ownedDbTable('market_pulse_memory')
    .update({
      latest_finding_hash: latestFindingHash,
      last_seen_at: new Date().toISOString(),
      last_change_status: nextStatus,
      times_seen: Number(existing.times_seen ?? 0) + 1,
      is_resolved: nextStatus === 'resolved',
    })
    .eq('id', existing.id);
}

export async function syncLegacyJobIntoRun(runId: string, companyId: string) {
  const { run, findings } = await getMarketPulseRun(runId, companyId);
  if ((findings?.length ?? 0) > 0) return { run, findings };

  const legacyJobId = String(run.context_snapshot?.legacy_job_id ?? '').trim();
  if (!legacyJobId) return { run, findings };

  const { data: legacyJob } = await ownedDbTable('market_pulse_jobs_v1')
    .select('*')
    .eq('id', legacyJobId)
    .single();

  if (!legacyJob) return { run, findings };

  const legacyStatus = String(legacyJob.status ?? '').toLowerCase();
  const nextStatus =
    legacyStatus === 'completed_with_warnings'
      ? 'completed_with_warnings'
      : legacyStatus === 'completed'
        ? 'completed'
        : legacyStatus === 'failed'
          ? 'failed'
          : legacyStatus === 'running'
            ? 'running'
            : 'pending';

  await ownedDbTable('market_pulse_runs')
    .update({
      status: nextStatus,
      error: legacyJob.error ?? null,
      completed_at: legacyJob.completed_at ?? null,
      context_snapshot: {
        ...(run.context_snapshot ?? {}),
        legacy_job: legacyJob,
      },
    })
    .eq('id', runId);

  if (!['completed', 'completed_with_warnings'].includes(nextStatus)) {
    return getMarketPulseRun(runId, companyId);
  }

  const consolidated = (legacyJob.consolidated_result ?? {}) as LegacyConsolidatedResult;
  const globalTopics = Array.isArray(consolidated.global_topics) ? consolidated.global_topics : [];
  const objective = String(run.objective ?? 'growth') as MarketPulseObjective;

  // Phase 1A: source the executor context that produced this run so the
  // scoring service can compute company alignment + priority tiers.
  // Stored under `context_snapshot.run_input` + `context_snapshot.rawSettings`
  // by createMarketPulseRun. Re-derive defensively if either is missing.
  const snapshotInput = (run.context_snapshot?.run_input ?? null) as MarketPulseRunInput | null;
  const snapshotRawSettings = (run.context_snapshot?.rawSettings ?? null) as MarketPulseProfileSettings | null;
  let executorContext: MarketPulseExecutorContext | null = null;
  if (snapshotInput) {
    try {
      executorContext = buildExecutorContext(snapshotRawSettings, snapshotInput);
    } catch {
      executorContext = null;
    }
  }

  // Phase 1B: multi-pass enrichment.
  //   Pass 1 — collect raw + score every topic, snapshot memory.times_seen
  //   Pass 2 — correlate findings against each other + classify cluster role
  //   Pass 3 — compute trust + interpretation + alert classification, INSERT
  //   Pass 4 — compute change summary (reads from inserted rows + prior run)
  //   Pass 5 — synthesize executive summary, persist on run row
  //   Pass 6 — bucket alerts by class, dispatch via existing alert service

  type PreliminaryFinding = {
    canonicalEventKey: string;
    title: string;
    summary: string;
    category: string;
    regions: string[];
    impactType: 'opportunity' | 'risk' | 'watch';
    narrative_phase: string | null;
    shelf_life_days: number | null;
    momentum_score: number | null;
    itemHash: string;
    priorMemory: {
      times_seen: number;
      first_seen_at: string | null;
      latest_finding_hash: string | null;
    } | null;
    changeStatus: 'new' | 'updated' | 'unchanged' | 'resolved';
    scored: ReturnType<typeof scoreFinding>;
  };

  const preliminary: PreliminaryFinding[] = [];

  // ── PASS 1: score + snapshot memory ─────────────────────────────────────────
  for (const topic of globalTopics) {
    const title = String(topic.topic ?? '').trim();
    if (!title) continue;
    const summary = String(topic.spike_reason ?? '').trim() || 'Relevant market movement detected.';
    const regions = normalizeStringArray(topic.regions);
    const category = mapLegacyCategory(topic.primary_category);
    const impactType = buildImpactType(topic.risk_level);
    const canonicalEventKey = slugify(`${title}-${regions.join('-') || 'global'}`);
    const itemHash = findingHash(title, summary, category, regions);

    const { data: memory } = await ownedDbTable('market_pulse_memory')
      .select('times_seen, first_seen_at, latest_finding_hash')
      .eq('company_id', companyId)
      .eq('canonical_event_key', canonicalEventKey)
      .maybeSingle();

    const priorMemory = memory
      ? {
          times_seen: Number(memory.times_seen ?? 0),
          first_seen_at: (memory.first_seen_at as string | null) ?? null,
          latest_finding_hash: (memory.latest_finding_hash as string | null) ?? null,
        }
      : null;

    const changeStatus: 'new' | 'updated' | 'unchanged' | 'resolved' =
      !priorMemory
        ? 'new'
        : priorMemory.latest_finding_hash === itemHash
          ? 'unchanged'
          : 'updated';

    const scored = scoreFinding({
      topic: {
        title,
        summary,
        momentum_score: typeof topic.momentum_score === 'number' ? topic.momentum_score : null,
        risk_level: topic.risk_level ?? null,
        regions,
        primary_category: topic.primary_category ?? null,
        narrative_phase: topic.narrative_phase ?? null,
      },
      run: {
        confidence_index: typeof legacyJob.confidence_index === 'number' ? legacyJob.confidence_index : null,
        started_at: (run as { started_at?: string | null }).started_at ?? null,
        objective,
      },
      category,
      impactType,
      companyContext: executorContext,
    });

    preliminary.push({
      canonicalEventKey,
      title,
      summary,
      category,
      regions,
      impactType,
      narrative_phase: topic.narrative_phase ?? null,
      shelf_life_days: typeof (topic as unknown as { shelf_life_days?: number }).shelf_life_days === 'number'
        ? (topic as unknown as { shelf_life_days: number }).shelf_life_days
        : null,
      momentum_score: typeof topic.momentum_score === 'number' ? topic.momentum_score : null,
      itemHash,
      priorMemory,
      changeStatus,
      scored,
    });
  }

  // ── PASS 2: correlate (canonical_event_key as the join key) ─────────────────
  // Build mention indices once for efficient contradiction counting.
  const competitorTokenized = (executorContext?.named_competitors ?? []).map((c) => ({
    name: c.toLowerCase(),
    tokens: new Set(
      c.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 2),
    ),
  }));
  function mentionedCompetitorsFor(text: string): Set<string> {
    if (competitorTokenized.length === 0) return new Set();
    const tokens = new Set(
      text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 2),
    );
    const out = new Set<string>();
    for (const c of competitorTokenized) {
      if (c.tokens.size === 0) continue;
      let hit = 0;
      for (const t of c.tokens) if (tokens.has(t)) hit++;
      if (hit / c.tokens.size >= 0.5) out.add(c.name);
    }
    return out;
  }

  const corrInputs = preliminary.map((p) => ({
    id: p.canonicalEventKey,
    title: p.title,
    summary: p.summary,
    category: p.category,
    regions: p.regions,
  }));

  const edgesByKey = correlateFindings(corrInputs, executorContext, { maxEdgesPerFinding: 4 });

  const competitorMentionsByKey = new Map<string, Set<string>>();
  for (const p of preliminary) {
    competitorMentionsByKey.set(p.canonicalEventKey, mentionedCompetitorsFor(`${p.title} ${p.summary}`));
  }

  const contradictionInputs = preliminary.map((p) => ({
    id: p.canonicalEventKey,
    impactType: p.impactType,
    category: p.category,
    regions: p.regions,
    competitorMentions: competitorMentionsByKey.get(p.canonicalEventKey) ?? new Set<string>(),
  }));

  // ── PASS 2.5 (Phase 2): cross-product correlation enrichment ────────────────
  // Pulls cross-run + cross-product evidence (intelligence_signals,
  // signal_clusters, historical findings) and upgrades cluster_role with
  // 'emerging_market_shift' / 'coordinated_competitor_movement' classifications.
  const inRunClusterRoleByKey = new Map<
    string,
    'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly'
  >();
  for (const p of preliminary) {
    const cluster = classifyClusterRole(
      {
        id: p.canonicalEventKey,
        title: p.title,
        summary: p.summary,
        category: p.category,
        regions: p.regions,
        timesSeenPrior: p.priorMemory?.times_seen ?? 0,
        impactType: p.impactType,
        relevanceScore: p.scored.relevance_score,
      },
      preliminary.map((q) => ({
        id: q.canonicalEventKey,
        title: q.title,
        summary: q.summary,
        category: q.category,
        regions: q.regions,
        impactType: q.impactType,
      })),
      edgesByKey.get(p.canonicalEventKey) ?? [],
    );
    inRunClusterRoleByKey.set(p.canonicalEventKey, cluster.cluster_role);
  }

  let crossProductBatch: Awaited<ReturnType<typeof enrichFindingsCrossProduct>> | null = null;
  try {
    crossProductBatch = await enrichFindingsCrossProduct({
      companyId,
      currentRunId: runId,
      findings: preliminary.map((p) => ({
        canonicalEventKey: p.canonicalEventKey,
        title: p.title,
        summary: p.summary,
        category: p.category,
        regions: p.regions,
        impactType: p.impactType,
      })),
      competitorMentionsByKey,
      inRunClusterRoleByKey,
    });
  } catch {
    crossProductBatch = null;
  }

  // ── PASS 3: trust + interpretation + alert classification + INSERT ──────────
  const insertedSummaries: Array<{
    finding_id: string;
    canonicalEventKey: string;
    title: string;
    category: string;
    impactType: 'opportunity' | 'risk' | 'watch';
    priority_tier: 'P0' | 'P1' | 'P2';
    confidence_score: number;
    relevance_score: number;
    evidence_strength: number;
    company_alignment_score: number;
    change_status: 'new' | 'updated' | 'unchanged' | 'resolved';
    regions: string[];
    mentioned_competitors: string[];
    mentioned_regulatory: string[];
    narrative_phase: string | null;
    // Phase 2 fields
    escalation_level?: 'first_occurrence' | 'repeated' | 'escalating_pattern' | 'market_wide_propagation';
    cluster_role?: 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly' | 'emerging_market_shift' | 'coordinated_competitor_movement';
    trajectory?: 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable' | null;
  }> = [];

  for (const p of preliminary) {
    const edges = edgesByKey.get(p.canonicalEventKey) ?? [];

    const contradictionCount = countContradictingPeers(
      {
        id: p.canonicalEventKey,
        impactType: p.impactType,
        category: p.category,
        regions: p.regions,
        competitorMentions: competitorMentionsByKey.get(p.canonicalEventKey),
      },
      contradictionInputs,
    );

    // Phase 2: prefer cross-product source-kind enrichment when available
    // (lets trust composite see "this finding is corroborated by 3 upstream
    // intelligence_signals" rather than just the single LLM topic).
    const enrichment = crossProductBatch?.enrichmentByKey.get(p.canonicalEventKey) ?? null;
    const sourceKinds: string[] = ['llm'];
    if ((enrichment?.related_intelligence_signal_ids.length ?? 0) > 0) sourceKinds.push('intelligence_signals');
    if ((enrichment?.cluster_signal_ids.length ?? 0) > 0) sourceKinds.push('signal_clusters');
    if ((enrichment?.historical_finding_ids.length ?? 0) > 0) sourceKinds.push('historical_findings');

    const trust = computeTrust({
      sourceCount: 1
        + (enrichment?.related_intelligence_signal_ids.length ?? 0)
        + (enrichment?.cluster_signal_ids.length ?? 0)
        + (enrichment?.historical_finding_ids.length ?? 0),
      sourceKinds,
      regions: p.regions,
      timesSeenPrior: p.priorMemory?.times_seen ?? 0,
      runStartedAt: (run as { started_at?: string | null }).started_at ?? null,
      contradictingFindingCount: contradictionCount,
    });

    // Phase 2: cluster role uses cross-product enrichment when available;
    // otherwise falls back to the in-run classification from Phase 1B.
    const cluster = enrichment
      ? {
          cluster_role: enrichment.upgraded_cluster_role ?? 'isolated',
          rationale: enrichment.cluster_role_rationale,
        }
      : classifyClusterRole(
          {
            id: p.canonicalEventKey,
            title: p.title,
            summary: p.summary,
            category: p.category,
            regions: p.regions,
            timesSeenPrior: p.priorMemory?.times_seen ?? 0,
            impactType: p.impactType,
            relevanceScore: p.scored.relevance_score,
          },
          preliminary.map((q) => ({
            id: q.canonicalEventKey,
            title: q.title,
            summary: q.summary,
            category: q.category,
            regions: q.regions,
            impactType: q.impactType,
          })),
          edges,
        );

    const interp = generateFindingInterpretation({
      title: p.title,
      summary: p.summary,
      category: p.category,
      impactType: p.impactType,
      regions: p.regions,
      narrativePhase: p.narrative_phase,
      shelfLifeDays: p.shelf_life_days,
      score: p.scored,
      executorContext,
      timesSeenPrior: p.priorMemory?.times_seen ?? 0,
    });

    // Mentioned-context lookups for the alert classifier.
    const mentionedCompetitors = Array.from(competitorMentionsByKey.get(p.canonicalEventKey) ?? new Set<string>());
    const mentionedRegulatory = (executorContext?.regulatory_policy_sensitivity ?? [])
      .filter((r) => `${p.title} ${p.summary}`.toLowerCase().includes(r.toLowerCase()));

    const { data: insertedRow, error: insertError, droppedColumns } = await insertMarketPulseFindingWithSchemaFallback({
        run_id: runId,
        company_id: companyId,
        canonical_event_key: p.canonicalEventKey,
        category: p.category,
        subtype: p.narrative_phase,
        title: p.title,
        summary: p.summary,
        regions: p.regions,
        entities: [],
        impact_type: p.impactType,
        affected_objectives: [objective],
        relevance_score: p.scored.relevance_score,
        confidence_score: p.scored.confidence_score,
        freshness_score: p.scored.freshness_score,
        priority_tier: p.scored.priority_tier,
        severity_modifier: p.scored.severity_modifier,
        company_alignment_score: p.scored.company_alignment_score,
        // Phase 1B trust composite (additive — see migration 20260634).
        evidence_strength: trust.evidence_strength,
        source_diversity_score: trust.source_diversity_score,
        freshness_factor: trust.freshness_factor,
        recurrence_factor: trust.recurrence_factor,
        region_consistency_factor: trust.region_consistency_factor,
        contradiction_factor: trust.contradiction_factor,
        confidence_breakdown: trust.breakdown,
        // Phase 1B interpretation.
        interpretation_text: interp.interpretation_text,
        strategic_implication: interp.strategic_implication,
        urgency_reason: interp.urgency_reason,
        operational_impact: interp.operational_impact,
        opportunity_window: interp.opportunity_window,
        affected_business_areas: interp.affected_business_areas,
        // Phase 1B correlation + cluster.
        correlated_findings: edges,
        cluster_role: cluster.cluster_role,
        // Phase 2: cross-product linkage — see migration 20260635.
        cluster_signal_ids: enrichment?.cluster_signal_ids ?? null,
        related_intelligence_signal_ids: enrichment?.related_intelligence_signal_ids ?? null,
        historical_finding_ids: enrichment?.historical_finding_ids ?? null,
        // Phase 1B priority explanation (one-liner so UI can show "why P0").
        priority_explanation: `${p.scored.priority_tier} (impact=${p.impactType}, conf=${Math.round(p.scored.confidence_score)}, rel=${Math.round(p.scored.relevance_score)}, align=${(p.scored.company_alignment_score * 100).toFixed(0)})`,
        why_it_matters: buildWhyItMatters(p.title, p.summary, objective, p.regions),
        recommended_action: buildRecommendedAction(p.impactType, objective),
        source_count: 1,
        sources_json: [],
        change_status: p.changeStatus,
        first_seen_at: p.priorMemory?.first_seen_at ?? new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        last_shared_at: null,
        user_action_state: 'open',
        escalation_tracking: false,
      });

    if (droppedColumns.length > 0) {
      console.warn('[market-pulse] finding insert skipped unavailable schema columns', {
        runId,
        title: p.title,
        droppedColumns,
      });
    }

    if (insertError || !insertedRow) {
      // Skip this finding but continue the loop — one bad row should not abort
      // the whole run.
      continue;
    }

    try {
      const { signal, impacts } = buildSignalFromFinding({
        title: p.title,
        summary: p.summary,
        category: p.category,
        regions: p.regions,
        impactType: p.impactType,
        confidenceScore: p.scored.confidence_score,
        freshnessScore: p.scored.freshness_score,
        momentumScore: p.momentum_score,
        canonicalEventKey: p.canonicalEventKey,
        sourceName: 'Market Pulse legacy scan',
      });
      await persistMarketPulseSignalForCompany({
        companyId,
        signal,
        impacts,
        profile: (run.context_snapshot?.profile ?? null) as Record<string, unknown> | null,
      });
      await synthesizeMarketPulseIntelligence(companyId);
      await synthesizeMarketPulseBusinessImpact(companyId);
      await synthesizeMarketPulseExecutiveExperience(companyId);
      await synthesizeMarketPulseProductionHardening(companyId);
    } catch (error) {
      console.warn('[marketpulse-intelligence] failed to persist signal relevance', (error as Error)?.message);
    }

    await upsertMemory(companyId, p.canonicalEventKey, p.itemHash, p.changeStatus);

    // ── Phase 2: market memory evolution ──────────────────────────────────────
    // Reads the just-updated memory row, computes trajectory + escalation
    // velocity + recurrence cadence + regional spread, writes longitudinal
    // columns. Returns the trajectory + escalation_level so we can persist
    // them on the finding too.
    let evolution: Awaited<ReturnType<typeof evolveMemoryAfterFinding>> | null = null;
    try {
      evolution = await evolveMemoryAfterFinding({
        companyId,
        canonicalEventKey: p.canonicalEventKey,
        current: {
          tier: p.scored.priority_tier,
          category: p.category,
          regions: p.regions,
          impactType: p.impactType,
          seenAt: new Date().toISOString(),
        },
      });
    } catch {
      evolution = null;
    }

    const escalation_level = evolution
      ? deriveEscalationLevel(evolution, p.regions.length)
      : 'first_occurrence';

    // Stamp the finding with trajectory + escalation_level (Phase 2 columns).
    if (evolution) {
      try {
        await ownedDbTable('market_pulse_findings')
          .update({
            trajectory: evolution.trajectory,
            escalation_level,
          })
          .eq('id', insertedRow.id);
      } catch {
        /* non-blocking */
      }
    }

    insertedSummaries.push({
      finding_id: insertedRow.id as string,
      canonicalEventKey: p.canonicalEventKey,
      title: p.title,
      category: p.category,
      impactType: p.impactType,
      priority_tier: p.scored.priority_tier,
      confidence_score: p.scored.confidence_score,
      relevance_score: p.scored.relevance_score,
      evidence_strength: trust.evidence_strength,
      company_alignment_score: p.scored.company_alignment_score,
      change_status: p.changeStatus,
      regions: p.regions,
      mentioned_competitors: mentionedCompetitors,
      mentioned_regulatory: mentionedRegulatory,
      narrative_phase: p.narrative_phase,
      // Phase 2 fields piped into the alert classifier in PASS 6.
      escalation_level,
      cluster_role: cluster.cluster_role,
      trajectory: evolution?.trajectory ?? null,
    });
  }

  // ── PASS 4: compute change summary (vs prior run) ───────────────────────────
  const runCreatedAt = String((run as { created_at?: string | null }).created_at ?? new Date().toISOString());
  let changeSummary: Awaited<ReturnType<typeof computeChangeSummary>> | null = null;
  try {
    changeSummary = await computeChangeSummary(companyId, runId, runCreatedAt);
  } catch {
    changeSummary = null;
  }

  // Mark each inserted finding's was_escalated using changeSummary.escalated_samples
  // for the alert classifier pass.
  const escalatedFindingIds = new Set(
    (changeSummary?.escalated_samples ?? []).map((s) => s.finding_id),
  );

  // ── PASS 5: executive summary + persist run-level intelligence ──────────────
  const exec = generateExecutiveSummary(
    insertedSummaries.map((f) => ({
      id: f.finding_id,
      title: f.title,
      category: f.category,
      impactType: f.impactType,
      priority_tier: f.priority_tier,
      confidence_score: f.confidence_score,
      relevance_score: f.relevance_score,
      evidence_strength: f.evidence_strength,
      company_alignment_score: f.company_alignment_score,
      change_status: f.change_status,
      regions: f.regions,
    })),
    {
      objective,
      region_divergence_score:
        typeof (legacyJob.region_divergence_score as number | undefined) === 'number'
          ? (legacyJob.region_divergence_score as number)
          : null,
    },
    executorContext,
  );

  // ── Phase 2: build executive panels and persist on the run row ──────────────
  let panels: Awaited<ReturnType<typeof buildExecutivePanels>> | null = null;
  try {
    panels = await buildExecutivePanels({
      companyId,
      runId,
      runCreatedAt,
      findings: insertedSummaries.map((f) => ({
        finding_id: f.finding_id,
        title: f.title,
        category: f.category,
        regions: f.regions,
        priority_tier: f.priority_tier,
        impact_type: f.impactType,
        alert_class: null, // populated post-classification in PASS 6
        mentioned_competitors: f.mentioned_competitors,
        escalation_level: f.escalation_level ?? null,
        trajectory: f.trajectory ?? null,
      })),
      executorContext,
    });
  } catch {
    panels = null;
  }

  await ownedDbTable('market_pulse_runs')
    .update({
      executive_summary: exec.executive_summary,
      top_takeaways: exec.top_takeaways,
      immediate_attention_items: exec.immediate_attention_items,
      strategic_shift_assessment: exec.strategic_shift_assessment,
      market_direction: exec.market_direction,
      opportunity_pressure: exec.opportunity_pressure,
      risk_pressure: exec.risk_pressure,
      change_summary: changeSummary,
      prior_run_id: changeSummary?.prior_run_id ?? null,
      // Phase 2 executive panels (additive — see migration 20260635).
      momentum_overview: panels?.momentum_overview ?? null,
      category_acceleration: panels?.category_acceleration ?? null,
      competitor_pressure: panels?.competitor_pressure ?? null,
      escalation_timeline: panels?.escalation_timeline ?? null,
      propagation_map: panels?.propagation_map ?? null,
      trend_persistence: panels?.trend_persistence ?? null,
    })
    .eq('id', runId);

  // ── PASS 6: classify + dispatch alerts (one per class per run) ──────────────
  // Phase 2: feeds escalation_level + cluster_role + trajectory into the
  // classifier so it can promote alerts to executive_interrupt for the
  // strongest cases (coordinated competitor movement, regulatory market
  // propagation, structural P0 shifts, opportunity breakouts).
  const classifications = insertedSummaries.map((f) => {
    const classifierInput: Parameters<typeof classifyFindingAlert>[0] = {
      finding_id: f.finding_id,
      title: f.title,
      category: f.category,
      impactType: f.impactType,
      priority_tier: f.priority_tier,
      change_status: f.change_status,
      confidence_score: f.confidence_score,
      evidence_strength: f.evidence_strength,
      company_alignment_score: f.company_alignment_score,
      was_escalated: escalatedFindingIds.has(f.finding_id),
      times_seen_prior: 0, // recurrence already factored into evidence_strength
      mentioned_competitors: f.mentioned_competitors,
      mentioned_regulatory: f.mentioned_regulatory,
      narrative_phase: f.narrative_phase,
      executorContext,
      escalation_level: f.escalation_level ?? null,
      cluster_role: f.cluster_role ?? null,
      trajectory: f.trajectory ?? null,
    };
    const classification = classifyFindingAlert(classifierInput);
    return { input: classifierInput, classification, alert_class: classification.alert_class };
  });

  // Persist alert_class on each finding (deferred-write — finding row already
  // exists, this is a one-column UPDATE per row).
  for (const c of classifications) {
    if (!c.alert_class) continue;
    await ownedDbTable('market_pulse_findings')
      .update({ alert_class: c.alert_class })
      .eq('id', c.input.finding_id);
  }

  const buckets = bucketAlerts(
    classifications
      .filter((c) => c.classification.should_alert)
      .map((c) => ({ input: c.input, classification: c.classification })),
  );

  for (const bucket of buckets) {
    try {
      const eventType = `market_pulse_${bucket.alert_class}`;
      const titlePrefix = {
        strategic_risk: 'Market Pulse — strategic risk',
        competitor_escalation: 'Market Pulse — competitor escalation',
        regulatory_exposure: 'Market Pulse — regulatory exposure',
        market_acceleration: 'Market Pulse — market acceleration',
        opportunity_breakout: 'Market Pulse — opportunity breakout',
      }[bucket.alert_class];
      const message = bucket.count === 1
        ? `${bucket.top_finding_title}`
        : `${bucket.count} qualifying findings — top: ${bucket.top_finding_title}`;
      const eventData = {
        run_id: runId,
        alert_class: bucket.alert_class,
        finding_count: bucket.count,
        top_finding_id: bucket.top_finding_id,
        top_finding_title: bucket.top_finding_title,
        member_finding_ids: bucket.member_finding_ids.slice(0, 10),
        executive_interrupt: bucket.executive_interrupt,
        interrupt_reasons: bucket.interrupt_reasons,
      };

      if (bucket.executive_interrupt) {
        // Phase 2: stronger interrupt — uses sendDeterministicIntelligenceAlert
        // with a 1h cooldown (vs the 6h default) so executive attention is not
        // delayed when a structural shift / coordinated competitor movement /
        // regulatory propagation / opportunity breakout lands.
        await sendDeterministicIntelligenceAlert({
          company_id: companyId,
          event_type: `${eventType}_interrupt`,
          rule_types: [bucket.alert_class, 'executive_interrupt'],
          title: `[INTERRUPT] ${titlePrefix}`,
          message: `${message}\n\nReason: ${bucket.interrupt_reasons.join(' · ')}`,
          event_data: eventData,
          channels: ['in_app', 'email', 'slack'],
          cooldown_hours: 1,
        });
      } else {
        await sendIntelligenceAlert({
          company_id: companyId,
          event_type: eventType,
          // Pipe through existing opportunity_high (>85) rule for dispatch —
          // sha256 dedup key includes event_type so each class has its own
          // 6-hour cooldown bucket.
          opportunity_score: Math.max(86, Math.round(bucket.top_confidence)),
          title: titlePrefix,
          message,
          event_data: eventData,
          channels: ['in_app'],
        });
      }
    } catch {
      // Alert delivery is non-blocking; findings + run-level synthesis already persisted.
    }
  }

  return getMarketPulseRun(runId, companyId);
}

export async function getAutomationSettings(companyId: string) {
  const { data } = await ownedDbTable('market_pulse_automation_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  return data ?? null;
}

export async function getMarketPulseHistory(companyId: string) {
  const { data, error } = await ownedDbTable('market_pulse_runs')
    .select('id, mode, objective, categories, status, credits_consumed, created_at, completed_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    throw new Error(error.message || 'Failed to load Market Pulse history');
  }

  return data ?? [];
}

export async function upsertAutomationSettings(companyId: string, payload: Record<string, unknown>) {
  const { data, error } = await ownedDbTable('market_pulse_automation_settings')
    .upsert({
      company_id: companyId,
      ...payload,
    }, { onConflict: 'company_id' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to save automation settings');
  }

  return data;
}

export async function deleteAutomationSettings(companyId: string) {
  const { error } = await ownedDbTable('market_pulse_automation_settings')
    .delete()
    .eq('company_id', companyId);
  if (error) {
    throw new Error(error.message || 'Failed to delete automation settings');
  }
}
