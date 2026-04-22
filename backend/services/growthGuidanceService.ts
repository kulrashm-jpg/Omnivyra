import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getGoogleAnalyticsStatus, type GoogleAnalyticsConnectionStatus } from './analyticsIntegrationService';
import { sendDeterministicIntelligenceAlert } from './intelligenceAlertService';

export type GrowthGuidanceAlertType =
  | 'critical_attention'
  | 'readiness_signal'
  | 'progress_signal'
  | 'stalled_execution'
  | 'missing_intelligence'
  | 'next_step'
  | 'upgrade_preview';

export type GrowthGuidanceSeverity = 'high' | 'medium' | 'low';
export type GrowthGuidanceEffort = 'low' | 'medium' | 'high';
export type GrowthReadinessStage =
  | 'no_signal'
  | 'early_signal'
  | 'consistent_signal'
  | 'ready_to_scale';

type GuidanceDomain = 'content' | 'campaign' | 'analytics' | 'execution' | 'general';

export interface GrowthGuidanceAlert {
  type: GrowthGuidanceAlertType;
  severity: GrowthGuidanceSeverity;
  message: string;
  action_hint?: string;
  impact?: string;
  effort?: GrowthGuidanceEffort;
  category_rank: number;
}

export type GuidanceActionStatus = 'pending' | 'in_progress' | 'completed';

export type GrowthGuidanceAlertWithAction = GrowthGuidanceAlert & {
  action_id?: string;
  action_key?: string;
  action_status?: GuidanceActionStatus;
  validation_failed?: boolean;
  action_feedback?: string;
};

export interface GrowthReadiness {
  stage: GrowthReadinessStage;
  score: number;
}

export interface GrowthExecutionMetrics {
  total_actions: number;
  completed_actions: number;
  pending_actions: number;
  completion_rate: number;
  avg_completion_time_days: number;
}

type GrowthSignalSnapshot = {
  publishing_frequency_per_week: number;
  published_posts_30d: number;
  distribution_active: boolean;
  active_campaigns: number;
  engagement_signals: number;
  integrations_connected: number;
  ga_status: GoogleAnalyticsConnectionStatus | null;
  last_content_activity_at: string | null;
  last_campaign_activity_at: string | null;
  last_distribution_activity_at: string | null;
};

type GuidanceActionIntent =
  | 'publish_cadence_missing'
  | 'no_active_campaigns'
  | 'no_distribution'
  | 'start_weekly_content_rhythm'
  | 'start_first_campaign'
  | 'connect_analytics'
  | 'activate_distribution_channel'
  | 'improve_targeting_or_relevance'
  | 'optimize_conversion_follow_through';

type GuidanceActionRow = {
  id: string;
  recommendation_key: string | null;
  action_status: GuidanceActionStatus | 'implemented' | 'ignored';
  updated_at?: string | null;
  created_at?: string | null;
};

type GrowthGuidanceEvaluation = {
  signals: GrowthSignalSnapshot;
  readiness: GrowthReadiness;
  executionMetrics: GrowthExecutionMetrics;
  guidanceActions: GuidanceActionRow[];
};

type GuidanceCandidateAlert = GrowthGuidanceAlert & {
  domain: GuidanceDomain;
  root_issue: string;
  action_intent?: GuidanceActionIntent | null;
};

const CATEGORY_RANK: Record<GrowthGuidanceAlertType, number> = {
  critical_attention: 1,
  readiness_signal: 2,
  progress_signal: 3,
  stalled_execution: 4,
  missing_intelligence: 5,
  next_step: 6,
  upgrade_preview: 7,
};

const KNOWN_GUIDANCE_INTENTS: GuidanceActionIntent[] = [
  'publish_cadence_missing',
  'no_active_campaigns',
  'no_distribution',
  'start_weekly_content_rhythm',
  'start_first_campaign',
  'connect_analytics',
  'activate_distribution_channel',
  'improve_targeting_or_relevance',
  'optimize_conversion_follow_through',
];

function severityRank(severity: GrowthGuidanceSeverity): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function normalizeGuidanceActionStatus(status: GuidanceActionRow['action_status']): GuidanceActionStatus | undefined {
  if (status === 'implemented') return 'completed';
  if (status === 'ignored') return undefined;
  return status;
}

function isActionableGuidanceAlert(type: GrowthGuidanceAlertType): boolean {
  return type === 'critical_attention' || type === 'next_step';
}

function resolveGuidanceIntent(alert: Pick<GrowthGuidanceAlert, 'type' | 'message'>): GuidanceActionIntent | null {
  const lower = alert.message.toLowerCase();

  if (alert.type === 'critical_attention') {
    if (lower.includes('publishing')) return 'publish_cadence_missing';
    if (lower.includes('distribution')) return 'no_distribution';
    if (lower.includes('campaign')) return 'no_active_campaigns';
  }

  if (alert.type === 'next_step') {
    if (lower.includes('weekly content rhythm')) return 'start_weekly_content_rhythm';
    if (lower.includes('structured campaign')) return 'start_first_campaign';
    if (lower.includes('connect analytics')) return 'connect_analytics';
    if (lower.includes('distribution channel')) return 'activate_distribution_channel';
    if (lower.includes('targeting') || lower.includes('landing page relevance')) return 'improve_targeting_or_relevance';
    return 'optimize_conversion_follow_through';
  }

  return null;
}

