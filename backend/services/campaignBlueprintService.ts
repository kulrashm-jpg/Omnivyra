/**
 * Unified read layer for campaign blueprints.
 * Resolves from campaign_week_plan, campaign_versions.campaign_snapshot.weekly_plan, or weekly_content_refinements.
 */

import { supabase } from '../db/supabaseClient';
import { BLUEPRINT_FREEZE_WINDOW_HOURS } from '../governance/GovernanceConfig';
import { blueprintPerItemLocksEnabled } from '../../config/featureFlags';
import { campaignLifecycleSelect } from '../../lib/campaign/executionStatusCompat';
import { memoRequest } from './requestScopedMemo';
import {
  classifyPostQueueJobs,
  isRetryStateColumnMissing,
  type PostRetryClass,
} from '../queue/publishRetryState';

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

/**
 * A genuine database read failure while evaluating blueprint mutability.
 *
 * The guard used to treat every read error as "mutable" and return, so any
 * failed read — including the permanent 42703 on the absent
 * `campaigns.execution_status` column — silently disabled it. It now fails
 * closed: callers map this to 503 (retryable), distinct from a policy
 * conflict (409) and from a missing campaign (the guard allows; callers
 * own the 404).
 */
export class BlueprintMutabilityReadError extends Error {
  code = 'BLUEPRINT_STATE_READ_FAILED' as const;
  httpStatus = 503 as const;
  source: string;
  constructor(source: string, cause?: unknown) {
    const detail = (cause as { message?: unknown } | null | undefined)?.message;
    super(`Blueprint mutability could not be evaluated: ${source} read failed${typeof detail === 'string' && detail ? ` (${detail})` : ''}.`);
    this.name = 'BlueprintMutabilityReadError';
    this.source = source;
  }
}

/** PostgREST / Postgres `undefined_column`. */
const UNDEFINED_COLUMN = '42703';

/**
 * Read the OPTIONAL legacy `campaigns.execution_status` column.
 *
 * The column is absent in production (see lib/campaign/executionStatusCompat.ts):
 * an absent column — or a null value — is NO SIGNAL, never a state. A value
 * that is genuinely present is still honoured. Same narrow contract as
 * pages/api/campaigns/[id]/release.ts readOptionalExecutionStatus:
 *   • 42703 (column absent) → null
 *   • present               → the value, upper-cased (null when empty)
 *   • any other error       → BlueprintMutabilityReadError (never disguised)
 */
