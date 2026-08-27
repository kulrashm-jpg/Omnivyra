/**
 * P4 — campaign week state, bulk-selection conditions, and skeleton
 * validation (ALL PURE, ALL DERIVED).
 *
 * WHAT THIS IS
 * ------------
 * A read-model over facts that already exist. It creates NO new week model,
 * NO new slot model, NO new state machine and NO persistence. Every value is
 * recomputed from:
 *
 *   calendar_plan activities      → the slots in each week (P1 skeleton)
 *   draft_content / status        → text lifecycle  (campaignContentModel)
 *   CampaignAssignment[]          → assets + approval + execution (P3-B)
 *   platform_content_requests     → the declared skeleton (P4 validation)
 *
 * WHY DERIVED, NOT PERSISTED
 * --------------------------
 * A stored week status is a second source of truth that drifts the moment a
 * slot changes. Everything here is a projection, so a week's condition can
 * never disagree with its slots.
 *
 * SELECTION SEMANTICS (P4 §12) — three distinct things, never conflated:
 *   selectAll        every week in the campaign
 *   selectMatching   every week satisfying a condition (may exceed what is
 *                    on screen — the count says so)
 *   visible          only the currently filtered set
 *
 * Deterministic: same facts → same states, counts and verdicts.
 */

import { deriveContentItems, type ContentPlanLike } from './campaignContentModel';
import type { CampaignAssignment } from './campaignAssignments';

/* ────────────────────────────────────────────────────────────────────────
 * Week state
 * ──────────────────────────────────────────────────────────────────────── */

export interface WeekSlotCounts {
  /** Slots the skeleton placed in this week. */
  total: number;
  /** Slots with non-empty text. */
  with_content: number;
  /** Slots with no text at all. */
  empty: number;
  drafts: number;
  in_review: number;
  approved: number;
  /** Slots carrying at least one assignment. */
  with_assets: number;
  /** Assignments on this week's slots still awaiting approval. */
  assets_pending_approval: number;
  /** Slots whose execution produced a scheduled post. */
  released: number;
  /** Slots whose execution recorded a publish failure. */
  failed: number;
}

/**
 * The canonical week states, derived only from facts that exist today.
 * `planned` is the floor (the skeleton placed slots); the rest are refinements.
 */
export type WeekStateCode =
  | 'empty'        // the skeleton placed no slots in this week
  | 'planned'      // slots exist, no content written yet
  | 'in_progress'  // some slots written, some not
  | 'in_review'    // every slot written, at least one awaiting approval
  | 'approved'     // every slot written AND approved, nothing released
  | 'released'     // at least one slot produced a scheduled post
  | 'failed';      // at least one slot recorded a publish failure

export interface CampaignWeekState {
  week: number;
  counts: WeekSlotCounts;
  state: WeekStateCode;
  /** Platforms the skeleton placed in this week (sorted, lowercased). */
  platforms: string[];
  /** Content types the skeleton placed in this week (sorted). */
  content_types: string[];
  /** Days the skeleton placed in this week, in week order. */
  days: string[];
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Derive every week's state.
 *
 * Weeks come from the SLOTS the skeleton produced — a week with no slots is
 * reported as `empty` rather than silently omitted, so a CMO can see the hole.
 */
export function deriveCampaignWeekStates(input: {
  plan: ContentPlanLike | null | undefined;
  assignments?: CampaignAssignment[] | null;
  /** Declared campaign length; weeks beyond the plan are surfaced as `empty`. */
  durationWeeks?: number | null;
}): CampaignWeekState[] {
  const items = deriveContentItems(input.plan);
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];

  const assignmentsBySlot = new Map<string, CampaignAssignment[]>();
  for (const a of assignments) {
    if (!a?.structure_id) continue;
    const list = assignmentsBySlot.get(a.structure_id) ?? [];
    list.push(a);
    assignmentsBySlot.set(a.structure_id, list);
  }

  const byWeek = new Map<number, CampaignWeekState>();
  const ensure = (week: number): CampaignWeekState => {
    let w = byWeek.get(week);
    if (!w) {
      w = {
        week,
        counts: {
          total: 0, with_content: 0, empty: 0, drafts: 0, in_review: 0, approved: 0,
          with_assets: 0, assets_pending_approval: 0, released: 0, failed: 0,
        },
        state: 'empty',
        platforms: [],
        content_types: [],
        days: [],
      };
      byWeek.set(week, w);
    }
    return w;
  };

