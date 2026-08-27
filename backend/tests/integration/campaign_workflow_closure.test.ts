/**
 * P4.2 — end-to-end CMO workflow closure.
 *
 * Every prior phase tested its own module in isolation. This closes the two
 * gaps that isolation leaves, both of which are real risks rather than test
 * padding:
 *
 *   1. CROSS-MODULE AGREEMENT. Four independent derivations read the SAME
 *      planner_state — week states (P4), review packages (P3-B), generation
 *      context (P2/P3-C) and the release plan (P1). If they disagree, the CMO
 *      is told "Week 1 is ready" while release silently skips it. Nothing
 *      previously asserted they agree.
 *
 *   2. PERSISTENCE REOPEN (§26). The canonical seam whitelists TOP-LEVEL keys
 *      but passes calendar_plan and assignments through whole, so the nested
 *      fields P3-B and P3-C depend on — draft_content, content_planning_status
 *      and assignment `notes` — survive only by that pass-through. If a future
 *      edit tightens the serializer, asset intent and content review would die
 *      silently on reopen. This pins it.
 *
 * Pure composition only: no network, no database, no new model.
 */

import { serializePlannerState } from '../../../components/planner/plannerDraftPersistence';
import { deriveCampaignWeekStates, matchWeeks } from '../../../lib/campaign/campaignWeekState';
import { deriveSlotReviewPackages } from '../../../lib/campaign/slotReadiness';
import { deriveReleasePlan } from '../../../lib/campaign/campaignRelease';
import { resolveGenerationContext, buildGroundedContextBlock } from '../../../lib/campaign/generationContext';
import { authorizePostPublish } from '../../../lib/campaign/publishAuthorization';
import type { CampaignAssignment } from '../../../lib/campaign/campaignAssignments';

/* ────────────────────────────────────────────────────────────────────────
 * One realistic campaign, built the way a CMO would.
 * 3 weeks · LinkedIn + X · post / carousel / video · day-specific.
 * ──────────────────────────────────────────────────────────────────────── */

const approved = (body: string) => ({
  draft_content: { body, source: 'ai' as const, updated_at: '2026-09-01T00:00:00Z' },
  content_planning_status: 'approved' as const,
});
const inReview = (body: string) => ({
  draft_content: { body, source: 'ai' as const, updated_at: 'x' },
  content_planning_status: 'review' as const,
});
const manual = (body: string) => ({
  draft_content: { body, source: 'manual' as const, updated_at: 'x', manually_edited: true },
  content_planning_status: 'approved' as const,
});

const ACTIVITIES = [
  // Week 1 — fully approved, one manually edited
  { execution_id: 'w1-mon-li', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'Twelve-day close', ...approved('W1 LinkedIn post.') },
  { execution_id: 'w1-tue-li', week_number: 1, day: 'Tuesday', platform: 'linkedin', content_type: 'carousel', title: 'Where days go', ...manual('W1 carousel, hand-written.') },
  { execution_id: 'w1-wed-x', week_number: 1, day: 'Wednesday', platform: 'x', content_type: 'post', title: 'Close stat', ...approved('W1 X post.') },
  // Week 2 — fully approved
  { execution_id: 'w2-mon-li', week_number: 2, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'Audit pressure', ...approved('W2 LinkedIn post.') },
  { execution_id: 'w2-thu-li', week_number: 2, day: 'Thursday', platform: 'linkedin', content_type: 'video', title: 'Demo', ...approved('W2 video script.') },
  // Week 3 — still being worked
  { execution_id: 'w3-mon-li', week_number: 3, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'Proof', ...inReview('W3 awaiting approval.') },
  { execution_id: 'w3-wed-x', week_number: 3, day: 'Wednesday', platform: 'x', content_type: 'post', title: 'Recap' },
];

