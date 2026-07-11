/**
 * Strategic Mix P6 — the Master Campaign Board projection.
 *
 *   Campaign → Structure → Content → Assignments → Execution Status
 *                                                 → CAMPAIGN BOARD
 *                                                 → Scheduling/Publishing
 *
 * The board NEVER owns data: everything here is a pure, deterministic
 * projection over the canonical entities (structure slots, Asset Library
 * metadata, assignments with their P5-synchronized execution state). It
 * reuses the assignment intelligence (gaps/conflicts/readiness) rather than
 * re-deriving any rule, so there is exactly one source for every judgement.
 * No state, no fetching, no timers — the UI passes entities in, a
 * projection comes out.
 */

import {
  ASSIGNMENT_LIFECYCLE,
  assignmentsForSlot,
  type AssignmentStatus,
  type CampaignAssignment,
  type StructureSlot,
} from './campaignAssignments';
import {
  assessExecutionReadiness,
  detectAssignmentConflicts,
  detectAssignmentGaps,
  type AssignableAsset,
  type ExecutionReadinessReport,
} from './assignmentIntelligence';

/** Where an issue can be resolved — the board links, it never edits. */
export type BoardIssueTarget = 'alignment' | 'structure' | 'content';

export interface BoardIssue {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
  target: BoardIssueTarget;
  /** The source entity (assignment id / slot id / asset id) when known. */
  ref_id?: string;
}

export interface WeekCoverage {
  week: number;
  slots: number;
  assigned: number;
  in_execution: number;
  published: number;
}

export interface PlatformCoverage {
  platform: string;
  slots: number;
  assigned: number;
}

export interface CampaignHealth {
  /** 'empty' → no structure yet; 'blocked' → blocking issues; 'attention'
   *  → warnings only; 'ready' → confirmed work, nothing in the way. */
  label: 'empty' | 'blocked' | 'attention' | 'ready';
  ready: boolean;
  blocking_count: number;
  warning_count: number;
  coverage_pct: number;
  scheduling_pct: number;
  publishing_pct: number;
  completion_pct: number;
  /** Mean lifecycle progress of items in execution (materialized=0% …
   *  archived=100%); 0 when nothing has been handed off. */
  execution_progress_pct: number;
}

export interface CampaignBoardProjection {
  structure: {
    total_slots: number;
    by_week: WeekCoverage[];
    by_platform: PlatformCoverage[];
  };
  content: {
    assets_available: number;
    assets_referenced: number;
    missing_asset_ids: string[];
  };
  assignments: {
    total: number;
    assigned_slots: number;
    unassigned_slots: number;
    orphaned: string[];
    by_status: Record<AssignmentStatus, number>;
  };
  execution: {
    in_execution: number;
    failures: Array<{ assignment_id: string; message: string | null }>;
    stalled: string[];
  };
  /** R2-P1 — approval summary (planning-owned states; counts only). */
  approvals: {
    enabled: boolean;
    pending: number;
    approved: number;
    rejected: number;
    not_required: number;
    /** Confirmed assignments the approval gate blocks from materializing. */
    blocking: string[];
  };
  issues: BoardIssue[];
  health: CampaignHealth;
  /** The full readiness report (already assist-only) for drill-down. */
  readiness: ExecutionReadinessReport;
}

const pct = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((part / whole) * 100));
const rankOf = (s: AssignmentStatus): number => ASSIGNMENT_LIFECYCLE.indexOf(s);
const MATERIALIZED_RANK = ASSIGNMENT_LIFECYCLE.indexOf('materialized');
const SCHEDULED_RANK = ASSIGNMENT_LIFECYCLE.indexOf('scheduled');
const PUBLISHED_RANK = ASSIGNMENT_LIFECYCLE.indexOf('published');

