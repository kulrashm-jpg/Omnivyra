import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';

export type StatusNormalized = 'planned' | 'active' | 'completed' | 'abandoned' | 'unknown';

export type CampaignIntelligence = {
  campaign_id: string;
  name: string | null;
  status_raw: string | null;
  status_normalized: StatusNormalized;
  current_stage: string | null;
  timeframe: string | null;
  start_date: string | null;
  end_date: string | null;
  intent_objective: string | null;
  target_audience: string | null;
  platforms: string[];
  primary_topics: string[];
  plan_summary: {
    weekly_themes: number;
    weekly_refinements: number;
    weekly_plans: number;
    daily_plans: number;
  };
  execution_summary: {
    scheduled_posts_total: number;
    scheduled_posts_by_status: Record<string, number>;
    scheduled_posts: number;
    published_posts: number;
    failed_posts: number;
  };
  outcome_summary: {
    total_impressions: number | null;
    total_reach: number | null;
    total_engagements: number | null;
    total_conversions: number | null;
    source: 'campaign_performance_metrics' | 'campaign_performance' | null;
  };
  readiness_state: string | null;
  health_status: {
    status: string | null;
    confidence: number | null;
    created_at: string | null;
  } | null;
  series_hint: {
    past_themes: string[];
    past_topics: string[];
    past_platforms: string[];
    past_trends_used: string[];
    last_snapshot_at: string | null;
  } | null;
  last_updated_at: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: any | null;
};

const KNOWN_MISSING_CODES = new Set(['PGRST116', '42P01', '42703']);

