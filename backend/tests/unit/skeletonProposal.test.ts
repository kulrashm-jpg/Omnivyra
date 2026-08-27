/**
 * P4.1 — AI skeleton proposal + deterministic skeleton impact.
 *
 * Two invariants under test:
 *
 *   1. AI MAY PROPOSE, THE CMO COMMITS. The proposal is a value derived from
 *      an HTTP response; reading, editing, validating or regenerating it
 *      cannot touch canonical planner_state, because none of these functions
 *      can write anything.
 *
 *   2. IMPACT IS DERIVED, NEVER STORED. A skeleton change produces a report
 *      recomputed from existing facts — no invalidation flag, no automatic
 *      deletion, no silent unscheduling.
 */

import {
  readSkeletonProposal,
  applyProposalEdit,
  validateProposal,
  proposalToPlanLike,
  deriveSkeletonImpact,
  describeAtRiskWork,
} from '../../../lib/campaign/skeletonProposal';
import type { CampaignAssignment } from '../../../lib/campaign/campaignAssignments';

/* ── fixtures ── */

/** An ai/plan-shaped week. */
const aiWeek = (week: number, items: Array<Record<string, unknown>>) => ({
  week,
  theme: `Week ${week}`,
  daily_execution_items: items,
});

const item = (day: string, platform: string, content_type: string) => ({ day, platform, content_type });

const AI_RESPONSE_WEEKS = [
  aiWeek(1, [item('Monday', 'linkedin', 'post'), item('Wednesday', 'x', 'post')]),
  aiWeek(2, [item('Monday', 'linkedin', 'post'), item('Wednesday', 'x', 'post')]),
];

/** A committed planner calendar_plan. */
const act = (id: string, week: number, day: string, platform: string, content_type: string, over: Record<string, unknown> = {}) => ({
  execution_id: id, week_number: week, day, platform, content_type, title: id, ...over,
});
const plan = (activities: Array<Record<string, unknown>>) => ({ activities } as never);

const approvedText = { draft_content: { body: 'approved copy', source: 'ai', updated_at: 'x' }, content_planning_status: 'approved' };
const draftText = { draft_content: { body: 'wip', source: 'ai', updated_at: 'x' }, content_planning_status: 'draft' };

const assign = (over: Partial<CampaignAssignment> = {}): CampaignAssignment => ({
  id: 'as-1', campaign_id: 'c', asset_id: 'a-1', asset_version: 1,
  structure_id: 's1', week: 1, day: 'Monday', platform: 'linkedin',
  content_type: 'image', slot: 'primary', status: 'confirmed', notes: '', ordering: 0,
  created_at: 'x', updated_at: 'x', ...over,
} as CampaignAssignment);

/* ────────────────────────────────────────────────────────────────────────
 * PROPOSAL
 * ──────────────────────────────────────────────────────────────────────── */

describe('reading an AI plan into a proposal', () => {
  const proposal = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS, startDate: '2026-09-01', campaignType: 'TEXT' });

  it('derives duration, platforms and slot count from what the plan contains', () => {
    expect(proposal.duration_weeks).toBe(2);
    expect(proposal.platforms).toEqual(['linkedin', 'x']);
    expect(proposal.slot_count).toBe(4);
  });

  it('derives the PER-WEEK matrix (not the whole-plan totals)', () => {
    // 2 linkedin posts across 2 weeks = 1 per week.
    expect(proposal.platform_content_requests).toEqual({
      linkedin: { post: 1 }, x: { post: 1 },
    });
  });

  it('carries start date and campaign type through unchanged', () => {
    expect(proposal.start_date).toBe('2026-09-01');
    expect(proposal.campaign_type).toBe('TEXT');
  });

  it('uses ONLY canonical skeleton vocabulary — no invented fields', () => {
    expect(Object.keys(proposal).sort()).toEqual([
      'campaign_type', 'duration_weeks', 'platform_content_requests',
      'platforms', 'slot_count', 'start_date', 'weeks',
    ]);
  });

  it('reads the alternate `days[]` plan shape too', () => {
    const p = readSkeletonProposal({
      weeks: [{ week: 1, days: [{ day: 'Friday', activities: [{ platform: 'linkedin', content_type: 'carousel' }] }] }],
    });
    expect(p.platforms).toEqual(['linkedin']);
    expect(p.platform_content_requests).toEqual({ linkedin: { carousel: 1 } });
  });

  it('tolerates an empty or absent plan', () => {
    expect(readSkeletonProposal({ weeks: [] }).slot_count).toBe(0);
    expect(readSkeletonProposal({ weeks: null }).duration_weeks).toBeNull();
  });

  it('is deterministic', () => {
    expect(readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS }))
      .toEqual(readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS }));
  });
});