  // Declared-but-unplanned weeks surface as `empty` rather than disappearing.
  const declared = Number(input.durationWeeks);
  if (Number.isFinite(declared) && declared > 0) {
    for (let i = 1; i <= declared; i += 1) ensure(i);
  }

  const platformSets = new Map<number, Set<string>>();
  const typeSets = new Map<number, Set<string>>();
  const daySets = new Map<number, Set<string>>();

  for (const item of items) {
    const week = Number(item.slot.week);
    if (!Number.isFinite(week)) continue;
    const w = ensure(week);
    const c = w.counts;

    c.total += 1;
    if (item.has_content) {
      c.with_content += 1;
      if (item.status === 'approved') c.approved += 1;
      else if (item.status === 'review') c.in_review += 1;
      else c.drafts += 1;
    } else {
      c.empty += 1;
    }

    const slotAssignments = assignmentsBySlot.get(item.slot.structure_id) ?? [];
    if (slotAssignments.length > 0) {
      c.with_assets += 1;
      for (const a of slotAssignments) {
        const approval = a.approval ?? 'not_required';
        if (approval !== 'approved' && approval !== 'not_required') c.assets_pending_approval += 1;
        if (typeof a.scheduled_post_id === 'string' && a.scheduled_post_id.trim()) c.released += 1;
        if (a.execution_failure) c.failed += 1;
      }
    }

    if (item.slot.platform) {
      const s = platformSets.get(week) ?? new Set<string>();
      s.add(norm(item.slot.platform));
      platformSets.set(week, s);
    }
    if (item.slot.content_type) {
      const s = typeSets.get(week) ?? new Set<string>();
      s.add(norm(item.slot.content_type));
      typeSets.set(week, s);
    }
    if (item.slot.day) {
      const s = daySets.get(week) ?? new Set<string>();
      s.add(String(item.slot.day));
      daySets.set(week, s);
    }
  }