const safeSingle = async <T>(
  table: string,
  select: string,
  applyQuery: (query: any) => any
): Promise<QueryResult<T>> => {
  try {
    const query = supabase.from(table).select(select);
    const { data, error } = await applyQuery(query).single();
    if (error) {
      if (KNOWN_MISSING_CODES.has(error.code) || String(error.message || '').includes('does not exist')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
    return { data: data as T, error: null };
  } catch (error: any) {
    if (KNOWN_MISSING_CODES.has(error?.code) || String(error?.message || '').includes('does not exist')) {
      return { data: null, error: null };
    }
    return { data: null, error };
  }
};

const safeMany = async <T>(
  table: string,
  select: string,
  applyQuery: (query: any) => any
): Promise<QueryResult<T[]>> => {
  try {
    const query = supabase.from(table).select(select);
    const { data, error } = await applyQuery(query);
    if (error) {
      if (KNOWN_MISSING_CODES.has(error.code) || String(error.message || '').includes('does not exist')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
    return { data: (data as T[]) || [], error: null };
  } catch (error: any) {
    if (KNOWN_MISSING_CODES.has(error?.code) || String(error?.message || '').includes('does not exist')) {
      return { data: null, error: null };
    }
    return { data: null, error };
  }
};

const normalizePlatform = (platform: string | null | undefined): string | null => {
  if (!platform || typeof platform !== 'string') return null;
  const lower = platform.trim().toLowerCase();
  if (!lower) return null;
  if (lower === 'x' || lower === 'twitter') return 'x';
  if (lower === 'linkedin') return 'linkedin';
  if (lower === 'instagram') return 'instagram';
  if (lower === 'facebook') return 'facebook';
  if (lower === 'youtube') return 'youtube';
  if (lower === 'tiktok') return 'tiktok';
  return lower;
};

const normalizeTopic = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.replace(/[.]+$/g, '');
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
};

const normalizeStatus = (input: {
  rawStatus: string | null;
  readinessState: string | null;
  executionSummary: CampaignIntelligence['execution_summary'];
}): StatusNormalized => {
  const raw = (input.rawStatus || '').trim().toLowerCase();
  if (raw === 'completed') return 'completed';
  if (['cancelled', 'canceled', 'paused', 'abandoned', 'archived'].includes(raw)) return 'abandoned';
  if (raw === 'active') return 'active';
  if (['approved', 'pending_approval', 'planning', 'draft', 'market-analysis', 'content-creation', 'schedule-review'].includes(raw)) {
    return 'planned';
  }
  if (input.executionSummary.published_posts > 0) return 'active';
  if (input.executionSummary.scheduled_posts > 0) return 'planned';
  if (input.readinessState === 'ready') return 'planned';
  return 'unknown';
};

const sumNumbers = (values: Array<number | null | undefined>): number => {
  return values.reduce((acc, value) => acc + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
};

const extractWeeklyThemes = (weeklyThemes: any): string[] => {
  if (!Array.isArray(weeklyThemes)) return [];
  return weeklyThemes
    .map((theme) => {
      if (typeof theme === 'string') return normalizeTopic(theme);
      if (theme && typeof theme === 'object') {
        return normalizeTopic(theme.theme || theme.title || theme.name);
      }
      return null;
    })
    .filter(Boolean) as string[];
};

const extractTrendTopics = (snapshots: any[] | null): string[] => {
  if (!snapshots || snapshots.length === 0) return [];
  const topics = snapshots.flatMap((snap) => {
    const snapshot = snap?.snapshot;
    const emerging = snapshot?.emerging_trends || snapshot?.trends || [];
    if (!Array.isArray(emerging)) return [];
    return emerging
      .map((trend: any) => normalizeTopic(trend?.topic || trend?.title || trend))
      .filter(Boolean) as string[];
  });
  return uniqueStrings(topics);
};

export async function getCampaignIntelligence(
  campaignId: string
): Promise<CampaignIntelligence> {
  const campaignResult = await safeSingle<any>('campaigns', '*', (query) =>
    query.eq('id', campaignId)
  );

  const campaign = campaignResult.data;

  const campaignVersionResult = await safeSingle<any>('campaign_versions', 'company_id, created_at', (query) =>
    query.eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(1)
  );

  const companyId = campaignVersionResult.data?.company_id ?? null;

  const [
    strategyResult,
    goalsResult,
    weeklyRefinementsResult,
    weeklyPlansResult,
    dailyPlansResult,
    scheduledPostsResult,
    performanceMetricsResult,
    performanceResult,
    readinessResult,
    healthResult,
    forecastResult,
    trendSnapshotsResult,
    memoryResult,
    platformStrategyResult,
  ] = await Promise.all([
    safeSingle<any>('campaign_strategies', '*', (query) => query.eq('campaign_id', campaignId)),
    safeMany<any>('campaign_goals', '*', (query) => query.eq('campaign_id', campaignId)),
    safeMany<any>('weekly_content_refinements', '*', (query) => query.eq('campaign_id', campaignId)),
    safeMany<any>('weekly_content_plans', '*', (query) => query.eq('campaign_id', campaignId)),
    safeMany<any>('daily_content_plans', '*', (query) =>
      query.eq('campaign_id', campaignId).limit(1000)
    ),
    safeMany<any>('scheduled_posts', '*', (query) => query.eq('campaign_id', campaignId)),
    safeMany<any>('campaign_performance_metrics', '*', (query) =>
      query.eq('campaign_id', campaignId)
    ),
    safeMany<any>('campaign_performance', '*', (query) => query.eq('campaign_id', campaignId)),
    safeSingle<any>('campaign_readiness', '*', (query) => query.eq('campaign_id', campaignId)),
    safeSingle<any>('campaign_health_reports', '*', (query) =>
      query.eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(1)
    ),
    safeSingle<any>('campaign_forecasts', '*', (query) =>
      query.eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(1)
    ),
    safeMany<any>('trend_snapshots', '*', (query) =>
      query.eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(20)
    ),
    companyId
      ? safeSingle<any>('campaign_memory_snapshots', '*', (query) =>
          query.eq('company_id', companyId).order('created_at', { ascending: false }).limit(1)
        )
      : Promise.resolve({ data: null, error: null }),
    safeMany<any>('platform_strategies', '*', (query) => query.eq('campaign_id', campaignId)),
  ]);

  const weeklyThemes = extractWeeklyThemes(campaign?.weekly_themes);
  const weeklyRefinements = weeklyRefinementsResult.data || [];
  const weeklyPlans = weeklyPlansResult.data || [];
  const dailyPlans = dailyPlansResult.data || [];
  const scheduledPosts = scheduledPostsResult.data || [];
  const goals = goalsResult.data || [];
  const strategy = strategyResult.data || null;

  const planSummary = {
    weekly_themes: weeklyThemes.length,
    weekly_refinements: weeklyRefinements.length,
    weekly_plans: weeklyPlans.length,
    daily_plans: dailyPlans.length,
  };

  const scheduledByStatus: Record<string, number> = {};
  scheduledPosts.forEach((post) => {
    const status = String(post?.status || 'unknown');
    scheduledByStatus[status] = (scheduledByStatus[status] || 0) + 1;
  });

  const executionSummary = {
    scheduled_posts_total: scheduledPosts.length,
    scheduled_posts_by_status: scheduledByStatus,
    scheduled_posts: scheduledByStatus.scheduled || 0,
    published_posts: scheduledByStatus.published || 0,
    failed_posts: scheduledByStatus.failed || 0,
  };

  const metricRows = performanceMetricsResult.data || [];
  const perfRows = performanceResult.data || [];

  const outcomeFromMetrics = metricRows.length > 0
    ? {
        total_impressions: sumNumbers(metricRows.map((row) => row.impressions)),
        total_reach: sumNumbers(metricRows.map((row) => row.reach)),
        total_engagements: sumNumbers(
          metricRows.map((row) => (row.likes || 0) + (row.comments || 0) + (row.shares || 0))
        ),
        total_conversions: sumNumbers(metricRows.map((row) => row.conversions)),
        source: 'campaign_performance_metrics' as const,
      }
    : null;

  const outcomeFromPerf = perfRows.length > 0
    ? {
        total_impressions: null,
        total_reach: sumNumbers(perfRows.map((row) => row.total_reach)),
        total_engagements: sumNumbers(perfRows.map((row) => row.total_engagement)),
        total_conversions: sumNumbers(perfRows.map((row) => row.total_conversions)),
        source: 'campaign_performance' as const,
      }
    : null;

  const outcomeSummary = outcomeFromMetrics || outcomeFromPerf || {
    total_impressions: null,
    total_reach: null,
    total_engagements: null,
    total_conversions: null,
    source: null,
  };

  const platforms = uniqueStrings([
    ...dailyPlans.map((plan) => normalizePlatform(plan?.platform) || null),
    ...scheduledPosts.map((post) => normalizePlatform(post?.platform) || null),
    ...(strategy?.key_platforms || []).map((platform: any) => normalizePlatform(platform) || null),
    ...(platformStrategyResult.data || []).map((plan) => normalizePlatform(plan?.platform) || null),
  ]);

  const goalObjectives = goals.flatMap((goal) => (goal?.objectives as string[]) || []);
  const intentObjective =
    normalizeTopic(campaign?.objective) ||
    normalizeTopic(strategy?.objective) ||
    normalizeTopic(goalObjectives[0]) ||
    null;

  const targetAudience =
    normalizeTopic(campaign?.target_audience) ||
    normalizeTopic(strategy?.target_audience) ||
    null;

  const dailyTopics = dailyPlans.flatMap((plan) => [
    normalizeTopic(plan?.topic),
    normalizeTopic(plan?.title),
  ]);

  const weeklyTopics = weeklyRefinements.map((plan) => normalizeTopic(plan?.theme));

  const trendTopics = extractTrendTopics(trendSnapshotsResult.data);

  const primaryTopics = uniqueStrings([
    ...weeklyThemes,
    ...weeklyTopics.filter(Boolean) as string[],
    ...dailyTopics.filter(Boolean) as string[],
    ...trendTopics,
  ]);

  const readinessState = readinessResult.data?.readiness_state || null;
  const healthStatus = healthResult.data
    ? {
        status: healthResult.data.status ?? null,
        confidence: typeof healthResult.data.confidence === 'number' ? healthResult.data.confidence : null,
        created_at: healthResult.data.created_at ?? null,
      }
    : null;

  const memory = memoryResult.data?.memory_json || null;
  const seriesHint = memory
    ? {
        past_themes: uniqueStrings((memory.pastThemes || memory.past_themes || []) as string[]),
        past_topics: uniqueStrings((memory.pastTopics || memory.past_topics || []) as string[]),
        past_platforms: uniqueStrings((memory.pastPlatforms || memory.past_platforms || []) as string[]),
        past_trends_used: uniqueStrings((memory.pastTrendsUsed || memory.past_trends_used || []) as string[]),
        last_snapshot_at: memoryResult.data?.created_at ?? null,
      }
    : null;

  const statusNormalized = normalizeStatus({
    rawStatus: campaign?.status ?? null,
    readinessState,
    executionSummary,
  });

  return {
    campaign_id: campaignId,
    name: campaign?.name ?? null,
    status_raw: campaign?.status ?? null,
    status_normalized: statusNormalized,
    current_stage: campaign?.current_stage ?? null,
    timeframe: campaign?.timeframe ?? null,
    start_date: campaign?.start_date ?? null,
    end_date: campaign?.end_date ?? null,
    intent_objective: intentObjective,
    target_audience: targetAudience,
    platforms,
    primary_topics: primaryTopics,
    plan_summary: planSummary,
    execution_summary: executionSummary,
    outcome_summary: outcomeSummary,
    readiness_state: readinessState,
    health_status: healthStatus,
    series_hint: seriesHint,
    last_updated_at: campaign?.updated_at ?? null,
  };
}

export async function getRecentCampaignIntelligenceForCompany(
  companyId: string,
  limit = 5
): Promise<CampaignIntelligence[]> {
  const mappingResult = await safeMany<any>(
    'campaign_versions',
    'campaign_id, created_at',
    (query) => query.eq('company_id', companyId).order('created_at', { ascending: false }).limit(50)
  );

  const rows = mappingResult.data || [];
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    const id = typeof row?.campaign_id === 'string' ? row.campaign_id : null;
    if (!id || seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  });

  const targetIds = orderedIds.slice(0, Math.max(0, limit));
  if (targetIds.length === 0) return [];

  const results = await Promise.all(
    targetIds.map((id) =>
      getCampaignIntelligence(id).catch(() => null)
    )
  );

  return results.filter(Boolean) as CampaignIntelligence[];
}

export const __testUtils = {
  normalizeStatus,
  normalizeTopic,
  uniqueStrings,
};

export const normalizeCampaignTopic = normalizeTopic;

// ---------------------------------------------------------------------------
// Campaign Health Analyzer (design + execution plan evaluation)
// ---------------------------------------------------------------------------

/** Planner-compatible shapes (no frontend import) */
export interface IdeaSpineInput {
  title?: string | null;
  description?: string | null;
  refined_title?: string | null;
  refined_description?: string | null;
  selected_angle?: string | null;
}

export interface CampaignBriefInput {
  pain_point?: string;
  audience?: string;
  campaign_goal?: string;
  campaign_theme?: string;
  communication_style?: string;
  primary_cta?: string;
}

export interface CampaignStructurePhaseInput {
  id?: string;
  label?: string;
  week_start?: number;
  week_end?: number;
  narrative_hint?: string;
  objective?: string;
  content_focus?: string;
  cta_focus?: string;
}

export interface CampaignStructureInput {
  phases?: CampaignStructurePhaseInput[];
  narrative?: string;
}

export interface CampaignDesignInput {
  idea_spine?: IdeaSpineInput | null;
  campaign_brief?: CampaignBriefInput | null;
  campaign_structure?: CampaignStructureInput | null;
}

export interface StrategyContextInput {
  duration_weeks?: number;
  platforms?: string[];
  posting_frequency?: Record<string, number>;
  content_mix?: string[];
  campaign_goal?: string;
  target_audience?: string;
}

export interface CalendarPlanActivityInput {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  /** CTA intent: e.g. download, book, signup → conversion */
  cta?: string;
  /** Phase label: e.g. awareness, education → direct role match */
  phase?: string;
  /** Objective: e.g. educate, explain → education */
  objective?: string;
}

export interface CalendarPlanInput {
  weeks?: unknown[];
  days?: unknown[];
  activities?: CalendarPlanActivityInput[];
}

export interface ExecutionPlanInput {
  strategy_context?: StrategyContextInput | null;
  calendar_plan?: CalendarPlanInput | null;
  activity_cards?: CalendarPlanActivityInput[];
}

export type HealthSuggestionSeverity = 'info' | 'warning' | 'critical';

export type HealthSuggestionCategory =
  | 'narrative'
  | 'content_mix'
  | 'cadence'
  | 'audience'
  | 'company_alignment'
  | 'focus_coverage'
  | 'platform_distribution'
  | 'execution_cadence'
  | 'content_type_balance'
  | 'role_distribution'
  | 'general';

/** Activity role in funnel: awareness → education → authority → engagement → conversion */
export type ActivityRole = 'awareness' | 'education' | 'authority' | 'engagement' | 'conversion';

export interface RoleClassificationResult {
  role: ActivityRole;
  confidence: number;
  signals_used: string[];
}

export interface LowConfidenceActivity {
  id: string;
  predicted_role: ActivityRole;
  confidence: number;
}

export interface RoleDistribution {
  awareness: number;
  education: number;
  authority: number;
  engagement: number;
  conversion: number;
  by_role: Record<ActivityRole, number>;
  total: number;
  percentages: Record<ActivityRole, number>;
  low_confidence_ratio: number;
  low_confidence_count: number;
  missing_cta_count: number;
  missing_objective_count: number;
  missing_phase_count: number;
  low_confidence_activities: LowConfidenceActivity[];
}

export interface HealthSuggestion {
  message: string;
  severity: HealthSuggestionSeverity;
  category: HealthSuggestionCategory;
  priority: number;
}

export type EvaluationScope = 'planner_preview' | 'campaign_saved' | 'daily_health_job' | 'manual_run';

export type HealthStatus = 'excellent' | 'strong' | 'moderate' | 'weak' | 'critical';

export interface CampaignHealthReport {
  narrative_score: number;
  content_mix_score: number;
  cadence_score: number;
  audience_alignment_score: number;
  execution_cadence_score: number;
  platform_distribution_score: number;
  role_distribution?: RoleDistribution;
  role_balance_score?: number;
  metadata_completeness_score: number;
  missing_cta_total: number;
  missing_objective_total: number;
  missing_phase_total: number;
  low_confidence_ratio: number;
  low_confidence_count: number;
  analyzed_activity_count: number;
  issue_count: number;
  visible_issue_count: number;
  hidden_issue_count: number;
  health_version: number;
  evaluation_duration_ms: number;
  evaluation_context: {
    evaluation_scope: EvaluationScope;
    report_generated_by: string;
    activity_sampled: boolean;
    activity_count_total: number;
    analyzed_activity_count: number;
  };
  analysis_version_hash: string;
  health_summary: string;
  top_issue_categories: string[];
  health_score: number;
  health_grade: string;
  score_breakdown: Record<string, number>;
  health_status: HealthStatus;
  health_flags: Record<string, boolean>;
  health_dimensions: Record<string, number>;
  dimension_status: Record<string, 'good' | 'warning' | 'critical'>;
  health_trend: string;
  primary_issue: string | null;
  report_id: string;
  report_timestamp: string;
  issue_density: number;
  analysis_warnings: string[];
  evaluated_at: string;
  suggestions: HealthSuggestion[];
}

export type CompanyContextModeInput = 'full_company_context' | 'focused_context' | 'no_company_context';

export type FocusModuleInput = string;

export interface CampaignHealthInput {
  campaign_design: CampaignDesignInput | null | undefined;
  execution_plan: ExecutionPlanInput | null | undefined;
  /** Optional override; when absent, uses execution_plan.strategy_context */
  strategy_context?: StrategyContextInput | null;
  company_context_mode?: CompanyContextModeInput | null;
  focus_modules?: FocusModuleInput[] | null;
  companyId?: string | null;
  company_profile?: Record<string, unknown> | null;
  /** Scope of this evaluation: planner_preview | campaign_saved | daily_health_job | manual_run */
  evaluation_scope?: EvaluationScope | null;
  /** Whether activities were sampled (e.g. when too many); default false */
  activity_sampled?: boolean;
  /** Source: planner | campaign_engine | health_scheduler | manual_trigger */
  report_generated_by?: 'planner' | 'campaign_engine' | 'health_scheduler' | 'manual_trigger' | null;
}

function _ensureArray<T>(v: T[] | null | undefined): T[];
function _ensureArray(v: unknown): unknown[];
function _ensureArray(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}

function _hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function evaluateNarrativeBalance(design: CampaignDesignInput | null | undefined): number {
  if (!design) return 0;
  const spine = design.idea_spine;
  const structure = design.campaign_structure;
  let score = 0;
  let checks = 0;
  if (spine) {
    const title = spine.refined_title ?? spine.title;
    const desc = spine.refined_description ?? spine.description;
    if (_hasText(title)) { score += 25; checks++; }
    if (_hasText(desc)) { score += 25; checks++; }
    if (_hasText(spine.selected_angle)) { score += 25; checks++; }
  } else { checks += 3; }
  if (structure) {
    const phases = _ensureArray(structure.phases);
    const narrative = structure.narrative;
    if (phases.length >= 2) { score += 15; checks++; }
    if (_hasText(narrative)) { score += 10; checks++; }
  } else { checks += 2; }
  return checks === 0 ? 0 : Math.round((score / (checks * 25)) * 100);
}

export function evaluateContentMix(design: CampaignDesignInput | null | undefined, plan: ExecutionPlanInput | null | undefined): number {
  const mix = plan?.strategy_context?.content_mix;
  const activities = plan?.calendar_plan?.activities ?? plan?.activity_cards ?? [];
  const typesFromActivities = new Set(activities.map((a) => (a.content_type ?? '').trim().toLowerCase()).filter(Boolean));
  const mixTypes = _ensureArray(mix).map((m) => String(m).trim().toLowerCase()).filter(Boolean);
  const union = new Set([...typesFromActivities, ...mixTypes]);
  if (union.size === 0) return 0;
  if (union.size === 1) return 40;
  if (union.size === 2) return 65;
  return union.size >= 3 ? 100 : 50;
}

export function evaluateCadence(plan: ExecutionPlanInput | null | undefined): number {
  const strat = plan?.strategy_context;
  const activities = plan?.calendar_plan?.activities ?? plan?.activity_cards ?? [];
  const duration = strat?.duration_weeks ?? 12;
  const freq = strat?.posting_frequency;
  const platforms = _ensureArray(strat?.platforms);
  let score = 0;
  let checks = 0;
  if (duration > 0 && duration <= 52) { score += 25; checks++; }
  if (platforms.length > 0) { score += 25; checks++; }
  if (freq && typeof freq === 'object') {
    const totalPerWeek = Object.values(freq).reduce((a, b) => a + (Number(b) || 0), 0);
    score += totalPerWeek >= 2 ? 25 : totalPerWeek >= 1 ? 15 : 0;
    checks++;
  }
  const activityCount = activities.length;
  const expected = duration * 3;
  if (expected > 0) {
    const ratio = activityCount / expected;
    score += ratio >= 0.8 ? 25 : ratio >= 0.4 ? 15 : 0;
    checks++;
  } else checks++;
  return checks === 0 ? 0 : Math.min(100, Math.round((score / (checks * 25)) * 100));
}

export function evaluateAudienceAlignment(design: CampaignDesignInput | null | undefined, plan: ExecutionPlanInput | null | undefined): number {
  const brief = design?.campaign_brief;
  const strat = plan?.strategy_context;
  const hasAudience = _hasText(brief?.audience) || _hasText(strat?.target_audience);
  const hasGoal = _hasText(brief?.campaign_goal) || _hasText(strat?.campaign_goal);
  let score = (hasAudience ? 50 : 0) + (hasGoal ? 50 : 0);
  if (hasAudience && hasGoal) score = Math.min(100, score + 10);
  return Math.min(100, score);
}

/** Platform distribution: multiple platforms, balanced allocation. */
export function evaluatePlatformDistribution(strat: StrategyContextInput | null | undefined): number {
  const platforms = _ensureArray(strat?.platforms).map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  const freq = strat?.posting_frequency;
  if (platforms.length === 0) return 0;
  if (platforms.length === 1) return 40;
  let balanceScore = 50;
  if (freq && typeof freq === 'object') {
    const counts = platforms.map((p) => Number(freq[p] ?? freq[p === 'twitter' ? 'x' : p] ?? 0)).filter((n) => n > 0);
    if (counts.length >= 2) {
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      const ratio = max > 0 ? min / max : 1;
      balanceScore = ratio >= 0.5 ? 100 : ratio >= 0.25 ? 70 : 50;
    }
  }
  if (platforms.length >= 3) return Math.min(100, balanceScore + 15);
  return Math.min(100, balanceScore + (platforms.length === 2 ? 10 : 0));
}

/** Posting cadence: frequency per platform, consistency. */
export function evaluateExecutionCadence(
  strat: StrategyContextInput | null | undefined,
  activities: CalendarPlanActivityInput[] | null | undefined
): number {
  const freq = strat?.posting_frequency;
  const platforms = _ensureArray(strat?.platforms);
  const duration = strat?.duration_weeks ?? 12;
  let score = 0;
  let checks = 0;
  if (freq && typeof freq === 'object' && Object.keys(freq).length > 0) {
    const totalPerWeek = Object.values(freq).reduce((a, b) => a + (Number(b) || 0), 0);
    if (totalPerWeek >= 5) score += 40;
    else if (totalPerWeek >= 3) score += 30;
    else if (totalPerWeek >= 1) score += 20;
    checks++;
  }
  if (platforms.length > 0) {
    const coveredPlatforms = platforms.filter((p) => freq && Number(freq[p] ?? 0) > 0).length;
    score += coveredPlatforms >= platforms.length ? 30 : coveredPlatforms > 0 ? 15 : 0;
    checks++;
  }
  const actCount = _ensureArray(activities).length;
  const expected = duration * (Object.values(freq || {}).reduce((a, b) => a + (Number(b) || 0), 0) || 3);
  if (expected > 0) {
    const ratio = actCount / expected;
    score += ratio >= 0.8 ? 30 : ratio >= 0.4 ? 20 : ratio > 0 ? 10 : 0;
    checks++;
  } else checks++;
  return checks === 0 ? 0 : Math.min(100, Math.round((score / (checks * 25)) * 100));
}

/** CTA signals → conversion */
const CTA_CONVERSION = ['download', 'book', 'signup', 'sign up', 'register', 'subscribe', 'buy', 'trial', 'demo', 'convert', 'join'];

/** Objective signals → roles */
const OBJECTIVE_EDUCATION = ['educate', 'explain', 'teach', 'inform', 'learn'];
const OBJECTIVE_AUTHORITY = ['establish', 'demonstrate', 'prove', 'expertise', 'credibility'];
const OBJECTIVE_ENGAGEMENT = ['engage', 'interact', 'discuss', 'community', 'feedback'];
const OBJECTIVE_CONVERSION = ['convert', 'sign up', 'download', 'register'];

/** Phase label → direct role match */
const PHASE_ROLES: ActivityRole[] = ['awareness', 'education', 'authority', 'engagement', 'conversion'];

const ROLE_KEYWORDS: Record<ActivityRole, string[]> = {
  conversion: ['sign up', 'signup', 'download', 'buy', 'cta', 'convert', 'trial', 'demo', 'register', 'join', 'subscribe', 'book a call'],
  engagement: ['poll', 'question', 'comment', 'discussion', 'community', 'q&a', 'ask', 'feedback', 'survey'],
  education: ['how to', 'howto', 'guide', 'tips', 'learn', 'tutorial', 'explain', 'webinar', 'workshop', 'best practices'],
  authority: ['case study', 'casestudy', 'expert', 'thought leadership', 'research', 'data', 'whitepaper', 'report', 'insight'],
  awareness: ['launch', 'announcement', 'brand', 'introduce', 'new', 'awareness'],
};

function _text(v: unknown): string {
  return (typeof v === 'string' ? v : '').trim().toLowerCase();
}

const CONFIDENCE = { cta: 0.9, objective: 0.8, phase: 0.7, keyword: 0.6, fallback: 0.4 } as const;

/** Classify activity into funnel role. Priority: 1.CTA 2.Objective 3.Phase 4.Keyword scan. Returns role, confidence, signals_used. */
export function classifyActivityRole(activity: CalendarPlanActivityInput | null | undefined): RoleClassificationResult {
  if (!activity) return { role: 'awareness', confidence: CONFIDENCE.fallback, signals_used: ['fallback'] };
  const cta = _text(activity.cta);
  const phase = _text(activity.phase);
  const objective = _text(activity.objective);
  const title = _text(activity.title);
  const theme = _text(activity.theme);
  const contentType = _text(activity.content_type);

  if (cta && CTA_CONVERSION.some((k) => cta.includes(k)))
    return { role: 'conversion', confidence: CONFIDENCE.cta, signals_used: ['cta'] };

  if (objective) {
    if (OBJECTIVE_CONVERSION.some((k) => objective.includes(k)))
      return { role: 'conversion', confidence: CONFIDENCE.objective, signals_used: ['objective'] };
    if (OBJECTIVE_EDUCATION.some((k) => objective.includes(k)))
      return { role: 'education', confidence: CONFIDENCE.objective, signals_used: ['objective'] };
    if (OBJECTIVE_AUTHORITY.some((k) => objective.includes(k)))
      return { role: 'authority', confidence: CONFIDENCE.objective, signals_used: ['objective'] };
    if (OBJECTIVE_ENGAGEMENT.some((k) => objective.includes(k)))
      return { role: 'engagement', confidence: CONFIDENCE.objective, signals_used: ['objective'] };
  }

  if (phase) {
    for (const r of PHASE_ROLES) {
      if (phase === r || phase.startsWith(`${r} `) || phase.includes(` ${r}`) || phase.endsWith(r))
        return { role: r, confidence: CONFIDENCE.phase, signals_used: ['phase'] };
    }
  }

  const combined = `${title} ${theme} ${contentType} ${cta} ${objective}`;
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS) as [ActivityRole, string[]][]) {
    if (keywords.some((k) => combined.includes(k)))
      return { role, confidence: CONFIDENCE.keyword, signals_used: ['keyword'] };
  }
  if (contentType === 'thread' || contentType === 'story')
    return { role: 'engagement', confidence: CONFIDENCE.keyword, signals_used: ['content_type'] };
  if (contentType === 'blog' || contentType === 'video')
    return { role: 'education', confidence: CONFIDENCE.keyword, signals_used: ['content_type'] };
  return { role: 'awareness', confidence: CONFIDENCE.fallback, signals_used: ['fallback'] };
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;
const LOW_CONFIDENCE_RATIO_THRESHOLD = 0.25;
const MAX_LOW_CONFIDENCE_ACTIVITIES = 20;

/** Compute role distribution from activities. Uses confidence as weight; excludes activities with confidence < 0.5. */
export function computeRoleDistribution(activities: CalendarPlanActivityInput[] | null | undefined): RoleDistribution {
  const acts = _ensureArray(activities);
  const by_role: Record<ActivityRole, number> = {
    awareness: 0,
    education: 0,
    authority: 0,
    engagement: 0,
    conversion: 0,
  };
  let lowConfidenceCount = 0;
  let missingCtaCount = 0;
  let missingObjectiveCount = 0;
  let missingPhaseCount = 0;
  const lowConfidenceActivities: LowConfidenceActivity[] = [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i] as CalendarPlanActivityInput;
    const result = classifyActivityRole(a);
    if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceCount++;
      if (!_text(a?.cta)) missingCtaCount++;
      if (!_text(a?.objective)) missingObjectiveCount++;
      if (!_text(a?.phase)) missingPhaseCount++;
      const act = a as { execution_id?: string; id?: string };
      const id = act.execution_id || act.id || `activity-${i}`;
      lowConfidenceActivities.push({ id, predicted_role: result.role, confidence: result.confidence });
      continue;
    }
    by_role[result.role] += result.confidence;
  }
  const total = (Object.values(by_role) as number[]).reduce((s, n) => s + n, 0);
  const total_activities = acts.length;
  const low_confidence_ratio = total_activities === 0 ? 0 : lowConfidenceCount / total_activities;
  lowConfidenceActivities.sort((a, b) => a.confidence - b.confidence);
  const truncatedLowConfidence = lowConfidenceActivities.slice(0, MAX_LOW_CONFIDENCE_ACTIVITIES);
  const percentages: Record<ActivityRole, number> = {
    awareness: total > 0 ? Math.round((by_role.awareness / total) * 100) : 0,
    education: total > 0 ? Math.round((by_role.education / total) * 100) : 0,
    authority: total > 0 ? Math.round((by_role.authority / total) * 100) : 0,
    engagement: total > 0 ? Math.round((by_role.engagement / total) * 100) : 0,
    conversion: total > 0 ? Math.round((by_role.conversion / total) * 100) : 0,
  };
  return { awareness: by_role.awareness, education: by_role.education, authority: by_role.authority, engagement: by_role.engagement, conversion: by_role.conversion, by_role, total, percentages, low_confidence_ratio, low_confidence_count: lowConfidenceCount, missing_cta_count: missingCtaCount, missing_objective_count: missingObjectiveCount, missing_phase_count: missingPhaseCount, low_confidence_activities: truncatedLowConfidence };
}

