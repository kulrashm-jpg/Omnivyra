/**
 * P4 — bidirectional workflow proofs and grounding preservation.
 *
 * Strategic Mix must work in BOTH directions:
 *   skeleton-first   skeleton → strategic cards → content
 *   strategy-first   strategic cards → skeleton → content
 *
 * Both are already supported by the existing planner_state shape (the planner
 * soft-gates rather than sequencing). These tests pin that, prove neither
 * direction orphans or loses the other half, and prove that changing the
 * skeleton moves the P2/P3 grounding for the INTENDED slots only.
 */

import {
  deriveCampaignWeekStates,
  validateSkeleton,
  deriveDayAllocation,
} from '../../../lib/campaign/campaignWeekState';
import {
  resolveGenerationContext,
  buildGroundedContextBlock,
  type PlannerStateLike,
} from '../../../lib/campaign/generationContext';

const CAMPAIGN = 'camp-a';

const CARD = {
  core: { topic: 'Spreadsheet risk', summary: 'Manual close hides risk' },
  intelligence: {
    problem_being_solved: 'Close takes 12 days',
    why_now: 'Audit rules change',
    expected_transformation: 'A 3-day close',
    campaign_angle: 'Risk not efficiency',
  },
  execution: { execution_stage: 'Education' },
};

const THEMES = [
  { week: 1, title: 'Name the pain', phase_label: 'Awareness', objective: 'Make it concrete' },
  { week: 2, title: 'Show the outcome', phase_label: 'Solution', objective: 'Prove it' },
];

const STRATEGY = {
  campaign_goal: 'Win mid-market CFOs',
  target_audience: ['CFOs'],
  key_message: 'Close in days not weeks',
  duration_weeks: 2,
  platforms: ['linkedin'],
};

const act = (id: string, week: number, over: Record<string, unknown> = {}) => ({
  execution_id: id, week_number: week, day: 'Monday',
  platform: 'linkedin', content_type: 'post', title: `Slot ${id}`, ...over,
});

const ctxFor = (planner: PlannerStateLike, slotId: string) =>
  resolveGenerationContext({ campaignId: CAMPAIGN, plannerState: planner, slotId });

/* ── STRATEGY-FIRST ── */

describe('strategy-first: cards exist before any skeleton', () => {
  const strategyOnly: PlannerStateLike = {
    strategy_context: STRATEGY,
    strategic_card: CARD,
    strategic_themes: THEMES,
    calendar_plan: { activities: [] },
  };

  it('week states surface the DECLARED weeks as empty rather than hiding them', () => {
    const states = deriveCampaignWeekStates({
      plan: strategyOnly.calendar_plan, assignments: [], durationWeeks: 2,
    });
    expect(states.map((w) => w.week)).toEqual([1, 2]);
    expect(states.every((w) => w.state === 'empty')).toBe(true);
  });

  it('generation is BLOCKED until a skeleton exists — no ungrounded fallback', () => {
    const r = ctxFor(strategyOnly, 'anything');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_SKELETON_CONTEXT');
  });

  it('adding the skeleton afterwards preserves the strategic cards', () => {
    const withSkeleton: PlannerStateLike = {
      ...strategyOnly,
      calendar_plan: { activities: [act('s1', 1), act('s2', 2)] },
    };
    // The cards are untouched…
    expect(withSkeleton.strategic_card).toBe(CARD);
    expect(withSkeleton.strategic_themes).toBe(THEMES);
    // …and now reach generation.
    const b = buildGroundedContextBlock(ctxFor(withSkeleton, 's1').context!);
    expect(b).toContain('Close takes 12 days');
    expect(b).toContain('Weekly theme: Name the pain');
  });

  it('the skeleton does not overwrite the week themes it wraps', () => {
    const withSkeleton: PlannerStateLike = {
      ...strategyOnly,
      calendar_plan: { activities: [act('s1', 1), act('s2', 2)] },
    };
    expect(buildGroundedContextBlock(ctxFor(withSkeleton, 's2').context!))
      .toContain('Weekly theme: Show the outcome');
  });
});

