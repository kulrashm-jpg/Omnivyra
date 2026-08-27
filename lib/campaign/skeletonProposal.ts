/**
 * P4.1 — AI skeleton PROPOSAL and deterministic skeleton IMPACT (ALL PURE).
 *
 * ── Why there is no second skeleton ────────────────────────────────────────
 * `/api/campaigns/ai/plan` already returns `{ plan: { weeks } }` as an
 * EPHEMERAL HTTP response. Today the panel converts it and calls
 * setCalendarPlan immediately, so the proposal becomes canonical the instant
 * it arrives — there is no review step, not because the architecture lacks
 * one, but because nothing pauses between fetch and commit.
 *
 * P4.1 inserts that pause. The proposal lives in the component's own state
 * between the response and the existing `weeksToCalendarPlan → setCalendarPlan`
 * write. Nothing new is persisted:
 *
 *     ephemeral response → UI proposal → CMO decision → EXISTING write path
 *
 * There is therefore NO draft_skeleton, proposed_skeleton, ai_skeleton or
 * skeleton_versions. Canonical planner_state is the single source of truth and
 * changes only on accept.
 *
 * ── Why impact is derived, not stored ─────────────────────────────────────
 * A persisted "invalidated" flag is a second truth that drifts the moment a
 * slot changes. `deriveSkeletonImpact` recomputes the comparison between the
 * committed plan and a candidate plan every time it is asked, from facts that
 * already exist (slots, text lifecycle, assignments, execution fields).
 *
 * Nothing here mutates, schedules, deletes or reassigns anything.
 */

import { deriveContentItems, type ContentPlanLike } from './campaignContentModel';
import type { CampaignAssignment } from './campaignAssignments';
import {
  validateSkeleton,
  deriveCampaignWeekStates,
  type SkeletonValidation,
} from './campaignWeekState';

/* ────────────────────────────────────────────────────────────────────────
 * 1. The proposal envelope
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Only fields the CANONICAL skeleton already understands. No new structural
 * vocabulary — every key here exists on planner_state today.
 */
