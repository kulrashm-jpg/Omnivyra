/**
 * Strategic Mix P4 — Execution Handoff: materialize confirmed Assignments
 * into the canonical execution payload.
 *
 *   Campaign → Structure → Content → Assignment → Execution Plan →
 *   Scheduled Posts → Publishing
 *
 * The existing pipeline stays the single execution engine: materialization
 * only ENRICHES the calendar-plan activities that planner-finalize already
 * sends (each matched activity gains `creator_asset` + `content_status`,
 * the exact fields the scheduler already consumes as an asset override).
 * No second execution path, no duplicated scheduling, no new scheduler.
 *
 * Only CONFIRMED assignments participate. Draft/ready assignments and
 * unassigned slots pass through untouched — the engine's normal generation
 * handles them (partial campaigns are first-class). Everything here is pure.
 */

import {
  ASSIGNMENT_LIFECYCLE,
  advanceAssignmentStatus,
  deriveStructureSlots,
  type CampaignAssignment,
  type StructureSlot,
} from './campaignAssignments';

/** The asset payload slice an execution row needs — resolved by the caller
 *  from the Asset Library (P2); this module never fetches. */
export interface MaterializableAsset {
  id: string;
  title: string | null;
  url: string | null;
  files?: unknown[] | null;
  creatorType: string | null;
  version: number | null;
}

export type MaterializationIssueCode =
  | 'missing_asset'
  | 'orphaned_structure'
  | 'ownership_mismatch'
  | 'content_type_mismatch'
  | 'duplicate_asset_platform_day'
  | 'secondary_assignment';

export interface MaterializationIssue {
  severity: 'error' | 'warning';
  code: MaterializationIssueCode;
  message: string;
  assignment_id?: string;
  structure_id?: string;
}

/** Same content-type families the assignment intelligence uses. */
const TYPE_FAMILY: Record<string, string> = {
  image: 'image', banner: 'image', photo: 'image', visual: 'image',
  carousel: 'carousel', slider: 'carousel', presentation: 'carousel', deck: 'carousel',
  infographic: 'infographic',
};
const family = (v: string | null | undefined): string | null => {
  const key = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return key ? TYPE_FAMILY[key] ?? key : null;
};

/**
 * Validate confirmed assignments against the execution contract:
 * referenced assets exist, referenced slots exist, campaign ownership,
 * content-type compatibility, scheduling integrity (no duplicate asset on
 * one platform+day). Errors block that assignment's materialization;
 * warnings don't.
 */
export function validateAssignmentsForExecution(params: {
  campaignId: string | null;
  slots: StructureSlot[];
  assignments: CampaignAssignment[];
  assets: Map<string, MaterializableAsset>;
}): MaterializationIssue[] {
  const { campaignId, slots, assignments, assets } = params;
  const issues: MaterializationIssue[] = [];
  const slotById = new Map(slots.map((s) => [s.structure_id, s]));
  const confirmed = assignments.filter((a) => a.status === 'confirmed');

  const placementSeen = new Map<string, string>();
  for (const a of confirmed) {
    if (!assets.has(a.asset_id)) {
      issues.push({
        severity: 'error', code: 'missing_asset', assignment_id: a.id,
        message: `Assignment references asset ${a.asset_id}, which is not in the Asset Library (deleted or inaccessible).`,
      });
    }
    if (!slotById.has(a.structure_id)) {
      issues.push({
        severity: 'error', code: 'orphaned_structure', assignment_id: a.id, structure_id: a.structure_id,
        message: `Assignment references structure slot ${a.structure_id}, which the current plan no longer defines.`,
      });
    }
    if (a.campaign_id && campaignId && a.campaign_id !== campaignId) {
      issues.push({
        severity: 'error', code: 'ownership_mismatch', assignment_id: a.id,
        message: `Assignment belongs to campaign ${a.campaign_id}, not the campaign being finalized.`,
      });
    }
    const asset = assets.get(a.asset_id);
    const assetFamily = family(asset?.creatorType);
    const slotFamily = family(a.content_type);
    if (asset && assetFamily && slotFamily && assetFamily !== slotFamily) {
      issues.push({
        severity: 'error', code: 'content_type_mismatch', assignment_id: a.id,
        message: `A ${assetFamily} asset cannot materialize into a ${slotFamily} slot (week ${a.week ?? '?'}, ${a.platform ?? 'any platform'}).`,
      });
    }
    // Scheduling integrity: one asset must not publish twice on the same
    // platform+day (mirrors the BOLT no-duplicate-content rule).
    const placementKey = `${a.asset_id}|${(a.platform ?? '').toLowerCase()}|w${a.week ?? ''}|${(a.day ?? '').toLowerCase()}`;
    const priorId = placementSeen.get(placementKey);
    if (priorId && priorId !== a.structure_id) {
      issues.push({
        severity: 'error', code: 'duplicate_asset_platform_day', assignment_id: a.id,
        message: `The same asset is confirmed twice for ${a.platform ?? 'a platform'} on week ${a.week ?? '?'} ${a.day ?? ''} — duplicate content on one platform/day.`,
      });
    } else {
      placementSeen.set(placementKey, a.structure_id);
    }
  }
  return issues;
}

// Structural (no index signatures, so planner interfaces like CalendarPlan
// assign directly); the JSON deep copy preserves any extra fields untouched.
interface CalendarActivityLike {
  execution_id?: string;
  week_number?: number;
  day?: string;
  platform?: string;
  content_type?: string;
  creator_asset?: Record<string, unknown> | null;
  content_status?: string;
}

