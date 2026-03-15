/**
 * Campaign Health Evaluation Job
 * Runs daily. Evaluates active campaigns using campaign_design + execution_plan
 * derived from existing campaign data. Stores suggestions via campaign_health_reports.
 * No database schema changes; reuses campaign_summary and campaign_health_reports.
 */

import { supabase } from '../db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../services/campaignBlueprintService';
import {
  evaluateCampaignHealth,
  type CampaignDesignInput,
  type ExecutionPlanInput,
  type CalendarPlanActivityInput,
} from '../services/campaignIntelligenceService';

function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}
import { saveCampaignHealthReport } from '../db/campaignVersionStore';

const MAX_HEALTH_REPORT_SIZE = 200_000;

const ACTIVE_STATUSES = new Set([
  'planning',
  'scheduled',
  'active',
  'approved',
  'draft',
  'content-creation',
  'schedule-review',
  'twelve_week_plan',
  'execution_ready',
]);

export type CampaignHealthEvaluationResult = {
  campaigns_evaluated: number;
  reports_stored: number;
  errors: string[];
};

function deriveCampaignDesignFromDb(campaign: Record<string, unknown>): CampaignDesignInput {
  const name = (campaign.name as string) ?? '';
  const description = (campaign.description as string) ?? '';
  const objective = (campaign.objective as string) ?? '';
  const targetAudience = (campaign.target_audience as string) ?? '';
  const weeklyThemes = campaign.weekly_themes as Array<{ theme?: string; label?: string }> | null | undefined;

  const phases = Array.isArray(weeklyThemes)
    ? weeklyThemes.slice(0, 12).map((w, i) => ({
        id: `phase-${i}`,
        label: (w?.theme ?? w?.label ?? `Week ${i + 1}`) as string,
        week_start: i + 1,
        week_end: i + 1,
      }))
    : [];

  return {
    idea_spine: {
      title: name,
      refined_title: name,
      description,
      refined_description: description,
    },
    campaign_brief: {
      audience: targetAudience,
      campaign_goal: objective,
    },
    campaign_structure:
      phases.length >= 2
        ? {
            phases,
            narrative: objective || 'Campaign narrative',
          }
        : null,
  };
}

