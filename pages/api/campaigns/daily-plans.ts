import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import { getDailyPlans } from '../../../backend/services/executionPlannerService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import {
  dailyPlanRowToUnifiedExecutionUnit,
  applyUnifiedToDailyPlanResponse,
} from '../../../lib/planning/unifiedExecutionAdapter';
import { applyDistributionForWeek } from '../../../lib/planning/distributionEngine';
import { detectMasterContentGroups } from '../../../lib/planning/masterContentGrouping';
import { buildStrategicMemoryProfile } from '../../../lib/intelligence/strategicMemory';
import type { StrategistAction } from '../../../lib/intelligence/strategicMemory';
import { logDistributionDecision } from '../../../lib/intelligence/distributionDecisionLogger';

function tryParseJson(value: unknown): any | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || (!s.startsWith('{') && !s.startsWith('['))) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId: campaignIdQuery } = req.query;
    const campaignId = typeof campaignIdQuery === 'string' ? campaignIdQuery : Array.isArray(campaignIdQuery) ? campaignIdQuery[0] : '';
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    // Single read path: execution engine
    if (process.env.NODE_ENV !== 'test') {
      console.log('[EXECUTION_ENGINE] getDailyPlans', { campaignId: access.campaignId });
    }
    let dailyPlans: Record<string, unknown>[];
    try {
      dailyPlans = await getDailyPlans(access.campaignId);
    } catch (err) {
      console.error('Error fetching daily plans:', err);
      return res.status(500).json({ error: 'Failed to fetch daily plans' });
    }

    let memoryProfile: ReturnType<typeof buildStrategicMemoryProfile> | null = null;
    const { data: memoryRows } = await supabase
      .from('campaign_strategic_memory')
      .select('action, platform, accepted, confidence_score, created_at')
      .eq('campaign_id', access.campaignId)
      .order('created_at', { ascending: true });
    if (memoryRows?.length) {
      const events = memoryRows.map((r: any) => ({
        campaign_id: access.campaignId,
        execution_id: '',
        platform: r.platform ?? undefined,
        action: r.action as StrategistAction,
        accepted: Boolean(r.accepted),
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      }));
      const confidenceHistory = (memoryRows as any[])
        .filter((r) => r.confidence_score != null && Number.isFinite(r.confidence_score) && r.platform)
        .map((r) => ({
          platform: String(r.platform).trim().toLowerCase(),
          confidence: Math.max(0, Math.min(100, Number(r.confidence_score))),
        }));
      memoryProfile = buildStrategicMemoryProfile(events, confidenceHistory);
    }

    const blueprint = await getUnifiedCampaignBlueprint(access.campaignId);
    const weekDistributionByNumber: Record<number, string | null> = {};
    const weekReasonByNumber: Record<number, string | null> = {};
    const weekPlanningAdjustmentByNumber: Record<number, string | null> = {};
    const weekPlanningAdjustmentsSummaryByNumber: Record<number, { reduced: string[]; preserved: string[]; text: string } | null> = {};
    const weekMomentumAdjustmentsByNumber: Record<number, { absorbed_from_week?: number[]; carried_forward_to?: number[]; reason?: string } | null> = {};
    const weekExtrasByNumber: Record<number, { recovered_topics?: Array<{ topic: string; recovered_from_week: number }> } | null> = {};
    if (blueprint?.weeks?.length) {
      for (const w of blueprint.weeks) {
        const n = Number((w as any).week_number ?? (w as any).week ?? 0) || 0;
        if (n > 0) {
          weekDistributionByNumber[n] = (w as any).distribution_strategy ?? null;
          weekReasonByNumber[n] = (w as any).distribution_reason ?? null;
          weekPlanningAdjustmentByNumber[n] = (w as any).planning_adjustment_reason ?? null;
          weekPlanningAdjustmentsSummaryByNumber[n] = (w as any).planning_adjustments_summary ?? null;
          weekMomentumAdjustmentsByNumber[n] = (w as any).momentum_adjustments ?? null;
          weekExtrasByNumber[n] = (w as any).week_extras ?? null;
        }
      }
    }

    // Transform the data to match the expected format (include all fields for day detail modal)
    // Supports both legacy rows and v2 rows where `content` stores the normalized daily object as JSON.
    const transformedPlans =
      dailyPlans?.map((plan: any) => {
        const parsed = tryParseJson(plan.content);
        const isV2 =
          parsed &&
          typeof parsed === 'object' &&
          Number.isFinite(Number(parsed.dayIndex)) &&
          Number.isFinite(Number(parsed.weekNumber)) &&
          typeof parsed.topicTitle === 'string';

        const keyPoints = (() => {
          const k = plan.key_points ?? plan.main_points;
          if (Array.isArray(k)) return k;
          if (typeof k === 'string') {
            try {
              const p = JSON.parse(k);
              return Array.isArray(p) ? p : [];
            } catch {
              return [];
            }
          }
          return [];
        })();

        if (isV2) {
          const daily = parsed as any;
          const wn = Number(daily.weekNumber) || plan.week_number;
          return {
            id: plan.id,
            weekNumber: wn,
            dayOfWeek: plan.day_of_week,
            platform: plan.platform,
            contentType: String(daily.contentType ?? plan.content_type ?? 'post'),
            title: String(daily.topicTitle ?? plan.title ?? ''),
            content: String(daily.dailyObjective ?? ''),
            description: String(daily.writingIntent ?? ''),
            topic: String(daily.topicTitle ?? plan.topic ?? ''),
            introObjective: String(daily.whatShouldReaderLearn ?? plan.intro_objective ?? ''),
            summary: String(daily.whatProblemAreWeAddressing ?? plan.summary ?? ''),
            objective: String(daily.dailyObjective ?? plan.objective ?? ''),
            keyPoints,
            cta: String(daily.desiredAction ?? plan.cta ?? ''),
            brandVoice: String(daily.narrativeStyle ?? plan.brand_voice ?? ''),
            themeLinkage: plan.theme_linkage,
            formatNotes:
              plan.format_notes ||
              (daily.contentGuidance
                ? `${daily.contentGuidance.primaryFormat}; max ${daily.contentGuidance.maxWordTarget} words`
                : undefined),
            weekTheme: plan.week_theme,
            campaignTheme: plan.campaign_theme,
            hashtags: plan.hashtags || [],
            scheduledTime: plan.scheduled_time || plan.optimal_posting_time,
            status: plan.status || 'planned',
            dailyObject: daily,
            ...(daily.master_content_id != null ? { master_content_id: daily.master_content_id } : {}),
            ...(daily.creator_card != null && typeof daily.creator_card === 'object' ? { creator_card: daily.creator_card } : {}),
            ...(weekDistributionByNumber[wn] != null ? { distribution_strategy: weekDistributionByNumber[wn] } : {}),
            ...(weekReasonByNumber[wn] != null ? { distribution_reason: weekReasonByNumber[wn] } : {}),
            ...(weekPlanningAdjustmentByNumber[wn] != null ? { planning_adjustment_reason: weekPlanningAdjustmentByNumber[wn] } : {}),
            ...(weekPlanningAdjustmentsSummaryByNumber[wn] != null ? { planning_adjustments_summary: weekPlanningAdjustmentsSummaryByNumber[wn] } : {}),
            ...(weekExtrasByNumber[wn] != null ? { week_extras: weekExtrasByNumber[wn] } : {}),
            generation_source: plan.generation_source ?? null,
          };
        }

        const legacyParsed = tryParseJson(plan.content);
        const lp = legacyParsed && typeof legacyParsed === 'object' ? legacyParsed as any : null;
        const legWeekNum = plan.week_number;
        return {
          id: plan.id,
          weekNumber: legWeekNum,
          dayOfWeek: plan.day_of_week,
          platform: plan.platform,
          contentType: plan.content_type ?? lp?.contentType ?? lp?.content_type,
          title: plan.title ?? lp?.topicTitle,
          content: plan.content,
          description: plan.description ?? lp?.writingIntent ?? '',
          topic: plan.topic ?? lp?.topicTitle ?? '',
          introObjective: plan.intro_objective ?? lp?.whatShouldReaderLearn ?? '',
          summary: plan.summary ?? lp?.whatProblemAreWeAddressing ?? '',
          objective: plan.objective ?? lp?.dailyObjective ?? '',
          keyPoints,
          cta: plan.cta ?? lp?.desiredAction ?? '',
          brandVoice: plan.brand_voice ?? lp?.narrativeStyle ?? '',
          themeLinkage: plan.theme_linkage,
          formatNotes: plan.format_notes ?? (lp?.contentType ? `${lp.contentType} content` : undefined),
          weekTheme: plan.week_theme,
          campaignTheme: plan.campaign_theme,
          hashtags: plan.hashtags || (Array.isArray(lp?.hashtags) ? lp.hashtags : []),
          scheduledTime: plan.scheduled_time || plan.optimal_posting_time || lp?.optimalTime,
          status: plan.status || 'planned',
          ...(lp ? { dailyObject: lp } : {}),
          ...(legacyParsed && typeof legacyParsed === 'object' && (legacyParsed as any).master_content_id != null
            ? { master_content_id: (legacyParsed as any).master_content_id }
            : {}),
          ...(legacyParsed && typeof legacyParsed === 'object' && (legacyParsed as any).creator_card != null && typeof (legacyParsed as any).creator_card === 'object'
            ? { creator_card: (legacyParsed as any).creator_card }
            : {}),
          ...(weekDistributionByNumber[legWeekNum] != null ? { distribution_strategy: weekDistributionByNumber[legWeekNum] } : {}),
          ...(weekReasonByNumber[legWeekNum] != null ? { distribution_reason: weekReasonByNumber[legWeekNum] } : {}),
          ...(weekPlanningAdjustmentByNumber[legWeekNum] != null ? { planning_adjustment_reason: weekPlanningAdjustmentByNumber[legWeekNum] } : {}),
          ...(weekPlanningAdjustmentsSummaryByNumber[legWeekNum] != null ? { planning_adjustments_summary: weekPlanningAdjustmentsSummaryByNumber[legWeekNum] } : {}),
          ...(weekMomentumAdjustmentsByNumber[legWeekNum] != null ? { momentum_adjustments: weekMomentumAdjustmentsByNumber[legWeekNum] } : {}),
          ...(weekExtrasByNumber[legWeekNum] != null ? { week_extras: weekExtrasByNumber[legWeekNum] } : {}),
          generation_source: plan.generation_source ?? null,
        };
      }) || [];

    // Adapter: normalize via UnifiedExecutionUnit, apply distribution per week, then apply back
    const normalizedPlans = [...transformedPlans];
    const byWeek = new Map<number, number[]>();
    transformedPlans.forEach((plan: any, index: number) => {
      const wn = Number(plan.weekNumber ?? plan.week_number ?? 0) || 0;
      if (!byWeek.has(wn)) byWeek.set(wn, []);
      byWeek.get(wn)!.push(index);
    });
    byWeek.forEach((indices, weekNumber) => {
      const weekPlans = indices.map((i: number) => transformedPlans[i]);
      const week = {
        distribution_strategy:
          weekPlans[0]?.distribution_strategy ?? weekDistributionByNumber[weekNumber] ?? undefined,
        momentum_adjustments: weekMomentumAdjustmentsByNumber[weekNumber] ?? undefined,
      };
      const units = weekPlans.map((p: any) => dailyPlanRowToUnifiedExecutionUnit(p));
      const result = applyDistributionForWeek(units, week, memoryProfile);
      const distributed = result.units;
      detectMasterContentGroups(distributed);
      indices.forEach((idx: number, j: number) => {
        normalizedPlans[idx] = applyUnifiedToDailyPlanResponse(weekPlans[j], distributed[j]);
      });
      void logDistributionDecision({
        campaign_id: access.campaignId,
        week_number: weekNumber,
        resolved_strategy: result.meta.resolvedStrategy,
        auto_detected: result.meta.auto_detected,
        quality_override: result.meta.quality_override,
        slot_optimization_applied: result.meta.slot_optimization_applied,
      });
    });

    console.log('[DAILY_PLAN_TRACE] daily-plans returning', normalizedPlans.length, 'plans');
    res.status(200).json(normalizedPlans);

  } catch (error) {
    console.error('Error in daily plans API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}