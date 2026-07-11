/**
 * Strategic Mix P3 — Assignment layer contract.
 *
 * Assignment is the ONLY relationship between Structure and Content:
 *  - operations are pure (input arrays never mutated)
 *  - assets are referenced by id, never embedded (no duplicated asset state)
 *  - unassigning removes the relationship ONLY — never the asset
 *  - one asset can hold many assignments (reuse)
 *  - slot derivation is deterministic (same plan → same slot ids across reloads)
 */

import {
  deriveStructureSlots,
  normalizeAssignments,
  assignAsset,
  bulkAssign,
  unassignAssignment,
  bulkUnassign,
  moveAssignment,
  duplicateAssignment,
  replaceAssignmentAsset,
  reorderAssignments,
  updateAssignmentMetadata,
  assignmentsForSlot,
  assignmentsForAsset,
  type CampaignAssignment,
  type StructureSlot,
} from '../../../lib/campaign/campaignAssignments';
import {
  detectAssignmentGaps,
  detectAssignmentConflicts,
  recommendAssignments,
  type AssignableAsset,
} from '../../../lib/campaign/assignmentIntelligence';

const CTX = { now: '2026-07-11T10:00:00.000Z', mintId: (() => { let i = 0; return () => `asg-${++i}`; })() };
const freshCtx = () => { let i = 0; return { now: '2026-07-11T10:00:00.000Z', mintId: () => `asg-${++i}` }; };

const calendarPlan = {
  days: [
    {
      week_number: 1,
      day: 'Monday',
      activities: [
        { execution_id: 'ex-1', platform: 'linkedin', content_type: 'image', title: 'Kickoff visual' },
        { platform: 'x', content_type: 'carousel', title: 'Framework deck' }, // no execution_id
      ],
    },
    { week_number: 2, day: 'Wednesday', activities: [{ execution_id: 'ex-3', platform: 'linkedin', content_type: 'infographic', title: 'Stats drop' }] },
  ],
};

const slots = deriveStructureSlots(calendarPlan);
const slotByPlatformType = (platform: string, type: string): StructureSlot =>
  slots.find((s) => s.platform === platform && s.content_type === type)!;

describe('deriveStructureSlots — structure defines opportunities, deterministically', () => {
  it('uses execution_id when present and a deterministic key otherwise', () => {
    expect(slots).toHaveLength(3);
    expect(slots[0].structure_id).toBe('ex-1');
    expect(slots[1].structure_id).toBe('slot:w1:monday:x:carousel:1');
    expect(slots[2]).toMatchObject({ structure_id: 'ex-3', week: 2, day: 'Wednesday' });
  });

  it('same plan → identical slot ids (assignments survive reloads)', () => {
    expect(deriveStructureSlots(calendarPlan)).toEqual(slots);
  });

  it('is defensive about malformed plans', () => {
    expect(deriveStructureSlots(null)).toEqual([]);
    expect(deriveStructureSlots({} as never)).toEqual([]);
    expect(deriveStructureSlots({ days: [{}], activities: 'nope' } as never)).toEqual([]);
  });
});

