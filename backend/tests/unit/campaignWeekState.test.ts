/**
 * P4 — campaign week state, bulk-selection conditions, skeleton validation.
 *
 * Everything is DERIVED from existing facts: calendar_plan slots, the text
 * lifecycle, and CampaignAssignment. No week model, no state machine, no
 * persistence. These tests pin the exact predicate behind every UI condition
 * so a label can never drift from its meaning.
 */

import {
  deriveCampaignWeekStates,
  deriveWeekStateCode,
  matchWeeks,
  summarizeWeekSelection,
  validateSkeleton,
  deriveDayAllocation,
  WEEK_CONDITIONS,
  getWeekCondition,
  type CampaignWeekState,
} from '../../../lib/campaign/campaignWeekState';
import type { CampaignAssignment } from '../../../lib/campaign/campaignAssignments';

/* ── fixtures ── */

const approved = { draft_content: { body: 'ok', source: 'ai', updated_at: 'x' }, content_planning_status: 'approved' };
const review = { draft_content: { body: 'pending', source: 'ai', updated_at: 'x' }, content_planning_status: 'review' };
const draft = { draft_content: { body: 'wip', source: 'manual', updated_at: 'x' }, content_planning_status: 'draft' };

const act = (id: string, week: number, over: Record<string, unknown> = {}) => ({
  execution_id: id, week_number: week, day: 'Monday',
  platform: 'linkedin', content_type: 'post', title: `Slot ${id}`, ...over,
});

const plan = (activities: Array<Record<string, unknown>>) => ({ activities } as never);

const assign = (over: Partial<CampaignAssignment> = {}): CampaignAssignment => ({
  id: 'as-1', campaign_id: 'c', asset_id: 'a-1', asset_version: 1,
  structure_id: 's1', week: 1, day: 'Monday', platform: 'linkedin',
  content_type: 'image', slot: 'primary', status: 'confirmed', notes: '', ordering: 0,
  created_at: 'x', updated_at: 'x', ...over,
} as CampaignAssignment);

const states = (activities: Array<Record<string, unknown>>, assignments: CampaignAssignment[] = [], duration?: number) =>
  deriveCampaignWeekStates({ plan: plan(activities), assignments, durationWeeks: duration });

/* ── WEEK STATE ── */

