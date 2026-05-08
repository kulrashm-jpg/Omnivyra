import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getBasicFunnel, getConversionSummary, getDropOffPages, getTopPages, getTrafficSources } from './behaviorAnalyticsService';
import type {

  BehaviorRecommendation,
  BehaviorRecommendationReportData,
  BehaviorRecommendationType,
} from './behaviorRecommendationService';
import { ownedDbTable } from '../db/writeOwner';

export interface BehaviorRecommendationLearningStats {
  recommendation_type: BehaviorRecommendationType;
  average_impact_score: number;
  success_rate: number;
  sample_size: number;
  priority_adjustment: number;
}

export type BehaviorRecommendationLearningProfile =
  Partial<Record<BehaviorRecommendationType, BehaviorRecommendationLearningStats>>;

type PersistedIntelligenceActionRow = {
  id: string;
  company_id: string;
  recommendation_type: BehaviorRecommendationType;
  recommendation_message: string;
  action_status: 'pending' | 'implemented' | 'ignored';
  impact_score: number | null;
  recommendation_context: Record<string, unknown> | null;
  baseline_metrics: Record<string, unknown> | null;
  evaluation_due_at: string | null;
};

const EVALUATION_WINDOW_DAYS = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function buildRecommendationKey(recommendation: BehaviorRecommendation): string {
  const scope =
    typeof recommendation.context?.page_url === 'string'
      ? recommendation.context.page_url
      : typeof recommendation.context?.traffic_source === 'string'
        ? `${recommendation.context.traffic_source}|${String(recommendation.context?.source_medium ?? '')}`
        : recommendation.type;

  return createHash('sha256')
    .update(`${recommendation.type}|${recommendation.message}|${scope}`, 'utf8')
    .digest('hex');
}

