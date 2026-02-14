/**
 * Unified read layer for campaign blueprints.
 * Resolves from 12_week_plan, campaign_versions.campaign_snapshot.weekly_plan, or weekly_content_refinements.
 */

import { supabase } from '../db/supabaseClient';
import type { CampaignBlueprint } from '../types/CampaignBlueprint';
import {
  fromStructuredPlan,
  fromRecommendationPlan,
  fromLegacyRefinements,
} from './campaignBlueprintAdapter';

/**
 * Assert campaign blueprint is active for execution.
 * Scheduler and plan consumers must call this before using blueprint for execution.
 * @throws Error if blueprint_status is not ACTIVE
 */
export async function assertBlueprintActive(campaignId: string): Promise<void> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('blueprint_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) return; // Allow on error for backward compat when column missing
  const status = data?.blueprint_status ?? 'ACTIVE';
  if (status !== 'ACTIVE') {
    throw new Error('Blueprint outdated. Regeneration required.');
  }
}

/**
 * Get unified campaign blueprint from any available source.
 * Priority: 12_week_plan → campaign_versions → weekly_content_refinements.
 * Returns null if no plan exists. Does not throw.
 */
export async function getUnifiedCampaignBlueprint(
  campaignId: string
): Promise<CampaignBlueprint | null> {
  if (!campaignId || typeof campaignId !== 'string') {
    return null;
  }

  try {
    // 1. Check 12_week_plan (Flow B - Structured Blueprint)
    const { data: planRow, error: planError } = await supabase
      .from('12_week_plan')
      .select('weeks, blueprint')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!planError && planRow) {
      // Prefer stored blueprint if available
      if (planRow.blueprint && typeof planRow.blueprint === 'object') {
        const bp = planRow.blueprint as CampaignBlueprint;
        if (bp.weeks && Array.isArray(bp.weeks) && bp.weeks.length > 0) {
          return { ...bp, campaign_id: campaignId };
        }
      }
      // Convert from weeks
      const weeks = planRow.weeks;
      if (weeks && Array.isArray(weeks) && weeks.length > 0) {
        return fromStructuredPlan({ weeks, campaign_id: campaignId });
      }
    }

    // 2. Check campaign_versions.campaign_snapshot.weekly_plan (Flow A)
    const { data: versionRow, error: versionError } = await supabase
      .from('campaign_versions')
      .select('campaign_snapshot')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!versionError && versionRow?.campaign_snapshot) {
      const snapshot = versionRow.campaign_snapshot;
      const weeklyPlan = snapshot?.weekly_plan;
      if (Array.isArray(weeklyPlan) && weeklyPlan.length > 0) {
        return fromRecommendationPlan(weeklyPlan, campaignId);
      }
    }

    // 3. Check weekly_content_refinements (Flow C)
    const { data: refinements, error: refError } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });

    if (!refError && refinements && refinements.length > 0) {
      return fromLegacyRefinements(refinements, campaignId);
    }

    return null;
  } catch (err) {
    console.warn('[campaignBlueprintService] getUnifiedCampaignBlueprint error:', err);
    return null;
  }
}

/** Legacy week shape expected by buildPlatformExecutionPlan, validateCampaignHealth, etc. */
export type LegacyWeekPlan = {
  week_number: number;
  theme: string;
  platforms: string[];
  content_types?: Record<string, string[]>;
  [key: string]: any;
};

/** Resolved context for endpoints: campaign metadata + weekly/daily plans in legacy shape */
export type ResolvedCampaignPlanContext = {
  campaign: any;
  weekly_plan: LegacyWeekPlan[];
  daily_plan: any[];
  campaign_version: any | null;
  /** Duration from blueprint when available; use for expectedDurationWeeks in health checks */
  duration_weeks?: number;
};

/**
 * Get resolved campaign plan context for endpoints.
 * Blueprint-first: 12_week_plan.blueprint → campaign_snapshot.weekly_plan → weekly_content_refinements.
 * Never prefer campaign_snapshot over blueprint.
 * @param requireActiveBlueprint - When true, throws if blueprint_status !== ACTIVE (for execution flows)
 */
export async function getResolvedCampaignPlanContext(
  companyId: string,
  campaignId: string,
  requireActiveBlueprint = false
): Promise<ResolvedCampaignPlanContext | null> {
  const { blueprintWeekToLegacyWeekPlan } = await import('./campaignBlueprintAdapter');
  const { getLatestApprovedCampaignVersion } = await import('../db/campaignApprovedVersionStore');
  const { getLatestCampaignVersion } = await import('../db/campaignVersionStore');

  const campaignVersion =
    (await getLatestApprovedCampaignVersion(companyId, campaignId)) ??
    (await getLatestCampaignVersion(companyId, campaignId));

  let campaign =
    campaignVersion?.campaign_snapshot?.campaign ??
    campaignVersion?.campaign_snapshot ??
    {};
  const daily_plan = campaignVersion?.campaign_snapshot?.daily_plan ?? [];

  if (!campaignVersion && (!campaign || !campaign.id)) {
    const { data: campRow } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle();
    if (campRow) campaign = campRow;
  }

  const { data: campaignRow } = await supabase
    .from('campaigns')
    .select('duration_weeks')
    .eq('id', campaignId)
    .maybeSingle();
  const campaignDurationWeeks = campaignRow?.duration_weeks;

  const blueprint = await getUnifiedCampaignBlueprint(campaignId);
  if (blueprint && blueprint.weeks.length > 0) {
    if (requireActiveBlueprint) {
      await assertBlueprintActive(campaignId);
    }
    const weekly_plan = blueprint.weeks.map((w) => blueprintWeekToLegacyWeekPlan(w));
    return {
      campaign,
      weekly_plan,
      daily_plan,
      campaign_version: campaignVersion,
      duration_weeks: campaignDurationWeeks ?? blueprint.duration_weeks,
    };
  }

  const snapshotWeeklyPlan = campaignVersion?.campaign_snapshot?.weekly_plan;
  if (Array.isArray(snapshotWeeklyPlan) && snapshotWeeklyPlan.length > 0) {
    if (requireActiveBlueprint) {
      await assertBlueprintActive(campaignId);
    }
    console.warn(`Legacy weekly plan fallback used for campaign ${campaignId}`);
    return {
      campaign,
      weekly_plan: snapshotWeeklyPlan,
      daily_plan,
      campaign_version: campaignVersion,
      duration_weeks: campaignDurationWeeks ?? snapshotWeeklyPlan.length,
    };
  }

  const refinements = await (async () => {
    const { data } = await supabase
      .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });
    return data ?? [];
  })();
  if (refinements.length > 0) {
    if (requireActiveBlueprint) {
      await assertBlueprintActive(campaignId);
    }
    const bp = (await import('./campaignBlueprintAdapter')).fromLegacyRefinements(
      refinements,
      campaignId
    );
    console.warn(`Legacy weekly plan fallback used for campaign ${campaignId} (from refinements)`);
    return {
      campaign,
      weekly_plan: bp.weeks.map((w) => blueprintWeekToLegacyWeekPlan(w)),
      daily_plan,
      campaign_version: campaignVersion,
      duration_weeks: campaignDurationWeeks ?? bp.duration_weeks,
    };
  }

  return null;
}