describe('the proposal is EPHEMERAL — nothing can be mutated by handling it', () => {
  it('reading does not modify the source weeks', () => {
    const source = JSON.parse(JSON.stringify(AI_RESPONSE_WEEKS));
    const before = JSON.stringify(source);
    readSkeletonProposal({ weeks: source });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('editing returns a NEW proposal and leaves the original intact', () => {
    const original = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS });
    const snapshot = JSON.stringify(original);
    const edited = applyProposalEdit(original, { remove_platforms: ['x'] });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(edited).not.toBe(original);
  });

  it('validating does not modify the proposal', () => {
    const p = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS });
    const before = JSON.stringify(p);
    validateProposal(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('the module exposes no writer — proposals cannot become canonical here', () => {
    const src = require('fs')
      .readFileSync(require('path').join(__dirname, '../../../lib/campaign/skeletonProposal.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const forbidden of ['setCalendarPlan', 'fetch(', 'supabase', 'planner_state', 'upsert', 'insert(']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('editing a proposal before acceptance', () => {
  const base = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS, startDate: '2026-09-01' });

  it('removing a platform prunes it from the matrix AND the weeks', () => {
    const edited = applyProposalEdit(base, { remove_platforms: ['x'] });
    expect(edited.platforms).toEqual(['linkedin']);
    expect(edited.platform_content_requests).toEqual({ linkedin: { post: 1 } });
    expect(edited.slot_count).toBe(2); // the x slots are genuinely gone
  });

  it('shrinking the duration truncates the proposed weeks', () => {
    const edited = applyProposalEdit(base, { duration_weeks: 1 });
    expect(edited.duration_weeks).toBe(1);
    expect(edited.weeks).toHaveLength(1);
    expect(edited.slot_count).toBe(2);
  });

  it('growing the duration leaves the extra weeks unplanned (validation reports it)', () => {
    const edited = applyProposalEdit(base, { duration_weeks: 4 });
    expect(edited.duration_weeks).toBe(4);
    expect(edited.weeks).toHaveLength(2); // not fabricated
    const v = validateProposal(edited);
    expect(v.issues.some((i) => i.code === 'week_has_no_slots')).toBe(true);
  });

  it('an explicit matrix from the CMO wins over the derived one', () => {
    const edited = applyProposalEdit(base, { platform_content_requests: { linkedin: { carousel: 3 } } });
    expect(edited.platform_content_requests).toEqual({ linkedin: { carousel: 3 } });
    expect(edited.platforms).toEqual(['linkedin']);
  });

  it('start date and campaign type are editable', () => {
    const edited = applyProposalEdit(base, { start_date: '2026-10-01', campaign_type: 'HYBRID' });
    expect(edited.start_date).toBe('2026-10-01');
    expect(edited.campaign_type).toBe('HYBRID');
  });

  it('edits compose — the ACCEPTED structure is the edited one, not the AI output', () => {
    const edited = applyProposalEdit(
      applyProposalEdit(base, { remove_platforms: ['x'] }),
      { duration_weeks: 1 },
    );
    expect(edited.platforms).toEqual(['linkedin']);
    expect(edited.weeks).toHaveLength(1);
    expect(edited.slot_count).toBe(1);
  });

  it('an empty edit is a no-op', () => {
    expect(applyProposalEdit(base, {})).toEqual(base);
  });
});

describe('proposal validation uses the SAME validator as the committed skeleton', () => {
  it('a coherent proposal validates clean', () => {
    const p = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS });
    expect(validateProposal(p).ok).toBe(true);
  });

  it('an inconsistent proposal is REPORTED, never silently repaired', () => {
    const p = applyProposalEdit(
      readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS }),
      { platform_content_requests: { linkedin: { post: 5 } } }, // declares 5/wk, plan places 2
    );
    const v = validateProposal(p);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'frequency_shortfall')).toBe(true);
    // The proposal itself is untouched — the CMO sees what AI proposed.
    expect(p.platform_content_requests).toEqual({ linkedin: { post: 5 } });
  });

  it('a declared platform the plan never places is reported', () => {
    const p = applyProposalEdit(
      readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS }),
      { platform_content_requests: { instagram: { post: 1 } } },
    );
    expect(validateProposal(p).issues.some((i) => i.code === 'platform_unplaced')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * IMPACT
 * ──────────────────────────────────────────────────────────────────────── */

describe('skeleton impact — derived, never stored', () => {
  const current = plan([
    act('s1', 1, 'Monday', 'linkedin', 'post', approvedText),
    act('s2', 1, 'Wednesday', 'x', 'post', draftText),
    act('s3', 2, 'Monday', 'linkedin', 'post', draftText),
  ]);

  it('an identical candidate is clean — nothing disturbed', () => {
    const impact = deriveSkeletonImpact({ current, candidate: current });
    expect(impact.clean).toBe(true);
    expect(impact.affected_weeks).toEqual([]);
    expect(impact.counts.unaffected).toBe(3);
    expect(impact.summary).toMatch(/No downstream changes/);
  });

  it('DAY MOVEMENT marks the moved slot contradictory and the new one missing', () => {
    const candidate = plan([
      act('s1', 1, 'Tuesday', 'linkedin', 'post'),   // moved Mon → Tue
      act('s2', 1, 'Wednesday', 'x', 'post'),
      act('s3', 2, 'Monday', 'linkedin', 'post'),
    ]);
    const impact = deriveSkeletonImpact({ current, candidate });
    expect(impact.clean).toBe(false);
    expect(impact.counts.contradictory).toBe(1);
    expect(impact.counts.missing).toBe(1);
    expect(impact.affected_weeks).toEqual([1]);
  });

  it('CONTENT-TYPE change is contradictory', () => {
    const candidate = plan([
      act('s1', 1, 'Monday', 'linkedin', 'carousel'),
      act('s2', 1, 'Wednesday', 'x', 'post'),
      act('s3', 2, 'Monday', 'linkedin', 'post'),
    ]);
    expect(deriveSkeletonImpact({ current, candidate }).counts.contradictory).toBe(1);
  });

  it('PLATFORM change is contradictory', () => {
    const candidate = plan([
      act('s1', 1, 'Monday', 'instagram', 'post'),
      act('s2', 1, 'Wednesday', 'x', 'post'),
      act('s3', 2, 'Monday', 'linkedin', 'post'),
    ]);
    expect(deriveSkeletonImpact({ current, candidate }).counts.contradictory).toBe(1);
  });

  it('WEEK REDUCTION orphans the slots in removed weeks', () => {
    const candidate = plan([
      act('s1', 1, 'Monday', 'linkedin', 'post'),
      act('s2', 1, 'Wednesday', 'x', 'post'),
    ]); // week 2 gone
    const impact = deriveSkeletonImpact({ current, candidate });
    expect(impact.counts.orphaned).toBe(1);
    expect(impact.weeks.find((w) => w.week === 2)!.category).toBe('orphaned');
    expect(impact.affected_weeks).toEqual([2]);
  });

  it('WEEK EXTENSION only adds missing placements — existing slots stay unaffected', () => {
    const candidate = plan([
      act('s1', 1, 'Monday', 'linkedin', 'post'),
      act('s2', 1, 'Wednesday', 'x', 'post'),
      act('s3', 2, 'Monday', 'linkedin', 'post'),
      act('s4', 3, 'Monday', 'linkedin', 'post'),
    ]);
    const impact = deriveSkeletonImpact({ current, candidate });
    expect(impact.counts.unaffected).toBe(3);
    expect(impact.counts.contradictory).toBe(0);
    expect(impact.missing_count).toBe(1);
    expect(impact.affected_weeks).toEqual([3]);
  });

  it('FREQUENCY increase shows as missing placements, not as damage', () => {
    const candidate = plan([
      act('s1', 1, 'Monday', 'linkedin', 'post'),
      act('s2', 1, 'Wednesday', 'x', 'post'),
      act('n1', 1, 'Friday', 'linkedin', 'post'),
      act('s3', 2, 'Monday', 'linkedin', 'post'),
    ]);
    const impact = deriveSkeletonImpact({ current, candidate });
    expect(impact.missing_count).toBe(1);
    expect(impact.counts.contradictory).toBe(0);
  });

  it('an UNAFFECTED sibling in an affected week is still reported unaffected', () => {
    const candidate = plan([
      act('s1', 1, 'Tuesday', 'linkedin', 'post'), // week 1 disturbed
      act('s2', 1, 'Wednesday', 'x', 'post'),      // sibling untouched
      act('s3', 2, 'Monday', 'linkedin', 'post'),
    ]);
    const impact = deriveSkeletonImpact({ current, candidate });
    const sibling = impact.slots.find((s) => s.structure_id === 's2')!;
    expect(sibling.category).toBe('unaffected');
    // The WEEK is affected, but the sibling slot is not.
    expect(impact.affected_weeks).toEqual([1]);
  });

  it('non-contiguous affected weeks are reported exactly', () => {
    const wide = plan([
      act('a', 1, 'Monday', 'linkedin', 'post'),
      act('b', 2, 'Monday', 'linkedin', 'post'),
      act('c', 3, 'Monday', 'linkedin', 'post'),
      act('d', 4, 'Monday', 'linkedin', 'post'),
    ]);
    const candidate = plan([
      act('a', 1, 'Monday', 'linkedin', 'post'),
      act('b', 2, 'Friday', 'linkedin', 'post'),   // changed
      act('c', 3, 'Monday', 'linkedin', 'post'),
      act('d', 4, 'Friday', 'linkedin', 'post'),   // changed
    ]);
    expect(deriveSkeletonImpact({ current: wide, candidate }).affected_weeks).toEqual([2, 4]);
  });

  it('is deterministic', () => {
    const candidate = plan([act('s1', 1, 'Tuesday', 'linkedin', 'post')]);
    expect(deriveSkeletonImpact({ current, candidate }))
      .toEqual(deriveSkeletonImpact({ current, candidate }));
  });

  it('tolerates absent input', () => {
    expect(deriveSkeletonImpact({ current: null, candidate: null }).clean).toBe(true);
  });
});

/* ── SAFETY: released / approved / assigned ── */

describe('released and scheduled work is protected, not rewritten', () => {
  const currentReleased = plan([act('s1', 1, 'Monday', 'linkedin', 'post', approvedText)]);
  const released = [assign({ structure_id: 's1', scheduled_post_id: 'sp-1' })];

  it('a change to a RELEASED slot is a release_conflict, outranking contradictory', () => {
    const candidate = plan([act('s1', 1, 'Tuesday', 'linkedin', 'post')]);
    const impact = deriveSkeletonImpact({ current: currentReleased, candidate, assignments: released });
    const slot = impact.slots.find((s) => s.structure_id === 's1')!;
    expect(slot.category).toBe('release_conflict');
    expect(slot.released).toBe(true);
    expect(impact.release_conflict_count).toBe(1);
    expect(impact.summary).toMatch(/already scheduled — needs review/);
  });

  it('an UNCHANGED released slot is not flagged', () => {
    const impact = deriveSkeletonImpact({ current: currentReleased, candidate: currentReleased, assignments: released });
    expect(impact.slots[0].category).toBe('unaffected');
    expect(impact.release_conflict_count).toBe(0);
  });

  it('the impact never recommends deleting or unscheduling anything', () => {
    const candidate = plan([act('s1', 1, 'Tuesday', 'linkedin', 'post')]);
    const impact = deriveSkeletonImpact({ current: currentReleased, candidate, assignments: released });
    const text = JSON.stringify(impact).toLowerCase();
    for (const destructive of ['delete', 'unschedule', 'revoke', 'remove approval']) {
      expect(text).not.toContain(destructive);
    }
  });
});

describe('at-risk work is named so nothing is destroyed silently', () => {
  const current = plan([
    act('approved', 1, 'Monday', 'linkedin', 'post', approvedText),
    act('drafty', 1, 'Tuesday', 'linkedin', 'post', draftText),
    act('assigned', 1, 'Wednesday', 'linkedin', 'post', draftText),
    act('shipped', 1, 'Thursday', 'linkedin', 'post', approvedText),
  ]);
  const assignments = [
    assign({ id: 'a1', structure_id: 'assigned' }),
    assign({ id: 'a2', structure_id: 'shipped', scheduled_post_id: 'sp-9' }),
  ];
  // Everything moves to Friday ⇒ every slot is disturbed.
  const candidate = plan([
    act('approved', 1, 'Friday', 'linkedin', 'post'),
    act('drafty', 1, 'Friday', 'linkedin', 'post'),
    act('assigned', 1, 'Friday', 'linkedin', 'post'),
    act('shipped', 1, 'Friday', 'linkedin', 'post'),
  ]);
  const risk = describeAtRiskWork(deriveSkeletonImpact({ current, candidate, assignments }));

  it('approved content is named, never listed as safe to regenerate', () => {
    expect(risk.approved_content.map((s) => s.structure_id)).toEqual(expect.arrayContaining(['approved']));
    expect(risk.safe_to_regenerate.map((s) => s.structure_id)).not.toContain('approved');
  });

  it('slots with assignments are named and excluded from safe regeneration', () => {
    expect(risk.with_assignments.map((s) => s.structure_id)).toEqual(expect.arrayContaining(['assigned']));
    expect(risk.safe_to_regenerate.map((s) => s.structure_id)).not.toContain('assigned');
  });

  it('released slots are named and excluded', () => {
    expect(risk.released.map((s) => s.structure_id)).toEqual(['shipped']);
    expect(risk.safe_to_regenerate.map((s) => s.structure_id)).not.toContain('shipped');
  });

  it('ONLY draft, unassigned, unreleased slots are safe to regenerate', () => {
    expect(risk.safe_to_regenerate.map((s) => s.structure_id)).toEqual(['drafty']);
  });

  it('assignments are reported, never reassigned (the impact carries counts only)', () => {
    const impact = deriveSkeletonImpact({ current, candidate, assignments });
    const slot = impact.slots.find((s) => s.structure_id === 'assigned')!;
    expect(slot.assignment_count).toBe(1);
    expect(Object.keys(slot)).not.toContain('new_structure_id');
  });
});

/* ── ARCHITECTURE CONTRACT (§31) ── */

describe('P4.1 introduced no new model', () => {
  /** Comment-free source: the module's own docblock NAMES the forbidden
   *  vocabulary to explain why it is absent, which must not read as the
   *  vocabulary existing. Scan CODE only. */
  const src = () => require('fs')
    .readFileSync(require('path').join(__dirname, '../../../lib/campaign/skeletonProposal.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('no second skeleton persistence vocabulary exists', () => {
    const s = src();
    for (const forbidden of ['draft_skeleton', 'proposed_skeleton', 'ai_skeleton', 'skeleton_versions']) {
      expect(s).not.toContain(forbidden);
    }
  });

  it('no invalidation state is persisted — impact is recomputed on demand', () => {
    const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(s).not.toMatch(/invalidated\s*[:=]/);
    expect(s).not.toContain('is_stale');
  });

  it('proposalToPlanLike reuses the existing plan shape, not a new one', () => {
    const p = readSkeletonProposal({ weeks: AI_RESPONSE_WEEKS });
    const planLike = proposalToPlanLike(p) as { activities?: unknown[] };
    expect(Array.isArray(planLike.activities)).toBe(true);
    expect(Object.keys(planLike)).toEqual(['activities']);
  });
});
