/**
 * Planner Finalize API
 * Commits planner session: creates campaign (if new), saves plan via canonical campaignPlanStore flow,
 * runs commit-plan + generate-weekly-structure (same pipeline as BOLT), updates status.
 * Redirect target: /campaign-calendar/{campaign_id}
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';

import { supabase } from '../../../backend/db/supabaseClient';
import { getCampaignById } from '../../../backend/db/campaignStore';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { fromStructuredPlan } from '../../../backend/services/campaignBlueprintAdapter';
import { saveStructuredCampaignPlan, commitDraftBlueprint } from '../../../backend/db/campaignPlanStore';
import { generateFromManualPlanner } from '../../../backend/services/executionPlannerService';
import { syncCampaignVersionStage } from '../../../backend/db/campaignVersionStore';
import { saveCampaignPlanningInputs } from '../../../backend/services/campaignPlanningInputsService';
import { validateCalendarPlan } from '../../../backend/services/plannerIntegrityService';
import { ENABLE_PLANNER_ADAPTER } from '../../../config/featureFlags';
import {
  adaptPlannerOutputToExecutionFormat,
  AdapterValidationError,
  type PlannerActivityInput,
} from '../../../lib/adapters/plannerToExecutionAdapter';
import { saveCampaignContextSnapshot } from '../../../backend/services/campaignContextService';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function dayNameToIndex(day: string): number {
  const d = String(day || 'Monday').trim();
  const idx = DAYS_OF_WEEK.indexOf(d as (typeof DAYS_OF_WEEK)[number]);
  return idx >= 0 ? idx + 1 : 1;
}

function computeDayDate(campaignStart: string, weekNumber: number, dayName: string): string {
  const start = new Date(campaignStart);
  const dayIndex = dayNameToIndex(dayName);
  const offsetDays = (weekNumber - 1) * 7 + (dayIndex - 1);
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().split('T')[0];
}

/** Platform normalization for consistent storage. */
function normalizePlatform(p: string): string {
  const map: Record<string, string> = {
    twitter: 'x',
    linkedin: 'linkedin',
    youtube: 'youtube',
    x: 'x',
    pinterest: 'pinterest',
    instagram: 'instagram',
  };
  const key = String(p ?? '').trim().toLowerCase();
  return (map[key] ?? key) || 'linkedin';
}

/** Content type standardization for consistent storage. */
function normalizeContentType(type: string): string {
  const map: Record<string, string> = {
    text: 'post',
    article: 'post',
    thread: 'post',
    video: 'video',
    reel: 'video',
    carousel: 'carousel',
    post: 'post',
  };
  const key = String(type ?? 'post').trim().toLowerCase();
  return (map[key] ?? key) || 'post';
}

/** Build weeks structure from calendar_plan for twelve_week_plan; skeleton comes from planner state only. */
function buildWeeksFromCalendarPlan(calendarPlan: {
  weeks?: unknown[];
  days?: Array<{ week_number: number; day: string; activities?: unknown[] }>;
  activities?: Array<{ week_number?: number; day?: string; platform?: string; content_type?: string; title?: string; theme?: string; execution_id?: string }>;
}): unknown[] {
  const activities = Array.isArray(calendarPlan?.activities) ? calendarPlan.activities : [];
  if (activities.length === 0) return [];

  const byWeek = new Map<number, typeof activities>();
  for (const a of activities) {
    const wn = Number(a?.week_number ?? 1);
    if (!byWeek.has(wn)) byWeek.set(wn, []);
    byWeek.get(wn)!.push(a);
  }

  const weekNumbers = Array.from(byWeek.keys()).sort((a, b) => a - b);
  const weeks: unknown[] = weekNumbers.map((wn) => {
    const weekActivities = byWeek.get(wn) ?? [];
    const platformAlloc: Record<string, number> = {};
    const contentSet = new Set<string>();
    for (const a of weekActivities) {
      const p = normalizePlatform(a.platform ?? 'linkedin');
      platformAlloc[p] = (platformAlloc[p] ?? 0) + 1;
      contentSet.add(String(a.content_type ?? 'post').toLowerCase());
    }
    const contentMix = Array.from(contentSet);
    if (contentMix.length === 0) contentMix.push('post');
    const totalPosts = Object.values(platformAlloc).reduce((a, b) => a + b, 0) || 1;

    const daily_execution_items = weekActivities.map((a, i) => ({
      execution_id: a.execution_id ?? `wk${wn}-${i + 1}`,
      platform: normalizePlatform(a.platform ?? 'linkedin'),
      content_type: String(a.content_type ?? 'post').toLowerCase(),
      topic: a.title ?? a.theme ?? `Week ${wn} slot ${i + 1}`,
      title: a.title ?? a.theme ?? `Week ${wn} slot ${i + 1}`,
      day: a.day ?? DAYS_OF_WEEK[i % 7],
    }));

    return {
      week: wn,
      week_number: wn,
      phase_label: `Week ${wn}`,
      primary_objective: `Week ${wn}`,
      platform_allocation: Object.keys(platformAlloc).length > 0 ? platformAlloc : { linkedin: totalPosts },
      content_type_mix: contentMix,
      cta_type: 'None',
      total_weekly_content_count: totalPosts,
      weekly_kpi_focus: 'Reach growth',
      topics_to_cover: ['Campaign content'],
      daily_execution_items,
    };
  });

  return weeks;
}

