/**
 * Strategic Mix R3-P1 — Content Workspace model contract.
 *
 * Locks: slot-aligned derivation, dual-list (days + flat) mutation sync,
 * AI-vs-manual overwrite guard (SPEC-001 §4.4), planning lifecycle
 * (draft ⇄ review ⇄ approved, content-gated, closed vocabulary), scope
 * targeting (campaign/week/activity × all/missing/selected), and coverage
 * summary determinism.
 */

import {
  applyGeneratedContent,
  applyManualContentEdit,
  deriveContentItems,
  duplicateActivityContent,
  moveActivityContent,
  planContentGeneration,
  removeActivityContent,
  setContentPlanningStatus,
  summarizeContentCoverage,
  type ContentPlanLike,
} from '../../../lib/campaign/campaignContentModel';

const NOW = '2026-07-12T10:00:00.000Z';

const activity = (over: Record<string, unknown> = {}) => ({
  execution_id: 'ex-1',
  week_number: 1,
  day: 'Monday',
  platform: 'linkedin',
  content_type: 'post',
  title: 'Kickoff post',
  ...over,
});

/** Plan with BOTH a days index and a flat list holding copies of the same
 *  logical activities — the store's dual-list reality. */
function dualListPlan(): ContentPlanLike {
  const a1 = activity();
  const a2 = activity({ execution_id: 'ex-2', day: 'Wednesday', platform: 'x', title: 'Hot take' });
  const a3 = activity({ execution_id: 'ex-3', week_number: 2, day: 'Friday', platform: 'linkedin', content_type: 'carousel', title: 'Deck' });
  return {
    days: [
      { week_number: 1, day: 'Monday', activities: [{ ...a1 }] },
      { week_number: 1, day: 'Wednesday', activities: [{ ...a2 }] },
      { week_number: 2, day: 'Friday', activities: [{ ...a3 }] },
    ],
    activities: [{ ...a1 }, { ...a2 }, { ...a3 }],
  };
}

describe('deriveContentItems', () => {
  test('one item per structure slot, empty until content exists', () => {
    const items = deriveContentItems(dualListPlan());
    expect(items.map((i) => i.slot.structure_id)).toEqual(['ex-1', 'ex-2', 'ex-3']);
    expect(items.every((i) => !i.has_content && i.draft === null && i.status === 'draft')).toBe(true);
  });

  test('tolerates null/absent plans', () => {
    expect(deriveContentItems(null)).toEqual([]);
    expect(deriveContentItems({})).toEqual([]);
  });
});

