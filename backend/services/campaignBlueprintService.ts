/**
 * Unified read layer for campaign blueprints.
 * Resolves from campaign_week_plan, campaign_versions.campaign_snapshot.weekly_plan, or weekly_content_refinements.
 */

import { supabase } from '../db/supabaseClient';
import { BLUEPRINT_FREEZE_WINDOW_HOURS } from '../governance/GovernanceConfig';
import { blueprintPerItemLocksEnabled } from '../../config/featureFlags';
import { memoRequest } from './requestScopedMemo';

/** Stage 11: Deterministic guard — campaign must have duration_weeks set before blueprint resolution. */
export class PrePlanningRequiredError extends Error {
  code = 'PRE_PLANNING_REQUIRED' as const;
  constructor(message = 'Campaign duration not initialized. Run pre-planning first.') {
    super(message);
    this.name = 'PrePlanningRequiredError';
  }
}

/** Stage 15: Blueprint Execution Integrity — campaign cannot be mutated while in execution. */
export class BlueprintImmutableError extends Error {
  code = 'BLUEPRINT_IMMUTABLE' as const;
  constructor(message = 'Blueprint cannot be modified while campaign is in execution.') {
    super(message);
    this.name = 'BlueprintImmutableError';
  }
}

/** Stage 16: Execution Window Freeze — blueprint locked within N hours of first scheduled post. */
export class BlueprintExecutionFreezeError extends Error {
  code = 'EXECUTION_WINDOW_FROZEN' as const;
  hoursUntilExecution: number;
  freezeWindowHours: number;
  constructor(
    message = 'Blueprint modifications are locked within 24 hours of execution.',
    hoursUntilExecution: number,
    freezeWindowHours: number
  ) {
    super(message);
    this.name = 'BlueprintExecutionFreezeError';
    this.hoursUntilExecution = hoursUntilExecution;
    this.freezeWindowHours = freezeWindowHours;
  }
}

/** R2-P2 — optional scoping for the mutability check. `affectedSlots` are
 *  the EXISTING execution identifiers (daily_content_plans.execution_id)
 *  a scoped operation touches; whole-campaign operations omit it and
 *  evaluate every item. Additive — existing callers pass nothing. */
export interface BlueprintMutabilityOptions {
  affectedSlots?: string[];
}

/**
 * Assert blueprint is mutable before any mutation (update-duration, regenerate, negotiate, etc).
 *
 * LEGACY doctrine (default — BLUEPRINT_PER_ITEM_LOCKS unset/false):
 * Throws BlueprintImmutableError when campaign is ACTIVE or has scheduled/published posts.
 * Throws BlueprintExecutionFreezeError when first scheduled post is within freeze window.
 * Allows mutation only when blueprint_status === 'INVALIDATED' or execution_status === 'PAUSED',
 * and no scheduled post within BLUEPRINT_FREEZE_WINDOW_HOURS.
 *
 * CANONICAL doctrine (BLUEPRINT_PER_ITEM_LOCKS=true — SPEC-001 §2, R2-P2):
 * immutability is PER-ITEM, never campaign-wide. An item protects the
 * blueprint only when it is publishing/published, or when it is live
 * (scheduled/failed-retryable) inside ITS OWN freeze window. Campaign-level
 * scheduling never freezes unrelated items; cancelled/draft/blocked items
 * never protect anything. Same guard API, same error types — only the
 * decision model changes, via configuration.
 */
export async function assertBlueprintMutable(
  campaignId: string,
  options?: BlueprintMutabilityOptions,
): Promise<void> {
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('execution_status, blueprint_status, duration_weeks')
    .eq('id', campaignId)
    .maybeSingle();

  if (campError || !campaign) return;

  // Campaigns without duration are not yet initialized — allow pre-planning and blueprint generation
  const durationWeeks = (campaign as { duration_weeks?: number | null }).duration_weeks;
  if (durationWeeks == null) {
    return;
  }

  if (blueprintPerItemLocksEnabled()) {
    return assertPerItemLocksNotBreached(campaignId, options);
  }

  const executionStatus = String(campaign.execution_status ?? 'ACTIVE').toUpperCase();
  const blueprintStatus = String(campaign.blueprint_status ?? 'ACTIVE').toUpperCase();

  if (blueprintStatus === 'INVALIDATED') {
    await assertFreezeWindowNotBreached(campaignId);
    return;
  }
  if (executionStatus === 'PAUSED') {
    await assertFreezeWindowNotBreached(campaignId);
    return;
  }

  if (executionStatus === 'ACTIVE') {
    throw new BlueprintImmutableError('Blueprint cannot be modified while campaign is in execution.');
  }

  const { data: scheduled, error: schedError } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();

  if (!schedError && scheduled) {
    throw new BlueprintImmutableError('Blueprint cannot be modified while campaign is in execution.');
  }
}