function buildIntentActionKey(type: 'critical_attention' | 'next_step', intent: GuidanceActionIntent): string {
  return createHash('sha256')
    .update(`${type}|${intent}`, 'utf8')
    .digest('hex');
}

function inferIntentFromKey(key: string): GuidanceActionIntent | null {
  for (const intent of KNOWN_GUIDANCE_INTENTS) {
    if (key === buildIntentActionKey('critical_attention', intent) || key === buildIntentActionKey('next_step', intent)) {
      return intent;
    }
  }
  return null;
}

export function buildGuidanceActionKey(alert: Pick<GrowthGuidanceAlert, 'type' | 'message'>): string {
  const intent = resolveGuidanceIntent(alert) ?? 'optimize_conversion_follow_through';
  return buildIntentActionKey(alert.type as 'critical_attention' | 'next_step', intent);
}

async function fetchRows(table: string, select: string, build?: (query: any) => any): Promise<Record<string, unknown>[]> {
  try {
    let query = supabase.from(table).select(select);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function getDaysSinceLastActivity(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.floor((Date.now() - value) / (24 * 60 * 60 * 1000)));
}

async function loadGrowthSignals(companyId: string): Promise<GrowthSignalSnapshot> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [
    campaignRows,
    scheduledPosts,
    socialAccounts,
    companyIntegrations,
    engagementThreads,
    responseMetrics,
    gaStatus,
  ] = await Promise.all([
    fetchRows('campaigns', 'status, created_at, updated_at', (query) => query.eq('company_id', companyId)),
    fetchRows('scheduled_posts', 'status, published_at, created_at', (query) => query.eq('company_id', companyId)),
    fetchRows('social_accounts', 'is_active', (query) => query.eq('company_id', companyId)),
    fetchRows('company_integrations', 'status', (query) => query.eq('company_id', companyId)),
    fetchRows('engagement_threads', 'id', (query) => query.eq('organization_id', companyId)),
    fetchRows('response_performance_metrics', 'id', (query) => query.eq('organization_id', companyId)),
    getGoogleAnalyticsStatus(companyId).catch(() => null),
  ]);

  const publishedPosts30d = scheduledPosts.filter((row) => {
    const status = String(row.status ?? '').trim().toLowerCase();
    const publishedAt = String(row.published_at ?? row.created_at ?? '');
    return status === 'published' && publishedAt >= since30d;
  }).length;

  return {
    publishing_frequency_per_week: Number((publishedPosts30d / (30 / 7)).toFixed(1)),
    published_posts_30d: publishedPosts30d,
    distribution_active: socialAccounts.some((row) => row.is_active === true) || publishedPosts30d > 0,
    active_campaigns: campaignRows.filter((row) => {
      const status = String(row.status ?? '').trim().toLowerCase();
      return status === 'active' || status === 'running' || status === 'in_progress';
    }).length,
    engagement_signals: engagementThreads.length + responseMetrics.length,
    integrations_connected: companyIntegrations.filter((row) => {
      const status = String(row.status ?? '').trim().toLowerCase();
      return status === 'connected' || status === 'active' || status === 'success';
    }).length,
    ga_status: gaStatus,
    last_content_activity_at: scheduledPosts.reduce<string | null>((latest, row) => {
      const timestamp = String(row.published_at ?? row.created_at ?? '').trim();
      if (!timestamp) return latest;
      if (!latest) return timestamp;
      return new Date(timestamp).getTime() > new Date(latest).getTime() ? timestamp : latest;
    }, null),
    last_campaign_activity_at: campaignRows.reduce<string | null>((latest, row) => {
      const timestamp = String((row as Record<string, unknown>).updated_at ?? row.created_at ?? '').trim();
      if (!timestamp) return latest;
      if (!latest) return timestamp;
      return new Date(timestamp).getTime() > new Date(latest).getTime() ? timestamp : latest;
    }, null),
    last_distribution_activity_at: scheduledPosts.reduce<string | null>((latest, row) => {
      const timestamp = String(row.published_at ?? '').trim();
      if (!timestamp) return latest;
      if (!latest) return timestamp;
      return new Date(timestamp).getTime() > new Date(latest).getTime() ? timestamp : latest;
    }, null),
  };
}

function isIntentResolved(intent: GuidanceActionIntent, signals: GrowthSignalSnapshot): boolean {
  switch (intent) {
    case 'publish_cadence_missing':
    case 'start_weekly_content_rhythm':
      return signals.published_posts_30d > 0 || signals.publishing_frequency_per_week >= 1;
    case 'no_active_campaigns':
    case 'start_first_campaign':
      return signals.active_campaigns > 0;
    case 'no_distribution':
    case 'activate_distribution_channel':
      return signals.distribution_active;
    case 'connect_analytics':
      return signals.ga_status?.ready === true;
    case 'improve_targeting_or_relevance':
      return signals.active_campaigns > 0 && signals.engagement_signals > 0;
    case 'optimize_conversion_follow_through':
      return signals.engagement_signals > 0;
    default:
      return false;
  }
}