interface CalendarPlanLike {
  days?: Array<{ week_number?: number; day?: string; activities?: CalendarActivityLike[] }>;
  activities?: CalendarActivityLike[];
}

export interface MaterializationResult {
  /** Deep-copied calendar plan with matched activities enriched. */
  calendar_plan: CalendarPlanLike;
  /** Assignments with materialized items advanced to 'materialized'. */
  assignments: CampaignAssignment[];
  materialized_ids: string[];
  issues: MaterializationIssue[];
}

const norm = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function activityMatchesSlot(activity: CalendarActivityLike, slot: StructureSlot, dayCtx?: { week?: number; day?: string }): boolean {
  if (slot.structure_id && activity.execution_id) return activity.execution_id === slot.structure_id;
  const week = Number(activity.week_number ?? dayCtx?.week);
  const day = norm(activity.day ?? dayCtx?.day);
  return (
    (slot.week === null || week === slot.week) &&
    (slot.day === null || day === norm(slot.day)) &&
    norm(activity.platform) === norm(slot.platform ?? '') &&
    norm(activity.content_type) === norm(slot.content_type ?? '')
  );
}

/**
 * Materialize confirmed assignments into the finalize payload.
 *
 * Per slot, the PRIMARY assignment (lowest ordering) materializes — the
 * execution engine consumes one asset override per slot; additional
 * confirmed assignments on the same slot are reported as warnings and stay
 * 'confirmed' (they remain editable planning items). Assignments with
 * validation ERRORS are skipped entirely (partial materialization is the
 * contract — a half-assigned campaign still finalizes).
 */
export function materializeAssignments(params: {
  campaignId: string | null;
  calendarPlan: CalendarPlanLike;
  assignments: CampaignAssignment[];
  assets: Map<string, MaterializableAsset>;
  now?: string;
}): MaterializationResult {
  const { campaignId, calendarPlan, assignments, assets, now } = params;
  const slots = deriveStructureSlots(calendarPlan);
  const issues = validateAssignmentsForExecution({ campaignId, slots, assignments, assets });
  const blockedIds = new Set(issues.filter((i) => i.severity === 'error').map((i) => i.assignment_id));

  // Primary confirmed assignment per slot (lowest ordering wins; ties by id).
  const primaries = new Map<string, CampaignAssignment>();
  for (const a of assignments) {
    if (a.status !== 'confirmed' || blockedIds.has(a.id)) continue;
    const current = primaries.get(a.structure_id);
    if (!current || a.ordering < current.ordering || (a.ordering === current.ordering && a.id < current.id)) {
      if (current) {
        issues.push({
          severity: 'warning', code: 'secondary_assignment', assignment_id: current.id, structure_id: a.structure_id,
          message: 'Slot already carries a primary asset; this assignment stays in planning.',
        });
      }
      primaries.set(a.structure_id, a);
    } else {
      issues.push({
        severity: 'warning', code: 'secondary_assignment', assignment_id: a.id, structure_id: a.structure_id,
        message: 'Slot already carries a primary asset; this assignment stays in planning.',
      });
    }
  }

  const plan: CalendarPlanLike = JSON.parse(JSON.stringify(calendarPlan ?? {}));
  const materializedIds: string[] = [];
  const slotById = new Map(slots.map((s) => [s.structure_id, s]));

  // The days index and the flat activities list are COPIES of the same
  // logical activities (finalize reads flat; the canvas reads days), so each
  // primary enriches once per SECTION. The per-section claim also keeps two
  // identical same-day slots from both receiving the first primary's asset.
  const enrich = (activity: CalendarActivityLike, claimed: Set<string>, dayCtx?: { week?: number; day?: string }): void => {
    for (const [structureId, assignment] of primaries) {
      if (claimed.has(structureId)) continue;
      const slot = slotById.get(structureId);
      if (!slot || !activityMatchesSlot(activity, slot, dayCtx)) continue;
      const asset = assets.get(assignment.asset_id);
      if (!asset) continue;
      claimed.add(structureId);
      activity.creator_asset = {
        asset_id: asset.id,
        asset_version: assignment.asset_version ?? asset.version ?? null,
        creatorType: asset.creatorType ?? undefined,
        title: asset.title ?? undefined,
        url: asset.url ?? undefined,
        ...(Array.isArray(asset.files) && asset.files.length > 0 ? { files: asset.files } : {}),
        assignment_id: assignment.id,
      };
      activity.content_status = 'READY_FOR_PROMOTION';
      if (!materializedIds.includes(assignment.id)) materializedIds.push(assignment.id);
      return; // one primary per activity
    }
  };

  const daysClaimed = new Set<string>();
  for (const dayEntry of Array.isArray(plan.days) ? plan.days : []) {
    for (const activity of Array.isArray(dayEntry?.activities) ? dayEntry.activities : []) {
      enrich(activity, daysClaimed, { week: Number(dayEntry.week_number), day: dayEntry.day });
    }
  }
  const flatClaimed = new Set<string>();
  for (const activity of Array.isArray(plan.activities) ? plan.activities : []) {
    enrich(activity, flatClaimed);
  }

  return {
    calendar_plan: plan,
    assignments: advanceAssignmentStatus(assignments, materializedIds, 'materialized', { now }),
    materialized_ids: materializedIds,
    issues,
  };
}

/** True when a status participates in execution (materialized or beyond). */
export function isExecutionStatus(status: CampaignAssignment['status']): boolean {
  return ASSIGNMENT_LIFECYCLE.indexOf(status) >= ASSIGNMENT_LIFECYCLE.indexOf('materialized');
}
