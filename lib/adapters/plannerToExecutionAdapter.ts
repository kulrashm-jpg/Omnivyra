/**
 * Planner → Execution Adapter
 *
 * DESIGN CONSTRAINTS (non-negotiable):
 *   - Pure function: no service calls, no DB access, no side effects
 *   - Additive only: maps existing planner fields → existing execution fields
 *   - No new required fields introduced to ExecutionPlanRow
 *   - Missing fields receive safe defaults already used by the execution engine
 *   - is_planner_generated stored inside content JSON (no schema change needed)
 *   - generation_source = 'manual' (existing ExecutionSource, closest semantic match)
 *
 * Mapping table:
 *   Planner field              → Execution field        Notes
 *   ─────────────────────────────────────────────────────────────────
 *   week_number                → week_number            default 1
 *   day                        → day_of_week            default 'Monday'
 *   (computed)                 → date                   startDate + week + day offset
 *   platform                   → platform               normalizePlatform()
 *   content_type               → content_type           normalizeContentType()
 *   topic ?? title ?? theme    → title                  priority: topic > title > theme
 *   topic ?? title ?? theme    → topic                  same value
 *   description ?? angle       → content (JSON)         inside placeholder blob
 *   (fixed)                    → status                 'planned'
 *   (fixed)                    → ai_generated           false
 *   (fixed)                    → generation_source      'manual'
 *   execution_id               → execution_id           passthrough or null
 *   (fixed)                    → is_planner_generated   true (inside content JSON)
 */

// ---------------------------------------------------------------------------
// Input types (mirrors planner session store — defined locally to avoid
// React-dependency chain; kept intentionally loose to accept future fields)
// ---------------------------------------------------------------------------

export interface PlannerActivityInput {
  execution_id?: string | null;
  week_number?: number | null;
  platform?: string | null;
  content_type?: string | null;
  /** AI-enriched topic; highest priority for title. */
  topic?: string | null;
  title?: string | null;
  theme?: string | null;
  day?: string | null;
  /** AI-generated description / content idea. */
  description?: string | null;
  /** Selected angle from the idea spine. */
  angle?: string | null;
  /** Funnel stage from strategy mapper (awareness / education / trust / conversion). */
  funnel_stage?: string | null;
  /** Campaign phase label. */
  phase?: string | null;
}

export interface AdapterInput {
  activities: PlannerActivityInput[];
  campaignId: string;
  /** ISO date string YYYY-MM-DD; used to compute absolute slot dates. */
  startDate: string;
}

/**
 * Shape that satisfies ExecutionPlanRow (from executionPlannerPersistence.ts).
 * Typed as intersection to remain compatible with Record<string, unknown>.
 */
