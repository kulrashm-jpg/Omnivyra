/**
 * Strategic Mix P6 — Master Campaign Board contract.
 *
 *  - the board is a PURE projection: inputs never mutated, no state owned
 *  - campaign health, coverage, lifecycle/execution/assignment aggregations
 *    are deterministic over the canonical entities
 *  - every surfaced issue links to its source entity + resolution surface
 *  - mixed and legacy campaigns project correctly
 *  - the AI summary is derived text only (assist-only)
 */

import {
  projectCampaignBoard,
  summarizeCampaignBoard,
} from '../../../lib/campaign/campaignBoardProjection';
import {
  assignAsset,
  bulkAssign,
  advanceAssignmentStatus,
  deriveStructureSlots,
  type CampaignAssignment,
} from '../../../lib/campaign/campaignAssignments';
import { applyExecutionEvents } from '../../../lib/campaign/assignmentExecutionSync';
import type { AssignableAsset } from '../../../lib/campaign/assignmentIntelligence';

const freshCtx = () => { let i = 0; return { now: '2026-07-11T10:00:00.000Z', mintId: () => `asg-${++i}` }; };

const slots = deriveStructureSlots({
  days: [
    { week_number: 1, day: 'Monday', activities: [
      { execution_id: 'ex-1', platform: 'linkedin', content_type: 'carousel', title: 'A' },
      { execution_id: 'ex-2', platform: 'x', content_type: 'image', title: 'B' },
    ] },
    { week_number: 2, day: 'Wednesday', activities: [
      { execution_id: 'ex-3', platform: 'linkedin', content_type: 'infographic', title: 'C' },
    ] },
  ],
});

const ASSETS: AssignableAsset[] = [
  { id: 'car-1', assetType: 'carousel', title: 'Deck', tags: [] },
  { id: 'img-1', assetType: 'image', title: 'Hero', tags: [] },
  { id: 'inf-1', assetType: 'infographic', title: 'Stats', tags: [] },
];

/** A mixed campaign: one published item (with an earlier failure cleared),
 *  one still materialized (stalled), one open slot. */
