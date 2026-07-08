/** Part 2/2 of growthGuidanceService.ts — verbatim split (barrel preserved; importers unchanged). */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getGoogleAnalyticsStatus, type GoogleAnalyticsConnectionStatus } from './analyticsIntegrationService';
import { sendDeterministicIntelligenceAlert } from './intelligenceAlertService';
import { ownedDbTable } from '../db/writeOwner';

import { type GuidanceDomain, type GrowthGuidanceAlert, type GrowthGuidanceAlertWithAction, type GrowthReadiness, type GrowthExecutionMetrics, type GrowthSignalSnapshot, type GuidanceActionIntent, type GuidanceActionRow, type GuidanceCandidateAlert, CATEGORY_RANK, severityRank, normalizeGuidanceActionStatus, isActionableGuidanceAlert, resolveGuidanceIntent, inferIntentFromKey, buildGuidanceActionKey, loadGrowthSignals, isIntentResolved, loadGuidanceActions, computeExecutionMetrics, evaluateGrowthGuidance, getResolvedCompletedActionKeys, getCompletedGuidanceIntents, buildCriticalAttentionAlerts, buildStalledExecutionAlerts } from './growthGuidanceServiceModel';

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
  const { data: existingRows, error: existingError } = await ownedDbTable('intelligence_actions')
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
    const { data: insertedRows, error: insertError } = await ownedDbTable('intelligence_actions')
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
  const { data, error } = await ownedDbTable('intelligence_actions')
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