async function loadGuidanceActions(companyId: string): Promise<GuidanceActionRow[]> {
  const { data, error } = await supabase
    .from('intelligence_actions')
    .select('id, recommendation_key, action_status, updated_at, created_at')
    .eq('company_id', companyId)
    .eq('source', 'guidance_alert')
    .limit(500);

  if (error) {
    throw new Error(`Failed to load guidance action state: ${error.message}`);
  }

  return (data ?? []) as GuidanceActionRow[];
}

function computeExecutionMetrics(
  actions: GuidanceActionRow[],
  signals: GrowthSignalSnapshot,
  sinceDays: number = 14,
): GrowthExecutionMetrics {
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const recentActions = actions.filter((action) => {
    const createdAt = action.created_at ? new Date(action.created_at).getTime() : NaN;
    return !Number.isNaN(createdAt) && createdAt >= cutoff;
  });

  const validatedCompleted = recentActions.filter((action) => {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    const key = String(action.recommendation_key ?? '').trim();
    const intent = key ? inferIntentFromKey(key) : null;
    return normalized === 'completed' && !!intent && isIntentResolved(intent, signals);
  });

  const pendingActions = recentActions.filter((action) => {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    if (normalized === 'pending' || normalized === 'in_progress') return true;
    if (normalized === 'completed') {
      const key = String(action.recommendation_key ?? '').trim();
      const intent = key ? inferIntentFromKey(key) : null;
      return !(intent && isIntentResolved(intent, signals));
    }
    return false;
  }).length;

  const completionRate = recentActions.length > 0 ? validatedCompleted.length / recentActions.length : 0;
  const completionTimes = validatedCompleted
    .map((action) => {
      const createdAt = action.created_at ? new Date(action.created_at).getTime() : NaN;
      const updatedAt = action.updated_at ? new Date(action.updated_at).getTime() : NaN;
      if (Number.isNaN(createdAt) || Number.isNaN(updatedAt) || updatedAt < createdAt) return null;
      return (updatedAt - createdAt) / (24 * 60 * 60 * 1000);
    })
    .filter((value): value is number => value != null);

  const avgCompletionTimeDays =
    completionTimes.length > 0
      ? Number((completionTimes.reduce((sum, value) => sum + value, 0) / completionTimes.length).toFixed(1))
      : 0;

  return {
    total_actions: recentActions.length,
    completed_actions: validatedCompleted.length,
    pending_actions: pendingActions,
    completion_rate: Number(completionRate.toFixed(4)),
    avg_completion_time_days: avgCompletionTimeDays,
  };
}

export async function getExecutionMetrics(companyId: string): Promise<GrowthExecutionMetrics> {
  const [signals, actions] = await Promise.all([
    loadGrowthSignals(companyId),
    loadGuidanceActions(companyId),
  ]);
  return computeExecutionMetrics(actions, signals);
}

function inferStageFromBaseScore(score: number): GrowthReadinessStage {
  if (score >= 75) return 'ready_to_scale';
  if (score >= 50) return 'consistent_signal';
  if (score >= 20) return 'early_signal';
  return 'no_signal';
}

function stageFloor(stage: GrowthReadinessStage): number {
  if (stage === 'ready_to_scale') return 60;
  if (stage === 'consistent_signal') return 40;
  if (stage === 'early_signal') return 20;
  return 0;
}

function proportionalDecay(daysInactive: number | null): number {
  if (daysInactive == null) return 20;
  return Math.min(20, Math.floor(daysInactive / 7) * 5);
}

function scoreGrowthReadiness(
  signals: GrowthSignalSnapshot,
  executionMetrics: GrowthExecutionMetrics,
): GrowthReadiness {
  let baseScore = 0;

  if (signals.publishing_frequency_per_week >= 1) baseScore += 30;
  else if (signals.published_posts_30d > 0) baseScore += 15;

  if (signals.active_campaigns >= 2) baseScore += 25;
  else if (signals.active_campaigns === 1) baseScore += 15;

  if (signals.engagement_signals >= 10) baseScore += 20;
  else if (signals.engagement_signals > 0) baseScore += 10;

  if (signals.integrations_connected >= 2) baseScore += 15;
  else if (signals.integrations_connected === 1) baseScore += 8;

  if (signals.ga_status?.ready) baseScore += 10;

  const baselineStage = inferStageFromBaseScore(baseScore);
  const contentDaysInactive = getDaysSinceLastActivity(signals.last_content_activity_at);
  const campaignDaysInactive = getDaysSinceLastActivity(signals.last_campaign_activity_at);

  const contentDecay = proportionalDecay(contentDaysInactive);
  const campaignDecay = proportionalDecay(campaignDaysInactive);
  const executionBoost = Math.min(15, executionMetrics.completion_rate * 100 * 0.2);

  const rawScore = baseScore - contentDecay - campaignDecay + executionBoost;
  const extremeInactivity =
    (contentDaysInactive ?? 999) >= 42 ||
    (campaignDaysInactive ?? 999) >= 56;

  const flooredScore = extremeInactivity
    ? rawScore
    : Math.max(rawScore, stageFloor(baselineStage));

  const score = Math.max(0, Math.min(100, flooredScore));
  const stage = inferStageFromBaseScore(score);

  return { stage, score: Number(score.toFixed(1)) };
}

