/**
 * Strategic Mix P1 — release eligibility policy (PURE).
 *
 * Locks the decision table that governs which finalized plan rows a release
 * may hand to the scheduler. Pure in / pure out: no DB, no clock, no mocks.
 *
 * The load-bearing rule is the asymmetry between "no workspace copy" (eligible
 * — the scheduler generates, exactly as it does for every BOLT campaign) and
 * "draft workspace copy" (blocked — a human started writing and did not finish).
 */

import {
  deriveReleasePlan,
  parseReleaseScope,
  type ReleaseCandidateRow,
} from '../../../lib/campaign/campaignRelease';

/** A plan row whose content envelope carries workspace copy at `status`. */
const withCopy = (
  id: string,
  week: number,
  platform: string,
  status: 'draft' | 'review' | 'approved',
  body = 'Some campaign copy.',
): ReleaseCandidateRow => ({
  id,
  week_number: week,
  platform,
  content_type: 'post',
  date: `2026-09-0${week}`,
  scheduled_time: '09:00:00',
  content: JSON.stringify({ draft_content: { body, source: 'ai', updated_at: 'x' }, content_planning_status: status }),
});

/** A planner placeholder row — no workspace copy at all. */
const withoutCopy = (id: string, week: number, platform: string): ReleaseCandidateRow => ({
  id,
  week_number: week,
  platform,
  content_type: 'post',
  date: `2026-09-0${week}`,
  scheduled_time: '10:00:00',
  content: JSON.stringify({ placeholder: true }),
});

describe('content lifecycle gating (SPEC-004 adoption ladder at the release boundary)', () => {
  it('APPROVED copy is releasable and counted as adopted', () => {
    const plan = deriveReleasePlan([withCopy('a', 1, 'linkedin', 'approved')], { kind: 'campaign' });
    expect(plan.eligible_ids).toEqual(['a']);
    expect(plan.approved_count).toBe(1);
    expect(plan.generate_count).toBe(0);
  });

  it('REVIEW copy is BLOCKED — review universally means "not yet approved"', () => {
    const plan = deriveReleasePlan([withCopy('a', 1, 'linkedin', 'review')], { kind: 'campaign' });
    expect(plan.eligible_ids).toEqual([]);
    expect(plan.skipped_by_reason.content_in_review).toBe(1);
    expect(plan.skipped[0]).toMatchObject({ id: 'a', reason: 'content_in_review' });
  });

  it('DRAFT copy is BLOCKED', () => {
    const plan = deriveReleasePlan([withCopy('a', 1, 'linkedin', 'draft')], { kind: 'campaign' });
    expect(plan.eligible_ids).toEqual([]);
    expect(plan.skipped_by_reason.content_in_draft).toBe(1);
  });

  it('a row with NO workspace copy IS releasable — the scheduler generates for it', () => {
    const plan = deriveReleasePlan([withoutCopy('a', 1, 'linkedin')], { kind: 'campaign' });
    expect(plan.eligible_ids).toEqual(['a']);
    expect(plan.approved_count).toBe(0);
    expect(plan.generate_count).toBe(1);
  });

  it('an unparseable envelope degrades to "no copy", never throws', () => {
    const row: ReleaseCandidateRow = { id: 'a', week_number: 1, platform: 'x', content: '{not json' };
    expect(() => deriveReleasePlan([row], { kind: 'campaign' })).not.toThrow();
    expect(deriveReleasePlan([row], { kind: 'campaign' }).eligible_ids).toEqual(['a']);
  });

  it('a row already carrying a scheduled post is skipped as already released', () => {
    const row = { ...withCopy('a', 1, 'linkedin', 'approved'), scheduled_post_id: 'sp-1' };
    const plan = deriveReleasePlan([row], { kind: 'campaign' });
    expect(plan.eligible_ids).toEqual([]);
    expect(plan.skipped_by_reason.already_scheduled).toBe(1);
  });

  it('mixed campaign: approved + placeholder release; draft + review do not', () => {
    const plan = deriveReleasePlan(
      [
        withCopy('approved-1', 1, 'linkedin', 'approved'),
        withCopy('review-1', 1, 'x', 'review'),
        withCopy('draft-1', 2, 'linkedin', 'draft'),
        withoutCopy('empty-1', 2, 'instagram'),
      ],
      { kind: 'campaign' },
    );
    expect(plan.eligible_ids.sort()).toEqual(['approved-1', 'empty-1']);
    expect(plan.approved_count).toBe(1);
    expect(plan.generate_count).toBe(1);
    expect(plan.skipped_by_reason).toMatchObject({ content_in_review: 1, content_in_draft: 1 });
    expect(plan.platforms).toEqual(['instagram', 'linkedin']);
    expect(plan.eligible_weeks).toEqual([1, 2]);
  });
});