describe('week state derivation', () => {
  it('a week with no slots is reported as empty, not omitted', () => {
    const s = states([act('s1', 1)], [], 3);
    expect(s.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(s[1].state).toBe('empty');
    expect(s[1].counts.total).toBe(0);
  });

  it('slots but no content → planned', () => {
    expect(states([act('s1', 1)])[0].state).toBe('planned');
  });

  it('some written, some not → in_progress', () => {
    expect(states([act('s1', 1, approved), act('s2', 1)])[0].state).toBe('in_progress');
  });

  it('all written, some awaiting → in_review', () => {
    expect(states([act('s1', 1, approved), act('s2', 1, review)])[0].state).toBe('in_review');
  });

  it('all written, a draft remains → in_review (not approved)', () => {
    expect(states([act('s1', 1, approved), act('s2', 1, draft)])[0].state).toBe('in_review');
  });

  it('all approved, nothing released → approved', () => {
    expect(states([act('s1', 1, approved), act('s2', 1, approved)])[0].state).toBe('approved');
  });

  it('an asset awaiting approval keeps the week in_review even when all text is approved', () => {
    const s = states([act('s1', 1, approved)], [assign({ structure_id: 's1', approval: 'pending' })]);
    expect(s[0].counts.assets_pending_approval).toBe(1);
    expect(s[0].state).toBe('in_review');
  });

  it('a released slot → released', () => {
    const s = states([act('s1', 1, approved)], [assign({ structure_id: 's1', scheduled_post_id: 'sp-1' })]);
    expect(s[0].state).toBe('released');
    expect(s[0].counts.released).toBe(1);
  });

  it('a publish failure outranks released', () => {
    const s = states([act('s1', 1, approved)], [assign({
      structure_id: 's1', scheduled_post_id: 'sp-1',
      execution_failure: { message: 'boom', code: 'X', occurred_at: 'x', scheduled_post_id: 'sp-1' },
    })]);
    expect(s[0].state).toBe('failed');
  });

  it('collects the platforms, content types and days the skeleton placed', () => {
    const s = states([
      act('s1', 1, { day: 'Wednesday', platform: 'x', content_type: 'post' }),
      act('s2', 1, { day: 'Monday', platform: 'linkedin', content_type: 'carousel' }),
    ]);
    expect(s[0].platforms).toEqual(['linkedin', 'x']);
    expect(s[0].content_types).toEqual(['carousel', 'post']);
    expect(s[0].days).toEqual(['Monday', 'Wednesday']); // week order, not insertion order
  });

  it('the state predicate is exposed and total-driven', () => {
    expect(deriveWeekStateCode({
      total: 0, with_content: 0, empty: 0, drafts: 0, in_review: 0, approved: 0,
      with_assets: 0, assets_pending_approval: 0, released: 0, failed: 0,
    })).toBe('empty');
  });

  it('is deterministic', () => {
    const a = states([act('s1', 1, approved)], [assign({ structure_id: 's1' })]);
    const b = states([act('s1', 1, approved)], [assign({ structure_id: 's1' })]);
    expect(a).toEqual(b);
  });
});

/* ── CONDITIONS ── */

describe('bulk-selection conditions — every predicate pinned', () => {
  /**
   * Six-week campaign covering every state:
   *   1 approved · 2 in_review · 3 in_progress · 4 planned · 5 empty · 6 released
   */
  const SIX = states(
    [
      act('w1a', 1, approved), act('w1b', 1, approved),
      act('w2a', 2, approved), act('w2b', 2, review),
      act('w3a', 3, approved), act('w3b', 3),
      act('w4a', 4),
      act('w6a', 6, approved),
    ],
    [assign({ structure_id: 'w6a', scheduled_post_id: 'sp-6' })],
    6,
  );

  it('every condition has an id, label and a written definition', () => {
    for (const c of WEEK_CONDITIONS) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.definition.length).toBeGreaterThan(20);
      expect(typeof c.match).toBe('function');
    }
  });

  it('all → every week including empty ones', () => {
    expect(matchWeeks(SIX, 'all')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('empty → weeks with zero slots', () => {
    expect(matchWeeks(SIX, 'empty')).toEqual([5]);
  });

  it('no_content → has slots, none written', () => {
    expect(matchWeeks(SIX, 'no_content')).toEqual([4]);
  });

  it('has_content → at least one slot written', () => {
    expect(matchWeeks(SIX, 'has_content')).toEqual([1, 2, 3, 6]);
  });

  it('incomplete → has slots and not every slot approved', () => {
    expect(matchWeeks(SIX, 'incomplete')).toEqual([2, 3, 4]);
  });

  it('complete → every slot approved', () => {
    expect(matchWeeks(SIX, 'complete')).toEqual([1, 6]);
  });

  it('awaiting_approval → a slot in review OR an asset pending approval', () => {
    expect(matchWeeks(SIX, 'awaiting_approval')).toEqual([2]);
  });

  it('approved → fully approved AND not released', () => {
    // Week 6 is fully approved but RELEASED, so it is not "approved".
    expect(matchWeeks(SIX, 'approved')).toEqual([1]);
  });

  it('released → at least one scheduled post', () => {
    expect(matchWeeks(SIX, 'released')).toEqual([6]);
  });

  it('unreleased → has slots and none released', () => {
    expect(matchWeeks(SIX, 'unreleased')).toEqual([1, 2, 3, 4]);
  });

  it('failed → at least one publish failure', () => {
    expect(matchWeeks(SIX, 'failed')).toEqual([]);
  });

  it('released and unreleased partition the weeks that have slots', () => {
    const withSlots = SIX.filter((w) => w.counts.total > 0).map((w) => w.week);
    const union = [...matchWeeks(SIX, 'released'), ...matchWeeks(SIX, 'unreleased')].sort((a, b) => a - b);
    expect(union).toEqual(withSlots);
  });

  it('an unknown condition throws rather than silently matching everything', () => {
    expect(() => getWeekCondition('nope' as never)).toThrow(/Unknown week condition/);
  });
});

/* ── SELECTION SEMANTICS ── */

describe('selection semantics and counts', () => {
  const SIX = states([act('a', 1, approved), act('b', 2, review), act('c', 3)], [], 3);

  it('reports "N weeks selected"', () => {
    expect(summarizeWeekSelection({ states: SIX, selected: [1, 3] }).selection_label).toBe('2 weeks selected');
  });

  it('singular is handled', () => {
    expect(summarizeWeekSelection({ states: SIX, selected: [1] }).selection_label).toBe('1 week selected');
  });

  it('reports "X of Y weeks match <condition>"', () => {
    const s = summarizeWeekSelection({ states: SIX, selected: [], condition: 'incomplete' });
    expect(s.match_label).toBe('2 of 3 weeks match "Incomplete"');
    expect(s.matching_count).toBe(2);
    expect(s.total_count).toBe(3);
  });

  it('select-all-matching yields exactly the matching weeks', () => {
    const matching = matchWeeks(SIX, 'incomplete');
    const s = summarizeWeekSelection({ states: SIX, selected: matching, condition: 'incomplete' });
    expect(s.selected).toEqual([2, 3]);
    expect(s.selected_count).toBe(s.matching_count);
  });

  it('select-all differs from select-all-matching', () => {
    expect(matchWeeks(SIX, 'all')).toEqual([1, 2, 3]);
    expect(matchWeeks(SIX, 'incomplete')).toEqual([2, 3]);
  });

  it('a selection is deduped, sorted, and restricted to weeks that exist', () => {
    const s = summarizeWeekSelection({ states: SIX, selected: [3, 1, 3, 99] });
    expect(s.selected).toEqual([1, 3]); // 99 does not exist, 3 deduped
  });

  it('an explicit selection is NOT mutated by the active condition', () => {
    // Selecting week 1 then filtering to "incomplete" (which excludes 1) must
    // leave the selection intact — the condition drives matching, not selection.
    const s = summarizeWeekSelection({ states: SIX, selected: [1], condition: 'incomplete' });
    expect(s.selected).toEqual([1]);
    expect(s.matching_count).toBe(2);
  });

  it('no matches reports zero without error', () => {
    const s = summarizeWeekSelection({ states: SIX, selected: [], condition: 'failed' });
    expect(s.matching_count).toBe(0);
    expect(s.match_label).toBe('0 of 3 weeks match "Publish failures"');
  });
});

/* ── SKELETON VALIDATION ── */

describe('skeleton validation — reports, never silently fixes', () => {
  const requests = { linkedin: { post: 2, carousel: 1 } }; // 3 per week

  it('a matching skeleton validates clean', () => {
    const s = states([
      act('a', 1, { content_type: 'post' }), act('b', 1, { content_type: 'post' }), act('c', 1, { content_type: 'carousel' }),
    ], [], 1);
    const v = validateSkeleton({ platformContentRequests: requests, states: s });
    expect(v.ok).toBe(true);
    expect(v.declared_per_week).toBe(3);
    expect(v.issues).toEqual([]);
  });

  it('detects a frequency SHORTFALL (declared 3, placed 2)', () => {
    const s = states([act('a', 1, { content_type: 'post' }), act('b', 1, { content_type: 'carousel' })], [], 1);
    const v = validateSkeleton({ platformContentRequests: requests, states: s });
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ code: 'frequency_shortfall', week: 1, expected: 3, actual: 2 });
  });

  it('detects a frequency SURPLUS', () => {
    const s = states([
      act('a', 1, { content_type: 'post' }), act('b', 1, { content_type: 'post' }),
      act('c', 1, { content_type: 'carousel' }), act('d', 1, { content_type: 'post' }),
    ], [], 1);
    const v = validateSkeleton({ platformContentRequests: requests, states: s });
    expect(v.issues.some((i) => i.code === 'frequency_surplus' && i.actual === 4)).toBe(true);
  });

  it('detects a declared content type with NO slot placed for it ("video requested, no video slot")', () => {
    const s = states([act('a', 1, { content_type: 'post' })], [], 1);
    const v = validateSkeleton({ platformContentRequests: { linkedin: { video: 1 } }, states: s });
    expect(v.issues.some((i) => i.code === 'content_type_unplaced' && i.content_type === 'video')).toBe(true);
  });

  it('detects a declared platform with no slot placed for it', () => {
    const s = states([act('a', 1, { platform: 'linkedin', content_type: 'post' })], [], 1);
    const v = validateSkeleton({ platformContentRequests: { instagram: { post: 1 } }, states: s });
    expect(v.issues.some((i) => i.code === 'platform_unplaced' && i.platform === 'instagram')).toBe(true);
  });

  it('flags a declared week with no slots at all', () => {
    const s = states([act('a', 1, { content_type: 'post' }), act('b', 1, { content_type: 'post' }), act('c', 1, { content_type: 'carousel' })], [], 2);
    const v = validateSkeleton({ platformContentRequests: requests, states: s });
    expect(v.issues.some((i) => i.code === 'week_has_no_slots' && i.week === 2)).toBe(true);
  });

  it('an empty matrix is an explicit issue, not a silent pass', () => {
    const v = validateSkeleton({ platformContentRequests: null, states: states([act('a', 1)]) });
    expect(v.ok).toBe(false);
    expect(v.issues[0].code).toBe('no_platforms_declared');
  });

  it('never mutates the input states', () => {
    const s = states([act('a', 1)], [], 1);
    const before = JSON.stringify(s);
    validateSkeleton({ platformContentRequests: requests, states: s });
    expect(JSON.stringify(s)).toBe(before);
  });
});