export async function getGrowthReadiness(companyId: string): Promise<GrowthReadiness> {
  const [signals, actions] = await Promise.all([
    loadGrowthSignals(companyId),
    loadGuidanceActions(companyId),
  ]);
  const executionMetrics = computeExecutionMetrics(actions, signals);
  return scoreGrowthReadiness(signals, executionMetrics);
}

async function evaluateGrowthGuidance(companyId: string): Promise<GrowthGuidanceEvaluation> {
  const [signals, guidanceActions] = await Promise.all([
    loadGrowthSignals(companyId),
    loadGuidanceActions(companyId),
  ]);

  const executionMetrics = computeExecutionMetrics(guidanceActions, signals);

  return {
    signals,
    readiness: scoreGrowthReadiness(signals, executionMetrics),
    executionMetrics,
    guidanceActions,
  };
}

function getResolvedCompletedActionKeys(actions: GuidanceActionRow[], signals: GrowthSignalSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const action of actions) {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    const key = String(action.recommendation_key ?? '').trim();
    const intent = key ? inferIntentFromKey(key) : null;
    if (normalized === 'completed' && key && intent && isIntentResolved(intent, signals)) {
      keys.add(key);
    }
  }
  return keys;
}

function getCompletedGuidanceIntents(actions: GuidanceActionRow[], signals: GrowthSignalSnapshot): Set<GuidanceActionIntent> {
  const intents = new Set<GuidanceActionIntent>();
  for (const action of actions) {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    const key = String(action.recommendation_key ?? '').trim();
    const intent = key ? inferIntentFromKey(key) : null;
    if (normalized === 'completed' && intent && isIntentResolved(intent, signals)) {
      intents.add(intent);
    }
  }
  return intents;
}

function buildCriticalAttentionAlerts(
  signals: GrowthSignalSnapshot,
  resolvedCompletedKeys: Set<string>,
): GuidanceCandidateAlert[] {
  const alerts: GuidanceCandidateAlert[] = [];
  const daysSinceContent = getDaysSinceLastActivity(signals.last_content_activity_at);
  const daysSinceCampaign = getDaysSinceLastActivity(signals.last_campaign_activity_at);
  const daysSinceDistribution = getDaysSinceLastActivity(signals.last_distribution_activity_at);

  if (signals.publishing_frequency_per_week <= 0) {
    const alert: GuidanceCandidateAlert = {
      type: 'critical_attention',
      severity: 'high',
      message:
        daysSinceContent != null && daysSinceContent >= 14
          ? `No publishing activity in the last ${daysSinceContent} days - lead flow is likely stalled.`
          : 'No consistent publishing detected - lead generation will remain unstable.',
      action_hint: 'Start weekly content cadence.',
      category_rank: CATEGORY_RANK.critical_attention,
      domain: 'content',
      root_issue: 'content_health',
      action_intent: 'publish_cadence_missing',
    };
    if (!resolvedCompletedKeys.has(buildGuidanceActionKey(alert))) alerts.push(alert);
  }

  if (!signals.distribution_active) {
    const alert: GuidanceCandidateAlert = {
      type: 'critical_attention',
      severity: 'high',
      message:
        daysSinceDistribution != null && daysSinceDistribution >= 7
          ? `No distribution activity in the last ${daysSinceDistribution} days - content is not reaching your audience.`
          : 'No distribution activity detected recently - content is not reaching your audience.',
      action_hint: 'Activate one consistent distribution channel.',
      category_rank: CATEGORY_RANK.critical_attention,
      domain: 'content',
      root_issue: 'content_distribution',
      action_intent: 'no_distribution',
    };
    if (!resolvedCompletedKeys.has(buildGuidanceActionKey(alert))) alerts.push(alert);
  }

  if (signals.active_campaigns === 0) {
    const alert: GuidanceCandidateAlert = {
      type: 'critical_attention',
      severity: 'high',
      message:
        daysSinceCampaign != null && daysSinceCampaign >= 30
          ? `No campaign activity in the last ${daysSinceCampaign} days - no active demand generation is running.`
          : 'No active campaigns detected - there is no structured engine turning attention into pipeline.',
      action_hint: 'Launch your first structured campaign.',
      category_rank: CATEGORY_RANK.critical_attention,
      domain: 'campaign',
      root_issue: 'campaign_health',
      action_intent: 'no_active_campaigns',
    };
    if (!resolvedCompletedKeys.has(buildGuidanceActionKey(alert))) alerts.push(alert);
  }

  return alerts;
}