function buildStructuredWeeksFromStrategy(
  strategy: { duration_weeks?: number; platforms?: string[]; posting_frequency?: Record<string, number>; content_mix?: string[]; campaign_goal?: string; target_audience?: string },
  ideaTitle?: string
): unknown[] {
  const duration = Math.max(1, Math.min(52, Number(strategy?.duration_weeks) || 12));
  const platforms = Array.isArray(strategy?.platforms) && strategy.platforms.length > 0
    ? strategy.platforms.map((p) => String(p).toLowerCase().replace(/^twitter$/i, 'x'))
    : ['linkedin'];
  const contentMix = Array.isArray(strategy?.content_mix) && strategy.content_mix.length > 0
    ? strategy.content_mix
    : ['post'];
  const freq = strategy?.posting_frequency && typeof strategy.posting_frequency === 'object'
    ? strategy.posting_frequency
    : {};
  const baseTheme = ideaTitle || strategy?.campaign_goal || 'Campaign content';

  const weeks: unknown[] = [];
  for (let w = 1; w <= duration; w++) {
    const platformAlloc: Record<string, number> = {};
    platforms.forEach((p) => {
      platformAlloc[p] = Number(freq[p]) || 3;
    });
    if (Object.keys(platformAlloc).length === 0) platformAlloc.linkedin = 3;

    const totalPosts = Object.values(platformAlloc).reduce((a, b) => a + (Number(b) || 0), 0) || 3;
    weeks.push({
      week: w,
      week_number: w,
      phase_label: `Week ${w}: ${baseTheme}`,
      primary_objective: strategy?.campaign_goal || baseTheme,
      platform_allocation: platformAlloc,
      content_type_mix: contentMix,
      cta_type: 'None',
      total_weekly_content_count: totalPosts,
      weekly_kpi_focus: 'Reach growth',
      topics_to_cover: [baseTheme],
    });
  }
  return weeks;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const body = req.body || {};
    const {
      companyId,
      idea_spine,
      strategy_context,
      campaignId: existingCampaignId,
      cross_platform_sharing,
      calendar_plan: bodyCalendarPlan,
      // Context snapshot fields — populated by FinalizeSection when preview was run first
      account_context: bodyAccountContext,
      campaign_validation: bodyValidation,
      paid_recommendation: bodyPaidRecommendation,
    } = body;

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!strategy_context || typeof strategy_context !== 'object') {
      return res.status(400).json({ error: 'strategy_context is required' });
    }

    // STEP 8: Validate calendar_plan before committing when provided
    if (bodyCalendarPlan && typeof bodyCalendarPlan === 'object' && !Array.isArray(bodyCalendarPlan)) {
      const validation = validateCalendarPlan(bodyCalendarPlan as any);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Calendar plan validation failed',
          details: validation.errors,
        });
      }
    }

    const ideaTitle = idea_spine && typeof idea_spine === 'object' && idea_spine.title
      ? String(idea_spine.title)
      : undefined;

    const hasCalendarPlan =
      bodyCalendarPlan &&
      typeof bodyCalendarPlan === 'object' &&
      !Array.isArray(bodyCalendarPlan) &&
      Array.isArray((bodyCalendarPlan as { activities?: unknown[] }).activities) &&
      (bodyCalendarPlan as { activities: unknown[] }).activities.length > 0;

    // FIX 4: Strict calendar plan validation
    if (hasCalendarPlan) {
      const activities = (bodyCalendarPlan as { activities: Array<{ week_number?: number; day?: string; platform?: string; content_type?: string }> }).activities;
      for (const act of activities) {
        if (!act.week_number || !act.day || !act.platform || !act.content_type) {
          return res.status(400).json({ error: 'Invalid calendar_plan: each activity must have week_number, day, platform, and content_type' });
        }
      }
    }

    let weeks: unknown[];
    let useCalendarPlanPath = false;

    if (hasCalendarPlan) {
      weeks = buildWeeksFromCalendarPlan(bodyCalendarPlan as any);
      useCalendarPlanPath = weeks.length > 0;
    }

    if (!useCalendarPlanPath) {
      if (!existingCampaignId) {
        return res.status(400).json({
          error: 'Generate skeleton first. Complete Campaign Context and Execution Setup, then click Generate Skeleton before finalizing.',
        });
      }
      weeks = buildStructuredWeeksFromStrategy(strategy_context, ideaTitle);
    }

    const durationWeeks = weeks.length;
    const strat = strategy_context as { planned_start_date?: string };
    const startDate =
      (typeof strat?.planned_start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(strat.planned_start_date.trim())
        ? strat.planned_start_date.trim()
        : null) ?? new Date().toISOString().split('T')[0];

    let campaignId = existingCampaignId && typeof existingCampaignId === 'string' ? existingCampaignId : null;

    if (!campaignId) {
      campaignId = crypto.randomUUID();
      const summary = ideaTitle || JSON.stringify(strategy_context).slice(0, 200) + '...';
      const { data: newCampaign, error: createErr } = await supabase
        .from('campaigns')
        .insert({
          id: campaignId,
          name: ideaTitle || 'Planner Campaign',
          description: summary,
          status: 'planning',
          current_stage: 'planning',
          timeframe: 'quarter',
          start_date: startDate,
          duration_weeks: durationWeeks,
          user_id: user.id,
          thread_id: 'planner_' + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createErr) {
        console.error('Planner finalize: campaign create failed', createErr);
        return res.status(500).json({ error: 'Failed to create campaign', details: createErr.message });
      }

      const snapshot: Record<string, unknown> = { campaign: newCampaign };
      if (cross_platform_sharing != null && typeof cross_platform_sharing === 'object' && !Array.isArray(cross_platform_sharing)) {
        const cps = cross_platform_sharing as { enabled?: boolean; mode?: string };
        snapshot.cross_platform_sharing = {
          enabled: cps.enabled !== false,
          mode: cps.mode === 'unique' ? 'unique' : 'shared',
        };
      }
      const { error: cvErr } = await supabase.from('campaign_versions').insert({
        company_id: companyId,
        campaign_id: campaignId,
        campaign_snapshot: snapshot,
        status: 'planning',
        version: 1,
        created_at: new Date().toISOString(),
      });
      if (cvErr) console.warn('campaign_versions insert failed:', cvErr.message);
    } else {
      const existing = await getCampaignById<{ id?: string; start_date?: string; duration_weeks?: number; status?: string }>(campaignId, 'id, start_date, duration_weeks, status');
      if (!existing) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      // FIX 10: Prevent repeated finalize
      if (existing.status === 'execution_ready') {
        return res.status(400).json({ error: 'Campaign already finalized' });
      }
      const start = existing.start_date;
      if (!start) {
        await supabase
          .from('campaigns')
          .update({ start_date: startDate, duration_weeks: durationWeeks, updated_at: new Date().toISOString() })
          .eq('id', campaignId);
      }
    }

    const blueprint = fromStructuredPlan({ weeks, campaign_id: campaignId });
    const snapshotHash = `planner-${campaignId}-${Date.now()}`;
    const structureHash =
      useCalendarPlanPath && hasCalendarPlan
        ? createHash('sha256')
            .update(JSON.stringify((bodyCalendarPlan as { activities: unknown[] }).activities))
            .digest('hex')
        : undefined;
    await saveStructuredCampaignPlan({
      campaignId,
      snapshot_hash: snapshotHash,
      weeks: weeks as any,
      omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as any,
      raw_plan_text: '',
      structure_hash: structureHash,
    });
    await commitDraftBlueprint({
      campaignId,
      blueprint,
      source: 'planner-finalize',
    });

    const selectedAngle = idea_spine && typeof idea_spine === 'object' ? (idea_spine as { selected_angle?: string | null }).selected_angle : null;
    if (selectedAngle && typeof selectedAngle === 'string' && selectedAngle.trim()) {
      try {
        await saveCampaignPlanningInputs({
          campaignId,
          companyId,
          recommendation_snapshot: { planning_inputs: { campaign_direction: selectedAngle.trim() } },
          campaign_direction: selectedAngle.trim(),
        });
      } catch (saveErr) {
        console.warn('[planner-finalize] saveCampaignPlanningInputs failed (continuing):', (saveErr as Error)?.message ?? saveErr);
      }
    }

    await supabase
      .from('campaigns')
      .update({
        duration_weeks: durationWeeks,
        start_date: startDate,
        current_stage: 'twelve_week_plan',
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);
    void syncCampaignVersionStage(campaignId, 'twelve_week_plan', companyId).catch(() => {});

    // -------------------------------------------------------------------------
    // ADAPTER BRANCH (additive — does NOT modify the block below)
    // Runs only when: request carries source='planner' AND the feature flag is
    // enabled AND a calendar plan is present.
    // On any failure, logs and falls through to the existing inline flow.
    // -------------------------------------------------------------------------
    let adapterHandledSlots = false;
    if (
      body.source === 'planner' &&
      ENABLE_PLANNER_ADAPTER &&
      useCalendarPlanPath &&
      hasCalendarPlan
    ) {
      try {
        const rawActivities = (bodyCalendarPlan as { activities: PlannerActivityInput[] }).activities;
        const adaptedRows = adaptPlannerOutputToExecutionFormat({
          activities: rawActivities,
          campaignId: campaignId!,
          startDate,
        });

        // Duplicate slot protection (mirrors existing path)
        const { data: existingAdapterSlots } = await supabase
          .from('daily_content_plans')
          .select('id')
          .eq('campaign_id', campaignId)
          .limit(1);
        if (existingAdapterSlots?.length) {
          return res.status(400).json({ error: 'Slots already exist for this campaign.' });
        }

        // Route via execution engine (same service as existing path)
        const { saveWeekPlans: saveWeekPlansAdapter } = await import('../../../backend/services/executionPlannerService');
        const byWeekAdapter = new Map<number, typeof adaptedRows>();
        for (const row of adaptedRows) {
          const wn = row.week_number;
          if (!byWeekAdapter.has(wn)) byWeekAdapter.set(wn, []);
          byWeekAdapter.get(wn)!.push(row);
        }
        for (const [wn, rows] of byWeekAdapter) {
          await saveWeekPlansAdapter(campaignId!, wn, rows as any, 'manual');
        }

        adapterHandledSlots = true;
        console.log(`[PLANNER][ADAPTER][INFO] Saved ${adaptedRows.length} slots via adapter for campaign ${campaignId}`);
      } catch (adapterErr) {
        if (adapterErr instanceof AdapterValidationError) {
          console.warn('[PLANNER][ADAPTER][WARN] Validation failed, falling back to existing flow:', (adapterErr as Error).message);
        } else {
          console.error('[PLANNER][ADAPTER][ERROR] Unexpected error, falling back to existing flow:', adapterErr);
        }
        // adapterHandledSlots remains false → existing flow below runs unchanged
      }
    }

    // -------------------------------------------------------------------------
    // EXISTING FLOW — completely unchanged; skipped only when adapter succeeded
    // -------------------------------------------------------------------------
    if (!adapterHandledSlots && useCalendarPlanPath && hasCalendarPlan) {
      const activities = (bodyCalendarPlan as { activities: Array<{ week_number?: number; day?: string; platform?: string; content_type?: string; title?: string; theme?: string; execution_id?: string }> }).activities;

      // FIX 3: Duplicate slot protection
      const { data: existingSlots } = await supabase
        .from('daily_content_plans')
        .select('id')
        .eq('campaign_id', campaignId)
        .limit(1);
      if (existingSlots?.length) {
        return res.status(400).json({ error: 'Slots already exist for this campaign.' });
      }

      // FIX 7: Prevent empty weeks (each week that has activities must have at least one slot)
      const byWeekCheck = new Map<number, typeof activities>();
      for (const a of activities) {
        const wn = Number(a?.week_number ?? 1);
        if (wn < 1 || wn > 52) {
          return res.status(400).json({ error: `Invalid week_number: ${wn} (must be 1-52)` });
        }
        if (!byWeekCheck.has(wn)) byWeekCheck.set(wn, []);
        byWeekCheck.get(wn)!.push(a);
      }
      for (const [wn, weekActivities] of byWeekCheck) {
        if (!weekActivities || weekActivities.length === 0) {
          return res.status(400).json({ error: `Week ${wn} has no slots` });
        }
      }

      const rowsToInsert = activities.map((act) => {
        const weekNum = Number(act?.week_number ?? 1);
        const dayName = String(act?.day ?? 'Monday').trim();
        const platform = normalizePlatform(act.platform ?? 'linkedin');
        const contentType = normalizeContentType(act.content_type ?? 'post');
        const label = `${platform} ${contentType}`;
        const date = computeDayDate(startDate, weekNum, dayName);
        return {
          campaign_id: campaignId,
          week_number: weekNum,
          day_of_week: dayName,
          date,
          platform,
          content_type: contentType,
          title: act.title ?? act.theme ?? label,
          topic: act.title ?? act.theme ?? label,
          content: JSON.stringify({
            placeholder: true,
            label,
          }),
          status: 'planned',
          ai_generated: false,
          execution_id: act.execution_id ?? null,
        };
      });
      if (rowsToInsert.length > 0) {
        // FIX 9: Placeholder validation
        for (const row of rowsToInsert) {
          const parsed = JSON.parse(row.content) as { placeholder?: boolean };
          if (parsed?.placeholder !== true) {
            throw new Error('Invalid placeholder slot');
          }
        }
        // FIX 2: Route via execution engine (saveWeekPlans)
        const { saveWeekPlans } = await import('../../../backend/services/executionPlannerService');
        const byWeek = new Map<number, typeof rowsToInsert>();
        for (const row of rowsToInsert) {
          const wn = Number(row.week_number) || 1;
          if (!byWeek.has(wn)) byWeek.set(wn, []);
          byWeek.get(wn)!.push(row);
        }
        for (const [wn, rows] of byWeek) {
          await saveWeekPlans(campaignId, wn, rows as any, 'manual');
        }
      }
    } else if (!adapterHandledSlots) {
      await generateFromManualPlanner({
        campaignId,
        companyId,
        plan: { weeks },
        startDate,
      });
    }

    await supabase
      .from('campaigns')
      .update({
        current_stage: 'execution_ready',
        blueprint_status: 'ACTIVE',
        status: 'planning',
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);
    void syncCampaignVersionStage(campaignId, 'execution_ready', companyId).catch(() => {});

    // ── Save context snapshot (non-fatal — never blocks the finalize response) ──
    void saveCampaignContextSnapshot({
      campaignId: campaignId!,
      companyId,
      account_context: bodyAccountContext && typeof bodyAccountContext === 'object' ? bodyAccountContext : null,
      validation: bodyValidation && typeof bodyValidation === 'object' ? bodyValidation : null,
      paid_recommendation: bodyPaidRecommendation && typeof bodyPaidRecommendation === 'object' ? bodyPaidRecommendation : null,
    }).catch((err) => {
      console.warn('[PLANNER][CONTEXT][WARN] Context snapshot save failed (non-fatal):', err?.message ?? err);
    });

    return res.status(200).json({ campaign_id: campaignId });
  } catch (err) {
    console.error('Planner finalize error:', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
