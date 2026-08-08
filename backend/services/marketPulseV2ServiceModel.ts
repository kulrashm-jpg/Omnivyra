/** Market Pulse V2 — types, scoring model, normalization helpers — split from marketPulseV2Service.ts (barrel preserved; importers unchanged). */
import { supabase } from '../db/supabaseClient';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { buildCompanyContext } from './companyContextService';
import { getCompanyContextIntelligence } from './companyContextIntelligenceService';
import { ownedDbTable } from '../db/writeOwner';
import { buildExecutorContext, type MarketPulseExecutorContext } from './marketPulse/executorContext';
import { adoptMarketPulseIdentity } from '@/backend/services/companyIntelligence';
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

export type LegacyConsolidatedResult = {
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

export function normalizeStringArray(value: unknown): string[] {
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

export function slugify(value: string): string {
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
  // U3·Consumer-3: Market Pulse obtains its projection-owned interpretive identity (business_model /
  // operating_model / domain_role) through the canonical seam's worldView, before the report/prompt/UI is
  // built from these settings. Flag OFF (default) ⇒ same settings, byte-identical. provider_type /
  // solution_domains / competitors are unchanged (not projection-owned here).
  const settings = adoptMarketPulseIdentity(
    (profile?.report_settings?.market_pulse ?? {}) as MarketPulseProfileSettings,
    profile,
    companyId,
    new Date().toISOString(),
  );
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

export function sourceCount(row: MarketPulseFindingRow): number | null {
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

export function mapLegacyCategory(primaryCategory?: string): string {
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

export function buildImpactType(riskLevel?: string): 'opportunity' | 'risk' | 'watch' {
  const normalized = String(riskLevel ?? '').toUpperCase();
  if (normalized === 'HIGH') return 'risk';
  if (normalized === 'MEDIUM') return 'watch';
  return 'opportunity';
}

export async function insertMarketPulseFindingWithSchemaFallback(payload: Record<string, unknown>) {
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