function buildStalledExecutionAlerts(
  actions: GuidanceActionRow[],
  executionMetrics: GrowthExecutionMetrics,
): GuidanceCandidateAlert[] {
  const alerts: GuidanceCandidateAlert[] = [];
  const stalledCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const action of actions) {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    const key = String(action.recommendation_key ?? '').trim();
    const intent = key ? inferIntentFromKey(key) : null;
    const updatedAt = action.updated_at ? new Date(action.updated_at).getTime() : NaN;
    if (normalized !== 'in_progress' || !intent || Number.isNaN(updatedAt) || updatedAt >= stalledCutoff) continue;

    const domain: GuidanceDomain =
      intent === 'connect_analytics'
        ? 'analytics'
        : intent === 'start_first_campaign' || intent === 'no_active_campaigns' || intent === 'improve_targeting_or_relevance'
          ? 'campaign'
          : 'content';

    alerts.push({
      type: 'stalled_execution',
      severity: 'medium',
      message: 'Execution started but not completed - progress is stalled.',
      impact: 'Delays are slowing down growth momentum.',
      category_rank: CATEGORY_RANK.stalled_execution,
      domain,
      root_issue: `${domain}_execution`,
      action_intent: intent,
    });
  }

  if (executionMetrics.total_actions >= 3 && executionMetrics.completion_rate < 0.3) {
    alerts.push({
      type: 'stalled_execution',
      severity: 'medium',
      message: 'Execution rate is low - actions are not being followed consistently.',
      impact: 'Plans are being set, but not turning into momentum.',
      category_rank: CATEGORY_RANK.stalled_execution,
      domain: 'execution',
      root_issue: 'execution_velocity',
    });
  }

  if (executionMetrics.completed_actions > 0 && executionMetrics.avg_completion_time_days >= 7) {
    alerts.push({
      type: 'stalled_execution',
      severity: 'low',
      message: 'Execution cycle is slow - delays are impacting growth momentum.',
      impact: 'Long execution cycles make learning and improvement slower.',
      category_rank: CATEGORY_RANK.stalled_execution,
      domain: 'execution',
      root_issue: 'execution_speed',
    });
  }

  return alerts;
}

function buildMissingIntelligenceAlerts(signals: GrowthSignalSnapshot): GuidanceCandidateAlert[] {
  const alerts: GuidanceCandidateAlert[] = [];

  if (!signals.ga_status?.integration) {
    alerts.push({
      type: 'missing_intelligence',
      severity: 'medium',
      message: 'You cannot see where users drop off yet.',
      impact: 'Limits ability to improve conversion.',
      action_hint: 'Connect analytics when you are ready to inspect drop-off and funnel behavior.',
      category_rank: CATEGORY_RANK.missing_intelligence,
      domain: 'analytics',
      root_issue: 'analytics_visibility',
      action_intent: 'connect_analytics',
    });
  }

  if (!signals.ga_status?.ready) {
    alerts.push({
      type: 'missing_intelligence',
      severity: 'medium',
      message: 'Conversion and funnel visibility are still incomplete.',
      impact: 'Limits ability to prioritize lead fixes with confidence.',
      action_hint: 'Enable conversion tracking so lead friction becomes measurable.',
      category_rank: CATEGORY_RANK.missing_intelligence,
      domain: 'analytics',
      root_issue: 'analytics_visibility',
      action_intent: 'connect_analytics',
    });
  }

  return alerts;
}

function buildNextStepAlerts(
  readiness: GrowthReadiness,
  signals: GrowthSignalSnapshot,
  completedIntents: Set<GuidanceActionIntent>,
  resolvedCompletedKeys: Set<string>,
): GuidanceCandidateAlert[] {
  const candidates: Array<{ domain: GuidanceDomain; intent: GuidanceActionIntent; alert: GuidanceCandidateAlert }> = [];

  if (signals.published_posts_30d > 0 && !signals.distribution_active) {
    candidates.push({
      domain: 'content',
      intent: 'activate_distribution_channel',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Activate distribution channels so your existing content starts reaching buyers consistently.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'content',
        root_issue: 'content_distribution',
        action_intent: 'activate_distribution_channel',
      },
    });
  }

  if (signals.active_campaigns > 0 && signals.engagement_signals === 0) {
    candidates.push({
      domain: 'campaign',
      intent: 'improve_targeting_or_relevance',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Improve targeting or landing page relevance so campaigns start generating engagement.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'campaign',
        root_issue: 'campaign_quality',
        action_intent: 'improve_targeting_or_relevance',
      },
    });
  }

  if (readiness.stage === 'no_signal') {
    candidates.push({
      domain: 'content',
      intent: 'start_weekly_content_rhythm',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Build a weekly content rhythm first so the system can start learning from real signal.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'content',
        root_issue: 'content_buildout',
        action_intent: 'start_weekly_content_rhythm',
      },
    });
    candidates.push({
      domain: 'campaign',
      intent: 'start_first_campaign',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Start your first structured campaign to validate demand and channel response.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'campaign',
        root_issue: 'campaign_buildout',
        action_intent: 'start_first_campaign',
      },
    });
  } else if (readiness.stage === 'early_signal') {
    candidates.push({
      domain: 'campaign',
      intent: 'start_first_campaign',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Start your first structured campaign to validate demand and channel response.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'campaign',
        root_issue: 'campaign_buildout',
        action_intent: 'start_first_campaign',
      },
    });
    if (!signals.ga_status?.ready) {
      candidates.push({
        domain: 'analytics',
        intent: 'connect_analytics',
        alert: {
          type: 'next_step',
          severity: 'medium',
          message: 'Connect analytics so you can see which journeys convert and which pages leak demand.',
          effort: 'medium',
          category_rank: CATEGORY_RANK.next_step,
          domain: 'analytics',
          root_issue: 'analytics_visibility',
          action_intent: 'connect_analytics',
        },
      });
    }
  } else if (readiness.stage === 'consistent_signal' && !signals.ga_status?.ready) {
    candidates.push({
      domain: 'analytics',
      intent: 'connect_analytics',
      alert: {
        type: 'next_step',
        severity: 'medium',
        message: 'Connect analytics so you can see which journeys convert and which pages leak demand.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'analytics',
        root_issue: 'analytics_visibility',
        action_intent: 'connect_analytics',
      },
    });
    candidates.push({
      domain: 'campaign',
      intent: 'optimize_conversion_follow_through',
      alert: {
        type: 'next_step',
        severity: 'low',
        message: 'Tighten conversion follow-through and double down on the channels already producing engaged demand.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'campaign',
        root_issue: 'campaign_quality',
        action_intent: 'optimize_conversion_follow_through',
      },
    });
  } else {
    candidates.push({
      domain: 'campaign',
      intent: 'optimize_conversion_follow_through',
      alert: {
        type: 'next_step',
        severity: 'low',
        message: 'Tighten conversion follow-through and double down on the channels already producing engaged demand.',
        effort: 'medium',
        category_rank: CATEGORY_RANK.next_step,
        domain: 'campaign',
        root_issue: 'campaign_quality',
        action_intent: 'optimize_conversion_follow_through',
      },
    });
  }

  const selected: GuidanceCandidateAlert[] = [];
  const usedDomains = new Set<GuidanceDomain>();

  for (const candidate of candidates) {
    if (selected.length >= 2) break;
    if (usedDomains.has(candidate.domain)) continue;
    if (completedIntents.has(candidate.intent)) continue;
    if (resolvedCompletedKeys.has(buildGuidanceActionKey(candidate.alert))) continue;
    usedDomains.add(candidate.domain);
    selected.push(candidate.alert);
  }

  return selected;
}

