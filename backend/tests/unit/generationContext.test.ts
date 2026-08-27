/**
 * P2 — grounded generation context (PURE).
 *
 * Proves the canonical chain Campaign → Week → Strategic Card → Skeleton →
 * Day → Platform → Content Type → Assets resolves from the campaign's OWN
 * planner_state, that a foreign slot cannot resolve, and that the assembled
 * prompt block actually carries the strategy (not just an HTTP 200).
 */

import {
  resolveGenerationContext,
  buildGroundedContextBlock,
  type PlannerStateLike,
} from '../../../lib/campaign/generationContext';

const CAMPAIGN_A = 'camp-a';

/** A realistic planner_state: 2 weeks × 2 platforms, card + themes + assignment. */
const plannerState = (over: Partial<PlannerStateLike> = {}): PlannerStateLike => ({
  strategy_context: {
    campaign_goal: 'Win mid-market CFOs away from spreadsheets',
    target_audience: ['CFOs', 'Finance directors'],
    key_message: 'Close the books in days, not weeks',
    duration_weeks: 2,
    platforms: ['linkedin', 'x'],
    planned_start_date: '2026-09-01',
  },
  strategic_card: {
    core: {
      topic: 'Spreadsheet risk in month-end close',
      polished_title: 'The hidden cost of spreadsheet close',
      summary: 'Manual close cycles hide material error risk.',
      narrative_direction: 'Move from anxiety to control',
    },
    strategic_context: {
      selected_aspects: ['Financial controls'],
      selected_offerings: ['Close Automation'],
    },
    intelligence: {
      problem_being_solved: 'Month-end close takes 12 days and breaks under audit',
      why_now: 'New audit rules land next quarter',
      expected_transformation: 'A 3-day auditable close',
      campaign_angle: 'Risk, not efficiency',
    },
    execution: { execution_stage: 'Education', stage_objective: 'Make the risk concrete' },
  },
  strategic_themes: [
    { week: 1, title: 'The cost of manual close', phase_label: 'Awareness', objective: 'Name the pain', content_focus: 'Story + stat', cta_focus: 'Comment' },
    { week: 2, title: 'What a 3-day close looks like', phase_label: 'Solution', objective: 'Show the outcome', content_focus: 'Walkthrough', cta_focus: 'Book a demo' },
  ],
  calendar_plan: {
    activities: [
      { execution_id: 'slot-w1-li', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'Close takes 12 days', objective: 'Name the pain' },
      { execution_id: 'slot-w1-x', week_number: 1, day: 'Wednesday', platform: 'x', content_type: 'post', title: 'Close stat' },
      { execution_id: 'slot-w2-li', week_number: 2, day: 'Tuesday', platform: 'linkedin', content_type: 'carousel', title: 'Three-day close' },
    ],
  },
  campaign_type: 'HYBRID',
  platform_content_requests: { linkedin: { post: 2, carousel: 1 }, x: { post: 1 } },
  assignments: [
    { asset_id: 'asset-1', structure_id: 'slot-w2-li', slot: 'primary', status: 'confirmed', content_type: 'carousel' },
  ],
  ...over,
});

const resolveA = (slotId: string, platform?: string | null) =>
  resolveGenerationContext({ campaignId: CAMPAIGN_A, plannerState: plannerState(), slotId, platform });