export interface SkeletonProposal {
  duration_weeks: number | null;
  start_date: string | null;
  platforms: string[];
  /** platform → content_type → per-week frequency (the existing matrix). */
  platform_content_requests: Record<string, Record<string, number>>;
  campaign_type: string | null;
  /** The raw `plan.weeks` the AI returned — converted on accept, not before. */
  weeks: unknown[];
  /** Slot count implied by the proposed weeks. */
  slot_count: number;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** Activities inside one proposed week, across the shapes ai/plan emits. */
function weekActivities(week: unknown): Array<Record<string, unknown>> {
  if (!week || typeof week !== 'object') return [];
  const w = week as Record<string, unknown>;
  for (const key of ['daily_execution_items', 'activities', 'items', 'days']) {
    const value = w[key];
    if (!Array.isArray(value)) continue;
    if (key !== 'days') return value as Array<Record<string, unknown>>;
    return value.flatMap((d) => {
      const day = d as Record<string, unknown>;
      const acts = Array.isArray(day.activities) ? day.activities : [];
      return (acts as Array<Record<string, unknown>>).map((a) => ({ day: day.day, ...a }));
    });
  }
  return [];
}

/**
 * Read an AI plan response into a proposal envelope.
 *
 * Derives the matrix from what the plan actually contains rather than trusting
 * a separate declaration, so the proposal's frequency and its slots agree by
 * construction — any disagreement afterwards is a real edit, not a parse bug.
 */
export function readSkeletonProposal(input: {
  weeks: unknown[] | null | undefined;
  startDate?: string | null;
  campaignType?: string | null;
}): SkeletonProposal {
  const weeks = Array.isArray(input.weeks) ? input.weeks : [];
  const perWeekCounts = new Map<string, Map<string, number>>();
  const platforms = new Set<string>();
  let slotCount = 0;

  for (const week of weeks) {
    for (const activity of weekActivities(week)) {
      const platform = norm(activity.platform);
      const contentType = norm(activity.content_type) || 'post';
      if (!platform) continue;
      slotCount += 1;
      platforms.add(platform);
      const types = perWeekCounts.get(platform) ?? new Map<string, number>();
      types.set(contentType, (types.get(contentType) ?? 0) + 1);
      perWeekCounts.set(platform, types);
    }
  }

  // The matrix is PER WEEK; the counts above span the whole plan.
  const weekCount = Math.max(1, weeks.length);
  const matrix: Record<string, Record<string, number>> = {};
  for (const [platform, types] of perWeekCounts) {
    const inner: Record<string, number> = {};
    for (const [type, total] of types) {
      const perWeek = Math.round(total / weekCount);
      if (perWeek > 0) inner[type] = perWeek;
    }
    if (Object.keys(inner).length > 0) matrix[platform] = inner;
  }

  return {
    duration_weeks: weeks.length > 0 ? weeks.length : null,
    start_date: str(input.startDate),
    platforms: Array.from(platforms).sort(),
    platform_content_requests: matrix,
    campaign_type: str(input.campaignType),
    weeks,
    slot_count: slotCount,
  };
}

/** A CMO edit applied BEFORE acceptance. Never persisted on its own. */
export interface SkeletonProposalEdit {
  duration_weeks?: number | null;
  start_date?: string | null;
  /** Platforms to drop from the proposal (lowercased). */
  remove_platforms?: string[];
  /** Replace the matrix wholesale (e.g. the CMO reworked it in the grid). */
  platform_content_requests?: Record<string, Record<string, number>>;
  campaign_type?: string | null;
}

/**
 * Apply an edit to a proposal, returning a NEW proposal.
 *
 * Removing a platform prunes it from BOTH the matrix and the proposed weeks,
 * so the accepted structure is what the CMO edited — not the original AI
 * output with a cosmetic override on top.
 */
export function applyProposalEdit(
  proposal: SkeletonProposal,
  edit: SkeletonProposalEdit,
): SkeletonProposal {
  const removed = new Set((edit.remove_platforms ?? []).map(norm).filter(Boolean));

  let weeks = proposal.weeks;
  if (removed.size > 0) {
    weeks = proposal.weeks.map((week) => {
      if (!week || typeof week !== 'object') return week;
      const w = { ...(week as Record<string, unknown>) };
      for (const key of ['daily_execution_items', 'activities', 'items']) {
        if (Array.isArray(w[key])) {
          w[key] = (w[key] as Array<Record<string, unknown>>)
            .filter((a) => !removed.has(norm(a.platform)));
        }
      }
      if (Array.isArray(w.days)) {
        w.days = (w.days as Array<Record<string, unknown>>).map((d) => ({
          ...d,
          activities: Array.isArray(d.activities)
            ? (d.activities as Array<Record<string, unknown>>).filter((a) => !removed.has(norm(a.platform)))
            : d.activities,
        }));
      }
      return w;
    });
  }

  const duration = edit.duration_weeks === undefined ? proposal.duration_weeks : num(edit.duration_weeks);
  // Shrinking the campaign truncates the proposed weeks; growing leaves the
  // extra weeks unplanned, which validation then reports as week_has_no_slots.
  if (duration !== null && duration > 0 && duration < weeks.length) {
    weeks = weeks.slice(0, duration);
  }

  const rebuilt = readSkeletonProposal({
    weeks,
    startDate: edit.start_date === undefined ? proposal.start_date : edit.start_date,
    campaignType: edit.campaign_type === undefined ? proposal.campaign_type : edit.campaign_type,
  });

  return {
    ...rebuilt,
    duration_weeks: duration ?? rebuilt.duration_weeks,
    // An explicit matrix from the CMO wins over the derived one.
    platform_content_requests: edit.platform_content_requests ?? rebuilt.platform_content_requests,
    platforms: edit.platform_content_requests
      ? Object.keys(edit.platform_content_requests).map(norm).sort()
      : rebuilt.platforms,
  };
}

/**
 * Validate a proposal with the SAME deterministic validator P4 applies to the
 * committed skeleton. The AI's output is never silently repaired — the CMO
 * sees exactly what was proposed and what is inconsistent.
 */
export function validateProposal(proposal: SkeletonProposal): SkeletonValidation {
  const states = deriveCampaignWeekStates({
    plan: proposalToPlanLike(proposal),
    assignments: [],
    durationWeeks: proposal.duration_weeks,
  });
  return validateSkeleton({
    platformContentRequests: proposal.platform_content_requests,
    states,
  });
}

/** Project a proposal into the plan shape the derivations already understand. */
export function proposalToPlanLike(proposal: SkeletonProposal): ContentPlanLike {
  const activities: Array<Record<string, unknown>> = [];
  proposal.weeks.forEach((week, index) => {
    const weekNumber = num((week as Record<string, unknown>)?.week)
      ?? num((week as Record<string, unknown>)?.week_number)
      ?? index + 1;
    weekActivities(week).forEach((activity, i) => {
      activities.push({
        execution_id: str(activity.execution_id) ?? `proposed-w${weekNumber}-${i}`,
        week_number: weekNumber,
        day: str(activity.day),
        platform: str(activity.platform),
        content_type: str(activity.content_type) ?? 'post',
        title: str(activity.title),
      });
    });
  });
  return { activities } as ContentPlanLike;
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. Skeleton impact (derived, never stored)
 * ──────────────────────────────────────────────────────────────────────── */

/** Only categories the current architecture can actually evidence. */
export type SkeletonImpactCategory =
  | 'unaffected'
  | 'missing'
  | 'contradictory'
  | 'orphaned'
  | 'release_conflict';

export interface SkeletonSlotImpact {
  structure_id: string;
  week: number | null;
  day: string | null;
  platform: string | null;
  content_type: string | null;
  category: SkeletonImpactCategory;
  reason: string;
  /** Facts that make this actionable — never a recommendation to delete. */
  has_content: boolean;
  content_status: string | null;
  assignment_count: number;
  released: boolean;
}

export interface SkeletonWeekImpact {
  week: number;
  category: SkeletonImpactCategory;
  slots: SkeletonSlotImpact[];
  counts: Record<SkeletonImpactCategory, number>;
}

export interface SkeletonImpact {
  /** True when nothing downstream is disturbed. */
  clean: boolean;
  affected_weeks: number[];
  weeks: SkeletonWeekImpact[];
  slots: SkeletonSlotImpact[];
  counts: Record<SkeletonImpactCategory, number>;
  /** Slots the proposal requires that do not exist yet. */
  missing_count: number;
  /** Already-released slots the change would contradict. */
  release_conflict_count: number;
  /** Honest headline for the UI. */
  summary: string;
}

const EMPTY_COUNTS = (): Record<SkeletonImpactCategory, number> => ({
  unaffected: 0, missing: 0, contradictory: 0, orphaned: 0, release_conflict: 0,
});

/** Structural identity: a slot is "the same placement" at this coordinate. */
const placementKey = (week: unknown, day: unknown, platform: unknown, contentType: unknown) =>
  `${num(week) ?? 0}|${norm(day)}|${norm(platform)}|${norm(contentType)}`;

/**
 * Compare the COMMITTED plan against a CANDIDATE plan and report what the
 * change would disturb.
 *
 * Read-only and non-destructive: it recommends nothing, deletes nothing, and
 * never proposes unscheduling. Released slots are reported as conflicts so the
 * CMO decides, per §16/§28.
 */
export function deriveSkeletonImpact(input: {
  current: ContentPlanLike | null | undefined;
  candidate: ContentPlanLike | null | undefined;
  assignments?: CampaignAssignment[] | null;
}): SkeletonImpact {
  const currentItems = deriveContentItems(input.current);
  const candidateItems = deriveContentItems(input.candidate);
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];

  const assignmentsBySlot = new Map<string, CampaignAssignment[]>();
  for (const a of assignments) {
    if (!a?.structure_id) continue;
    const list = assignmentsBySlot.get(a.structure_id) ?? [];
    list.push(a);
    assignmentsBySlot.set(a.structure_id, list);
  }

  const candidatePlacements = new Set(
    candidateItems.map((i) => placementKey(i.slot.week, i.slot.day, i.slot.platform, i.slot.content_type)),
  );
  const candidateWeeks = new Set(
    candidateItems.map((i) => Number(i.slot.week)).filter((n) => Number.isFinite(n)),
  );
  const currentPlacements = new Set(
    currentItems.map((i) => placementKey(i.slot.week, i.slot.day, i.slot.platform, i.slot.content_type)),
  );

  const slots: SkeletonSlotImpact[] = [];

  // Existing slots judged against the candidate.
  for (const item of currentItems) {
    const slotAssignments = assignmentsBySlot.get(item.slot.structure_id) ?? [];
    const released = slotAssignments.some(
      (a) => typeof a.scheduled_post_id === 'string' && a.scheduled_post_id.trim().length > 0,
    );
    const week = Number(item.slot.week);
    const key = placementKey(item.slot.week, item.slot.day, item.slot.platform, item.slot.content_type);

    let category: SkeletonImpactCategory;
    let reason: string;
    if (candidatePlacements.has(key)) {
      category = 'unaffected';
      reason = 'This placement is unchanged.';
    } else if (Number.isFinite(week) && !candidateWeeks.has(week)) {
      category = 'orphaned';
      reason = `Week ${week} no longer exists in the proposed structure.`;
    } else {
      category = 'contradictory';
      reason = 'This slot no longer matches the proposed structure for its week.';
    }

    // A released slot outranks everything except being genuinely unchanged —
    // the CMO must be told before anything touches it.
    if (released && category !== 'unaffected') {
      category = 'release_conflict';
      reason = 'This slot has already been scheduled; the change conflicts with it.';
    }

    slots.push({
      structure_id: item.slot.structure_id,
      week: Number.isFinite(week) ? week : null,
      day: item.slot.day,
      platform: item.slot.platform,
      content_type: item.slot.content_type,
      category,
      reason,
      has_content: item.has_content,
      content_status: item.has_content ? item.status : null,
      assignment_count: slotAssignments.length,
      released,
    });
  }

  // Placements the candidate requires that do not exist yet.
  for (const item of candidateItems) {
    const key = placementKey(item.slot.week, item.slot.day, item.slot.platform, item.slot.content_type);
    if (currentPlacements.has(key)) continue;
    const week = Number(item.slot.week);
    slots.push({
      structure_id: item.slot.structure_id,
      week: Number.isFinite(week) ? week : null,
      day: item.slot.day,
      platform: item.slot.platform,
      content_type: item.slot.content_type,
      category: 'missing',
      reason: 'The proposed structure needs this placement, which does not exist yet.',
      has_content: false,
      content_status: null,
      assignment_count: 0,
      released: false,
    });
  }

  const counts = EMPTY_COUNTS();
  const weekMap = new Map<number, SkeletonWeekImpact>();
  for (const slot of slots) {
    counts[slot.category] += 1;
    if (slot.week === null) continue;
    const w = weekMap.get(slot.week) ?? { week: slot.week, category: 'unaffected', slots: [], counts: EMPTY_COUNTS() };
    w.slots.push(slot);
    w.counts[slot.category] += 1;
    weekMap.set(slot.week, w);
  }

  // A week takes its most serious slot category.
  const SEVERITY: SkeletonImpactCategory[] = ['release_conflict', 'orphaned', 'contradictory', 'missing', 'unaffected'];
  for (const w of weekMap.values()) {
    w.category = SEVERITY.find((c) => w.counts[c] > 0) ?? 'unaffected';
  }

  const weeks = Array.from(weekMap.values()).sort((a, b) => a.week - b.week);
  const affected = weeks.filter((w) => w.category !== 'unaffected').map((w) => w.week);
  const disturbed = counts.missing + counts.contradictory + counts.orphaned + counts.release_conflict;

  const parts: string[] = [];
  if (counts.contradictory > 0) parts.push(`${counts.contradictory} slot(s) no longer match`);
  if (counts.orphaned > 0) parts.push(`${counts.orphaned} slot(s) in removed weeks`);
  if (counts.missing > 0) parts.push(`${counts.missing} new slot(s) needed`);
  if (counts.release_conflict > 0) parts.push(`${counts.release_conflict} already scheduled — needs review`);

  return {
    clean: disturbed === 0,
    affected_weeks: affected,
    weeks,
    slots,
    counts,
    missing_count: counts.missing,
    release_conflict_count: counts.release_conflict,
    summary: disturbed === 0
      ? 'No downstream changes — the structure is unchanged.'
      : `${affected.length} week(s) affected: ${parts.join(', ')}.`,
  };
}

/**
 * Slots that carry work a reconciliation must NOT silently destroy.
 *
 * Approved content, assigned assets and released slots are reported so the UI
 * can require an explicit decision. This function recommends no action — it
 * only names what is at stake.
 */
export function describeAtRiskWork(impact: SkeletonImpact): {
  approved_content: SkeletonSlotImpact[];
  with_assignments: SkeletonSlotImpact[];
  released: SkeletonSlotImpact[];
  safe_to_regenerate: SkeletonSlotImpact[];
} {
  const disturbed = impact.slots.filter((s) => s.category !== 'unaffected' && s.category !== 'missing');
  return {
    approved_content: disturbed.filter((s) => s.content_status === 'approved'),
    with_assignments: disturbed.filter((s) => s.assignment_count > 0),
    released: disturbed.filter((s) => s.released),
    // Only draft, unassigned, unreleased slots are safe to rebuild without
    // destroying reviewed work.
    safe_to_regenerate: disturbed.filter(
      (s) => !s.released && s.assignment_count === 0 && (s.content_status === null || s.content_status === 'draft'),
    ),
  };
}