describe('assignment operations — pure, reference-only, reversible', () => {
  const base: CampaignAssignment[] = [];

  it('assignAsset appends a reference with dense per-slot ordering; input untouched', () => {
    const ctx = freshCtx();
    const s = slots[0];
    const r1 = assignAsset(base, { campaignId: 'camp-1', assetId: 'asset-A', slot: s }, ctx);
    const r2 = assignAsset(r1.assignments, { campaignId: 'camp-1', assetId: 'asset-B', slot: s }, ctx);
    expect(base).toHaveLength(0); // purity
    expect(r2.assignments).toHaveLength(2);
    expect(r1.assignment).toMatchObject({ asset_id: 'asset-A', structure_id: 'ex-1', week: 1, day: 'Monday', platform: 'linkedin', content_type: 'image', ordering: 0, status: 'draft' });
    expect(r2.assignment.ordering).toBe(1);
    expect(Object.keys(r1.assignment)).toEqual(expect.arrayContaining(['campaign_id', 'asset_id', 'structure_id', 'week', 'day', 'platform', 'content_type', 'slot', 'status', 'notes', 'ordering', 'created_at', 'updated_at']));
  });

  it('one asset → many assignments (reuse, never duplication)', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'c', assetId: 'asset-A', slot: slots[0] },
      { campaignId: 'c', assetId: 'asset-A', slot: slots[1] },
      { campaignId: 'c', assetId: 'asset-A', slot: slots[2] },
    ], ctx);
    expect(assignmentsForAsset(list, 'asset-A')).toHaveLength(3);
    expect(new Set(list.map((a) => a.id)).size).toBe(3); // distinct relationships
  });

  it('unassign removes ONLY the relationship — other uses of the asset survive', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'c', assetId: 'asset-A', slot: slots[0] },
      { campaignId: 'c', assetId: 'asset-A', slot: slots[1] },
    ], ctx);
    const after = unassignAssignment(list, list[0].id);
    expect(after).toHaveLength(1);
    expect(assignmentsForAsset(after, 'asset-A')).toHaveLength(1); // asset untouched
  });

  it('bulkUnassign drops exactly the requested ids', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'c', assetId: 'a1', slot: slots[0] },
      { campaignId: 'c', assetId: 'a2', slot: slots[1] },
      { campaignId: 'c', assetId: 'a3', slot: slots[2] },
    ], ctx);
    const after = bulkUnassign(list, [list[0].id, list[2].id]);
    expect(after.map((a) => a.asset_id)).toEqual(['a2']);
  });

  it('moveAssignment re-homes placement fields and appends to the target ordering', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'c', assetId: 'a1', slot: slots[0] },
      { campaignId: 'c', assetId: 'a2', slot: slots[2] },
    ], ctx);
    const moved = moveAssignment(list, list[0].id, slots[2], { now: '2026-07-11T11:00:00.000Z' });
    const m = moved.find((a) => a.id === list[0].id)!;
    expect(m).toMatchObject({ structure_id: 'ex-3', week: 2, day: 'Wednesday', platform: 'linkedin', content_type: 'infographic', ordering: 1 });
    expect(m.updated_at).toBe('2026-07-11T11:00:00.000Z');
    expect(m.created_at).toBe('2026-07-11T10:00:00.000Z'); // identity travels
  });

  it('duplicateAssignment reuses the SAME asset id under a new relationship', () => {
    const ctx = freshCtx();
    const { assignments: list } = assignAsset([], { campaignId: 'c', assetId: 'asset-A', slot: slots[0] }, ctx);
    const { assignments: after, assignment: copy } = duplicateAssignment(list, list[0].id, slots[1], ctx);
    expect(after).toHaveLength(2);
    expect(copy!.asset_id).toBe('asset-A'); // reuse — no asset copy, no new asset id
    expect(copy!.id).not.toBe(list[0].id);
    expect(copy!.structure_id).toBe(slots[1].structure_id);
    expect(duplicateAssignment(list, 'missing', undefined, ctx).assignment).toBeNull();
  });

  it('replaceAssignmentAsset swaps content, keeps placement + identity', () => {
    const ctx = freshCtx();
    const { assignments: list } = assignAsset([], { campaignId: 'c', assetId: 'old-asset', slot: slots[0] }, ctx);
    const after = replaceAssignmentAsset(list, list[0].id, 'new-asset', 3, { now: '2026-07-11T12:00:00.000Z' });
    expect(after[0]).toMatchObject({ id: list[0].id, asset_id: 'new-asset', asset_version: 3, structure_id: 'ex-1' });
  });

  it('reorderAssignments makes ordering dense in the requested order', () => {
    const ctx = freshCtx();
    const list = bulkAssign([], [
      { campaignId: 'c', assetId: 'a1', slot: slots[0] },
      { campaignId: 'c', assetId: 'a2', slot: slots[0] },
      { campaignId: 'c', assetId: 'a3', slot: slots[0] },
    ], ctx);
    const [x, y, z] = list.map((a) => a.id);
    const after = reorderAssignments(list, slots[0].structure_id, [z, x, y]);
    expect(assignmentsForSlot(after, slots[0].structure_id).map((a) => a.asset_id)).toEqual(['a3', 'a1', 'a2']);
    expect(assignmentsForSlot(after, slots[0].structure_id).map((a) => a.ordering)).toEqual([0, 1, 2]);
  });

  it('updateAssignmentMetadata whitelists status/notes/slot only', () => {
    const ctx = freshCtx();
    const { assignments: list } = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, ctx);
    const after = updateAssignmentMetadata(list, list[0].id, { status: 'ready', notes: 'swap after review', slot: 'primary' }, ctx);
    expect(after[0]).toMatchObject({ status: 'ready', notes: 'swap after review', slot: 'primary' });
    const bad = updateAssignmentMetadata(after, after[0].id, { status: 'bogus' as never });
    expect(bad[0].status).toBe('ready'); // invalid status ignored
  });
});