function buildReadinessAlert(readiness: GrowthReadiness): GuidanceCandidateAlert {
  if (readiness.stage === 'ready_to_scale') {
    return {
      type: 'readiness_signal',
      severity: 'low',
      message: 'You now have enough signal to unlock performance intelligence.',
      category_rank: CATEGORY_RANK.readiness_signal,
      domain: 'general',
      root_issue: 'readiness_state',
    };
  }

  return {
    type: 'readiness_signal',
    severity: 'medium',
    message: 'You are not ready for advanced performance analysis yet. Build consistent signal first.',
    category_rank: CATEGORY_RANK.readiness_signal,
    domain: 'general',
    root_issue: 'readiness_state',
  };
}

function buildRecoveredProgressSignals(
  actions: GuidanceActionRow[],
  signals: GrowthSignalSnapshot,
): GuidanceCandidateAlert[] {
  const alerts: GuidanceCandidateAlert[] = [];
  const recoveryWindowCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const action of actions) {
    const normalized = normalizeGuidanceActionStatus(action.action_status);
    if (normalized !== 'completed') continue;
    const updatedAt = action.updated_at ? new Date(action.updated_at).getTime() : NaN;
    if (Number.isNaN(updatedAt) || updatedAt < recoveryWindowCutoff) continue;
    const key = String(action.recommendation_key ?? '').trim();
    const intent = key ? inferIntentFromKey(key) : null;
    if (!intent || !isIntentResolved(intent, signals)) continue;

    if (intent === 'publish_cadence_missing' || intent === 'start_weekly_content_rhythm') {
      alerts.push({
        type: 'progress_signal',
        severity: 'low',
        message: 'Publishing consistency restored - system is now generating stable signal.',
        category_rank: CATEGORY_RANK.progress_signal,
        domain: 'content',
        root_issue: 'content_recovered',
      });
    }

    if (intent === 'no_active_campaigns' || intent === 'start_first_campaign') {
      alerts.push({
        type: 'progress_signal',
        severity: 'low',
        message: 'Campaign activity restored - demand generation is now active again.',
        category_rank: CATEGORY_RANK.progress_signal,
        domain: 'campaign',
        root_issue: 'campaign_recovered',
      });
    }
  }

  return alerts;
}

function buildProgressSignal(readiness: GrowthReadiness): GuidanceCandidateAlert | null {
  if (readiness.stage === 'early_signal') {
    return {
      type: 'progress_signal',
      severity: 'low',
      message: 'You have started building activity - early signals are forming.',
      category_rank: CATEGORY_RANK.progress_signal,
      domain: 'general',
      root_issue: 'progress_state',
    };
  }

  if (readiness.stage === 'consistent_signal') {
    return {
      type: 'progress_signal',
      severity: 'low',
      message: 'You now have consistent activity - the system is generating usable signal.',
      category_rank: CATEGORY_RANK.progress_signal,
      domain: 'general',
      root_issue: 'progress_state',
    };
  }

  if (readiness.stage === 'ready_to_scale') {
    return {
      type: 'progress_signal',
      severity: 'low',
      message: 'You have enough signal to make confident optimization decisions.',
      category_rank: CATEGORY_RANK.progress_signal,
      domain: 'general',
      root_issue: 'progress_state',
    };
  }

  return null;
}