/* ── DAY ALLOCATION ── */

describe('day allocation — Monday → LinkedIn → post', () => {
  const ACTIVITIES = [
    act('a', 1, { day: 'Monday', platform: 'linkedin', content_type: 'post' }),
    act('b', 1, { day: 'Tuesday', platform: 'linkedin', content_type: 'carousel' }),
    act('c', 1, { day: 'Wednesday', platform: 'x', content_type: 'image' }),
    act('d', 2, { day: 'Thursday', platform: 'linkedin', content_type: 'video' }),
  ];

  it('projects day → platform → content type in week order', () => {
    const rows = deriveDayAllocation({ plan: plan(ACTIVITIES), week: 1 });
    expect(rows).toEqual([
      { day: 'Monday', platform: 'linkedin', content_type: 'post', count: 1 },
      { day: 'Tuesday', platform: 'linkedin', content_type: 'carousel', count: 1 },
      { day: 'Wednesday', platform: 'x', content_type: 'image', count: 1 },
    ]);
  });

  it('scopes to the requested week', () => {
    expect(deriveDayAllocation({ plan: plan(ACTIVITIES), week: 2 }))
      .toEqual([{ day: 'Thursday', platform: 'linkedin', content_type: 'video', count: 1 }]);
  });

  it('aggregates repeats on the same day/platform/type', () => {
    const rows = deriveDayAllocation({
      plan: plan([act('a', 1, { day: 'Monday' }), act('b', 1, { day: 'Monday' })]), week: 1,
    });
    expect(rows).toEqual([{ day: 'Monday', platform: 'linkedin', content_type: 'post', count: 2 }]);
  });

  it('covers the whole campaign when no week is given', () => {
    expect(deriveDayAllocation({ plan: plan(ACTIVITIES) })).toHaveLength(4);
  });

  it('tolerates empty input', () => {
    expect(deriveDayAllocation({ plan: null })).toEqual([]);
    expect(deriveCampaignWeekStates({ plan: null })).toEqual([]);
  });
});
