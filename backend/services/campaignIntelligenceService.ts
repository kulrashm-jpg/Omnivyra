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