function evaluationDueAtIso(): string {
  return new Date(Date.now() + EVALUATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function buildBaselineMetrics(
  recommendation: BehaviorRecommendation,
  reportData: BehaviorRecommendationReportData,
): Record<string, unknown> {
  const context = recommendation.context ?? {};

  if (recommendation.type === 'ux_fix') {
    return {
      page_url: context.page_url ?? null,
      drop_off_rate: context.baseline_metric ?? null,
      entry_sessions: context.entry_sessions ?? null,
    };
  }

  if (recommendation.type === 'messaging_fix') {
    const step = reportData.funnel.steps.find((item) => item.step === 'engagement');
    return {
      funnel_step: 'engagement',
      drop_pct: context.baseline_metric ?? null,
      users: step?.users ?? null,
    };
  }

  if (recommendation.type === 'conversion_optimization') {
    const step = reportData.funnel.steps.find((item) => item.step === 'conversion');
    return {
      funnel_step: 'conversion',
      drop_pct: context.baseline_metric ?? null,
      conversion_rate_per_session: reportData.conversions.conversion_rate_per_session,
      users: step?.users ?? null,
    };
  }

  if (recommendation.type === 'traffic_alignment') {
    return {
      traffic_source: context.traffic_source ?? null,
      source_medium: context.source_medium ?? null,
      conversion_rate: context.baseline_metric ?? null,
      sessions: context.sessions ?? null,
    };
  }

  if (recommendation.type === 'content_optimization') {
    return {
      page_url: context.page_url ?? null,
      engagement_rate: context.baseline_metric ?? null,
      visits: context.visits ?? null,
    };
  }

  return {
    page_url: context.page_url ?? null,
    conversion_rate: context.baseline_metric ?? null,
    visits: context.visits ?? null,
  };
}

export async function recordGeneratedBehaviorRecommendations(
  companyId: string,
  recommendations: BehaviorRecommendation[],
  reportData: BehaviorRecommendationReportData,
): Promise<void> {
  if (recommendations.length === 0) {
    return;
  }

  const payload = recommendations.map((recommendation) => ({
    recommendation,
    recommendationKey: buildRecommendationKey(recommendation),
    baselineMetrics: buildBaselineMetrics(recommendation, reportData),
  }));

  const recommendationKeys = payload.map((item) => item.recommendationKey);
  const { data: existingRows, error: existingError } = await ownedDbTable('intelligence_actions')
    .select('recommendation_key')
    .eq('company_id', companyId)
    .eq('action_status', 'pending')
    .is('evaluated_at', null)
    .in('recommendation_key', recommendationKeys);

  if (existingError) {
    throw new Error(`Failed to check existing intelligence actions: ${existingError.message}`);
  }

  const existingKeys = new Set((existingRows ?? []).map((row) => String((row as { recommendation_key?: string }).recommendation_key ?? '')));
  const rowsToInsert = payload
    .filter((item) => !existingKeys.has(item.recommendationKey))
    .map((item) => ({
      company_id: companyId,
      recommendation_type: item.recommendation.type,
      recommendation_message: item.recommendation.message,
      action_status: 'pending',
      recommendation_key: item.recommendationKey,
      linked_insight_type: item.recommendation.linked_insight,
      recommendation_context: item.recommendation.context ?? {},
      baseline_metrics: item.baselineMetrics,
      evaluation_due_at: evaluationDueAtIso(),
      user_feedback_status: null,
      manual_override: {},
    }));

  if (rowsToInsert.length === 0) {
    return;
  }

  const { error } = await ownedDbTable('intelligence_actions').insert(rowsToInsert);
  if (error) {
    throw new Error(`Failed to persist intelligence actions: ${error.message}`);
  }
}

async function computeCurrentOutcomeMetrics(
  companyId: string,
  action: PersistedIntelligenceActionRow,
): Promise<Record<string, unknown>> {
  const baseline = action.baseline_metrics ?? {};
  const context = action.recommendation_context ?? {};

  if (action.recommendation_type === 'ux_fix') {
    const pageUrl = String(baseline.page_url ?? context.page_url ?? '');
    const rows = await getDropOffPages(companyId, { sinceDays: EVALUATION_WINDOW_DAYS });
    const page = rows.find((row) => row.page_url === pageUrl);
    return {
      page_url: pageUrl,
      drop_off_rate: page?.drop_off_rate ?? null,
      entry_sessions: page?.entry_sessions ?? null,
    };
  }

  if (action.recommendation_type === 'messaging_fix') {
    const funnel = await getBasicFunnel(companyId, { sinceDays: EVALUATION_WINDOW_DAYS });
    const engagementStep = funnel.steps.find((step) => step.step === 'engagement');
    return {
      funnel_step: 'engagement',
      drop_pct: engagementStep?.drop_pct ?? null,
      users: engagementStep?.users ?? null,
    };
  }

  if (action.recommendation_type === 'conversion_optimization') {
    const [funnel, conversions] = await Promise.all([
      getBasicFunnel(companyId, { sinceDays: EVALUATION_WINDOW_DAYS }),
      getConversionSummary(companyId, { sinceDays: EVALUATION_WINDOW_DAYS }),
    ]);
    const conversionStep = funnel.steps.find((step) => step.step === 'conversion');
    return {
      funnel_step: 'conversion',
      drop_pct: conversionStep?.drop_pct ?? null,
      conversion_rate_per_session: conversions.conversion_rate_per_session,
      users: conversionStep?.users ?? null,
    };
  }

  if (action.recommendation_type === 'traffic_alignment') {
    const trafficSource = String(baseline.traffic_source ?? context.traffic_source ?? '');
    const sourceMedium = String(baseline.source_medium ?? context.source_medium ?? '');
    const sources = await getTrafficSources(companyId, { sinceDays: EVALUATION_WINDOW_DAYS });
    const source = sources.find((row) => row.traffic_source === trafficSource && row.source_medium === sourceMedium);
    return {
      traffic_source: trafficSource,
      source_medium: sourceMedium,
      conversion_rate: source ? safeDiv(source.conversions, source.sessions) : null,
      sessions: source?.sessions ?? null,
    };
  }

  if (action.recommendation_type === 'content_optimization') {
    const pageUrl = String(baseline.page_url ?? context.page_url ?? '');
    const pages = await getTopPages(companyId, { sinceDays: EVALUATION_WINDOW_DAYS });
    const page = pages.find((row) => row.page_url === pageUrl);
    return {
      page_url: pageUrl,
      engagement_rate: page ? safeDiv(page.events, page.visits) : null,
      visits: page?.visits ?? null,
    };
  }

  const pageUrl = String(baseline.page_url ?? context.page_url ?? '');
  const pages = await getTopPages(companyId, { sinceDays: EVALUATION_WINDOW_DAYS });
  const page = pages.find((row) => row.page_url === pageUrl);
  return {
    page_url: pageUrl,
    conversion_rate: page ? safeDiv(page.conversions, page.visits) : null,
    visits: page?.visits ?? null,
  };
}

function calculateImpactScore(
  recommendationType: BehaviorRecommendationType,
  baselineMetrics: Record<string, unknown>,
  outcomeMetrics: Record<string, unknown>,
): number {
  if (recommendationType === 'ux_fix' || recommendationType === 'messaging_fix') {
    const baseline = Number(baselineMetrics.drop_off_rate ?? baselineMetrics.drop_pct ?? 0);
    const current = Number(outcomeMetrics.drop_off_rate ?? outcomeMetrics.drop_pct ?? baseline);
    return Number(clamp((baseline - current) * 100, -100, 100).toFixed(2));
  }

  if (recommendationType === 'conversion_optimization') {
    const baselineDrop = Number(baselineMetrics.drop_pct ?? 0);
    const currentDrop = Number(outcomeMetrics.drop_pct ?? baselineDrop);
    const baselineRate = Number(baselineMetrics.conversion_rate_per_session ?? 0);
    const currentRate = Number(outcomeMetrics.conversion_rate_per_session ?? baselineRate);
    const dropImprovement = baselineDrop - currentDrop;
    const rateImprovement = currentRate - baselineRate;
    return Number(clamp((dropImprovement * 60) + (rateImprovement * 400), -100, 100).toFixed(2));
  }

  if (recommendationType === 'traffic_alignment' || recommendationType === 'cta_optimization') {
    const baseline = Number(baselineMetrics.conversion_rate ?? 0);
    const current = Number(outcomeMetrics.conversion_rate ?? baseline);
    return Number(clamp((current - baseline) * 400, -100, 100).toFixed(2));
  }

  const baseline = Number(baselineMetrics.engagement_rate ?? 0);
  const current = Number(outcomeMetrics.engagement_rate ?? baseline);
  return Number(clamp((current - baseline) * 100, -100, 100).toFixed(2));
}

export async function evaluateBehaviorActionOutcomes(
  companyId: string,
): Promise<{ evaluated: number }> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await ownedDbTable('intelligence_actions')
    .select('id, company_id, recommendation_type, recommendation_message, action_status, impact_score, recommendation_context, baseline_metrics, evaluation_due_at')
    .eq('company_id', companyId)
    .neq('action_status', 'ignored')
    .is('evaluated_at', null)
    .not('evaluation_due_at', 'is', null)
    .lte('evaluation_due_at', nowIso)
    .limit(50);

  if (error) {
    throw new Error(`Failed to load intelligence actions for evaluation: ${error.message}`);
  }

  const dueActions = (rows ?? []) as PersistedIntelligenceActionRow[];
  if (dueActions.length === 0) {
    return { evaluated: 0 };
  }

  for (const action of dueActions) {
    const outcomeMetrics = await computeCurrentOutcomeMetrics(companyId, action);
    const impactScore = calculateImpactScore(
      action.recommendation_type,
      action.baseline_metrics ?? {},
      outcomeMetrics,
    );

    const { error: updateError } = await ownedDbTable('intelligence_actions')
      .update({
        impact_score: impactScore,
        outcome_metrics: outcomeMetrics,
        evaluated_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', action.id);

    if (updateError) {
      throw new Error(`Failed to update intelligence action outcome: ${updateError.message}`);
    }
  }

  return { evaluated: dueActions.length };
}

export async function getBehaviorRecommendationLearningProfile(
  companyId: string,
): Promise<BehaviorRecommendationLearningProfile> {
  const { data, error } = await ownedDbTable('intelligence_actions')
    .select('recommendation_type, impact_score, action_status')
    .eq('company_id', companyId)
    .not('impact_score', 'is', null)
    .neq('action_status', 'ignored')
    .limit(500);

  if (error) {
    throw new Error(`Failed to load intelligence action learning profile: ${error.message}`);
  }

  const grouped = new Map<BehaviorRecommendationType, number[]>();

  for (const row of data ?? []) {
    const type = String((row as { recommendation_type?: string }).recommendation_type ?? '') as BehaviorRecommendationType;
    const impactScore = Number((row as { impact_score?: number | null }).impact_score ?? 0);
    const bucket = grouped.get(type) ?? [];
    bucket.push(impactScore);
    grouped.set(type, bucket);
  }

  const profile: BehaviorRecommendationLearningProfile = {};

  for (const [recommendationType, scores] of grouped.entries()) {
    if (scores.length === 0) continue;

    const averageImpactScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const successRate = scores.filter((score) => score > 0).length / scores.length;

    profile[recommendationType] = {
      recommendation_type: recommendationType,
      average_impact_score: Number(averageImpactScore.toFixed(2)),
      success_rate: Number(successRate.toFixed(4)),
      sample_size: scores.length,
      priority_adjustment: Number(clamp((averageImpactScore / 100) * 0.75, -0.75, 0.75).toFixed(3)),
    };
  }

  return profile;
}