/* ── SKELETON-FIRST ── */

describe('skeleton-first: structure exists before any strategy', () => {
  const skeletonOnly: PlannerStateLike = {
    strategy_context: { ...STRATEGY, campaign_goal: undefined } as never,
    strategic_card: null,
    strategic_themes: [],
    calendar_plan: { activities: [act('s1', 1), act('s2', 2)] },
    platform_content_requests: { linkedin: { post: 1 } },
  };

  it('week states are real immediately — no orphan weeks or slots', () => {
    const states = deriveCampaignWeekStates({
      plan: skeletonOnly.calendar_plan, assignments: [], durationWeeks: 2,
    });
    expect(states.map((w) => w.week)).toEqual([1, 2]);
    expect(states.every((w) => w.counts.total === 1)).toBe(true);
    expect(states.every((w) => w.state === 'planned')).toBe(true);
  });

  it('the skeleton alone validates against its own declaration', () => {
    const states = deriveCampaignWeekStates({ plan: skeletonOnly.calendar_plan, durationWeeks: 2 });
    const v = validateSkeleton({ platformContentRequests: { linkedin: { post: 1 } }, states });
    expect(v.ok).toBe(true);
  });

  it('generation is BLOCKED until strategy exists — never generic content', () => {
    const r = ctxFor(skeletonOnly, 's1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('MISSING_STRATEGIC_CONTEXT');
  });

  it('adding cards afterwards preserves the skeleton slots exactly', () => {
    const withCards: PlannerStateLike = { ...skeletonOnly, strategy_context: STRATEGY, strategic_card: CARD, strategic_themes: THEMES };
    const before = deriveCampaignWeekStates({ plan: skeletonOnly.calendar_plan, durationWeeks: 2 });
    const after = deriveCampaignWeekStates({ plan: withCards.calendar_plan, durationWeeks: 2 });
    expect(after).toEqual(before);
    // …and generation now resolves.
    expect(ctxFor(withCards, 's1').ok).toBe(true);
  });
});

/* ── SKELETON CHANGES MOVE THE RIGHT GROUNDING (§25) ── */

describe('skeleton edits change the intended slot only', () => {
  const base: PlannerStateLike = {
    strategy_context: STRATEGY,
    strategic_card: CARD,
    strategic_themes: THEMES,
    calendar_plan: {
      activities: [
        act('mon', 1, { day: 'Monday', content_type: 'post' }),
        act('tue', 1, { day: 'Tuesday', content_type: 'carousel' }),
      ],
    },
  };

  it('changing one slot\'s day moves only that slot\'s context', () => {
    const edited: PlannerStateLike = {
      ...base,
      calendar_plan: {
        activities: [
          act('mon', 1, { day: 'Wednesday', content_type: 'post' }), // moved
          act('tue', 1, { day: 'Tuesday', content_type: 'carousel' }),
        ],
      },
    };
    expect(buildGroundedContextBlock(ctxFor(edited, 'mon').context!)).toContain('Day: Wednesday');
    // The sibling is byte-identical.
    expect(buildGroundedContextBlock(ctxFor(edited, 'tue').context!))
      .toBe(buildGroundedContextBlock(ctxFor(base, 'tue').context!));
  });

  it('changing one slot\'s content type moves only that slot', () => {
    const edited: PlannerStateLike = {
      ...base,
      calendar_plan: {
        activities: [
          act('mon', 1, { day: 'Monday', content_type: 'video' }), // retyped
          act('tue', 1, { day: 'Tuesday', content_type: 'carousel' }),
        ],
      },
    };
    expect(buildGroundedContextBlock(ctxFor(edited, 'mon').context!)).toContain('Content type: video');
    expect(buildGroundedContextBlock(ctxFor(edited, 'tue').context!)).toContain('Content type: carousel');
  });

  it('extending the campaign adds weeks without disturbing existing slots', () => {
    const longer: PlannerStateLike = {
      ...base,
      strategy_context: { ...STRATEGY, duration_weeks: 4 },
      calendar_plan: { activities: [...(base.calendar_plan!.activities as never[]), act('w3', 3)] },
    };
    const states = deriveCampaignWeekStates({ plan: longer.calendar_plan, durationWeeks: 4 });
    expect(states.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    expect(states[3].state).toBe('empty'); // week 4 declared, unplanned — visible, not hidden
    // Week-1 grounding is unchanged apart from the campaign-length line.
    expect(buildGroundedContextBlock(ctxFor(longer, 'tue').context!)).toContain('Day: Tuesday');
  });

  it('removing a platform leaves the remaining slots grounded and flags the gap', () => {
    const states = deriveCampaignWeekStates({ plan: base.calendar_plan, durationWeeks: 1 });
    // Declared instagram, none placed → reported, never silently reconciled.
    const v = validateSkeleton({ platformContentRequests: { instagram: { post: 1 } }, states });
    expect(v.issues.some((i) => i.code === 'platform_unplaced')).toBe(true);
    expect(ctxFor(base, 'mon').ok).toBe(true);
  });

  it('day allocation reflects the edit immediately (one representation, not two)', () => {
    const edited: PlannerStateLike = {
      ...base,
      calendar_plan: { activities: [act('mon', 1, { day: 'Friday', content_type: 'post' })] },
    };
    expect(deriveDayAllocation({ plan: edited.calendar_plan, week: 1 }))
      .toEqual([{ day: 'Friday', platform: 'linkedin', content_type: 'post', count: 1 }]);
  });
});

/* ── P2/P3 CONTEXT SURVIVES ── */

describe('P2/P3 grounding is preserved end to end', () => {
  const full: PlannerStateLike = {
    strategy_context: STRATEGY,
    strategic_card: CARD,
    strategic_themes: THEMES,
    calendar_plan: { activities: [act('s1', 1, { day: 'Monday', content_type: 'carousel' })] },
    campaign_type: 'HYBRID',
    platform_content_requests: { linkedin: { carousel: 1 } },
    assignments: [{
      asset_id: 'a-1', structure_id: 's1', slot: 'primary', status: 'confirmed',
      content_type: 'carousel', ordering: 0, notes: 'Use as the proof carousel.',
    }],
  };

  it('campaign, card, skeleton, week, day, platform, type and asset all still reach the model', () => {
    const b = buildGroundedContextBlock(
      resolveGenerationContext({
        campaignId: CAMPAIGN, plannerState: full, slotId: 's1',
        assetLibrary: new Map([['a-1', { id: 'a-1', title: 'Proof deck', url: null, files: [{ url: 'x' }, { url: 'y' }], creatorType: 'carousel' }]]),
      }).context!,
    );
    expect(b).toContain('Win mid-market CFOs');          // campaign
    expect(b).toContain('Close takes 12 days');           // strategic card
    expect(b).toContain('Campaign type: HYBRID');         // skeleton
    expect(b).toContain('Week: 1');                       // week
    expect(b).toContain('Day: Monday');                   // day
    expect(b).toContain('Platform: linkedin');            // platform
    expect(b).toContain('Content type: carousel');        // content type
    expect(b).toContain('Proof deck');                    // asset facts (P3-C)
    expect(b).toContain('Use as the proof carousel.');    // user intent (P3-C)
  });

  it('week-state derivation does not mutate the plan generation reads', () => {
    const before = JSON.stringify(full.calendar_plan);
    deriveCampaignWeekStates({ plan: full.calendar_plan, assignments: full.assignments as never });
    expect(JSON.stringify(full.calendar_plan)).toBe(before);
    expect(resolveGenerationContext({ campaignId: CAMPAIGN, plannerState: full, slotId: 's1' }).ok).toBe(true);
  });
});