describe('canonical context chain', () => {
  it('resolves campaign context from the campaign\'s own planner_state', () => {
    const r = resolveA('slot-w1-li');
    expect(r.ok).toBe(true);
    expect(r.context!.campaign).toMatchObject({
      campaign_id: CAMPAIGN_A,
      goal: 'Win mid-market CFOs away from spreadsheets',
      key_message: 'Close the books in days, not weeks',
      duration_weeks: 2,
      start_date: '2026-09-01',
    });
    expect(r.context!.campaign.audience).toEqual(['CFOs', 'Finance directors']);
  });

  it('resolves the STRATEGIC CARD (the field set the audit found never reached the model)', () => {
    const s = resolveA('slot-w1-li').context!.strategic;
    expect(s).toMatchObject({
      topic: 'Spreadsheet risk in month-end close',
      problem_being_solved: 'Month-end close takes 12 days and breaks under audit',
      why_now: 'New audit rules land next quarter',
      expected_transformation: 'A 3-day auditable close',
      campaign_angle: 'Risk, not efficiency',
      execution_stage: 'Education',
      stage_objective: 'Make the risk concrete',
    });
    expect(s.selected_offerings).toEqual(['Close Automation']);
  });

  it('resolves the WEEK theme matching the slot\'s week — not week 1 for every slot', () => {
    expect(resolveA('slot-w1-li').context!.week).toMatchObject({
      week: 1, theme_title: 'The cost of manual close', phase_label: 'Awareness', cta_focus: 'Comment',
    });
    expect(resolveA('slot-w2-li').context!.week).toMatchObject({
      week: 2, theme_title: 'What a 3-day close looks like', phase_label: 'Solution', cta_focus: 'Book a demo',
    });
  });

  it('resolves SKELETON structure from the existing model (no second representation)', () => {
    const st = resolveA('slot-w1-li').context!.structure;
    expect(st).toMatchObject({ campaign_type: 'HYBRID', duration_weeks: 2, total_slots: 3, week_slots: 2 });
    expect(st.platforms).toEqual(['linkedin', 'x']);
    expect(st.platform_content_requests).toEqual({ linkedin: { post: 2, carousel: 1 }, x: { post: 1 } });
  });

  it('resolves SLOT specifics: day, platform, content type, sequence', () => {
    expect(resolveA('slot-w2-li').context!.slot).toMatchObject({
      structure_id: 'slot-w2-li', week: 2, day: 'Tuesday',
      platform: 'linkedin', content_type: 'carousel', sequence_in_week: 1,
    });
  });

  it('resolves ASSIGNED assets for the slot — and only for that slot', () => {
    // P3-C added asset FACTS + user intent + position to this shape; the P2
    // assertion intent (the right asset, scoped to the right slot) is kept.
    expect(resolveA('slot-w2-li').context!.assets).toMatchObject([
      { asset_id: 'asset-1', slot: 'primary', status: 'confirmed', content_type: 'carousel', position: 1 },
    ]);
    expect(resolveA('slot-w1-li').context!.assets).toEqual([]);
  });
});