describe('scope restriction', () => {
  const rows = [
    withCopy('w1-li', 1, 'linkedin', 'approved'),
    withCopy('w2-li', 2, 'linkedin', 'approved'),
    withCopy('w2-x', 2, 'x', 'approved'),
    withCopy('w3-li', 3, 'linkedin', 'approved'),
  ];

  it('scope=campaign releases everything releasable', () => {
    expect(deriveReleasePlan(rows, { kind: 'campaign' }).eligible_ids).toEqual(['w1-li', 'w2-li', 'w2-x', 'w3-li']);
  });

  it('scope=weeks releases ONLY the named weeks', () => {
    const plan = deriveReleasePlan(rows, { kind: 'weeks', weeks: [2] });
    expect(plan.eligible_ids).toEqual(['w2-li', 'w2-x']);
    expect(plan.eligible_weeks).toEqual([2]);
    expect(plan.skipped_by_reason.out_of_scope).toBe(2);
  });

  it('scope=weeks supports several weeks at once', () => {
    expect(deriveReleasePlan(rows, { kind: 'weeks', weeks: [1, 3] }).eligible_ids).toEqual(['w1-li', 'w3-li']);
  });

  it('scope=slots releases ONLY the named slots', () => {
    const plan = deriveReleasePlan(rows, { kind: 'slots', slot_ids: ['w2-x'] });
    expect(plan.eligible_ids).toEqual(['w2-x']);
    expect(plan.skipped_by_reason.out_of_scope).toBe(3);
  });

  it('scope never overrides the lifecycle gate — an explicitly named draft slot stays blocked', () => {
    const plan = deriveReleasePlan([withCopy('d', 1, 'linkedin', 'draft')], { kind: 'slots', slot_ids: ['d'] });
    expect(plan.eligible_ids).toEqual([]);
    expect(plan.skipped_by_reason.content_in_draft).toBe(1);
  });

  it('reports weeks and slots that do not belong to the campaign', () => {
    expect(deriveReleasePlan(rows, { kind: 'weeks', weeks: [9] }).unknown_weeks).toEqual([9]);
    expect(deriveReleasePlan(rows, { kind: 'slots', slot_ids: ['nope'] }).unknown_slot_ids).toEqual(['nope']);
  });

  it('is deterministic — the same input yields an identical plan', () => {
    const a = deriveReleasePlan(rows, { kind: 'weeks', weeks: [2] });
    const b = deriveReleasePlan(rows, { kind: 'weeks', weeks: [2] });
    expect(a).toEqual(b);
  });

  it('tolerates empty and absent input', () => {
    expect(deriveReleasePlan([], { kind: 'campaign' }).eligible_ids).toEqual([]);
    expect(deriveReleasePlan(undefined, { kind: 'campaign' }).eligible_ids).toEqual([]);
  });
});

describe('scope parsing (untrusted request bodies)', () => {
  it('defaults to campaign scope', () => {
    expect(parseReleaseScope({})).toEqual({ ok: true, scope: { kind: 'campaign' } });
    expect(parseReleaseScope(undefined)).toEqual({ ok: true, scope: { kind: 'campaign' } });
  });

  it('normalizes, dedupes and sorts weeks', () => {
    const parsed = parseReleaseScope({ scope: 'weeks', weeks: [3, 1, 3] });
    expect(parsed).toEqual({ ok: true, scope: { kind: 'weeks', weeks: [1, 3] } });
  });

  it('rejects malformed weeks', () => {
    expect(parseReleaseScope({ scope: 'weeks' }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'weeks', weeks: [] }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'weeks', weeks: [0] }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'weeks', weeks: ['x'] }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'weeks', weeks: [1.5] }).ok).toBe(false);
  });

  it('rejects malformed slot ids', () => {
    expect(parseReleaseScope({ scope: 'slots' }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'slots', slot_ids: [] }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'slots', slot_ids: [''] }).ok).toBe(false);
    expect(parseReleaseScope({ scope: 'slots', slot_ids: [1] }).ok).toBe(false);
  });

  it('rejects an unknown scope rather than silently widening to the whole campaign', () => {
    const parsed = parseReleaseScope({ scope: 'everything' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/unknown scope/i);
  });
});