/** Project the canonical entities into the Master Campaign Board view. */
export function projectCampaignBoard(params: {
  slots: StructureSlot[];
  assignments: CampaignAssignment[];
  assets: AssignableAsset[];
  /** R2-P1 — company approval enablement (default false ⇒ pre-R2 output). */
  requireApproval?: boolean;
}): CampaignBoardProjection {
  const { slots, assignments, assets, requireApproval = false } = params;

  // Single-source judgements (never re-derived here).
  const readiness = assessExecutionReadiness(slots, assignments, assets);
  const gaps = detectAssignmentGaps(slots, assignments);
  const conflicts = detectAssignmentConflicts(slots, assignments, assets);

  // ── Structure coverage ──
  const assignedSlotIds = new Set(assignments.map((a) => a.structure_id));
  const slotExecutionRank = (slot: StructureSlot): number =>
    Math.max(-1, ...assignmentsForSlot(assignments, slot.structure_id).map((a) => rankOf(a.status)));
  const weekMap = new Map<number, WeekCoverage>();
  const platformMap = new Map<string, PlatformCoverage>();
  for (const slot of slots) {
    const week = slot.week ?? 0;
    const w = weekMap.get(week) ?? { week, slots: 0, assigned: 0, in_execution: 0, published: 0 };
    w.slots += 1;
    const rank = slotExecutionRank(slot);
    if (assignedSlotIds.has(slot.structure_id)) w.assigned += 1;
    if (rank >= MATERIALIZED_RANK) w.in_execution += 1;
    if (rank >= PUBLISHED_RANK) w.published += 1;
    weekMap.set(week, w);

    const platform = (slot.platform ?? 'unspecified').toLowerCase();
    const p = platformMap.get(platform) ?? { platform, slots: 0, assigned: 0 };
    p.slots += 1;
    if (assignedSlotIds.has(slot.structure_id)) p.assigned += 1;
    platformMap.set(platform, p);
  }

  // ── Assignment aggregation ──
  const byStatus = Object.fromEntries(ASSIGNMENT_LIFECYCLE.map((s) => [s, 0])) as Record<AssignmentStatus, number>;
  for (const a of assignments) byStatus[a.status] += 1;
  const slotIds = new Set(slots.map((s) => s.structure_id));
  const orphaned = assignments.filter((a) => !slotIds.has(a.structure_id)).map((a) => a.id);

  // ── Content coverage ──
  const availableIds = new Set(assets.map((a) => a.id));
  const referenced = new Set(assignments.map((a) => a.asset_id));
  const missingAssetIds = Array.from(referenced).filter((id) => !availableIds.has(id)).sort();

  // ── Execution aggregation (from the P5-synchronized state) ──
  const inExecution = assignments.filter((a) => rankOf(a.status) >= MATERIALIZED_RANK);
  const failures = assignments
    .filter((a) => a.execution_failure)
    .map((a) => ({ assignment_id: a.id, message: a.execution_failure?.message ?? null }));

  // ── R2-P1 approval aggregation (planning-owned; the board only counts) ──
  const approvalOf = (a: CampaignAssignment) => a.approval ?? 'not_required';
  const approvalBlocking = requireApproval
    ? assignments
        .filter((a) => a.status === 'confirmed' && approvalOf(a) !== 'approved' && approvalOf(a) !== 'not_required')
        .map((a) => a.id)
    : [];
  const approvals = {
    enabled: requireApproval,
    pending: assignments.filter((a) => approvalOf(a) === 'pending').length,
    approved: assignments.filter((a) => approvalOf(a) === 'approved').length,
    rejected: assignments.filter((a) => approvalOf(a) === 'rejected').length,
    not_required: assignments.filter((a) => approvalOf(a) === 'not_required').length,
    blocking: approvalBlocking,
  };

  // ── Issues (each linked to where it is resolved) ──
  const issues: BoardIssue[] = [];
  if (requireApproval) {
    for (const id of approvalBlocking) {
      const a = assignments.find((x) => x.id === id);
      issues.push({
        severity: 'blocking',
        code: a?.approval === 'rejected' ? 'approval_rejected' : 'approval_pending',
        message:
          a?.approval === 'rejected'
            ? 'Assignment was rejected — replace the asset or return it to pending.'
            : 'Assignment awaits approval before it can enter execution.',
        target: 'alignment',
        ref_id: id,
      });
    }
  }
  for (const c of conflicts) {
    issues.push({ severity: 'blocking', code: c.kind, message: c.message, target: 'alignment', ref_id: c.assignment_ids[0] });
  }
  for (const id of readiness.missing_assets) {
    issues.push({ severity: 'blocking', code: 'missing_asset', message: 'A confirmed assignment references an asset that is no longer in the library.', target: 'content', ref_id: id });
  }
  for (const f of failures) {
    issues.push({ severity: 'warning', code: 'publish_failed', message: f.message ? `Publish failed: ${f.message}` : 'Publish failed — the engine retries.', target: 'alignment', ref_id: f.assignment_id });
  }
  for (const g of gaps) {
    issues.push({ severity: 'warning', code: 'missing_assignment', message: g.reason, target: 'alignment', ref_id: g.slot.structure_id });
  }
  for (const id of orphaned) {
    issues.push({ severity: 'warning', code: 'orphaned_assignment', message: 'Assignment references a slot the structure no longer defines.', target: 'structure', ref_id: id });
  }
  for (const id of readiness.stalled_execution) {
    issues.push({ severity: 'warning', code: 'stalled_execution', message: 'Materialized but not yet scheduled while other items progressed.', target: 'alignment', ref_id: id });
  }
  for (const m of readiness.schedule_imbalance) {
    issues.push({ severity: 'warning', code: 'schedule_imbalance', message: m, target: 'structure' });
  }

  // ── Campaign Health (deterministic, canonical-entities-only) ──
  const blocking = issues.filter((i) => i.severity === 'blocking');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const scheduledPlus = assignments.filter((a) => rankOf(a.status) >= SCHEDULED_RANK).length;
  const publishedPlus = assignments.filter((a) => rankOf(a.status) >= PUBLISHED_RANK).length;
  const executionProgress =
    inExecution.length === 0
      ? 0
      : Math.round(
          (inExecution.reduce((sum, a) => sum + (rankOf(a.status) - MATERIALIZED_RANK), 0) /
            (inExecution.length * (ASSIGNMENT_LIFECYCLE.length - 1 - MATERIALIZED_RANK))) * 100,
        );
  const health: CampaignHealth = {
    label:
      slots.length === 0 ? 'empty'
      : blocking.length > 0 ? 'blocked'
      : warnings.length > 0 ? 'attention'
      : 'ready',
    ready: slots.length > 0 && blocking.length === 0,
    blocking_count: blocking.length,
    warning_count: warnings.length,
    coverage_pct: pct(slots.filter((s) => assignedSlotIds.has(s.structure_id)).length, slots.length),
    scheduling_pct: pct(scheduledPlus, slots.length),
    publishing_pct: pct(publishedPlus, slots.length),
    completion_pct: pct(byStatus.archived, slots.length),
    execution_progress_pct: executionProgress,
  };

  return {
    structure: {
      total_slots: slots.length,
      by_week: Array.from(weekMap.values()).sort((a, b) => a.week - b.week),
      by_platform: Array.from(platformMap.values()).sort((a, b) => a.platform.localeCompare(b.platform)),
    },
    content: {
      assets_available: assets.length,
      assets_referenced: referenced.size,
      missing_asset_ids: missingAssetIds,
    },
    assignments: {
      total: assignments.length,
      assigned_slots: slots.filter((s) => assignedSlotIds.has(s.structure_id)).length,
      unassigned_slots: gaps.length,
      orphaned,
      by_status: byStatus,
    },
    execution: {
      in_execution: inExecution.length,
      failures,
      stalled: readiness.stalled_execution,
    },
    approvals,
    issues,
    health,
    readiness,
  };
}