const ASSIGNMENTS: CampaignAssignment[] = [
  {
    id: 'as-1', campaign_id: 'camp-1', asset_id: 'asset-carousel', asset_version: 2,
    structure_id: 'w1-tue-li', week: 1, day: 'Tuesday', platform: 'linkedin',
    content_type: 'carousel', slot: 'primary', status: 'confirmed',
    notes: 'Use these five slides as the customer proof deck.', ordering: 0,
    approval: 'approved', created_at: 'x', updated_at: 'x',
  } as CampaignAssignment,
  {
    id: 'as-2', campaign_id: 'camp-1', asset_id: 'asset-video', asset_version: 1,
    structure_id: 'w2-thu-li', week: 2, day: 'Thursday', platform: 'linkedin',
    content_type: 'video', slot: 'primary', status: 'confirmed',
    notes: 'Our existing product demo video.', ordering: 0,
    approval: 'approved', created_at: 'x', updated_at: 'x',
  } as CampaignAssignment,
];

const PLANNER_STATE = {
  idea_spine: { title: 'Close in days', description: 'Month-end close campaign', origin: 'direct' as const },
  strategy_context: {
    duration_weeks: 3,
    platforms: ['linkedin', 'x'],
    posting_frequency: { linkedin: 2, x: 1 },
    content_mix: ['post', 'carousel', 'video'],
    campaign_goal: 'Win mid-market CFOs',
    target_audience: ['CFOs'],
    key_message: 'Close the books in days, not weeks',
    planned_start_date: '2026-09-01',
  },
  skeleton_confirmed: true,
  strategy_confirmed: true,
  planner_entry_mode: 'direct' as const,
  campaign_type: 'HYBRID' as const,
  platform_content_requests: { linkedin: { post: 1, carousel: 1, video: 1 }, x: { post: 1 } },
  source_ids: {},
  plan_preview: null,
  campaign_structure: { narrative: 'Awareness → Solution → Proof', phases: [] },
  calendar_plan: { activities: ACTIVITIES },
  strategic_themes: [
    { week: 1, title: 'Name the pain', phase_label: 'Awareness', objective: 'Make it concrete' },
    { week: 2, title: 'Show the cost', phase_label: 'Education', objective: 'Quantify it' },
    { week: 3, title: 'Prove the outcome', phase_label: 'Solution', objective: 'Demonstrate' },
  ],
  strategic_card: {
    schema_type: 'planner_strategic_card', schema_version: 1,
    core: { topic: 'Spreadsheet risk', summary: 'Manual close hides risk', polished_title: null, narrative_direction: null },
    strategic_context: { campaign_goal: 'Win mid-market CFOs', target_audience: ['CFOs'], key_message: null, selected_aspects: [], selected_offerings: [] },
    intelligence: { problem_being_solved: 'Close takes 12 days', why_now: 'Audit rules change', expected_transformation: 'A 3-day close', campaign_angle: 'Risk not efficiency' },
    execution: { execution_stage: 'Education', stage_objective: null, psychological_goal: null, momentum_level: null },
  },
  assignments: ASSIGNMENTS,
  draft_campaign_id: 'camp-1',
  // Transient, UI-only. Present here so the reopen test proves they are
  // deliberately dropped, rather than merely absent from the fixture.
  health_report: { score: 91 },
  selected_activity: ACTIVITIES[0],
  recommended_goal: 'Win mid-market CFOs',
} as never;

const ASSET_LIBRARY = new Map([
  ['asset-carousel', { id: 'asset-carousel', title: 'Customer proof deck', url: null, version: 2,
    files: [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }, { url: 'e' }], creatorType: 'carousel' }],
  ['asset-video', { id: 'asset-video', title: 'Product demo', url: 'https://youtu.be/demo', version: 1,
    files: null, creatorType: 'video' }],
]);

/** daily_content_plans rows as planner-finalize would write them. */
const planRows = ACTIVITIES.map((a) => ({
  id: a.execution_id,
  week_number: a.week_number,
  platform: a.platform,
  content_type: a.content_type,
  date: `2026-09-0${a.week_number}`,
  scheduled_time: '09:00:00',
  scheduled_post_id: null,
  content: JSON.stringify({
    ...(a.draft_content ? { draft_content: a.draft_content } : {}),
    ...(a.content_planning_status ? { content_planning_status: a.content_planning_status } : {}),
  }),
}));

/* ────────────────────────────────────────────────────────────────────────
 * 1. CROSS-MODULE AGREEMENT
 * ──────────────────────────────────────────────────────────────────────── */

