/**
 * Strategic Mix P4 — Execution Handoff contract.
 *
 *  - lifecycle: draft→…→archived, forward-only via advanceAssignmentStatus
 *  - per-item locks: protected execution states are immutable; unaffected
 *    assignments stay fully editable (deterministic, status-based scope)
 *  - validation: assets, slots, ownership, type compatibility, scheduling
 *    integrity (no duplicate asset per platform+day)
 *  - materialization: confirmed assignments enrich the EXISTING finalize
 *    payload (creator_asset + content_status on matched activities) — one
 *    primary per slot, partial campaigns fine, inputs never mutated
 */

import {
  assignAsset,
  bulkAssign,
  advanceAssignmentStatus,
  unassignAssignment,
  bulkUnassign,
  moveAssignment,
  duplicateAssignment,
  replaceAssignmentAsset,
  reorderAssignments,
  updateAssignmentMetadata,
  isAssignmentLocked,
  deriveStructureSlots,
  ASSIGNMENT_LIFECYCLE,
  type CampaignAssignment,
} from '../../../lib/campaign/campaignAssignments';
import {
  materializeAssignments,
  validateAssignmentsForExecution,
  isExecutionStatus,
  type MaterializableAsset,
} from '../../../lib/campaign/assignmentMaterialization';
import { assessExecutionReadiness } from '../../../lib/campaign/assignmentIntelligence';

const freshCtx = () => { let i = 0; return { now: '2026-07-11T10:00:00.000Z', mintId: () => `asg-${++i}` }; };

const calendarPlan = {
  days: [
    {
      week_number: 1,
      day: 'Monday',
      activities: [
        { execution_id: 'ex-1', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'carousel', title: 'Kickoff deck' },
        { execution_id: 'ex-2', week_number: 1, day: 'Monday', platform: 'x', content_type: 'image', title: 'Teaser' },
      ],
    },
    { week_number: 2, day: 'Wednesday', activities: [{ execution_id: 'ex-3', week_number: 2, day: 'Wednesday', platform: 'linkedin', content_type: 'infographic', title: 'Stats' }] },
  ],
  activities: [
    { execution_id: 'ex-1', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'carousel', title: 'Kickoff deck' },
    { execution_id: 'ex-2', week_number: 1, day: 'Monday', platform: 'x', content_type: 'image', title: 'Teaser' },
    { execution_id: 'ex-3', week_number: 2, day: 'Wednesday', platform: 'linkedin', content_type: 'infographic', title: 'Stats' },
  ],
};
const slots = deriveStructureSlots(calendarPlan);

const ASSETS = new Map<string, MaterializableAsset>([
  ['car-1', { id: 'car-1', title: 'Framework deck', url: 'https://cdn/car1.png', files: [{ url: 'https://cdn/car1-1.png' }], creatorType: 'carousel', version: 2 }],
  ['img-1', { id: 'img-1', title: 'Hero shot', url: 'https://cdn/img1.png', creatorType: 'image', version: 1 }],
  ['inf-1', { id: 'inf-1', title: 'Q4 stats', url: 'https://cdn/inf1.png', creatorType: 'infographic', version: 1 }],
  ['car-2', { id: 'car-2', title: 'Backup deck', url: 'https://cdn/car2.png', creatorType: 'carousel', version: 1 }],
]);

