/**
 * Strategic Mix P5 — characterization of the state-ownership contract,
 * written BEFORE the Execution Lifecycle Synchronization touches anything.
 *
 * Locks the pre-P5 guarantees the sync layer must never weaken:
 *  - planning operations produce ONLY the canonical planning field set —
 *    no operation invents execution-owned fields
 *  - the planner cannot reach or overwrite execution-owned states
 *    (metadata whitelist + forward-only advance + per-item locks)
 *  - normalizeAssignments round-trips the P3/P4 shape and tolerates
 *    unknown extra keys from foreign/legacy snapshots without crashing
 */

import {
  assignAsset,
  moveAssignment,
  duplicateAssignment,
  updateAssignmentMetadata,
  advanceAssignmentStatus,
  normalizeAssignments,
  reorderAssignments,
  replaceAssignmentAsset,
  deriveStructureSlots,
  isAssignmentLocked,
  type CampaignAssignment,
} from '../../../lib/campaign/campaignAssignments';

const CTX = { now: '2026-07-11T10:00:00.000Z', mintId: (() => { let i = 0; return () => `asg-${++i}`; })() };
const slots = deriveStructureSlots({
  days: [{ week_number: 1, day: 'Monday', activities: [
    { execution_id: 'ex-1', platform: 'linkedin', content_type: 'carousel', title: 'A' },
    { execution_id: 'ex-2', platform: 'x', content_type: 'image', title: 'B' },
  ] }],
});

/** The planning-owned field set every op is allowed to produce. */
const PLANNING_FIELDS = [
  'id', 'campaign_id', 'asset_id', 'asset_version', 'structure_id', 'week', 'day',
  'platform', 'content_type', 'slot', 'status', 'notes', 'ordering', 'created_at', 'updated_at',
].sort();

describe('ownership — planning operations never invent execution-owned fields', () => {
  it('assign/move/duplicate/replace/reorder/metadata produce exactly the planning field set', () => {
    let list = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX).assignments;
    list = moveAssignment(list, list[0].id, slots[1], CTX);
    list = duplicateAssignment(list, list[0].id, slots[0], CTX).assignments;
    list = replaceAssignmentAsset(list, list[0].id, 'a2', 1, CTX);
    list = reorderAssignments(list, slots[0].structure_id, [list[1].id], CTX);
    list = updateAssignmentMetadata(list, list[0].id, { status: 'ready', notes: 'n', slot: 'primary' }, CTX);
    for (const a of list) {
      expect(Object.keys(a).sort()).toEqual(PLANNING_FIELDS);
    }
  });
});

describe('ownership — the planner cannot reach or overwrite execution-owned states', () => {
  it('metadata edits cap at planning statuses; execution states require advanceAssignmentStatus', () => {
    let list = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX).assignments;
    for (const forbidden of ['materialized', 'scheduled', 'publishing', 'published', 'archived']) {
      const attempt = updateAssignmentMetadata(list, list[0].id, { status: forbidden as never }, CTX);
      expect(attempt[0].status).toBe('draft');
    }
    list = advanceAssignmentStatus(list, list[0].id, 'scheduled', CTX);
    expect(list[0].status).toBe('scheduled');
    expect(isAssignmentLocked(list[0])).toBe(true);
    // …and once execution-owned, planning edits are inert (per-item lock)
    const after = updateAssignmentMetadata(list, list[0].id, { status: 'draft', notes: 'x' }, CTX);
    expect(after[0]).toMatchObject({ status: 'scheduled', notes: '' });
  });

  it('advance is forward-only: execution states never regress', () => {
    let list = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX).assignments;
    list = advanceAssignmentStatus(list, list[0].id, 'published', CTX);
    expect(advanceAssignmentStatus(list, list[0].id, 'scheduled', CTX)[0].status).toBe('published');
  });
});

describe('ownership — persisted-state parse (planner/campaign reload, legacy snapshots)', () => {
  it('round-trips the canonical shape and tolerates unknown extra keys without crashing', () => {
    const canonical = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX).assignments;
    expect(normalizeAssignments(JSON.parse(JSON.stringify(canonical)))).toEqual(canonical);

    const withForeignKeys = [{ ...canonical[0], some_future_field: { nested: true }, another: 1 }];
    const parsed = normalizeAssignments(withForeignKeys);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(canonical[0].id);
    expect('some_future_field' in parsed[0]).toBe(false); // unknown keys dropped, never fatal
  });

  it('parses every lifecycle status (execution states survive reload)', () => {
    const base = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX).assignments[0];
    for (const status of ['draft', 'ready', 'confirmed', 'materialized', 'scheduled', 'publishing', 'published', 'archived']) {
      expect(normalizeAssignments([{ ...base, status }])[0].status).toBe(status);
    }
    expect(normalizeAssignments([{ ...base, status: 'garbage' }])[0].status).toBe('draft');
  });
});