  for (const [week, w] of byWeek) {
    w.platforms = Array.from(platformSets.get(week) ?? []).sort();
    w.content_types = Array.from(typeSets.get(week) ?? []).sort();
    w.days = Array.from(daySets.get(week) ?? []).sort(
      (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
    );
    w.state = deriveWeekStateCode(w.counts);
  }

  return Array.from(byWeek.values()).sort((a, b) => a.week - b.week);
}

/**
 * The state predicate, stated once so UI and tests cannot disagree.
 * Most-terminal first.
 */
export function deriveWeekStateCode(c: WeekSlotCounts): WeekStateCode {
  if (c.total === 0) return 'empty';
  if (c.failed > 0) return 'failed';
  if (c.released > 0) return 'released';
  if (c.with_content === 0) return 'planned';
  if (c.with_content < c.total) return 'in_progress';
  // Every slot written from here.
  if (c.in_review > 0 || c.drafts > 0 || c.assets_pending_approval > 0) return 'in_review';
  return 'approved';
}

/* ────────────────────────────────────────────────────────────────────────
 * Bulk-selection conditions (P4 §10/§11)
 * ──────────────────────────────────────────────────────────────────────── */

export type WeekConditionId =
  | 'all'
  | 'empty'
  | 'incomplete'
  | 'complete'
  | 'no_content'
  | 'has_content'
  | 'awaiting_approval'
  | 'approved'
  | 'released'
  | 'unreleased'
  | 'failed';

export interface WeekCondition {
  id: WeekConditionId;
  label: string;
  /** The exact predicate, in words. Shown in the UI so the rule is never vague. */
  definition: string;
  match: (w: CampaignWeekState) => boolean;
}

/**
 * Every condition is derived from canonical counts. No condition exists that
 * cannot be computed from the facts above.
 */
export const WEEK_CONDITIONS: readonly WeekCondition[] = [
  {
    id: 'all',
    label: 'All weeks',
    definition: 'Every week in the campaign, including weeks with no slots.',
    match: () => true,
  },
  {
    id: 'empty',
    label: 'No slots',
    definition: 'The skeleton placed no slots in this week (total = 0).',
    match: (w) => w.counts.total === 0,
  },
  {
    id: 'no_content',
    label: 'No content written',
    definition: 'The week has slots, but none has text yet (total > 0 and with_content = 0).',
    match: (w) => w.counts.total > 0 && w.counts.with_content === 0,
  },
  {
    id: 'has_content',
    label: 'Has content',
    definition: 'At least one slot has text (with_content > 0).',
    match: (w) => w.counts.with_content > 0,
  },
  {
    id: 'incomplete',
    label: 'Incomplete',
    definition: 'The week has slots and at least one is not yet approved (total > 0 and approved < total).',
    match: (w) => w.counts.total > 0 && w.counts.approved < w.counts.total,
  },
  {
    id: 'complete',
    label: 'Complete',
    definition: 'Every slot in the week is written AND approved (total > 0 and approved = total).',
    match: (w) => w.counts.total > 0 && w.counts.approved === w.counts.total,
  },
  {
    id: 'awaiting_approval',
    label: 'Awaiting approval',
    definition: 'At least one slot is in review, or at least one assigned asset still needs approval.',
    match: (w) => w.counts.in_review > 0 || w.counts.assets_pending_approval > 0,
  },
  {
    id: 'approved',
    label: 'Approved',
    definition: 'Every slot is approved, no assets await approval, and nothing has been released yet.',
    match: (w) => w.state === 'approved',
  },
  {
    id: 'released',
    label: 'Released',
    definition: 'At least one slot produced a scheduled post (released > 0).',
    match: (w) => w.counts.released > 0,
  },
  {
    id: 'unreleased',
    label: 'Not released',
    definition: 'The week has slots and none has produced a scheduled post (total > 0 and released = 0).',
    match: (w) => w.counts.total > 0 && w.counts.released === 0,
  },
  {
    id: 'failed',
    label: 'Publish failures',
    definition: 'At least one slot recorded a publish failure (failed > 0).',
    match: (w) => w.counts.failed > 0,
  },
];

export function getWeekCondition(id: WeekConditionId): WeekCondition {
  const found = WEEK_CONDITIONS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown week condition: ${id}`);
  return found;
}

/** Weeks satisfying a condition, ascending. */
export function matchWeeks(states: CampaignWeekState[], id: WeekConditionId): number[] {
  const condition = getWeekCondition(id);
  return states.filter((w) => condition.match(w)).map((w) => w.week).sort((a, b) => a - b);
}

export interface WeekSelectionSummary {
  /** Weeks explicitly selected. */
  selected: number[];
  selected_count: number;
  /** Weeks satisfying the active condition. */
  matching_count: number;
  /** Every week in the campaign. */
  total_count: number;
  /** "7 of 12 weeks match Incomplete" */
  match_label: string;
  /** "3 weeks selected" */
  selection_label: string;
}

/** Counts the UI shows so the user always knows what will be affected. */
export function summarizeWeekSelection(input: {
  states: CampaignWeekState[];
  selected: number[];
  condition?: WeekConditionId;
}): WeekSelectionSummary {
  const total = input.states.length;
  const conditionId = input.condition ?? 'all';
  const matching = matchWeeks(input.states, conditionId);
  // Only weeks that actually exist can be selected.
  const known = new Set(input.states.map((w) => w.week));
  const selected = Array.from(new Set(input.selected.filter((w) => known.has(w)))).sort((a, b) => a - b);
  const label = getWeekCondition(conditionId).label;
  return {
    selected,
    selected_count: selected.length,
    matching_count: matching.length,
    total_count: total,
    match_label: `${matching.length} of ${total} week${total === 1 ? '' : 's'} match "${label}"`,
    selection_label: `${selected.length} week${selected.length === 1 ? '' : 's'} selected`,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Skeleton validation (P4 §6)
 * ──────────────────────────────────────────────────────────────────────── */

export type SkeletonIssueCode =
  | 'no_platforms_declared'
  | 'frequency_shortfall'
  | 'frequency_surplus'
  | 'content_type_unplaced'
  | 'platform_unplaced'
  | 'week_has_no_slots';

export interface SkeletonIssue {
  code: SkeletonIssueCode;
  message: string;
  week?: number;
  platform?: string;
  content_type?: string;
  expected?: number;
  actual?: number;
}

export interface SkeletonValidation {
  ok: boolean;
  /** Declared slots per week, summed across the matrix. */
  declared_per_week: number;
  issues: SkeletonIssue[];
}

/**
 * Compare the DECLARED skeleton (`platform_content_requests`: platform →
 * content_type → per-week frequency) against the slots actually placed.
 *
 * Reports only; never "fixes" a user's choice. A mismatch is information the
 * CMO must resolve, not something to silently reconcile.
 */
export function validateSkeleton(input: {
  platformContentRequests?: Record<string, Record<string, number>> | null;
  states: CampaignWeekState[];
}): SkeletonValidation {
  const requests = input.platformContentRequests ?? {};
  const issues: SkeletonIssue[] = [];

  let declaredPerWeek = 0;
  const declaredPlatforms = new Set<string>();
  const declaredTypes = new Set<string>();
  for (const [platform, types] of Object.entries(requests)) {
    if (!types || typeof types !== 'object') continue;
    for (const [contentType, freq] of Object.entries(types)) {
      const n = Number(freq);
      if (!Number.isFinite(n) || n <= 0) continue;
      declaredPerWeek += n;
      declaredPlatforms.add(norm(platform));
      declaredTypes.add(norm(contentType));
    }
  }

  if (declaredPlatforms.size === 0) {
    issues.push({
      code: 'no_platforms_declared',
      message: 'No platforms or content types are declared in the skeleton.',
    });
    return { ok: false, declared_per_week: 0, issues };
  }

  const planned = input.states.filter((w) => w.counts.total > 0);

  for (const w of input.states) {
    if (w.counts.total === 0) {
      issues.push({
        code: 'week_has_no_slots',
        message: `Week ${w.week} has no slots, but the skeleton declares ${declaredPerWeek} per week.`,
        week: w.week,
        expected: declaredPerWeek,
        actual: 0,
      });
      continue;
    }
    if (w.counts.total < declaredPerWeek) {
      issues.push({
        code: 'frequency_shortfall',
        message: `Week ${w.week} has ${w.counts.total} slots but the skeleton declares ${declaredPerWeek} per week.`,
        week: w.week, expected: declaredPerWeek, actual: w.counts.total,
      });
    } else if (w.counts.total > declaredPerWeek) {
      issues.push({
        code: 'frequency_surplus',
        message: `Week ${w.week} has ${w.counts.total} slots but the skeleton declares only ${declaredPerWeek} per week.`,
        week: w.week, expected: declaredPerWeek, actual: w.counts.total,
      });
    }
  }

  // A declared platform / content type that no slot anywhere realises — e.g.
  // "video requested but no slot supports video".
  const placedPlatforms = new Set(planned.flatMap((w) => w.platforms));
  const placedTypes = new Set(planned.flatMap((w) => w.content_types));
  for (const p of declaredPlatforms) {
    if (!placedPlatforms.has(p)) {
      issues.push({
        code: 'platform_unplaced',
        message: `"${p}" is declared in the skeleton but no slot is placed for it.`,
        platform: p,
      });
    }
  }
  for (const t of declaredTypes) {
    if (!placedTypes.has(t)) {
      issues.push({
        code: 'content_type_unplaced',
        message: `"${t}" is declared in the skeleton but no slot is placed for it.`,
        content_type: t,
      });
    }
  }

  return { ok: issues.length === 0, declared_per_week: declaredPerWeek, issues };
}

/* ────────────────────────────────────────────────────────────────────────
 * Day allocation view (P4 §4/§20)
 * ──────────────────────────────────────────────────────────────────────── */

export interface DayAllocationEntry {
  day: string;
  platform: string;
  content_type: string;
  count: number;
}

/**
 * The realised Day → Platform → Content-type allocation for one week.
 *
 * This is the answer to "Monday → LinkedIn → text post". The DECLARED skeleton
 * (`platform_content_requests`) has no day axis; day lives on the activity the
 * skeleton produced, and is editable through the existing natural-language
 * skeleton command ("move Monday LinkedIn posts to Wednesday"). This projects
 * what is actually placed — it does not add a second allocation model.
 */
export function deriveDayAllocation(input: {
  plan: ContentPlanLike | null | undefined;
  week?: number | null;
}): DayAllocationEntry[] {
  const items = deriveContentItems(input.plan);
  const wanted = Number(input.week);
  const scoped = Number.isFinite(wanted)
    ? items.filter((i) => Number(i.slot.week) === wanted)
    : items;

  const counts = new Map<string, DayAllocationEntry>();
  for (const item of scoped) {
    const day = item.slot.day ?? 'Unscheduled';
    const platform = norm(item.slot.platform) || 'unknown';
    const contentType = norm(item.slot.content_type) || 'unknown';
    const key = `${day}|${platform}|${contentType}`;
    const entry = counts.get(key) ?? { day, platform, content_type: contentType, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  return Array.from(counts.values()).sort((a, b) => {
    const d = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
    if (d !== 0) return d;
    if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
    return a.content_type < b.content_type ? -1 : 1;
  });
}