function confirmedAssignments(): CampaignAssignment[] {
  const ctx = freshCtx();
  let list = bulkAssign([], [
    { campaignId: 'camp-1', assetId: 'car-1', slot: slots[0], status: 'confirmed' },
    { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' },
  ], ctx);
  return list;
}

describe('P4 lifecycle — forward-only advancement', () => {
  it('advances along the lifecycle and refuses backward/unknown transitions', () => {
    const ctx = freshCtx();
    let list = assignAsset([], { campaignId: 'c', assetId: 'car-1', slot: slots[0] }, ctx).assignments;
    const id = list[0].id;
    list = advanceAssignmentStatus(list, id, 'confirmed');
    expect(list[0].status).toBe('confirmed');
    list = advanceAssignmentStatus(list, id, 'materialized');
    list = advanceAssignmentStatus(list, id, 'scheduled');
    list = advanceAssignmentStatus(list, id, 'published');
    expect(list[0].status).toBe('published');
    expect(advanceAssignmentStatus(list, id, 'draft')[0].status).toBe('published'); // backward = no-op
    expect(advanceAssignmentStatus(list, id, 'bogus' as never)[0].status).toBe('published');
    expect(ASSIGNMENT_LIFECYCLE).toHaveLength(8);
  });

  it('bulk-advances only the requested ids', () => {
    const list = confirmedAssignments();
    const advanced = advanceAssignmentStatus(list, [list[0].id], 'materialized');
    expect(advanced[0].status).toBe('materialized');
    expect(advanced[1].status).toBe('confirmed');
  });
});

describe('P4 per-item locks — deterministic, status-scoped', () => {
  const locked = (): CampaignAssignment[] => {
    const list = confirmedAssignments();
    return advanceAssignmentStatus(list, [list[0].id], 'materialized');
  };

  it('locked items resist unassign/move/replace/metadata; unaffected items stay editable', () => {
    const list = locked();
    const [lockedA, freeA] = list;
    expect(isAssignmentLocked(lockedA)).toBe(true);
    expect(isAssignmentLocked(freeA)).toBe(false);

    expect(unassignAssignment(list, lockedA.id)).toHaveLength(2); // kept
    expect(unassignAssignment(list, freeA.id)).toHaveLength(1); // editable item detaches
    expect(bulkUnassign(list, [lockedA.id, freeA.id]).map((a) => a.id)).toEqual([lockedA.id]);

    const moved = moveAssignment(list, lockedA.id, slots[2]);
    expect(moved.find((a) => a.id === lockedA.id)!.structure_id).toBe(lockedA.structure_id);

    const replaced = replaceAssignmentAsset(list, lockedA.id, 'img-1');
    expect(replaced.find((a) => a.id === lockedA.id)!.asset_id).toBe('car-1');

    const patched = updateAssignmentMetadata(list, lockedA.id, { notes: 'nope', status: 'draft' });
    expect(patched.find((a) => a.id === lockedA.id)).toMatchObject({ notes: '', status: 'materialized' });
  });

  it('a slot containing a locked item does not reorder; duplicates never inherit execution states', () => {
    const ctx = freshCtx();
    let list = locked();
    // add a second assignment on the locked slot
    list = assignAsset(list, { campaignId: 'camp-1', assetId: 'inf-1', slot: slots[0] }, ctx).assignments;
    const slotId = slots[0].structure_id;
    const before = list.map((a) => a.ordering);
    const reordered = reorderAssignments(list, slotId, [list[2].id, list[0].id]);
    expect(reordered.map((a) => a.ordering)).toEqual(before); // no-op

    const { assignment: copy } = duplicateAssignment(list, list[0].id, slots[2], ctx);
    expect(copy!.status).toBe('draft'); // materialized source → fresh planning copy
    expect(copy!.asset_id).toBe('car-1');
  });

  it('users cannot reach execution states via metadata; only advanceAssignmentStatus can', () => {
    const list = confirmedAssignments();
    const viaMetadata = updateAssignmentMetadata(list, list[0].id, { status: 'materialized' as never });
    expect(viaMetadata[0].status).toBe('confirmed');
  });
});

describe('P4 validation — the execution contract', () => {
  it('flags missing assets, orphaned slots, foreign campaigns, type mismatches, and dup placement', () => {
    const ctx = freshCtx();
    let list = bulkAssign([], [
      { campaignId: 'camp-1', assetId: 'ghost', slot: slots[0], status: 'confirmed' },       // missing asset
      { campaignId: 'camp-OTHER', assetId: 'img-1', slot: slots[1], status: 'confirmed' },   // foreign campaign
      { campaignId: 'camp-1', assetId: 'car-1', slot: slots[2], status: 'confirmed' },       // carousel → infographic slot
    ], ctx);
    list = [...list, { ...list[2], id: 'asg-orphan', structure_id: 'gone', status: 'confirmed' }];
    // duplicate placement: img-1 twice on x/Monday
    list = assignAsset(list, { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' }, ctx).assignments;
    // make the second img-1 land on a DIFFERENT slot id but same platform/day
    list = list.map((a, i) => (i === list.length - 1 ? { ...a, structure_id: 'ex-2b' } : a));

    const codes = validateAssignmentsForExecution({ campaignId: 'camp-1', slots, assignments: list, assets: ASSETS })
      .map((i) => i.code).sort();
    expect(codes).toEqual(expect.arrayContaining([
      'missing_asset', 'ownership_mismatch', 'content_type_mismatch', 'orphaned_structure', 'duplicate_asset_platform_day',
    ]));
  });

  it('draft/ready assignments are NOT part of the execution contract', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [{ campaignId: 'camp-1', assetId: 'ghost', slot: slots[0] }], ctx); // draft
    expect(validateAssignmentsForExecution({ campaignId: 'camp-1', slots, assignments: list, assets: ASSETS })).toEqual([]);
  });
});

describe('P4 materialization — assignments enrich the EXISTING finalize payload', () => {
  it('enriches matched activities (days AND flat) with creator_asset + READY_FOR_PROMOTION and advances statuses', () => {
    const list = confirmedAssignments();
    const result = materializeAssignments({ campaignId: 'camp-1', calendarPlan, assignments: list, assets: ASSETS });

    expect(result.materialized_ids).toHaveLength(2);
    // Flat copy (what planner-finalize reads for rows)
    const flat1 = result.calendar_plan.activities!.find((a) => a.execution_id === 'ex-1')!;
    expect(flat1.creator_asset).toMatchObject({ asset_id: 'car-1', asset_version: 2, creatorType: 'carousel', title: 'Framework deck', url: 'https://cdn/car1.png' });
    expect(flat1.content_status).toBe('READY_FOR_PROMOTION');
    // Days copy (what the planning canvas renders)
    const day1 = result.calendar_plan.days![0].activities!.find((a) => a.execution_id === 'ex-1')!;
    expect(day1.creator_asset).toMatchObject({ asset_id: 'car-1' });
    // Unassigned slot untouched (partial campaign)
    const flat3 = result.calendar_plan.activities!.find((a) => a.execution_id === 'ex-3')!;
    expect(flat3.creator_asset).toBeUndefined();

    // Lifecycle advanced; locked from here on
    expect(result.assignments.every((a) => a.status === 'materialized')).toBe(true);
    expect(result.assignments.every((a) => isAssignmentLocked(a))).toBe(true);
    expect(isExecutionStatus('materialized')).toBe(true);
    expect(isExecutionStatus('confirmed')).toBe(false);

    // Purity: the input plan and input assignments are untouched
    expect((calendarPlan.activities[0] as { creator_asset?: unknown }).creator_asset).toBeUndefined();
    expect(list.every((a) => a.status === 'confirmed')).toBe(true);
  });

  it('one PRIMARY per slot (lowest ordering); secondary confirmed assignments stay in planning', () => {
    const ctx = freshCtx();
    let list = bulkAssign([], [
      { campaignId: 'camp-1', assetId: 'car-1', slot: slots[0], status: 'confirmed' },
      { campaignId: 'camp-1', assetId: 'car-2', slot: slots[0], status: 'confirmed' }, // ordering 1 — secondary
    ], ctx);
    const result = materializeAssignments({ campaignId: 'camp-1', calendarPlan, assignments: list, assets: ASSETS });
    expect(result.materialized_ids).toEqual([list[0].id]);
    expect(result.assignments.find((a) => a.id === list[1].id)!.status).toBe('confirmed');
    expect(result.issues.some((i) => i.code === 'secondary_assignment' && i.assignment_id === list[1].id)).toBe(true);
    const flat1 = result.calendar_plan.activities!.find((a) => a.execution_id === 'ex-1')!;
    expect((flat1.creator_asset as { asset_id: string }).asset_id).toBe('car-1');
  });

  it('skips assignments with blocking issues but materializes the rest (partial handoff)', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'camp-1', assetId: 'ghost', slot: slots[0], status: 'confirmed' }, // missing asset → skipped
      { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' },
    ], ctx);
    const result = materializeAssignments({ campaignId: 'camp-1', calendarPlan, assignments: list, assets: ASSETS });
    expect(result.materialized_ids).toEqual([list[1].id]);
    expect(result.assignments.find((a) => a.id === list[0].id)!.status).toBe('confirmed'); // stays editable
    expect(result.calendar_plan.activities!.find((a) => a.execution_id === 'ex-1')!.creator_asset).toBeUndefined();
  });

  it('asset REUSE across slots materializes each relationship (mixed asset campaigns)', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'camp-1', assetId: 'inf-1', slot: slots[2], status: 'confirmed' },
      { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' },
    ], ctx);
    const result = materializeAssignments({ campaignId: 'camp-1', calendarPlan, assignments: list, assets: ASSETS });
    expect(result.materialized_ids).toHaveLength(2);
    expect(result.calendar_plan.activities!.find((a) => a.execution_id === 'ex-3')!.creator_asset).toMatchObject({ asset_id: 'inf-1' });
  });
});

