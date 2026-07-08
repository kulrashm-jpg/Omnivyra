/** Part 1/2 of growthGuidanceService.ts — verbatim split (barrel preserved; importers unchanged). */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getGoogleAnalyticsStatus, type GoogleAnalyticsConnectionStatus } from './analyticsIntegrationService';
import { sendDeterministicIntelligenceAlert } from './intelligenceAlertService';
import { ownedDbTable } from '../db/writeOwner';


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

export type GuidanceDomain = 'content' | 'campaign' | 'analytics' | 'execution' | 'general';

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

export type GrowthSignalSnapshot = {
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

export type GuidanceActionIntent =
  | 'publish_cadence_missing'
  | 'no_active_campaigns'
  | 'no_distribution'
  | 'start_weekly_content_rhythm'
  | 'start_first_campaign'
  | 'connect_analytics'
  | 'activate_distribution_channel'
  | 'improve_targeting_or_relevance'
  | 'optimize_conversion_follow_through';

export type GuidanceActionRow = {
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

export type GuidanceCandidateAlert = GrowthGuidanceAlert & {
  domain: GuidanceDomain;
  root_issue: string;
  action_intent?: GuidanceActionIntent | null;
};

export const CATEGORY_RANK: Record<GrowthGuidanceAlertType, number> = {
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

export function severityRank(severity: GrowthGuidanceSeverity): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export function normalizeGuidanceActionStatus(status: GuidanceActionRow['action_status']): GuidanceActionStatus | undefined {
  if (status === 'implemented') return 'completed';
  if (status === 'ignored') return undefined;
  return status;
}

export function isActionableGuidanceAlert(type: GrowthGuidanceAlertType): boolean {
  return type === 'critical_attention' || type === 'next_step';
}

export function resolveGuidanceIntent(alert: Pick<GrowthGuidanceAlert, 'type' | 'message'>): GuidanceActionIntent | null {
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

export function inferIntentFromKey(key: string): GuidanceActionIntent | null {
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
    let query = ownedDbTable(table).select(select);
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

export async function loadGrowthSignals(companyId: string): Promise<GrowthSignalSnapshot> {
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

export function isIntentResolved(intent: GuidanceActionIntent, signals: GrowthSignalSnapshot): boolean {
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

export async function loadGuidanceActions(companyId: string): Promise<GuidanceActionRow[]> {
  const { data, error } = await ownedDbTable('intelligence_actions')
    .select('id, recommendation_key, action_status, updated_at, created_at')
    .eq('company_id', companyId)
    .eq('source', 'guidance_alert')
    .limit(500);

  if (error) {
    throw new Error(`Failed to load guidance action state: ${error.message}`);
  }

  return (data ?? []) as GuidanceActionRow[];
}

export function computeExecutionMetrics(
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

export async function evaluateGrowthGuidance(companyId: string): Promise<GrowthGuidanceEvaluation> {
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

export function getResolvedCompletedActionKeys(actions: GuidanceActionRow[], signals: GrowthSignalSnapshot): Set<string> {
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

export function getCompletedGuidanceIntents(actions: GuidanceActionRow[], signals: GrowthSignalSnapshot): Set<GuidanceActionIntent> {
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

export function buildCriticalAttentionAlerts(
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

export function buildStalledExecutionAlerts(
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