/* ── AI (assist-only): a deterministic narrative over the projection.
 *    Summaries only — nothing here can modify campaign state. ── */

export function summarizeCampaignBoard(p: CampaignBoardProjection): string[] {
  const out: string[] = [];
  const h = p.health;

  if (h.label === 'empty') {
    return ['No structure yet — build the campaign skeleton to open publishing slots.'];
  }
  out.push(
    h.label === 'blocked'
      ? `${h.blocking_count} blocking issue${h.blocking_count === 1 ? '' : 's'} stand between this campaign and a clean handoff.`
      : h.label === 'attention'
        ? `Campaign is workable with ${h.warning_count} warning${h.warning_count === 1 ? '' : 's'} to review.`
        : 'Campaign is healthy — no blocking issues or warnings.',
  );
  out.push(`${h.coverage_pct}% of slots carry content; ${h.scheduling_pct}% scheduled; ${h.publishing_pct}% published.`);

  // Weak coverage: the emptiest weeks and platforms (deterministic order).
  const weakWeeks = p.structure.by_week.filter((w) => w.slots > 0 && w.assigned === 0).map((w) => `week ${w.week}`);
  if (weakWeeks.length > 0 && p.assignments.assigned_slots > 0) {
    out.push(`Coverage is weakest in ${weakWeeks.join(', ')} — no content assigned there yet.`);
  }
  const weakPlatforms = p.structure.by_platform.filter((pl) => pl.slots > 0 && pl.assigned === 0).map((pl) => pl.platform);
  if (weakPlatforms.length > 0 && p.assignments.assigned_slots > 0) {
    out.push(`Platform imbalance: ${weakPlatforms.join(', ')} ${weakPlatforms.length === 1 ? 'has' : 'have'} slots but no assigned content.`);
  }
  if (p.execution.failures.length > 0) {
    out.push(`${p.execution.failures.length} publish failure${p.execution.failures.length === 1 ? '' : 's'} need attention (lifecycle preserved; the engine retries).`);
  }
  // R2-P1 — approval progress (summary only; approving stays a human act).
  if (p.approvals.enabled) {
    const reviewed = p.approvals.approved + p.approvals.rejected;
    const total = reviewed + p.approvals.pending;
    out.push(
      p.approvals.blocking.length > 0
        ? `Approvals gate the handoff: ${p.approvals.pending} pending, ${p.approvals.rejected} rejected (${p.approvals.approved} approved of ${total} reviewed-or-waiting).`
        : `Approvals are clear — ${p.approvals.approved} approved, nothing blocking the handoff.`,
    );
  }
  if (p.execution.stalled.length > 0) {
    out.push(`${p.execution.stalled.length} materialized item${p.execution.stalled.length === 1 ? ' is' : 's are'} not yet scheduled while others progressed.`);
  }
  // Optimization opportunity: reusable library headroom.
  if (p.assignments.unassigned_slots > 0 && p.content.assets_available > p.content.assets_referenced) {
    out.push(
      `${p.assignments.unassigned_slots} open slot${p.assignments.unassigned_slots === 1 ? '' : 's'} and ${p.content.assets_available - p.content.assets_referenced} unused library asset${p.content.assets_available - p.content.assets_referenced === 1 ? '' : 's'} — the Alignment suggestions can close the gap.`,
    );
  }
  return out;
}