/**
 * R2-P2 — the canonical per-item evaluation. Deterministic precedence:
 * any publishing/published item → BlueprintImmutableError; else any live
 * item inside its own window → BlueprintExecutionFreezeError (reporting
 * the nearest item). No protected items → mutable, regardless of campaign
 * status or how many future posts exist.
 */
async function assertPerItemLocksNotBreached(
  campaignId: string,
  options?: BlueprintMutabilityOptions,
): Promise<void> {
  const affected = (options?.affectedSlots ?? []).map((s) => String(s).trim()).filter(Boolean);

  let postIdFilter: string[] | null = null;
  if (affected.length > 0) {
    // Scoped operation: evaluate ONLY the items its slots resolve to
    // (existing execution_id → scheduled_post_id linkage on the plan rows).
    const { data: planRows, error: planError } = await supabase
      .from('daily_content_plans')
      .select('scheduled_post_id')
      .eq('campaign_id', campaignId)
      .in('execution_id', affected);
    if (planError) return; // fail-open matches the legacy guard's error posture
    postIdFilter = (Array.isArray(planRows) ? planRows : [])
      .map((r) => (r as { scheduled_post_id?: unknown }).scheduled_post_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (postIdFilter.length === 0) return; // affected slots have no live items
  }

  let query = supabase
    .from('scheduled_posts')
    .select('id, status, scheduled_at')
    .eq('campaign_id', campaignId);
  if (postIdFilter) query = query.in('id', postIdFilter);
  const { data: posts, error: postsError } = await query;
  if (postsError || !Array.isArray(posts) || posts.length === 0) return;

  const now = Date.now();
  let nearestFrozenHours: number | null = null;
  for (const post of posts as Array<{ status?: string | null; scheduled_at?: string | null }>) {
    const status = String(post.status ?? '').toLowerCase();
    if (status === 'publishing' || status === 'published') {
      throw new BlueprintImmutableError(
        'Blueprint cannot be modified: an item is publishing or already published. Unaffected items remain editable via scoped operations.',
      );
    }
    // Live items (scheduled, or failed awaiting retry) lock only inside
    // their OWN window; cancelled/draft/blocked never protect anything.
    if (status !== 'scheduled' && status !== 'failed') continue;
    if (!post.scheduled_at) continue;
    const hoursUntil = (new Date(post.scheduled_at).getTime() - now) / 3600000;
    if (hoursUntil <= BLUEPRINT_FREEZE_WINDOW_HOURS) {
      nearestFrozenHours = nearestFrozenHours === null ? hoursUntil : Math.min(nearestFrozenHours, hoursUntil);
    }
  }
  if (nearestFrozenHours !== null) {
    throw new BlueprintExecutionFreezeError(
      `Blueprint modifications are locked within ${BLUEPRINT_FREEZE_WINDOW_HOURS} hours of an item's execution.`,
      nearestFrozenHours,
      BLUEPRINT_FREEZE_WINDOW_HOURS,
    );
  }
}

/**
 * Stage 16: Check that earliest scheduled post is not within freeze window.
 * Throws BlueprintExecutionFreezeError when within BLUEPRINT_FREEZE_WINDOW_HOURS.
 */
async function assertFreezeWindowNotBreached(campaignId: string): Promise<void> {
  const { data: earliest, error } = await supabase
    .from('scheduled_posts')
    .select('scheduled_at')
    .eq('campaign_id', campaignId)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !earliest?.scheduled_at) return;

  const scheduledAt = new Date(earliest.scheduled_at).getTime();
  const now = Date.now();
  const hoursUntilExecution = (scheduledAt - now) / 3600000;

  if (hoursUntilExecution <= BLUEPRINT_FREEZE_WINDOW_HOURS) {
    throw new BlueprintExecutionFreezeError(
      `Blueprint modifications are locked within ${BLUEPRINT_FREEZE_WINDOW_HOURS} hours of execution.`,
      hoursUntilExecution,
      BLUEPRINT_FREEZE_WINDOW_HOURS
    );
  }
}