function mixedCampaign(): CampaignAssignment[] {
  const ctx = freshCtx();
  let list = bulkAssign([], [
    { campaignId: 'camp-1', assetId: 'car-1', slot: slots[0], status: 'confirmed' },
    { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' },
  ], ctx);
  list = advanceAssignmentStatus(list, list.map((a) => a.id), 'materialized', ctx);
  list = applyExecutionEvents(list, [
    { type: 'scheduled_post_created', execution_id: 'ex-1', scheduled_post_id: 'sp-1' },
    { type: 'publish_completed', execution_id: 'ex-1', scheduled_post_id: 'sp-1', occurred_at: '2026-07-12T08:00:00Z' },
  ]).assignments;
  return list;
}

describe('projection — aggregations over canonical entities (never owned)', () => {
  it('aggregates structure/content/assignment/execution + purity of inputs', () => {
    const assignments = mixedCampaign();
    const inputSnapshot = JSON.parse(JSON.stringify({ slots, assignments, ASSETS }));
    const p = projectCampaignBoard({ slots, assignments, assets: ASSETS });

    expect(p.structure.total_slots).toBe(3);
    expect(p.structure.by_week).toEqual([
      { week: 1, slots: 2, assigned: 2, in_execution: 2, published: 1 },
      { week: 2, slots: 1, assigned: 0, in_execution: 0, published: 0 },
    ]);
    expect(p.structure.by_platform).toEqual([
      { platform: 'linkedin', slots: 2, assigned: 1 },
      { platform: 'x', slots: 1, assigned: 1 },
    ]);
    expect(p.content).toEqual({ assets_available: 3, assets_referenced: 2, missing_asset_ids: [] });
    expect(p.assignments).toMatchObject({ total: 2, assigned_slots: 2, unassigned_slots: 1, orphaned: [] });
    expect(p.assignments.by_status).toMatchObject({ published: 1, materialized: 1, draft: 0 });
    expect(p.execution).toMatchObject({ in_execution: 2, failures: [] });
    expect(p.execution.stalled).toHaveLength(1); // img-1 stuck while sibling published

    // purity — the board never mutates its inputs
    expect(JSON.parse(JSON.stringify({ slots, assignments, ASSETS }))).toEqual(inputSnapshot);
  });

  it('campaign health is deterministic: coverage/scheduling/publishing/progress', () => {
    const p = projectCampaignBoard({ slots, assignments: mixedCampaign(), assets: ASSETS });
    expect(p.health).toMatchObject({
      label: 'attention', // warnings (gap + stalled), no blockers
      ready: true,
      blocking_count: 0,
      coverage_pct: 67,   // 2/3 slots
      scheduling_pct: 33, // 1/3 scheduled-or-beyond
      publishing_pct: 33, // 1/3 published-or-beyond
      completion_pct: 0,  // nothing archived
    });
    // execution progress: published (3/4 of the ladder — archived is 4/4)
    // + materialized (0/4) over 2 items = 37.5 → 38%
    expect(p.health.execution_progress_pct).toBe(38);
    // idempotent projection
    expect(projectCampaignBoard({ slots, assignments: mixedCampaign(), assets: ASSETS })).toEqual(p);
  });

  it('every issue links to its source entity and resolution surface', () => {
    const ctx = freshCtx();
    let assignments = mixedCampaign();
    // add: an orphan, a missing asset, and a publish failure
    assignments = [...assignments, { ...assignments[0], id: 'asg-orphan', structure_id: 'gone-slot', status: 'draft' as const }];
    assignments = assignAsset(assignments, { campaignId: 'camp-1', assetId: 'ghost', slot: slots[2], status: 'confirmed' }, ctx).assignments;
    assignments = applyExecutionEvents(assignments, [
      { type: 'publish_failed', execution_id: 'ex-2', scheduled_post_id: 'sp-2', error_message: 'API down' },
    ]).assignments;

    const p = projectCampaignBoard({ slots, assignments, assets: ASSETS });
    const byCode = (code: string) => p.issues.filter((i) => i.code === code);

    expect(byCode('missing_asset')[0]).toMatchObject({ severity: 'blocking', target: 'content' });
    expect(byCode('orphaned_assignment')[0]).toMatchObject({ severity: 'warning', target: 'structure', ref_id: 'asg-orphan' });
    expect(byCode('publish_failed')[0]).toMatchObject({ severity: 'warning', target: 'alignment', message: 'Publish failed: API down' });
    expect(p.health.label).toBe('blocked');
    expect(p.health.ready).toBe(false);
    for (const issue of p.issues) expect(['alignment', 'structure', 'content']).toContain(issue.target);
  });

  it('legacy campaigns (planning-only assignments, no execution fields) project cleanly', () => {
    const ctx = freshCtx();
    const legacy = bulkAssign([], [{ campaignId: 'c', assetId: 'car-1', slot: slots[0] }], ctx); // draft
    const p = projectCampaignBoard({ slots, assignments: legacy, assets: ASSETS });
    expect(p.health.label).toBe('attention'); // gaps only
    expect(p.execution).toEqual({ in_execution: 0, failures: [], stalled: [] });
    expect(p.health.execution_progress_pct).toBe(0);
    expect(p.assignments.by_status.draft).toBe(1);
  });

  it('empty structure → health empty; nothing crashes', () => {
    const p = projectCampaignBoard({ slots: [], assignments: [], assets: [] });
    expect(p.health).toMatchObject({ label: 'empty', ready: false, coverage_pct: 0 });
    expect(summarizeCampaignBoard(p)).toEqual(['No structure yet — build the campaign skeleton to open publishing slots.']);
  });
});

describe('AI summary — assist-only, derived text', () => {
  it('summarizes readiness, coverage, imbalance, failures, and opportunities without mutating', () => {
    const assignments = mixedCampaign();
    const p = projectCampaignBoard({ slots, assignments, assets: ASSETS });
    const before = JSON.parse(JSON.stringify(p));
    const summary = summarizeCampaignBoard(p);
    expect(summary.some((s) => s.includes('warning'))).toBe(true);
    expect(summary.some((s) => s.includes('67% of slots'))).toBe(true);
    expect(summary.some((s) => s.includes('not yet scheduled'))).toBe(true);
    expect(summary.some((s) => s.includes('unused library asset'))).toBe(true);
    expect(JSON.parse(JSON.stringify(p))).toEqual(before); // read-only
    expect(summarizeCampaignBoard(p)).toEqual(summary); // deterministic
  });
});