function buildUpgradePreviewAlert(readiness: GrowthReadiness, signals: GrowthSignalSnapshot): GuidanceCandidateAlert | null {
  const hasRealSignal =
    signals.active_campaigns > 0 ||
    signals.publishing_frequency_per_week >= 1 ||
    signals.engagement_signals > 0;

  if (readiness.score < 70 || !hasRealSignal) {
    return null;
  }

  return {
    type: 'upgrade_preview',
    severity: 'low',
    message: 'You now have enough real signal. Advanced analysis can show exactly where you are losing leads and how to fix it.',
    category_rank: CATEGORY_RANK.upgrade_preview,
    domain: 'general',
    root_issue: 'upgrade_state',
  };
}

function consolidateAlerts(alerts: GuidanceCandidateAlert[]): GuidanceCandidateAlert[] {
  const grouped = new Map<string, GuidanceCandidateAlert[]>();
  for (const alert of alerts) {
    const current = grouped.get(alert.root_issue) ?? [];
    current.push(alert);
    grouped.set(alert.root_issue, current);
  }

  return [...grouped.values()].map((group) => {
    const sorted = [...group].sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return left.category_rank - right.category_rank;
    });

    const primary = sorted[0];
    const uniqueMessages = [...new Set(sorted.map((item) => item.message.trim()))];
    const uniqueActionHints = [...new Set(sorted.map((item) => item.action_hint).filter(Boolean))] as string[];
    const impact = [...new Set(sorted.map((item) => item.impact).filter(Boolean))][0] as string | undefined;

    let mergedMessage = uniqueMessages[0] ?? primary.message;
    if (group.length > 1) {
      mergedMessage = `${uniqueMessages[0]} -> ${uniqueMessages[1] ?? 'execution is stalled and needs follow-through.'}`;
    }

    if (primary.root_issue === 'content_health' && group.length > 1) {
      mergedMessage = 'Publishing is inconsistent and execution is stalled -> lead flow is unstable.';
    }

    return {
      ...primary,
      message: mergedMessage,
      action_hint: uniqueActionHints[0],
      impact,
    };
  });
}

function reduceAlertNoise(alerts: GuidanceCandidateAlert[]): GuidanceCandidateAlert[] {
  const criticalByDomain = new Set<GuidanceDomain>();
  const kept: GuidanceCandidateAlert[] = [];

  const sorted = [...alerts].sort((left, right) => {
    const categoryDelta = left.category_rank - right.category_rank;
    if (categoryDelta !== 0) return categoryDelta;
    return severityRank(right.severity) - severityRank(left.severity);
  });

  for (const alert of sorted) {
    if (kept.length >= 5) break;

    if (alert.type === 'critical_attention') {
      if (criticalByDomain.has(alert.domain)) continue;
      criticalByDomain.add(alert.domain);
    }

    kept.push(alert);
  }

  return kept;
}

export async function validateGuidanceActionCompletion(
  companyId: string,
  recommendationKey: string | null,
): Promise<boolean> {
  if (!recommendationKey) return false;
  const intent = inferIntentFromKey(recommendationKey);
  if (!intent) return true;
  const signals = await loadGrowthSignals(companyId);
  return isIntentResolved(intent, signals);
}

export async function generateGrowthGuidanceAlerts(companyId: string): Promise<{
  readiness: GrowthReadiness;
  alerts: GrowthGuidanceAlert[];
}> {
  const { signals, readiness, guidanceActions, executionMetrics } = await evaluateGrowthGuidance(companyId);
  const resolvedCompletedKeys = getResolvedCompletedActionKeys(guidanceActions, signals);
  const completedIntents = getCompletedGuidanceIntents(guidanceActions, signals);

  const candidates = [
    ...buildCriticalAttentionAlerts(signals, resolvedCompletedKeys),
    buildReadinessAlert(readiness),
    ...buildRecoveredProgressSignals(guidanceActions, signals),
    ...([buildProgressSignal(readiness)].filter(Boolean) as GuidanceCandidateAlert[]),
    ...buildStalledExecutionAlerts(guidanceActions, executionMetrics),
    ...buildMissingIntelligenceAlerts(signals),
    ...buildNextStepAlerts(readiness, signals, completedIntents, resolvedCompletedKeys),
    ...([buildUpgradePreviewAlert(readiness, signals)].filter(Boolean) as GuidanceCandidateAlert[]),
  ];

  const alerts = reduceAlertNoise(consolidateAlerts(candidates)).map(({ domain, root_issue, action_intent, ...alert }) => alert);
  return { readiness, alerts };
}