describe('normalizeAssignments — persisted-state parse is defensive', () => {
  it('round-trips a real assignment and drops malformed entries', () => {
    const { assignments } = assignAsset([], { campaignId: 'c', assetId: 'a1', slot: slots[0] }, CTX);
    const parsed = normalizeAssignments(JSON.parse(JSON.stringify(assignments)));
    expect(parsed).toEqual(assignments);
    expect(normalizeAssignments([{ id: 'x' }, null, 42, { asset_id: 'a', structure_id: 's' }])).toEqual([]);
    expect(normalizeAssignments('nope')).toEqual([]);
  });
});

describe('assignment intelligence — assist-only, deterministic', () => {
  const assets: AssignableAsset[] = [
    { id: 'img-1', assetType: 'image', title: 'Kickoff visual hero', tags: ['launch'] },
    { id: 'car-1', assetType: 'carousel', title: 'Framework deck v2', tags: ['framework'] },
    { id: 'inf-1', assetType: 'infographic', title: 'Q4 stats', tags: [] },
  ];

  it('detectAssignmentGaps lists exactly the unfilled slots', () => {
    const { assignments } = assignAsset([], { campaignId: 'c', assetId: 'img-1', slot: slots[0] }, freshCtx());
    const gaps = detectAssignmentGaps(slots, assignments);
    expect(gaps.map((g) => g.slot.structure_id)).toEqual([slots[1].structure_id, 'ex-3']);
  });

  it('detectAssignmentConflicts flags dup-asset-per-platform-day, type mismatch, and orphans', () => {
    const ctx = freshCtx();
    let list = bulkAssign([], [
      { campaignId: 'c', assetId: 'img-1', slot: slots[0] },
      { campaignId: 'c', assetId: 'img-1', slot: slots[0] }, // same asset, same platform+day
      { campaignId: 'c', assetId: 'car-1', slot: slots[2] }, // carousel into infographic slot
    ], ctx);
    list = [...list, { ...list[0], id: 'asg-orphan', structure_id: 'gone-slot' }];
    const kinds = detectAssignmentConflicts(slots, list, assets).map((c) => c.kind).sort();
    expect(kinds).toEqual(['content_type_mismatch', 'duplicate_asset_same_platform_day', 'orphaned_structure']);
  });

  it('recommendAssignments proposes per-gap, never a type mismatch, and NEVER mutates assignments', () => {
    const existing: CampaignAssignment[] = [];
    const recs = recommendAssignments(slots, assets, existing);
    expect(existing).toEqual([]); // assist-only: no writes, ever
    const bysSlot = new Map(recs.map((r) => [r.slot.structure_id, r.asset_id]));
    expect(bysSlot.get('ex-1')).toBe('img-1'); // type + keyword match
    expect(bysSlot.get(slots[1].structure_id)).toBe('car-1');
    expect(bysSlot.get('ex-3')).toBe('inf-1');
    for (const r of recs) expect(typeof r.reason).toBe('string');
    // determinism
    expect(recommendAssignments(slots, assets, existing)).toEqual(recs);
  });

  it('recommendations penalize same-placement reuse instead of proposing a conflict', () => {
    const ctx = freshCtx();
    // img-1 already sits on slot ex-1 (linkedin/Mon). A second image slot on the
    // same platform+day must NOT get img-1 if any other image exists.
    const twoImageSlots: StructureSlot[] = [
      slots[0],
      { structure_id: 'ex-1b', week: 1, day: 'Monday', platform: 'linkedin', content_type: 'image', title: null },
    ];
    const assetsTwoImages: AssignableAsset[] = [
      { id: 'img-1', assetType: 'image', title: null, tags: [] },
      { id: 'img-2', assetType: 'image', title: null, tags: [] },
    ];
    const { assignments } = assignAsset([], { campaignId: 'c', assetId: 'img-1', slot: slots[0] }, ctx);
    const recs = recommendAssignments(twoImageSlots, assetsTwoImages, assignments);
    expect(recs.find((r) => r.slot.structure_id === 'ex-1b')!.asset_id).toBe('img-2');
  });
});