async function readOptionalExecutionStatus(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('execution_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) {
    if ((error as { code?: unknown }).code === UNDEFINED_COLUMN) return null;
    throw new BlueprintMutabilityReadError('campaigns.execution_status', error);
  }
  const value = (data as { execution_status?: unknown } | null)?.execution_status;
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
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
 * Throws BlueprintImmutableError when campaign is ACTIVE or has a PROTECTING post
 * (scheduled, publishing, published, or failed and not terminally resolved).
 * Allows mutation only when blueprint_status === 'INVALIDATED' or execution_status === 'PAUSED',
 * and then throws BlueprintExecutionFreezeError when the earliest protecting post
 * (scheduled, publishing, failed-not-terminal — not published) is within
 * BLUEPRINT_FREEZE_WINDOW_HOURS.
 *
 * CANONICAL doctrine (BLUEPRINT_PER_ITEM_LOCKS=true — SPEC-001 §2, R2-P2):
 * immutability is PER-ITEM, never campaign-wide. An item protects the
 * blueprint only when it is publishing/published, or when it is live
 * (scheduled, or failed and not terminally resolved) inside ITS OWN freeze
 * window. Campaign-level
 * scheduling never freezes unrelated items; cancelled/draft/blocked items
 * never protect anything. Same guard API, same error types — only the
 * decision model changes, via configuration.
 *
 * Read contract (both doctrines): the campaign is read through the
 * canonical lifecycle select, which never names the absent
 * `execution_status` column. A missing campaign is allowed (callers own the
 * 404). A missing or null lifecycle value is NO SIGNAL — it is never
 * synthesized into 'ACTIVE'. Any genuine read failure throws
 * BlueprintMutabilityReadError; no read in this guard allows on error.
 */
export async function assertBlueprintMutable(
  campaignId: string,
  options?: BlueprintMutabilityOptions,
): Promise<void> {
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select(campaignLifecycleSelect('duration_weeks'))
    .eq('id', campaignId)
    .maybeSingle();

  if (campError) throw new BlueprintMutabilityReadError('campaigns', campError);
  if (!campaign) return;

  const row = campaign as unknown as { blueprint_status?: unknown; duration_weeks?: number | null };

  // Campaigns without duration are not yet initialized — allow pre-planning and blueprint generation
  if (row.duration_weeks == null) {
    return;
  }

  if (blueprintPerItemLocksEnabled()) {
    return assertPerItemLocksNotBreached(campaignId, options);
  }

  // Absent column / null value → null (no signal). Never defaulted to 'ACTIVE'.
  const executionStatus = await readOptionalExecutionStatus(campaignId);
  const blueprintStatus =
    typeof row.blueprint_status === 'string' && row.blueprint_status.trim()
      ? row.blueprint_status.trim().toUpperCase()
      : null;

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

  // Legacy blanket: the campaign is in execution while ANY of its posts still
  // PROTECTS the blueprint. That used to be "any scheduled_posts row at all",
  // so a cancelled, draft or blocked row — or a failed one the pipeline had
  // finished with — froze the campaign forever. The approved protecting-status
  // policy decides instead; there is no time window in this campaign-wide rule.
  const posts = await readCampaignPosts(campaignId, null);
  if (await hasProtectingPost(posts)) {
    throw new BlueprintImmutableError('Blueprint cannot be modified while campaign is in execution.');
  }
}

/**
 * The approved protecting-status policy, shared by all three guard paths:
 *
 *   publishing, published  → protect (the per-item rule makes them IMMUTABLE;
 *                            the legacy freeze window ignores `published` —
 *                            history is not upcoming execution)
 *   scheduled              → protects
 *   failed                 → protects unless its queue_jobs show the publish
 *                            pipeline is TERMINALLY done with it
 *                            (classifyPostQueueJobs). UNKNOWN — no rows, a NULL
 *                            retry_state, an unrecognised value, or the column
 *                            absent before migration 20261202000000 — protects.
 *   cancelled, draft, blocked → never protect on their own
 *   NULL / unrecognised    → UNKNOWN, protects like scheduled (fail-safe)
 */
type GuardPost = { id: string; status: string; scheduled_for: string | null };

async function readCampaignPosts(campaignId: string, postIdFilter: string[] | null): Promise<GuardPost[]> {
  // `scheduled_posts` has no `scheduled_at` column — the timestamp is
  // `scheduled_for` (timestamptz NOT NULL; baseline schema and production).
  let query = supabase
    .from('scheduled_posts')
    .select('id, status, scheduled_for')
    .eq('campaign_id', campaignId);
  if (postIdFilter) query = query.in('id', postIdFilter);
  const { data, error } = await query;
  if (error) throw new BlueprintMutabilityReadError('scheduled_posts', error);
  return (Array.isArray(data) ? data : []).map((row) => {
    const r = row as { id?: unknown; status?: unknown; scheduled_for?: unknown };
    return {
      id: String(r.id ?? ''),
      status: String(r.status ?? '').toLowerCase(),
      scheduled_for: typeof r.scheduled_for === 'string' ? r.scheduled_for : null,
    };
  });
}

/**
 * Classify failed posts from ALL of their queue_jobs rows, in one read.
 * Before migration 20261202000000 the retry_state column is absent: nothing can
 * be shown terminal, so every failed post is UNKNOWN (the pre-migration,
 * fail-safe answer). Any other read failure is a typed 503, never "no rows".
 */
async function classifyFailedPosts(postIds: string[]): Promise<Map<string, PostRetryClass>> {
  const classes = new Map<string, PostRetryClass>();
  if (postIds.length === 0) return classes;
  const { data, error } = await supabase
    .from('queue_jobs')
    .select('scheduled_post_id, status, retry_state, error_code')
    .in('scheduled_post_id', postIds);
  if (error) {
    if (isRetryStateColumnMissing(error)) {
      for (const id of postIds) classes.set(id, 'UNKNOWN');
      return classes;
    }
    throw new BlueprintMutabilityReadError('queue_jobs', error);
  }
  const rowsByPost = new Map<string, Array<{ status?: unknown; retry_state?: unknown; error_code?: unknown }>>();
  for (const row of Array.isArray(data) ? data : []) {
    const r = row as { scheduled_post_id?: unknown; status?: unknown; retry_state?: unknown; error_code?: unknown };
    const key = String(r.scheduled_post_id ?? '');
    const list = rowsByPost.get(key) ?? [];
    list.push({ status: r.status, retry_state: r.retry_state, error_code: r.error_code });
    rowsByPost.set(key, list);
  }
  for (const id of postIds) classes.set(id, classifyPostQueueJobs(rowsByPost.get(id) ?? []));
  return classes;
}

function hoursUntil(post: GuardPost, now: number): number | null {
  if (!post.scheduled_for) return null;
  const at = new Date(post.scheduled_for).getTime();
  return Number.isFinite(at) ? (at - now) / 3600000 : null;
}

/** Legacy blanket: does any post protect the blueprint, at any time? */
async function hasProtectingPost(posts: GuardPost[]): Promise<boolean> {
  if (posts.some((p) =>
    p.status === 'scheduled' || p.status === 'publishing' || p.status === 'published' || isUnrecognizedPostStatus(p.status),
  )) {
    return true;
  }
  const failedIds = posts.filter((p) => p.status === 'failed').map((p) => p.id);
  if (failedIds.length === 0) return false;
  const classes = await classifyFailedPosts(failedIds);
  return failedIds.some((id) => classes.get(id) !== 'TERMINAL');
}

/**
 * Hours until the nearest PROTECTING post inside the freeze window (overdue
 * posts count — they are negative), or null when none is. `windowStatuses` are
 * the non-failed statuses that protect on the calling path; failed posts in the
 * window protect unless TERMINAL.
 */
async function nearestProtectingHoursInWindow(
  posts: GuardPost[],
  windowStatuses: ReadonlySet<string>,
): Promise<number | null> {
  const now = Date.now();
  let nearest: number | null = null;
  const consider = (hours: number) => { nearest = nearest === null ? hours : Math.min(nearest, hours); };
  const failedInWindow: Array<{ id: string; hours: number }> = [];
  for (const post of posts) {
    const hours = hoursUntil(post, now);
    if (hours === null || hours > BLUEPRINT_FREEZE_WINDOW_HOURS) continue;
    if (windowStatuses.has(post.status) || isUnrecognizedPostStatus(post.status)) consider(hours);
    else if (post.status === 'failed') failedInWindow.push({ id: post.id, hours });
  }
  if (failedInWindow.length > 0) {
    const classes = await classifyFailedPosts(failedInWindow.map((f) => f.id));
    for (const f of failedInWindow) {
      if (classes.get(f.id) !== 'TERMINAL') consider(f.hours);
    }
  }
  return nearest;
}

/**
 * scheduled_posts.status is CHECK-constrained to these values but NULLABLE, so
 * a NULL (or any value outside the set) can be stored. Such a post's state is
 * UNKNOWN and is treated as protecting — the same fail-safe rule as an unknown
 * retry state — never silently as cancelled/draft.
 */
const KNOWN_POST_STATUSES: ReadonlySet<string> = new Set([
  'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'blocked',
]);
function isUnrecognizedPostStatus(status: string): boolean {
  return !KNOWN_POST_STATUSES.has(status);
}

const PER_ITEM_WINDOW_STATUSES: ReadonlySet<string> = new Set(['scheduled']);
const LEGACY_FREEZE_WINDOW_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'publishing']);

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
    if (planError) throw new BlueprintMutabilityReadError('daily_content_plans', planError);
    postIdFilter = (Array.isArray(planRows) ? planRows : [])
      .map((r) => (r as { scheduled_post_id?: unknown }).scheduled_post_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (postIdFilter.length === 0) return; // affected slots have no live items
  }

  const posts = await readCampaignPosts(campaignId, postIdFilter);
  if (posts.length === 0) return;

  if (posts.some((p) => p.status === 'publishing' || p.status === 'published')) {
    throw new BlueprintImmutableError(
      'Blueprint cannot be modified: an item is publishing or already published. Unaffected items remain editable via scoped operations.',
    );
  }
  // Live items lock only inside their OWN window: scheduled (overdue
  // included), and failed unless the publish pipeline is terminally done
  // with it. cancelled/draft/blocked never protect anything.
  const nearestFrozenHours = await nearestProtectingHoursInWindow(posts, PER_ITEM_WINDOW_STATUSES);
  if (nearestFrozenHours !== null) {
    throw new BlueprintExecutionFreezeError(
      `Blueprint modifications are locked within ${BLUEPRINT_FREEZE_WINDOW_HOURS} hours of an item's execution.`,
      nearestFrozenHours,
      BLUEPRINT_FREEZE_WINDOW_HOURS,
    );
  }
}