export interface AdaptedExecutionRow {
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  date: string;
  platform: string;
  content_type: string;
  title: string;
  topic: string;
  /** JSON string — always contains placeholder:true for execution engine gate. */
  content: string;
  status: string;
  ai_generated: boolean;
  generation_source: string;
  execution_id: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Private normalization helpers
// (Mirror the logic in planner-finalize.ts — kept private to this adapter
// so there is no coupling to the API route internals.)
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function dayNameToIndex(day: string): number {
  const d = String(day || 'Monday').trim();
  const idx = DAYS_OF_WEEK.indexOf(d as (typeof DAYS_OF_WEEK)[number]);
  return idx >= 0 ? idx + 1 : 1;
}

function computeDate(startDate: string, weekNumber: number, dayName: string): string {
  const start = new Date(startDate);
  const dayIndex = dayNameToIndex(dayName);
  const offsetDays = (weekNumber - 1) * 7 + (dayIndex - 1);
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().split('T')[0];
}

function normalizePlatform(p: string | null | undefined): string {
  const MAP: Record<string, string> = {
    twitter: 'x',
    x: 'x',
    linkedin: 'linkedin',
    youtube: 'youtube',
    pinterest: 'pinterest',
    instagram: 'instagram',
    facebook: 'facebook',
    tiktok: 'tiktok',
  };
  const key = String(p ?? '').trim().toLowerCase();
  return (MAP[key] ?? key) || 'linkedin';
}

function normalizeContentType(t: string | null | undefined): string {
  const MAP: Record<string, string> = {
    text: 'post',
    article: 'post',
    thread: 'post',
    reel: 'video',
    short: 'video',
    video: 'video',
    carousel: 'carousel',
    story: 'story',
    blog: 'blog',
    post: 'post',
  };
  const key = String(t ?? 'post').trim().toLowerCase();
  return (MAP[key] ?? key) || 'post';
}

// ---------------------------------------------------------------------------
// Content placeholder builder
// Follows the exact shape validated by planner-finalize.ts:
//   { placeholder: true, label, ...metadata }
// Extra fields are stored here to avoid schema changes.
// ---------------------------------------------------------------------------

function buildContentJson(
  platform: string,
  contentType: string,
  activity: PlannerActivityInput
): string {
  const label = `${platform} ${contentType}`;
  const payload: Record<string, unknown> = {
    placeholder: true,
    label,
    // Debugging / rollback marker — NOT used by execution engine
    is_planner_generated: true,
  };
  // Preserve AI-enriched context when available (read-only for execution engine)
  if (activity.description) payload.description = activity.description;
  if (activity.angle)       payload.angle = activity.angle;
  if (activity.funnel_stage) payload.funnel_stage = activity.funnel_stage;
  if (activity.phase)       payload.phase = activity.phase;
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Public adapter function
// ---------------------------------------------------------------------------

/**
 * Converts Campaign Planner activities into execution-ready rows.
 *
 * Guarantees:
 *   - Every row has all required ExecutionPlanRow fields
 *   - content JSON always passes the `placeholder === true` gate in planner-finalize
 *   - No service calls; safe to call in any context (server or test)
 *
 * @throws {AdapterValidationError} if a required field cannot be resolved after defaults
 */
export function adaptPlannerOutputToExecutionFormat(input: AdapterInput): AdaptedExecutionRow[] {
  const { activities, campaignId, startDate } = input;

  if (!campaignId || typeof campaignId !== 'string') {
    throw new AdapterValidationError('campaignId is required');
  }
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new AdapterValidationError(`startDate must be YYYY-MM-DD, got: ${startDate}`);
  }
  // Guard: regex passes but calendar date is still invalid (e.g. 2024-02-30)
  if (isNaN(new Date(startDate).getTime())) {
    throw new AdapterValidationError(`startDate is not a valid calendar date: ${startDate}`);
  }
  if (!Array.isArray(activities) || activities.length === 0) {
    throw new AdapterValidationError('activities must be a non-empty array');
  }

  // Filter null/undefined entries before mapping to prevent mid-iteration crashes
  const validActivities = activities.filter((a): a is PlannerActivityInput => a != null && typeof a === 'object');
  if (validActivities.length === 0) {
    throw new AdapterValidationError('activities array contains no valid entries after filtering nulls');
  }

  return validActivities.map((act, idx): AdaptedExecutionRow => {
    // Guard: clamp weekNumber — Number(null/undefined) = 0, which produces negative date offsets
    const rawWeek = Number(act.week_number);
    const weekNumber = Number.isFinite(rawWeek) && rawWeek >= 1 ? Math.floor(rawWeek) : 1;
    const dayName = String(act.day ?? 'Monday').trim() || 'Monday';
    const platform = normalizePlatform(act.platform);
    const contentType = normalizeContentType(act.content_type);

    // Title resolution: topic (AI) > title (planner) > theme (fallback) > generated label
    const resolvedTitle = (
      act.topic?.trim() ||
      act.title?.trim() ||
      act.theme?.trim() ||
      `Week ${weekNumber} slot ${idx + 1}`
    );

    return {
      campaign_id: campaignId,
      week_number: weekNumber,
      day_of_week: dayName,
      date: computeDate(startDate, weekNumber, dayName),
      platform,
      content_type: contentType,
      title: resolvedTitle,
      topic: resolvedTitle,
      content: buildContentJson(platform, contentType, act),
      status: 'planned',
      ai_generated: false,
      generation_source: 'manual',        // existing ExecutionSource value
      execution_id: act.execution_id ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Typed error for caller to distinguish adapter failures from other errors
// ---------------------------------------------------------------------------

export class AdapterValidationError extends Error {
  constructor(message: string) {
    super(`[PLANNER][ADAPTER][ERROR] ${message}`);
    this.name = 'AdapterValidationError';
  }
}