const ROLE_DOMINANCE_THRESHOLD = 55;

/** Score 0-100: higher when more roles represented and no single role dominates. */
export function evaluateRoleBalance(dist: RoleDistribution): number {
  if (dist.total === 0) return 0;
  const rolesPresent = (Object.values(dist.by_role) as number[]).filter((n) => n > 0).length;
  const maxPct = Math.max(...(Object.values(dist.percentages) as number[]));
  let score = 0;
  if (rolesPresent >= 4) score += 50;
  else if (rolesPresent >= 3) score += 40;
  else if (rolesPresent >= 2) score += 25;
  else score += 10;
  if (maxPct <= 40) score += 50;
  else if (maxPct <= ROLE_DOMINANCE_THRESHOLD) score += 30;
  else if (maxPct <= 70) score += 15;
  return Math.min(100, score);
}

/** Content type balance: diversity of content_mix. */
export function evaluateContentTypeBalance(strat: StrategyContextInput | null | undefined, activities: CalendarPlanActivityInput[] | null | undefined): number {
  const mix = _ensureArray(strat?.content_mix).map((m) => String(m).trim().toLowerCase()).filter(Boolean);
  const actTypes = new Set(
    _ensureArray(activities).map((a) => (a.content_type ?? '').trim().toLowerCase()).filter(Boolean)
  );
  const union = new Set([...mix, ...actTypes]);
  if (union.size === 0) return 0;
  if (union.size === 1) return 40;
  if (union.size >= 3) return 100;
  return 65;
}