/**
 * Stage 16: the campaign-wide freeze window (legacy doctrine; the PAUSED and
 * INVALIDATED escapes both land here). Throws BlueprintExecutionFreezeError
 * when the earliest PROTECTING post is within BLUEPRINT_FREEZE_WINDOW_HOURS.
 *
 * It used to take the earliest post of ANY status, so a long-published,
 * cancelled, draft or blocked post — always in the past — froze the campaign
 * forever. Candidates are now scheduled, publishing, and failed posts the
 * pipeline is not terminally done with; `published` is history, not upcoming
 * execution, and does not participate here.
 */
async function assertFreezeWindowNotBreached(campaignId: string): Promise<void> {
  const posts = await readCampaignPosts(campaignId, null);
  const hoursUntilExecution = await nearestProtectingHoursInWindow(posts, LEGACY_FREEZE_WINDOW_STATUSES);

  if (hoursUntilExecution !== null) {
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

/**
 * Stage 16: Block reason for UI differentiation (red vs orange banner).
 * 'UNAVAILABLE' — the lock state could not be evaluated (a read failed). It is
 * NOT a confirmed lock, and NOT mutable either: mutations still fail closed
 * with 503 on the server.
 */
export type BlueprintBlockReason = 'IMMUTABLE' | 'FROZEN' | 'UNAVAILABLE' | null;

/**
 * Get why blueprint mutation is blocked. Returns null when mutable.
 * Used by campaign-status API for UI (blueprintImmutable vs blueprintFrozen).
 * Only the two policy errors are a confirmed state; anything else — the typed
 * read failure, or an unexpected error — is 'UNAVAILABLE', never 'IMMUTABLE'.
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
    return 'UNAVAILABLE';
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
 *
 * Read contract (`blueprint_status` exists in production):
 *   • genuine read failure            → BlueprintMutabilityReadError (fails closed; 503)
 *   • missing campaign                → allowed — callers own the 404
 *   • null blueprint_status           → NO SIGNAL — allowed, never synthesized into 'ACTIVE'
 *   • any other value but 'ACTIVE'    → Error('Blueprint outdated. Regeneration required.')
 * @throws Error if blueprint_status is present and not ACTIVE
 */
export async function assertBlueprintActive(campaignId: string): Promise<void> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('blueprint_status')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new BlueprintMutabilityReadError('campaigns.blueprint_status', error);
  if (!data) return;
  const status = (data as { blueprint_status?: unknown }).blueprint_status;
  if (status == null) return;
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