function buildActivityCardsFromBlueprint(
  campaign: Record<string, unknown>,
  blueprint: { weeks?: Array<Record<string, unknown>> } | null
): CalendarPlanActivityInput[] {
  const activities: CalendarPlanActivityInput[] = [];
  if (!blueprint?.weeks?.length) return activities;

  let idx = 0;
  for (const w of blueprint.weeks) {
    const wn = Number((w as { week_number?: number }).week_number ?? w.week ?? idx + 1) ?? idx + 1;
    const phaseLabel = nonEmpty((w as { phase_label?: string }).phase_label ?? (w as { theme?: string }).theme ?? '');

    const dailyItems: any[] = Array.isArray((w as any).daily_execution_items) ? (w as any).daily_execution_items : [];
    const execItems: any[] = Array.isArray((w as any).execution_items) ? (w as any).execution_items : [];

    if (dailyItems.length > 0) {
      for (const item of dailyItems) {
        const eid = nonEmpty(item?.execution_id ?? item?.id ?? '') || `activity-${idx}`;
        const cta = nonEmpty((item as any)?.desiredAction ?? (item as any)?.cta ?? (item as any)?.intent?.cta_type);
        const objective = nonEmpty((item as any)?.dailyObjective ?? (item as any)?.objective ?? (item as any)?.writer_content_brief?.topicGoal);
        const phase = nonEmpty((item as any)?.phase ?? phaseLabel);
        activities.push({
          execution_id: eid,
          week_number: wn,
          platform: nonEmpty((item as any)?.platform) || 'linkedin',
          content_type: nonEmpty((item as any)?.content_type) || 'post',
          title: nonEmpty((item as any)?.title ?? (item as any)?.topic ?? (item as any)?.writer_content_brief?.topicTitle) || 'Untitled',
          theme: phase || undefined,
          cta: cta || undefined,
          objective: objective || undefined,
          phase: phase || undefined,
        });
        idx++;
      }
      idx++;
      continue;
    }

    if (execItems.length > 0) {
      for (const exec of execItems) {
        const slots = Array.isArray((exec as any)?.topic_slots) ? (exec as any).topic_slots : [{ topic: (exec as any)?.topic }].filter(Boolean);
        for (let si = 0; si < Math.max(slots.length, 1); si++) {
          const slot = slots[si];
          const eid = nonEmpty(slot?.execution_id ?? exec?.execution_id ?? exec?.id) || `activity-${idx}`;
          activities.push({
            execution_id: eid,
            week_number: wn,
            platform: nonEmpty(slot?.platform ?? exec?.platform) || 'linkedin',
            content_type: nonEmpty(slot?.content_type ?? exec?.content_type) || 'post',
            title: nonEmpty(slot?.topic ?? exec?.topic) || (phaseLabel || 'Untitled'),
            theme: phaseLabel || undefined,
            cta: nonEmpty(slot?.cta ?? exec?.cta) || undefined,
            objective: nonEmpty(slot?.objective ?? exec?.objective) || undefined,
            phase: phaseLabel || undefined,
          });
          idx++;
        }
      }
      idx++;
      continue;
    }

    const mix = (w.content_type_mix as string[]) ?? ['post'];
    const platformAlloc = (w.platform_allocation as Record<string, number>) ?? { linkedin: 1 };
    for (const [platform, count] of Object.entries(platformAlloc)) {
      for (let i = 0; i < Math.min(Number(count) || 1, 7); i++) {
        activities.push({
          execution_id: `activity-${idx}`,
          week_number: wn,
          platform: platform?.toLowerCase() ?? 'linkedin',
          content_type: mix[0] ?? 'post',
          title: phaseLabel || (campaign.objective as string) || 'Untitled',
          theme: phaseLabel || undefined,
        });
        idx++;
      }
    }
  }
  return activities;
}

function deriveExecutionPlanFromDb(
  campaign: Record<string, unknown>,
  blueprint: { weeks?: Array<Record<string, unknown>> } | null
): ExecutionPlanInput {
  const durationWeeks = Number(campaign.duration_weeks) || 12;
  const postingSchedule = (campaign.posting_schedule as Record<string, number>) ?? {};
  const platforms: string[] = [];
  const postingFrequency: Record<string, number> = {};
  const contentMix: string[] = [];

  if (blueprint?.weeks?.length) {
    for (const w of blueprint.weeks) {
      const alloc = w.platform_allocation as Record<string, number> | undefined;
      if (alloc && typeof alloc === 'object') {
        for (const [p, count] of Object.entries(alloc)) {
          if (p && !platforms.includes(p.toLowerCase())) platforms.push(p.toLowerCase());
          if (p) postingFrequency[p.toLowerCase()] = (postingFrequency[p.toLowerCase()] ?? 0) + (Number(count) || 0);
        }
      }
      const mix = w.content_type_mix as string[] | undefined;
      if (Array.isArray(mix)) {
        for (const m of mix) {
          if (m && !contentMix.includes(m)) contentMix.push(m);
        }
      }
    }
  }

  if (Object.keys(postingSchedule).length > 0) {
    for (const [k, v] of Object.entries(postingSchedule)) {
      if (k && !platforms.includes(k.toLowerCase())) platforms.push(k.toLowerCase());
      if (k) postingFrequency[k.toLowerCase()] = Number(v) || 0;
    }
  }

  const activities = buildActivityCardsFromBlueprint(campaign, blueprint);

  return {
    strategy_context: {
      duration_weeks: durationWeeks,
      platforms: platforms.length ? platforms : ['linkedin'],
      posting_frequency: Object.keys(postingFrequency).length ? postingFrequency : { linkedin: 3 },
      content_mix: contentMix.length ? contentMix : ['post'],
      campaign_goal: (campaign.objective as string) ?? '',
      target_audience: (campaign.target_audience as string) ?? '',
    },
    calendar_plan: activities.length
      ? {
          weeks: blueprint?.weeks ?? [],
          days: [],
          activities,
        }
      : null,
    activity_cards: activities,
  };
}