describe('the four derivations agree on one planner_state', () => {
  const weekStates = deriveCampaignWeekStates({
    plan: PLANNER_STATE.calendar_plan, assignments: ASSIGNMENTS, durationWeeks: 3,
  });
  const packages = deriveSlotReviewPackages({
    plan: PLANNER_STATE.calendar_plan, assignments: ASSIGNMENTS,
    assets: ASSET_LIBRARY as never, requireApproval: true,
    capability: { mediaCapableByPlatform: { linkedin: true, x: true } },
  });
  const releasePlan = deriveReleasePlan(planRows as never, { kind: 'campaign' });

  it('week states classify the campaign as the CMO built it', () => {
    expect(weekStates.map((w) => `${w.week}:${w.state}`))
      .toEqual(['1:approved', '2:approved', '3:in_progress']);
  });

  it('P4 week counts equal the P3-B package verdicts, slot for slot', () => {
    for (const w of weekStates) {
      const inWeek = packages.filter((p) => p.slot.week === w.week);
      expect(inWeek).toHaveLength(w.counts.total);
      // "approved" in the week counts ⇔ text approved in the package.
      const approvedPackages = inWeek.filter((p) => p.text.status === 'approved' && p.text.has_content);
      expect(approvedPackages).toHaveLength(w.counts.approved);
    }
  });

  it('every week P4 calls complete has ONLY ready packages (no false green)', () => {
    const complete = matchWeeks(weekStates, 'complete');
    expect(complete.length).toBeGreaterThan(0); // never let this loop pass vacuously
    for (const week of complete) {
      const inWeek = packages.filter((p) => p.slot.week === week);
      expect(inWeek.every((p) => p.readiness.code === 'ready')).toBe(true);
    }
  });

  it('every week P4 calls incomplete has at least one non-ready package', () => {
    const incomplete = matchWeeks(weekStates, 'incomplete');
    expect(incomplete.length).toBeGreaterThan(0);
    for (const week of incomplete) {
      const inWeek = packages.filter((p) => p.slot.week === week);
      expect(inWeek.some((p) => p.readiness.code !== 'ready')).toBe(true);
    }
  });

  it('P1 release eligibility matches P3-B readiness — no silent skip of a "ready" slot', () => {
    const eligible = new Set(releasePlan.eligible_ids);
    for (const p of packages) {
      if (p.readiness.code === 'ready') {
        expect(eligible.has(p.slot.structure_id)).toBe(true);
      }
      // Copy that EXISTS but is not approved must never be released.
      if (p.readiness.code === 'blocked_text' && p.text.has_content) {
        expect(eligible.has(p.slot.structure_id)).toBe(false);
      }
    }
  });

  it('the ONE deliberate divergence is exactly the empty slot, counted as generate', () => {
    // P3-B calls a slot with no copy `blocked_text` (a reviewer cannot review
    // nothing). P1 still releases it, because the scheduler generates copy for
    // rows that carry none. That is intended — but it is the ONLY case where
    // "not ready" and "releasable" coexist, so it is pinned here rather than
    // left to be rediscovered as a bug.
    const eligible = new Set(releasePlan.eligible_ids);
    const divergent = packages.filter(
      (p) => p.readiness.code !== 'ready' && eligible.has(p.slot.structure_id),
    );
    expect(divergent.map((p) => p.slot.structure_id)).toEqual(['w3-wed-x']);
    expect(divergent.every((p) => p.text.has_content === false)).toBe(true);
    expect(releasePlan.generate_count).toBe(1);
  });

  it('a week shown as complete releases ALL of its slots', () => {
    const complete = matchWeeks(weekStates, 'complete');
    expect(complete.length).toBeGreaterThan(0);
    for (const week of complete) {
      const weekPlan = deriveReleasePlan(planRows as never, { kind: 'weeks', weeks: [week] });
      const weekSlots = packages.filter((p) => p.slot.week === week);
      expect(weekPlan.eligible_ids.sort()).toEqual(weekSlots.map((p) => p.slot.structure_id).sort());
    }
  });

  it('the in-progress week does NOT fully release — its unapproved work is held back', () => {
    const w3 = deriveReleasePlan(planRows as never, { kind: 'weeks', weeks: [3] });
    // w3-mon-li is in review ⇒ blocked; w3-wed-x has no copy ⇒ generatable.
    expect(w3.eligible_ids).toEqual(['w3-wed-x']);
    expect(w3.skipped_by_reason.content_in_review).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. THE CMO SCENARIO, COMPOSED
 * ──────────────────────────────────────────────────────────────────────── */

describe('full CMO scenario: skeleton → content → review → select → release → publish', () => {
  const weekStates = deriveCampaignWeekStates({
    plan: PLANNER_STATE.calendar_plan, assignments: ASSIGNMENTS, durationWeeks: 3,
  });

  it('STEP 1 — the skeleton produced day-specific, platform-specific slots', () => {
    const w1 = weekStates.find((w) => w.week === 1)!;
    expect(w1.days).toEqual(['Monday', 'Tuesday', 'Wednesday']);
    expect(w1.platforms).toEqual(['linkedin', 'x']);
    expect(w1.content_types).toEqual(['carousel', 'post']);
  });

  it('STEP 2 — generation is grounded in campaign, card, week, day, platform, type AND asset intent', () => {
    const block = buildGroundedContextBlock(
      resolveGenerationContext({
        campaignId: 'camp-1', plannerState: PLANNER_STATE, slotId: 'w1-tue-li',
        assetLibrary: ASSET_LIBRARY as never,
      }).context!,
    );
    expect(block).toContain('Win mid-market CFOs');
    expect(block).toContain('Close takes 12 days');
    expect(block).toContain('Weekly theme: Name the pain');
    expect(block).toContain('Day: Tuesday');
    expect(block).toContain('Platform: linkedin');
    expect(block).toContain('Content type: carousel');
    expect(block).toContain('Customer proof deck');
    expect(block).toContain('Use these five slides as the customer proof deck.');
  });

  it('STEP 3 — review shows the real package: 5 ordered slides, approved asset', () => {
    const pkg = deriveSlotReviewPackages({
      plan: PLANNER_STATE.calendar_plan, assignments: ASSIGNMENTS,
      assets: ASSET_LIBRARY as never, requireApproval: true,
      capability: { mediaCapableByPlatform: { linkedin: true, x: true } },
    }).find((p) => p.slot.structure_id === 'w1-tue-li')!;
    expect(pkg.assets[0].slides.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(pkg.assets[0].fully_available).toBe(true);
    expect(pkg.assets[0].approval).toBe('approved');
    expect(pkg.readiness.code).toBe('ready');
  });

  it('STEP 4 — week selection picks 1 and 2 by condition, not by hand', () => {
    expect(matchWeeks(weekStates, 'complete')).toEqual([1, 2]);
  });

  it('STEP 5 — release scoped to [1,2] touches ONLY weeks 1 and 2', () => {
    const plan = deriveReleasePlan(planRows as never, { kind: 'weeks', weeks: [1, 2] });
    expect(plan.eligible_weeks).toEqual([1, 2]);
    for (const id of plan.eligible_ids) expect(id.startsWith('w3-')).toBe(false);
    // Week 3's slots are reported out of scope, not silently dropped.
    expect(plan.skipped_by_reason.out_of_scope).toBe(2);
  });

  it('STEP 6 — a released post is authorized per-post, and its unreleased sibling is not', () => {
    // After scheduling, week-1/2 rows carry status 'scheduled'; week 3 does not exist as a post.
    expect(authorizePostPublish({
      campaign_id: 'camp-1', campaign_status: 'active', post_status: 'scheduled', has_content: true,
    }).authorized).toBe(true);
    expect(authorizePostPublish({
      campaign_id: 'camp-1', campaign_status: 'active', post_status: 'draft', has_content: true,
    }).code).toBe('PUBLISH_BLOCKED_POST_NOT_RELEASED');
  });

  it('STEP 7 — campaign-wide readiness never gates the released post', () => {
    // The campaign is only partially complete (week 3 in progress). Under the
    // pre-B1 gate that blocked EVERYTHING; it must not now.
    const verdict = authorizePostPublish({
      campaign_id: 'camp-1', campaign_status: 'active', post_status: 'scheduled', has_content: true,
    });
    expect(verdict.authorized).toBe(true);
    expect(JSON.stringify(verdict)).not.toContain('readiness');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. PERSISTENCE REOPEN (§26)
 * ──────────────────────────────────────────────────────────────────────── */

describe('close the planner, reopen it — everything represented as persisted is still there', () => {
  const serialized = serializePlannerState(PLANNER_STATE);
  /** The jsonb seam: what actually survives a database round-trip. */
  const reopened = JSON.parse(JSON.stringify(serialized));

  it('the skeleton survives', () => {
    expect(reopened.strategy_context.duration_weeks).toBe(3);
    expect(reopened.strategy_context.platforms).toEqual(['linkedin', 'x']);
    expect(reopened.platform_content_requests).toEqual(PLANNER_STATE.platform_content_requests);
    expect(reopened.campaign_type).toBe('HYBRID');
  });

  it('the strategic card and weekly themes survive', () => {
    expect(reopened.strategic_card.intelligence.problem_being_solved).toBe('Close takes 12 days');
    expect(reopened.strategic_themes).toHaveLength(3);
    expect(reopened.strategic_themes[2].title).toBe('Prove the outcome');
  });

  it('every slot survives with its day, platform and content type', () => {
    expect(reopened.calendar_plan.activities).toHaveLength(7);
    const tue = reopened.calendar_plan.activities.find((a: { execution_id: string }) => a.execution_id === 'w1-tue-li');
    expect(tue).toMatchObject({ day: 'Tuesday', platform: 'linkedin', content_type: 'carousel' });
  });

  it('P3-B — content bodies AND their approval status survive', () => {
    const acts = reopened.calendar_plan.activities;
    const approvedSlot = acts.find((a: { execution_id: string }) => a.execution_id === 'w1-mon-li');
    expect(approvedSlot.draft_content.body).toBe('W1 LinkedIn post.');
    expect(approvedSlot.content_planning_status).toBe('approved');
    const reviewSlot = acts.find((a: { execution_id: string }) => a.execution_id === 'w3-mon-li');
    expect(reviewSlot.content_planning_status).toBe('review');
  });

  it('P2 — a MANUAL edit and its protection flag survive', () => {
    const manualSlot = reopened.calendar_plan.activities
      .find((a: { execution_id: string }) => a.execution_id === 'w1-tue-li');
    expect(manualSlot.draft_content.body).toBe('W1 carousel, hand-written.');
    expect(manualSlot.draft_content.manually_edited).toBe(true);
  });

  it('P3-C — assignments survive WITH their asset intent (`notes`) and approval', () => {
    expect(reopened.assignments).toHaveLength(2);
    const carousel = reopened.assignments.find((a: { id: string }) => a.id === 'as-1');
    expect(carousel.asset_id).toBe('asset-carousel');
    expect(carousel.notes).toBe('Use these five slides as the customer proof deck.');
    expect(carousel.approval).toBe('approved');
    expect(carousel.ordering).toBe(0);
  });

  it('the reopened state produces IDENTICAL derivations — nothing is lost in the round trip', () => {
    const before = deriveCampaignWeekStates({
      plan: PLANNER_STATE.calendar_plan, assignments: ASSIGNMENTS, durationWeeks: 3,
    });
    const after = deriveCampaignWeekStates({
      plan: reopened.calendar_plan, assignments: reopened.assignments, durationWeeks: 3,
    });
    expect(after).toEqual(before);
  });

  it('grounding after reopen is byte-identical — asset intent still reaches the model', () => {
    const build = (state: unknown) => buildGroundedContextBlock(
      resolveGenerationContext({
        campaignId: 'camp-1', plannerState: state as never, slotId: 'w1-tue-li',
        assetLibrary: ASSET_LIBRARY as never,
      }).context!,
    );
    expect(build(reopened)).toBe(build(PLANNER_STATE));
  });

  it('review packages after reopen are byte-identical', () => {
    const build = (plan: unknown, assignments: unknown) => deriveSlotReviewPackages({
      plan: plan as never, assignments: assignments as never,
      assets: ASSET_LIBRARY as never, requireApproval: true,
      capability: { mediaCapableByPlatform: { linkedin: true, x: true } },
    });
    expect(build(reopened.calendar_plan, reopened.assignments))
      .toEqual(build(PLANNER_STATE.calendar_plan, ASSIGNMENTS));
  });

  it('transient UI-only state is deliberately NOT persisted', () => {
    expect(reopened).not.toHaveProperty('health_report');
    expect(reopened).not.toHaveProperty('selected_activity');
    expect(reopened).not.toHaveProperty('recommended_goal');
  });
});