/**
 * Check if blueprint is mutable (read-only, never throws).
 * Used by campaign-status API for UI visibility.
 */
export async function isBlueprintMutable(
  campaignId: string,
  options?: BlueprintMutabilityOptions,
): Promise<boolean> {
  try {
    await assertBlueprintMutable(campaignId, options);
    return true;
  } catch {
    return false;
  }
}

/** Stage 16: Block reason for UI differentiation (red vs orange banner). */
export type BlueprintBlockReason = 'IMMUTABLE' | 'FROZEN' | null;

/**
 * Get why blueprint mutation is blocked. Returns null when mutable.
 * Used by campaign-status API for UI (blueprintImmutable vs blueprintFrozen).
 */
export async function getBlueprintBlockReason(
  campaignId: string,
  options?: BlueprintMutabilityOptions,
): Promise<BlueprintBlockReason> {
  try {
    await assertBlueprintMutable(campaignId, options);
    return null;
  } catch (err) {
    if (err instanceof BlueprintExecutionFreezeError) return 'FROZEN';
    if (err instanceof BlueprintImmutableError) return 'IMMUTABLE';
    return 'IMMUTABLE';
  }
}
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
 * Priority: campaign_week_plan → campaign_versions → weekly_content_refinements.
 * Returns null if no plan exists. Does not throw.
 */
export async function getUnifiedCampaignBlueprint(
  campaignId: string
): Promise<CampaignBlueprint | null> {
  if (!campaignId || typeof campaignId !== 'string') {
    return null;
  }
  // PERF-001: dedupe repeated identical blueprint loads within a single request
  // (loadSources calls this 2-3× per resolve). No-op outside a memo scope.
  return memoRequest(`blueprint:${campaignId}`, () => loadUnifiedCampaignBlueprint(campaignId));
}

async function loadUnifiedCampaignBlueprint(
  campaignId: string
): Promise<CampaignBlueprint | null> {
  try {
    // 1. Check campaign_week_plan (Flow B - Structured Blueprint)
    // Prefer: edited_committed > committed > draft (status column if present)
    let planRow: { weeks?: any; blueprint?: any } | null = null;
    const { data: planRows, error: planError } = await supabase
      .from('campaign_week_plan')
      .select('weeks, blueprint, status')
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (!planError && planRows && planRows.length > 0) {
      const withStatus = planRows.find((r: any) => ['edited_committed', 'committed'].includes(r?.status));
      planRow = withStatus ?? planRows[0];
    } else if (planError) {
      // Fallback: status column may not exist; fetch without it
      const { data: fallbackRows } = await supabase
        .from('campaign_week_plan')
        .select('weeks, blueprint')
        .eq('campaign_id', campaignId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackRows) planRow = fallbackRows as any;
    }

    if (planRow) {
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
 * Blueprint-first: campaign_week_plan.blueprint → campaign_snapshot.weekly_plan → weekly_content_refinements.
 * Never prefer campaign_snapshot over blueprint.
 * @param requireActiveBlueprint - When true, throws if blueprint_status !== ACTIVE (for execution flows)
 */
export async function getResolvedCampaignPlanContext(
  companyId: string,
  campaignId: string,
  requireActiveBlueprint = false
): Promise<ResolvedCampaignPlanContext | null> {
  // Stage 11: Pre-planning gate — duration_weeks must be set before blueprint resolution
  const { data: durationRow } = await supabase
    .from('campaigns')
    .select('duration_weeks')
    .eq('id', campaignId)
    .maybeSingle();
  if (durationRow?.duration_weeks == null) {
    throw new PrePlanningRequiredError('Campaign duration not initialized. Run pre-planning first.');
  }
  const campaignDurationWeeks = durationRow.duration_weeks;

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