describe('P4 readiness (assist-only)', () => {
  const assetsList = Array.from(ASSETS.values()).map((a) => ({ id: a.id, assetType: a.creatorType, title: a.title, tags: [] }));

  it('reports ready when confirmed assignments have no blockers; never mutates', () => {
    const list = confirmedAssignments();
    const report = assessExecutionReadiness(slots, list, assetsList);
    expect(report.ready).toBe(true);
    expect(report.confirmed_count).toBe(2);
    expect(report.assigned_slots).toBe(2);
    expect(report.total_slots).toBe(3);
    expect(report.schedule_imbalance).toEqual(['Week 2 has 1 publishing slot but no assigned content.']);
    expect(list.every((a) => a.status === 'confirmed')).toBe(true); // read-only
  });

  it('reports not-ready with missing assets and zero confirmations', () => {
    expect(assessExecutionReadiness(slots, [], assetsList).ready).toBe(false);
    const ctx = freshCtx();
    const ghost = bulkAssign([], [{ campaignId: 'c', assetId: 'ghost', slot: slots[0], status: 'confirmed' }], ctx);
    const report = assessExecutionReadiness(slots, ghost, assetsList);
    expect(report.ready).toBe(false);
    expect(report.missing_assets).toEqual([ghost[0].id]);
  });
});