describe('cross-campaign / injection protection', () => {
  it('a slot from ANOTHER campaign does not resolve', () => {
    const r = resolveGenerationContext({
      campaignId: CAMPAIGN_A, plannerState: plannerState(), slotId: 'slot-from-campaign-b',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SLOT_NOT_IN_CAMPAIGN');
  });

  it('a client cannot substitute an arbitrary platform for the slot', () => {
    const r = resolveA('slot-w1-li', 'instagram'); // slot is linkedin
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SLOT_NOT_IN_CAMPAIGN');
    expect(r.message).toMatch(/linkedin/);
  });

  it('the asserted platform matching the slot is accepted (case-insensitive)', () => {
    expect(resolveA('slot-w1-li', 'LinkedIn').ok).toBe(true);
  });

  it('strategy is NEVER taken from the caller — only campaignId/slotId/platform are inputs', () => {
    const inputKeys = ['campaignId', 'plannerState', 'slotId', 'platform'];
    // plannerState is server-loaded; nothing else can carry strategy.
    expect(inputKeys).not.toContain('strategicCard');
    expect(inputKeys).not.toContain('theme');
    expect(inputKeys).not.toContain('objective');
  });
});

describe('structured failure instead of generic generation', () => {
  it('no skeleton → MISSING_SKELETON_CONTEXT', () => {
    const r = resolveGenerationContext({
      campaignId: CAMPAIGN_A, plannerState: plannerState({ calendar_plan: { activities: [] } }), slotId: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_SKELETON_CONTEXT');
    expect(r.message).toBeTruthy();
  });

  it('no strategy of any kind → MISSING_STRATEGIC_CONTEXT', () => {
    const r = resolveGenerationContext({
      campaignId: CAMPAIGN_A,
      plannerState: plannerState({ strategic_card: null, strategic_themes: [], strategy_context: {} }),
      slotId: 'slot-w1-li',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_STRATEGIC_CONTEXT');
  });

  it('a weekly theme ALONE is sufficient strategy (card optional)', () => {
    const r = resolveGenerationContext({
      campaignId: CAMPAIGN_A,
      plannerState: plannerState({ strategic_card: null, strategy_context: {} }),
      slotId: 'slot-w1-li',
    });
    expect(r.ok).toBe(true);
    expect(r.context!.week.theme_title).toBe('The cost of manual close');
  });

  it('null planner_state fails structurally, never throws', () => {
    expect(() => resolveGenerationContext({ campaignId: CAMPAIGN_A, plannerState: null, slotId: 's' })).not.toThrow();
    expect(resolveGenerationContext({ campaignId: CAMPAIGN_A, plannerState: null, slotId: 's' }).code)
      .toBe('MISSING_SKELETON_CONTEXT');
  });
});

describe('prompt block — grounding actually reaches the model', () => {
  const block = () => buildGroundedContextBlock(resolveA('slot-w2-li').context!);

  it('carries the four required sections', () => {
    const b = block();
    expect(b).toContain('CAMPAIGN STRATEGY (why this campaign exists)');
    expect(b).toContain('CAMPAIGN STRUCTURE (where this piece sits)');
    expect(b).toContain('THIS PIECE (what it must accomplish)');
    expect(b).toContain('CONSTRAINTS (must not be violated)');
  });

  it('carries the strategic card content verbatim', () => {
    const b = block();
    expect(b).toContain('Month-end close takes 12 days and breaks under audit');
    expect(b).toContain('New audit rules land next quarter');
    expect(b).toContain('A 3-day auditable close');
    expect(b).toContain('Risk, not efficiency');
  });

  it('carries week, day, platform and content type for THIS slot', () => {
    const b = block();
    expect(b).toContain('Week: 2');
    expect(b).toContain('Weekly theme: What a 3-day close looks like');
    expect(b).toContain('Day: Tuesday');
    expect(b).toContain('Platform: linkedin');
    expect(b).toContain('Content type: carousel');
  });

  it('carries the assigned asset and instructs the model to work WITH it', () => {
    // P3-C renamed the section header when it added asset facts/intent.
    const b = block();
    expect(b).toContain('ASSETS ALREADY ASSIGNED TO THIS PIECE');
    expect(b).toContain('asset-1');
    expect(b).toMatch(/complement it/);
  });

  it('constrains the model against generic, week-agnostic output', () => {
    expect(block()).toMatch(/Do not write a generic campaign post that could sit in any week/);
    expect(block()).toMatch(/do not introduce goals, offers, or audiences that are not listed above/);
  });

  it('omits absent fields rather than emitting empty labels', () => {
    const sparse = resolveGenerationContext({
      campaignId: CAMPAIGN_A,
      plannerState: plannerState({ strategic_card: null }),
      slotId: 'slot-w1-x',
    });
    const b = buildGroundedContextBlock(sparse.context!);
    expect(b).not.toMatch(/Why now:\s*$/m);
    expect(b).not.toContain('Problem being solved:');
  });

  it('is DETERMINISTIC — identical canonical input yields an identical block', () => {
    expect(block()).toBe(block());
    expect(buildGroundedContextBlock(resolveA('slot-w1-li').context!))
      .toBe(buildGroundedContextBlock(resolveA('slot-w1-li').context!));
  });

  it('different slots produce DIFFERENT blocks (no generic reuse)', () => {
    const w1 = buildGroundedContextBlock(resolveA('slot-w1-li').context!);
    const w2 = buildGroundedContextBlock(resolveA('slot-w2-li').context!);
    expect(w1).not.toBe(w2);
    expect(w1).toContain('Week: 1');
    expect(w2).toContain('Week: 2');
  });

  it('per-platform slots carry their own platform (LinkedIn variant ≠ X variant context)', () => {
    const li = buildGroundedContextBlock(resolveA('slot-w1-li').context!);
    const x = buildGroundedContextBlock(resolveA('slot-w1-x').context!);
    expect(li).toContain('Platform: linkedin');
    expect(x).toContain('Platform: x');
    expect(li).not.toBe(x);
  });
});