describe('content application + dual-list sync', () => {
  test('applyGeneratedContent writes BOTH the days copy and the flat copy', () => {
    const result = applyGeneratedContent(dualListPlan(), 'ex-2', 'Generated body', { operation: 'generatePlatformVariants', now: NOW });
    expect(result.changed).toBe(true);
    const daysCopy = result.plan.days?.[1]?.activities?.[0];
    const flatCopy = result.plan.activities?.[1];
    for (const copy of [daysCopy, flatCopy]) {
      expect(copy?.draft_content).toEqual({ body: 'Generated body', source: 'ai', ai_operation: 'generatePlatformVariants', updated_at: NOW });
      expect(copy?.content_planning_status).toBe('draft');
    }
    // Unrelated activities untouched (same references)
    expect(result.plan.days?.[0]?.activities?.[0]?.draft_content).toBeUndefined();
  });

  test('AI regeneration over a manual edit is BLOCKED without the explicit overwrite flag', () => {
    const manual = applyManualContentEdit(dualListPlan(), 'ex-1', 'My hand-written copy', { now: NOW });
    expect(manual.changed).toBe(true);

    const blocked = applyGeneratedContent(manual.plan, 'ex-1', 'AI replacement', { now: NOW });
    expect(blocked.changed).toBe(false);
    expect(blocked.reason).toBe('manual_overwrite_blocked');
    // Original plan returned untouched
    expect(blocked.plan.activities?.[0]?.draft_content?.body).toBe('My hand-written copy');

    const allowed = applyGeneratedContent(manual.plan, 'ex-1', 'AI replacement', { overwriteManual: true, now: NOW });
    expect(allowed.changed).toBe(true);
    expect(allowed.plan.activities?.[0]?.draft_content?.body).toBe('AI replacement');
  });

  test('manual edit always wins and re-enters draft status', () => {
    const generated = applyGeneratedContent(dualListPlan(), 'ex-1', 'AI body', { now: NOW });
    const approved = setContentPlanningStatus(generated.plan, 'ex-1', 'approved');
    const edited = applyManualContentEdit(approved.plan, 'ex-1', 'Edited by hand', { now: NOW });
    const item = deriveContentItems(edited.plan).find((i) => i.slot.structure_id === 'ex-1');
    expect(item?.draft?.source).toBe('manual');
    expect(item?.manually_edited).toBe(true);
    expect(item?.status).toBe('draft');
  });

  test('unknown slot is a no-op with reason', () => {
    const result = applyGeneratedContent(dualListPlan(), 'ex-404', 'Body', { now: NOW });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  test('empty body never writes', () => {
    expect(applyGeneratedContent(dualListPlan(), 'ex-1', '   ', { now: NOW }).reason).toBe('no_content');
    expect(applyManualContentEdit(dualListPlan(), 'ex-1', '', { now: NOW }).reason).toBe('no_content');
  });

  test('index-keyed slots (no execution_id) still resolve deterministically', () => {
    const plan: ContentPlanLike = {
      activities: [
        activity({ execution_id: undefined }),
        activity({ execution_id: undefined }), // same composite key, second occurrence
      ],
    };
    const items = deriveContentItems(plan);
    expect(items).toHaveLength(2);
    const second = items[1].slot.structure_id;
    const result = applyGeneratedContent(plan, second, 'Second body', { now: NOW });
    expect(result.changed).toBe(true);
    expect(result.plan.activities?.[0]?.draft_content).toBeUndefined();
    expect(result.plan.activities?.[1]?.draft_content?.body).toBe('Second body');
  });
});

describe('planning lifecycle', () => {
  test('draft → review → approved and back — reversible, content-gated', () => {
    const withContent = applyGeneratedContent(dualListPlan(), 'ex-1', 'Body', { now: NOW });
    const review = setContentPlanningStatus(withContent.plan, 'ex-1', 'review');
    expect(deriveContentItems(review.plan)[0].status).toBe('review');
    const approvedR = setContentPlanningStatus(review.plan, 'ex-1', 'approved');
    expect(deriveContentItems(approvedR.plan)[0].status).toBe('approved');
    const back = setContentPlanningStatus(approvedR.plan, 'ex-1', 'draft');
    expect(deriveContentItems(back.plan)[0].status).toBe('draft');
  });

  test('review/approved require content; unknown vocabulary rejected', () => {
    const empty = setContentPlanningStatus(dualListPlan(), 'ex-1', 'review');
    expect(empty.changed).toBe(false);
    expect(empty.reason).toBe('no_content');
    const bad = setContentPlanningStatus(dualListPlan(), 'ex-1', 'shipped' as never);
    expect(bad.changed).toBe(false);
    expect(bad.reason).toBe('invalid_status');
  });
});

describe('remove / duplicate / move', () => {
  test('remove clears content + status, keeps the slot', () => {
    const withContent = applyGeneratedContent(dualListPlan(), 'ex-1', 'Body', { now: NOW });
    const removed = removeActivityContent(withContent.plan, 'ex-1');
    expect(removed.changed).toBe(true);
    const item = deriveContentItems(removed.plan)[0];
    expect(item.has_content).toBe(false);
    expect(removed.plan.activities).toHaveLength(3);
  });

  test('duplicate copies content as a fresh draft; move also clears the source', () => {
    const withContent = applyManualContentEdit(dualListPlan(), 'ex-1', 'Original', { now: NOW });
    const approved = setContentPlanningStatus(
      applyGeneratedContent(withContent.plan, 'ex-2', 'x', { now: NOW }).plan, 'ex-1', 'review');

    const dup = duplicateActivityContent(approved.plan, 'ex-1', 'ex-3', { now: NOW });
    expect(dup.changed).toBe(true);
    const items = deriveContentItems(dup.plan);
    expect(items.find((i) => i.slot.structure_id === 'ex-3')?.draft?.body).toBe('Original');
    expect(items.find((i) => i.slot.structure_id === 'ex-3')?.status).toBe('draft'); // never inherits review state
    expect(items.find((i) => i.slot.structure_id === 'ex-1')?.draft?.body).toBe('Original'); // source kept

    const moved = moveActivityContent(approved.plan, 'ex-1', 'ex-3', { now: NOW });
    const movedItems = deriveContentItems(moved.plan);
    expect(movedItems.find((i) => i.slot.structure_id === 'ex-3')?.draft?.body).toBe('Original');
    expect(movedItems.find((i) => i.slot.structure_id === 'ex-1')?.has_content).toBe(false);
  });

  test('duplicate from an empty slot is refused', () => {
    const result = duplicateActivityContent(dualListPlan(), 'ex-1', 'ex-2', { now: NOW });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('no_content');
  });
});

describe('generation scopes', () => {
  const seeded = () => applyGeneratedContent(dualListPlan(), 'ex-1', 'Existing', { now: NOW }).plan;

  test('campaign scope + missing mode targets only empty slots', () => {
    const targets = planContentGeneration(seeded(), { kind: 'campaign' }, 'missing');
    expect(targets.map((t) => t.slot_id)).toEqual(['ex-2', 'ex-3']);
  });

  test('week scope isolates a single week', () => {
    const targets = planContentGeneration(seeded(), { kind: 'week', week: 2 }, 'all');
    expect(targets.map((t) => t.slot_id)).toEqual(['ex-3']);
  });

  test('activity scope targets exactly one slot', () => {
    const targets = planContentGeneration(seeded(), { kind: 'activity', slot_id: 'ex-1' }, 'all');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ slot_id: 'ex-1', has_content: true, platform: 'linkedin', topic: 'Kickoff post' });
  });

  test('selected mode intersects with explicit ids; flags overwrite risk', () => {
    const manual = applyManualContentEdit(seeded(), 'ex-2', 'Hand copy', { now: NOW }).plan;
    const targets = planContentGeneration(manual, { kind: 'campaign' }, 'selected', ['ex-2', 'ex-3']);
    expect(targets.map((t) => t.slot_id)).toEqual(['ex-2', 'ex-3']);
    expect(targets.find((t) => t.slot_id === 'ex-2')?.manually_edited).toBe(true);
  });
});

describe('coverage summary', () => {
  test('aggregates totals and per-week coverage', () => {
    let plan = applyGeneratedContent(dualListPlan(), 'ex-1', 'A', { now: NOW }).plan;
    plan = applyGeneratedContent(plan, 'ex-3', 'B', { now: NOW }).plan;
    plan = setContentPlanningStatus(plan, 'ex-3', 'review').plan;
    plan = setContentPlanningStatus(plan, 'ex-3', 'approved').plan;

    const summary = summarizeContentCoverage(plan);
    expect(summary).toMatchObject({ total: 3, with_content: 2, empty: 1, approved: 1, in_review: 0, drafts: 1 });
    expect(summary.weeks).toEqual([
      { week: 1, total: 2, with_content: 1, approved: 0 },
      { week: 2, total: 1, with_content: 1, approved: 1 },
    ]);
  });
});