const DEFAULT_PRIORITY = 10;
const MAX_HEALTH_SUGGESTIONS = 10;
const CAMPAIGN_HEALTH_SCHEMA_VERSION = 1;
const ANALYSIS_VERSION_HASH = 'health_v1.0.3';
const MAX_HEALTH_WARNINGS = 5;

const CATEGORY_ORDER: Record<HealthSuggestionCategory, number> = {
  narrative: 0,
  content_mix: 1,
  cadence: 2,
  audience: 3,
  company_alignment: 4,
  focus_coverage: 5,
  platform_distribution: 6,
  execution_cadence: 7,
  content_type_balance: 8,
  role_distribution: 9,
  general: 10,
};

function _s(
  message: string,
  severity: HealthSuggestionSeverity,
  category: HealthSuggestionCategory,
  priority = DEFAULT_PRIORITY
): HealthSuggestion {
  return { message, severity, category, priority };
}

export function evaluateCampaignHealth(
  campaign_designOrInput: CampaignDesignInput | CampaignHealthInput | null | undefined,
  execution_plan?: ExecutionPlanInput | null | undefined
): CampaignHealthReport {
  const evaluation_start = Date.now();
  let campaign_design: CampaignDesignInput | null | undefined;
  let execution_plan_val: ExecutionPlanInput | null | undefined;
  let company_context_mode: CompanyContextModeInput | null | undefined;
  let focus_modules: FocusModuleInput[] | null | undefined;
  let company_profile: Record<string, unknown> | null | undefined;
  let evaluation_scope: EvaluationScope = 'manual_run';
  let activity_sampled = false;
  let report_generated_by: 'planner' | 'campaign_engine' | 'health_scheduler' | 'manual_trigger' = 'manual_trigger';

  let strategy_context_val: StrategyContextInput | null | undefined;
  if (
    campaign_designOrInput &&
    typeof campaign_designOrInput === 'object' &&
    'campaign_design' in campaign_designOrInput &&
    (campaign_designOrInput as CampaignHealthInput).campaign_design != null
  ) {
    const input = campaign_designOrInput as CampaignHealthInput;
    campaign_design = input.campaign_design;
    execution_plan_val = input.execution_plan;
    strategy_context_val = input.strategy_context ?? execution_plan_val?.strategy_context ?? null;
    company_context_mode = input.company_context_mode;
    focus_modules = input.focus_modules;
    company_profile = input.company_profile;
    if (input.evaluation_scope) evaluation_scope = input.evaluation_scope;
    if (input.activity_sampled === true) activity_sampled = true;
    if (input.report_generated_by) report_generated_by = input.report_generated_by;
  } else {
    campaign_design = campaign_designOrInput as CampaignDesignInput | null | undefined;
    execution_plan_val = execution_plan ?? null;
    strategy_context_val = execution_plan_val?.strategy_context ?? null;
  }

  const activities = execution_plan_val?.calendar_plan?.activities ?? execution_plan_val?.activity_cards ?? [];

  const narrative_score = evaluateNarrativeBalance(campaign_design);
  const content_mix_score = evaluateContentMix(campaign_design, execution_plan_val);
  const cadence_score = evaluateCadence(execution_plan_val);
  const audience_alignment_score = evaluateAudienceAlignment(campaign_design, execution_plan_val);
  const platform_distribution_score = evaluatePlatformDistribution(strategy_context_val);
  const execution_cadence_score = evaluateExecutionCadence(strategy_context_val, activities);
  const suggestions: HealthSuggestion[] = [];
  const severity = (s: number) => (s < 40 ? ('critical' as const) : s < 60 ? ('warning' as const) : ('info' as const));

  if (narrative_score < 60) {
    suggestions.push(
      _s('Complete idea spine with title, description, and selected angle.', severity(narrative_score), 'narrative'),
      _s('Add campaign structure phases and narrative for stronger coherence.', 'warning', 'narrative')
    );
  }
  if (content_mix_score < 50) {
    suggestions.push(
      _s('Add more content types to diversify content mix.', severity(content_mix_score), 'content_mix')
    );
  }
  if (cadence_score < 50) {
    suggestions.push(
      _s('Define posting frequency per platform and extend calendar activities.', severity(cadence_score), 'cadence')
    );
  }
  if (platform_distribution_score < 50) {
    suggestions.push(
      _s('Add more platforms and balance posting frequency across them.', severity(platform_distribution_score), 'platform_distribution')
    );
  }
  if (execution_cadence_score < 50) {
    suggestions.push(
      _s('Improve posting cadence: ensure each platform has posting frequency and calendar activities.', severity(execution_cadence_score), 'execution_cadence')
    );
  }

  const roleDist = computeRoleDistribution(activities);
  const role_balance_score = evaluateRoleBalance(roleDist);
  if (roleDist.low_confidence_ratio > LOW_CONFIDENCE_RATIO_THRESHOLD) {
    const n2 = roleDist.missing_objective_count;
    if (n2 > 0) {
      suggestions.push(
        _s(n2 === 1 ? '1 activity lacks objective alignment.' : `${n2} activities lack objective alignment.`, 'warning', 'role_distribution', 1)
      );
    }
    const n = roleDist.missing_cta_count;
    if (n > 0) {
      suggestions.push(
        _s(n === 1 ? '1 activity lacks CTA alignment.' : `${n} activities lack CTA alignment.`, 'warning', 'role_distribution', 2)
      );
    }
    const n3 = roleDist.missing_phase_count;
    if (n3 > 0) {
      suggestions.push(
        _s(n3 === 1 ? '1 activity lacks phase alignment.' : `${n3} activities lack phase alignment.`, 'warning', 'role_distribution', 3)
      );
    }
  }
  const ROLES: ActivityRole[] = ['awareness', 'education', 'authority', 'engagement', 'conversion'];
  if (roleDist.total >= 3) {
    for (const role of ROLES) {
      if (roleDist.by_role[role] === 0) {
        suggestions.push(
          _s(`Add ${role} activities to balance the funnel.`, 'warning', 'role_distribution')
        );
      }
    }
    for (const role of ROLES) {
      const pct = roleDist.percentages[role];
      if (pct > ROLE_DOMINANCE_THRESHOLD) {
        suggestions.push(
          _s(`${role} activities (${pct}%) exceed recommended share. Consider rebalancing across funnel roles.`, pct > 70 ? 'critical' : 'warning', 'role_distribution')
        );
      }
    }
  }
  if (role_balance_score < 50 && roleDist.total >= 2) {
    suggestions.push(
      _s('Diversify activity roles: ensure awareness, education, authority, engagement, and conversion are represented.', severity(role_balance_score), 'role_distribution')
    );
  }

  if (audience_alignment_score < 50) {
    suggestions.push(
      _s(
        'Specify target audience and campaign goal in brief or strategy context.',
        severity(audience_alignment_score),
        'audience'
      )
    );
  }

  if (company_context_mode === 'full_company_context' && company_profile) {
    const profile = company_profile as Record<string, unknown>;
    const profileAudience = _ensureArray(profile.target_audience_list).concat(
      profile.target_audience ? [String(profile.target_audience)] : []
    );
    const profileGoals = _ensureArray(profile.goals_list).concat(profile.goals ? [String(profile.goals)] : []);
    const campaignAudience = (campaign_design?.campaign_brief?.audience ?? execution_plan_val?.strategy_context?.target_audience ?? '').trim().toLowerCase();
    const campaignGoal = (campaign_design?.campaign_brief?.campaign_goal ?? execution_plan_val?.strategy_context?.campaign_goal ?? '').trim().toLowerCase();
    const hasProfileAudience = profileAudience.some((a) => a && String(a).trim().length > 0);
    const hasProfileGoals = profileGoals.some((g) => g && String(g).trim().length > 0);
    if (hasProfileAudience && !campaignAudience) {
      suggestions.push(
        _s('Align campaign audience with company profile target audience.', 'warning', 'company_alignment')
      );
    }
    if (hasProfileGoals && !campaignGoal) {
      suggestions.push(
        _s('Align campaign goal with company profile goals.', 'warning', 'company_alignment')
      );
    }
    const profilePlatforms = _ensureArray(profile.social_profiles).map((p: unknown) =>
      typeof p === 'object' && p && 'platform' in p ? String((p as { platform?: unknown }).platform).toLowerCase() : ''
    ).filter(Boolean);
    const planPlatforms = _ensureArray(execution_plan_val?.strategy_context?.platforms).map((p) => String(p).toLowerCase()).filter(Boolean);
    if (profilePlatforms.length > 0 && planPlatforms.length > 0) {
      const overlap = planPlatforms.filter((p) => profilePlatforms.includes(p) || profilePlatforms.includes(p === 'twitter' ? 'x' : p));
      if (overlap.length === 0) {
        suggestions.push(
          _s('Consider adding platforms from your company profile to improve reach.', 'info', 'company_alignment')
        );
      }
    }
  }

  const focusArr = _ensureArray(focus_modules);
  if (company_context_mode === 'focused_context' && focusArr.length > 0) {
    const labels: Record<string, string> = {
      TARGET_CUSTOMER: 'Target Customer',
      PROBLEM_DOMAIN: 'Problem Domains',
      CAMPAIGN_PURPOSE: 'Campaign Purpose',
      OFFERINGS: 'Offerings',
      GEOGRAPHY: 'Geography',
      PRICING: 'Pricing',
    };
    const selected = focusArr.map((m) => labels[String(m).toUpperCase()] || String(m)).filter(Boolean);
    if (selected.length > 0) {
      suggestions.push(
        _s(
          `Ensure campaign addresses selected focus: ${selected.join(', ')}.`,
          'info',
          'focus_coverage'
        )
      );
    }
  }

  if (suggestions.length === 0) {
    suggestions.push(
      _s('Campaign design and execution plan look well-aligned.', 'info', 'general')
    );
  }
  suggestions.sort((a, b) => a.priority - b.priority || (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99));
  const total_issue_count = suggestions.length;
  suggestions.splice(MAX_HEALTH_SUGGESTIONS);
  const visible_issue_count = suggestions.length;
  const hidden_issue_count = Math.max(0, total_issue_count - visible_issue_count);

  const allActivities = _ensureArray(activities);
  const acts = allActivities.filter((a) => (a as { source?: string })?.source !== 'system_generated');
  let metadataFilled = 0;
  for (const a of acts) {
    if (_text((a as CalendarPlanActivityInput)?.cta)) metadataFilled++;
    if (_text((a as CalendarPlanActivityInput)?.objective)) metadataFilled++;
    if (_text((a as CalendarPlanActivityInput)?.phase)) metadataFilled++;
  }
  const metadataDenom = 3 * acts.length;
  const metadata_completeness_score = metadataDenom > 0 ? Math.round((metadataFilled / metadataDenom) * 100) : 0;

  const SUMMARY_PRIORITY: Array<{ category: string; hasIssue: boolean }> = [
    { category: 'narrative', hasIssue: narrative_score < 60 },
    { category: 'role_distribution', hasIssue: (roleDist.missing_cta_count > 0 || roleDist.missing_objective_count > 0 || roleDist.missing_phase_count > 0) || (role_balance_score < 50 && roleDist.total >= 2) },
    { category: 'execution_cadence', hasIssue: execution_cadence_score < 50 },
    { category: 'platform_distribution', hasIssue: platform_distribution_score < 50 },
    { category: 'metadata', hasIssue: metadata_completeness_score < 60 },
  ];
  const topIssueCategories = SUMMARY_PRIORITY.filter((p) => p.hasIssue).map((p) => p.category).slice(0, 3);
  const needsImprovementLabels: Record<string, string> = {
    narrative: 'narrative and idea spine',
    role_distribution: 'role and CTA alignment',
    execution_cadence: 'execution cadence',
    platform_distribution: 'platform distribution',
    metadata: 'metadata completeness',
  };
  const needsImprovement = topIssueCategories.map((c) => needsImprovementLabels[c] || c);
  const health_summary = needsImprovement.length > 0
    ? `${needsImprovement.join(', ')} need improvement.`.replace(/^./, (c) => c.toUpperCase())
    : 'Campaign design and execution plan look well-aligned.';

  const roleBalanceVal = role_balance_score ?? 0;
  const score_breakdown: Record<string, number> = {
    narrative_score,
    content_mix_score,
    cadence_score,
    audience_alignment_score,
    execution_cadence_score,
    platform_distribution_score,
    role_balance_score: roleBalanceVal,
    metadata_completeness_score,
  };
  const mainScores = Object.values(score_breakdown);
  const rawHealthScore = mainScores.length > 0
    ? Math.round(mainScores.reduce((a, b) => a + b, 0) / mainScores.length)
    : 0;
  const health_score = Math.min(100, Math.max(0, rawHealthScore));

  const health_status: HealthStatus =
    health_score >= 90 ? 'excellent' :
    health_score >= 75 ? 'strong' :
    health_score >= 60 ? 'moderate' :
    health_score >= 40 ? 'weak' : 'critical';

  const health_grade =
    health_score >= 90 ? 'A' :
    health_score >= 80 ? 'B' :
    health_score >= 70 ? 'C' :
    health_score >= 60 ? 'D' : 'F';

  const health_trend = 'unknown';
  const primary_issue = topIssueCategories[0] ?? null;
  const report_id = `health_${Date.now()}_${randomUUID()}`;

  const activity_count_total = allActivities.length;
  const analyzed_count = acts.length;
  const issue_density = analyzed_count === 0 ? 0 : Math.min(1, total_issue_count / analyzed_count);

  const report_timestamp = new Date().toISOString();

  const evaluation_context = {
    evaluation_scope,
    report_generated_by,
    activity_sampled,
    activity_count_total,
    analyzed_activity_count: analyzed_count,
  };

  const health_flags: Record<string, boolean> = {
    has_issues: total_issue_count > 0,
    has_critical_suggestions: suggestions.some((s) => s.severity === 'critical'),
    has_role_distribution_issues: topIssueCategories.includes('role_distribution'),
    has_hidden_issues: hidden_issue_count > 0,
    low_confidence_detected: roleDist.low_confidence_ratio > LOW_CONFIDENCE_RATIO_THRESHOLD,
    has_metadata_issues: metadata_completeness_score < 70,
    has_execution_issues: execution_cadence_score < 70,
    has_platform_distribution_issues: platform_distribution_score < 70,
    has_narrative_issues: narrative_score < 70,
    has_audience_alignment_issues: audience_alignment_score < 70,
    has_content_mix_issues: content_mix_score < 70,
    has_cadence_issues: cadence_score < 70,
    has_multiple_critical_issues: total_issue_count >= 5,
  };

  const designScore = Math.round((content_mix_score + cadence_score + audience_alignment_score) / 3);
  const distributionScore = Math.round((platform_distribution_score + roleBalanceVal) / 2);
  const health_dimensions: Record<string, number> = {
    design: designScore,
    execution: execution_cadence_score,
    distribution: distributionScore,
    metadata: metadata_completeness_score,
    narrative: narrative_score,
  };

  const toDimensionStatus = (score: number): 'good' | 'warning' | 'critical' =>
    score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical';

  const dimension_status: Record<string, 'good' | 'warning' | 'critical'> = {
    design: toDimensionStatus(designScore),
    execution: toDimensionStatus(execution_cadence_score),
    distribution: toDimensionStatus(distributionScore),
    metadata: toDimensionStatus(metadata_completeness_score),
    narrative: toDimensionStatus(narrative_score),
  };

  const analysis_warnings: string[] = [];
  if (activity_sampled) analysis_warnings.push('Activity sampling was applied.');
  if (roleDist.low_confidence_ratio > 0.5) analysis_warnings.push('High proportion of activities with unclear funnel role.');
  const truncatedWarnings = analysis_warnings.slice(0, MAX_HEALTH_WARNINGS);

  return {
    narrative_score,
    content_mix_score,
    cadence_score,
    audience_alignment_score,
    execution_cadence_score,
    platform_distribution_score,
    role_distribution: roleDist,
    role_balance_score,
    metadata_completeness_score,
    missing_cta_total: roleDist.missing_cta_count,
    missing_objective_total: roleDist.missing_objective_count,
    missing_phase_total: roleDist.missing_phase_count,
    low_confidence_ratio: roleDist.low_confidence_ratio,
    low_confidence_count: roleDist.low_confidence_count,
    analyzed_activity_count: acts.length,
    issue_count: total_issue_count,
    visible_issue_count,
    hidden_issue_count,
    health_version: CAMPAIGN_HEALTH_SCHEMA_VERSION,
    evaluation_duration_ms: Date.now() - evaluation_start,
    evaluation_context,
    analysis_version_hash: ANALYSIS_VERSION_HASH,
    health_summary,
    top_issue_categories: topIssueCategories,
    health_score,
    health_grade,
    score_breakdown,
    health_status,
    health_flags,
    health_dimensions,
    dimension_status,
    health_trend,
    primary_issue,
    report_id,
    report_timestamp,
    issue_density,
    analysis_warnings: truncatedWarnings,
    evaluated_at: new Date().toISOString(),
    suggestions,
  };
}