export async function runCampaignHealthEvaluation(): Promise<CampaignHealthEvaluationResult> {
  const errors: string[] = [];
  let campaignsEvaluated = 0;
  let reportsStored = 0;

  try {
    const { data: versionRows, error: versError } = await supabase
      .from('campaign_versions')
      .select('campaign_id, company_id')
      .not('campaign_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    if (versError) {
      errors.push(`campaign_versions query failed: ${versError.message}`);
      return { campaigns_evaluated: 0, reports_stored: 0, errors };
    }

    const seen = new Set<string>();
    const pairs: Array<{ campaignId: string; companyId: string }> = [];
    for (const row of versionRows ?? []) {
      const cid = row?.campaign_id;
      const coId = row?.company_id;
      if (!cid || !coId || seen.has(cid)) continue;
      seen.add(cid);
      pairs.push({ campaignId: cid, companyId: coId });
    }

    for (const { campaignId, companyId } of pairs) {
      try {
        const { data: campaign, error: campError } = await supabase
          .from('campaigns')
          .select('id, name, description, objective, target_audience, duration_weeks, posting_schedule, weekly_themes')
          .eq('id', campaignId)
          .maybeSingle();

        if (campError || !campaign) continue;

        const status = String((campaign as { status?: string }).status ?? '').toLowerCase();
        if (!ACTIVE_STATUSES.has(status)) continue;

        campaignsEvaluated++;

        const blueprint = await getUnifiedCampaignBlueprint(campaignId);
        const campaign_design = deriveCampaignDesignFromDb(campaign as Record<string, unknown>);
        const execution_plan = deriveExecutionPlanFromDb(
          campaign as Record<string, unknown>,
          blueprint as unknown as { weeks?: Array<Record<string, unknown>> } | null
        );

        const report = evaluateCampaignHealth(campaign_design, execution_plan);
        const scores = [
          report.narrative_score,
          report.content_mix_score,
          report.cadence_score,
          report.audience_alignment_score,
          report.execution_cadence_score ?? 0,
          report.platform_distribution_score ?? 0,
          report.role_balance_score ?? 0,
        ];
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const healthStatus =
          avg >= 75 ? 'healthy' : avg >= 50 ? 'warning' : 'blocked';

        const activities = execution_plan.activity_cards ?? [];
        const activityById = new Map(activities.map((a) => [a.execution_id ?? (a as { id?: string }).id ?? '', a]));
        const lowConf = report.role_distribution?.low_confidence_activities ?? [];
        const activityDiagnostics = lowConf.map((lc) => {
          const act = activityById.get(lc.id) as { cta?: string; objective?: string; phase?: string } | undefined;
          return {
            id: lc.id,
            missing_cta: !nonEmpty(act?.cta),
            missing_objective: !nonEmpty(act?.objective),
            missing_phase: !nonEmpty(act?.phase),
            predicted_role: lc.predicted_role,
            confidence: lc.confidence,
            low_confidence_role: true,
          };
        });
        const reportForJson = { ...report } as Record<string, unknown>;
        reportForJson.activity_diagnostics = activityDiagnostics;

        const size = JSON.stringify(reportForJson).length;
        if (size > MAX_HEALTH_REPORT_SIZE) {
          throw new Error('CampaignHealthReport exceeds maximum allowed size');
        }

        await saveCampaignHealthReport({
          companyId,
          campaignId,
          status: healthStatus,
          confidence: Math.round(avg),
          health_score: report.health_score,
          health_status: report.health_status,
          issues: report.suggestions.map((s) => ({
            level: s.severity === 'critical' ? 'error' : 'suggestion',
            field: 'design',
            message: typeof s === 'string' ? s : s.message,
          })),
          scores: {
            narrative_score: report.narrative_score,
            content_mix_score: report.content_mix_score,
            cadence_score: report.cadence_score,
            audience_alignment_score: report.audience_alignment_score,
            execution_cadence_score: report.execution_cadence_score ?? 0,
            platform_distribution_score: report.platform_distribution_score ?? 0,
            role_balance_score: report.role_balance_score ?? 0,
          } as Record<string, number>,
          report_json: reportForJson,
        });
        reportsStored++;
      } catch (err) {
        errors.push(
          `Campaign ${campaignId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    campaigns_evaluated: campaignsEvaluated,
    reports_stored: reportsStored,
    errors,
  };
}

/** Evaluate and persist campaign health for a single campaign. Used by orchestrator after plan save/edit. */
export async function evaluateAndPersistCampaignHealth(
  campaignId: string,
  companyId: string
): Promise<void> {
  try {
    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('id, name, description, objective, target_audience, duration_weeks, posting_schedule, weekly_themes')
      .eq('id', campaignId)
      .maybeSingle();

    if (campError || !campaign) return;

    const blueprint = await getUnifiedCampaignBlueprint(campaignId);
    const campaign_design = deriveCampaignDesignFromDb(campaign as Record<string, unknown>);
    const execution_plan = deriveExecutionPlanFromDb(
      campaign as Record<string, unknown>,
      blueprint as unknown as { weeks?: Array<Record<string, unknown>> } | null
    );

    const report = evaluateCampaignHealth(campaign_design, execution_plan);
    const scores = [
      report.narrative_score,
      report.content_mix_score,
      report.cadence_score,
      report.audience_alignment_score,
      report.execution_cadence_score ?? 0,
      report.platform_distribution_score ?? 0,
      report.role_balance_score ?? 0,
    ];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const healthStatus = avg >= 75 ? 'healthy' : avg >= 50 ? 'warning' : 'blocked';

    const activities = execution_plan.activity_cards ?? [];
    const activityById = new Map(activities.map((a) => [a.execution_id ?? (a as { id?: string }).id ?? '', a]));
    const lowConf = report.role_distribution?.low_confidence_activities ?? [];
    const activityDiagnostics = lowConf.map((lc) => {
      const act = activityById.get(lc.id) as { cta?: string; objective?: string; phase?: string } | undefined;
      const missingCta = !nonEmpty(act?.cta);
      const missingObjective = !nonEmpty(act?.objective);
      const missingPhase = !nonEmpty(act?.phase);
      return {
        id: lc.id,
        missing_cta: missingCta,
        missing_objective: missingObjective,
        missing_phase: missingPhase,
        predicted_role: lc.predicted_role,
        confidence: lc.confidence,
        low_confidence_role: true,
      };
    });

    const reportForJson = { ...report } as Record<string, unknown>;
    reportForJson.activity_diagnostics = activityDiagnostics;

    const size = JSON.stringify(reportForJson).length;
    if (size > MAX_HEALTH_REPORT_SIZE) {
      throw new Error('CampaignHealthReport exceeds maximum allowed size');
    }

    await saveCampaignHealthReport({
      companyId,
      campaignId,
      status: healthStatus,
      confidence: Math.round(avg),
      health_score: report.health_score,
      health_status: report.health_status,
      issues: report.suggestions.map((s) => ({
        level: s.severity === 'critical' ? 'error' : 'suggestion',
        field: 'design',
        message: typeof s === 'string' ? s : s.message,
      })),
      scores: {
        narrative_score: report.narrative_score,
        content_mix_score: report.content_mix_score,
        cadence_score: report.cadence_score,
        audience_alignment_score: report.audience_alignment_score,
        execution_cadence_score: report.execution_cadence_score ?? 0,
        platform_distribution_score: report.platform_distribution_score ?? 0,
        role_balance_score: report.role_balance_score ?? 0,
      } as Record<string, number>,
      report_json: reportForJson,
    });
  } catch (err) {
    console.warn('[campaignHealthEvaluationJob] evaluateAndPersistCampaignHealth failed:', err);
  }
}