async function ensureGuidanceActions(
  companyId: string,
  alerts: GrowthGuidanceAlert[],
): Promise<Map<string, GuidanceActionRow>> {
  const actionableAlerts = alerts.filter((alert) => isActionableGuidanceAlert(alert.type));
  if (actionableAlerts.length === 0) {
    return new Map();
  }

  const actionKeys = actionableAlerts.map((alert) => buildGuidanceActionKey(alert));
  const { data: existingRows, error: existingError } = await supabase
    .from('intelligence_actions')
    .select('id, recommendation_key, action_status, updated_at, created_at')
    .eq('company_id', companyId)
    .eq('source', 'guidance_alert')
    .in('recommendation_key', actionKeys);

  if (existingError) {
    throw new Error(`Failed to load guidance actions: ${existingError.message}`);
  }

  const existingByKey = new Map<string, GuidanceActionRow>();
  for (const row of (existingRows ?? []) as GuidanceActionRow[]) {
    const key = String(row.recommendation_key ?? '').trim();
    if (!key) continue;
    existingByKey.set(key, row);
  }

  const rowsToInsert = actionableAlerts
    .map((alert) => ({
      alert,
      actionKey: buildGuidanceActionKey(alert),
      intent: resolveGuidanceIntent(alert),
    }))
    .filter(({ actionKey }) => !existingByKey.has(actionKey))
    .map(({ alert, actionKey, intent }) => ({
      company_id: companyId,
      source: 'guidance_alert',
      recommendation_type: alert.type,
      recommendation_message: alert.message,
      action_status: 'pending',
      recommendation_key: actionKey,
      linked_insight_type: alert.type,
      recommendation_context: {
        guidance_type: alert.type,
        guidance_intent: intent,
        severity: alert.severity,
        action_hint: alert.action_hint ?? null,
        impact: alert.impact ?? null,
        effort: alert.effort ?? null,
      },
      baseline_metrics: {},
      manual_override: {},
    }));

  if (rowsToInsert.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from('intelligence_actions')
      .insert(rowsToInsert)
      .select('id, recommendation_key, action_status, updated_at, created_at');

    if (insertError) {
      throw new Error(`Failed to create guidance actions: ${insertError.message}`);
    }

    for (const row of (insertedRows ?? []) as GuidanceActionRow[]) {
      const key = String(row.recommendation_key ?? '').trim();
      if (!key) continue;
      existingByKey.set(key, row);
    }
  }

  return existingByKey;
}

async function loadValidationFeedbackMap(companyId: string): Promise<Map<string, string>> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('intelligence_actions')
    .select('recommendation_key, updated_at, manual_override')
    .eq('company_id', companyId)
    .eq('source', 'guidance_alert')
    .gte('updated_at', since7d)
    .limit(500);

  if (error) {
    throw new Error(`Failed to load guidance validation feedback: ${error.message}`);
  }

  const feedback = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ recommendation_key?: string | null; manual_override?: Record<string, unknown> | null }>) {
    const key = String(row.recommendation_key ?? '').trim();
    const message = typeof row.manual_override?.validation_message === 'string'
      ? row.manual_override.validation_message
      : '';
    if (key && message) {
      feedback.set(key, message);
    }
  }

  return feedback;
}

export async function generateGrowthGuidanceAlertsWithActions(companyId: string): Promise<{
  readiness: GrowthReadiness;
  executionMetrics: GrowthExecutionMetrics;
  alerts: GrowthGuidanceAlertWithAction[];
}> {
  const guidance = await generateGrowthGuidanceAlerts(companyId);
  const [signals, actions, validationFeedback] = await Promise.all([
    loadGrowthSignals(companyId),
    loadGuidanceActions(companyId),
    loadValidationFeedbackMap(companyId),
  ]);
  const executionMetrics = computeExecutionMetrics(actions, signals);
  const actionsByKey = await ensureGuidanceActions(companyId, guidance.alerts);

  return {
    readiness: guidance.readiness,
    executionMetrics,
    alerts: guidance.alerts.map((alert) => {
      if (!isActionableGuidanceAlert(alert.type)) {
        return alert;
      }

      const actionKey = buildGuidanceActionKey(alert);
      const action = actionsByKey.get(actionKey);
      const feedback = validationFeedback.get(actionKey);

      return {
        ...alert,
        action_id: action?.id,
        action_key: actionKey,
        action_status: action ? normalizeGuidanceActionStatus(action.action_status) : undefined,
        validation_failed: !!feedback,
        action_feedback: feedback,
      };
    }),
  };
}

export async function syncGrowthGuidanceAlerts(companyId: string): Promise<{
  readiness: GrowthReadiness;
  alerts: GrowthGuidanceAlert[];
  sent: number;
  deduplicated: number;
}> {
  const guidance = await generateGrowthGuidanceAlerts(companyId);
  let sent = 0;
  let deduplicated = 0;

  for (const alert of guidance.alerts) {
    const result = await sendDeterministicIntelligenceAlert({
      company_id: companyId,
      event_type: alert.type,
      rule_types: [alert.type],
      message: alert.message,
      channels: ['in_app'],
      cooldown_hours: 24,
      event_data: {
        severity: alert.severity,
        action_hint: alert.action_hint ?? null,
        impact: alert.impact ?? null,
        effort: alert.effort ?? null,
        readiness_stage: guidance.readiness.stage,
        readiness_score: guidance.readiness.score,
      },
    });

    if (result.sent.length > 0) sent += 1;
    else if (result.deduplicated) deduplicated += 1;
  }

  return { ...guidance, sent, deduplicated };
}
