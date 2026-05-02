import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';
import { buildCompanyContext } from './companyContextService';

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

export async function getMarketPulseContext(companyId: string) {
  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const companyContext = buildCompanyContext(profile);
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
    marketPulseProfile: {
      primary_operating_markets: operatingMarkets,
      target_expansion_markets: expansionMarkets,
      named_competitors: [],
      business_model: settings.business_model ?? '',
      provider_type: settings.provider_type ?? '',
      domain_role: settings.domain_role ?? '',
      operating_model: settings.operating_model ?? '',
      solution_domains: normalizeStringArray(settings.solution_domains),
      competitor_details: Array.isArray(settings.competitor_details) ? settings.competitor_details : [],
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
      effective_competitors: [],
      updated_at: settings.updated_at ?? null,
    },
  };
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
  const { data, error } = await supabase
    .from('market_pulse_runs')
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
      },
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create Market Pulse run');
  }

  return data;
}

export async function getMarketPulseRun(runId: string, companyId: string) {
  const { data: run, error } = await supabase
    .from('market_pulse_runs')
    .select('*')
    .eq('id', runId)
    .eq('company_id', companyId)
    .single();

  if (error || !run) {
    throw new Error(error?.message || 'Market Pulse run not found');
  }

  const { data: findings } = await supabase
    .from('market_pulse_findings')
    .select('*')
    .eq('run_id', runId)
    .order('relevance_score', { ascending: false });

  const legacyJob = run?.context_snapshot?.legacy_job ?? null;

  return {
    run: {
      ...run,
      progress_stage: legacyJob?.progress_stage ?? null,
      confidence_index: typeof legacyJob?.confidence_index === 'number' ? legacyJob.confidence_index : null,
      legacy_status: legacyJob?.status ?? null,
      legacy_error: legacyJob?.error ?? null,
    },
    findings: findings ?? [],
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
  const { data: existing } = await supabase
    .from('market_pulse_memory')
    .select('*')
    .eq('company_id', companyId)
    .eq('canonical_event_key', canonicalEventKey)
    .maybeSingle();

  if (!existing) {
    await supabase.from('market_pulse_memory').insert({
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

  await supabase
    .from('market_pulse_memory')
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

  const { data: legacyJob } = await supabase
    .from('market_pulse_jobs_v1')
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

  await supabase
    .from('market_pulse_runs')
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

  for (const topic of globalTopics) {
    const title = String(topic.topic ?? '').trim();
    if (!title) continue;
    const summary = String(topic.spike_reason ?? '').trim() || 'Relevant market movement detected.';
    const regions = normalizeStringArray(topic.regions);
    const category = mapLegacyCategory(topic.primary_category);
    const impactType = buildImpactType(topic.risk_level);
    const canonicalEventKey = slugify(`${title}-${regions.join('-') || 'global'}`);
    const itemHash = findingHash(title, summary, category, regions);

    const { data: memory } = await supabase
      .from('market_pulse_memory')
      .select('*')
      .eq('company_id', companyId)
      .eq('canonical_event_key', canonicalEventKey)
      .maybeSingle();

    const changeStatus =
      !memory
        ? 'new'
        : memory.latest_finding_hash === itemHash
          ? 'unchanged'
          : 'updated';

    await supabase.from('market_pulse_findings').insert({
      run_id: runId,
      company_id: companyId,
      canonical_event_key: canonicalEventKey,
      category,
      subtype: topic.narrative_phase ?? null,
      title,
      summary,
      regions,
      entities: [],
      impact_type: impactType,
      affected_objectives: [objective],
      relevance_score: Number(topic.momentum_score ?? 65),
      confidence_score: Number(legacyJob.confidence_index ?? 60),
      freshness_score: 75,
      why_it_matters: buildWhyItMatters(title, summary, objective, regions),
      recommended_action: buildRecommendedAction(impactType, objective),
      source_count: 1,
      sources_json: [],
      change_status: changeStatus,
      first_seen_at: memory?.first_seen_at ?? new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      last_shared_at: null,
    });

    await upsertMemory(companyId, canonicalEventKey, itemHash, changeStatus);
  }

  return getMarketPulseRun(runId, companyId);
}

export async function getAutomationSettings(companyId: string) {
  const { data } = await supabase
    .from('market_pulse_automation_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  return data ?? null;
}

export async function getMarketPulseHistory(companyId: string) {
  const { data, error } = await supabase
    .from('market_pulse_runs')
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
  const { data, error } = await supabase
    .from('market_pulse_automation_settings')
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
  const { error } = await supabase
    .from('market_pulse_automation_settings')
    .delete()
    .eq('company_id', companyId);
  if (error) {
    throw new Error(error.message || 'Failed to delete automation settings');
  }
}
