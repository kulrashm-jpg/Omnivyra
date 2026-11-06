/**
 * SC-7 Q-4 — the deterministic follow-up retiming engine, on explicit fixtures.
 *
 * SC-7 is not ratified: these fixtures are structured inputs, never classifier output, and
 * the guard at the end proves no runtime module reaches the engine yet.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('the pure engine reads nothing'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('the pure engine reads nothing'); } } }));

import * as fs from 'fs';
import * as path from 'path';
import {
  decideFollowUpRetiming, retimingActionKey, zonedMidnight,
  type RetimingContext, type RetimingPolicy, type RetimingSignal,
} from '../../services/orchestration/journeyRetiming';

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const STEP = '00000000-0000-4000-8000-000000000201';
const NOW = '2026-11-05T12:00:00.000Z'; // a Thursday

const ctx = (over: Partial<RetimingContext> = {}): RetimingContext => ({
  organizationId: ORG, executionInstanceId: RUN, planStepId: STEP,
  runLifecycleState: 'active', stepState: 'pending', controlRefusal: null, consequences: [], prior: null, ...over,
});
const LONDON_WEEKDAYS = { timezone: 'Europe/London', start_hour: 9, end_hour: 17, weekdays: [1, 2, 3, 4, 5] };
const pol = (over: Partial<RetimingPolicy> = {}): RetimingPolicy => ({
  delayHours: 0, window: LONDON_WEEKDAYS, personTimezone: null, tenantTimezone: null, ...over,
});
const sig = (over: Partial<RetimingSignal> = {}): RetimingSignal => ({
  signalId: 'msg-1', kind: 'out_of_office', receivedAt: '2026-11-05T08:00:00.000Z',
  returnDate: { kind: 'date', date: '2026-11-16' }, ...over,
});
const NOTHING = { outcome: null, endsJourney: false, suppression: false, unsubscribe: false, complaint: false, channelSwitch: false };
const at = (d: ReturnType<typeof decideFollowUpRetiming>) => (d.kind === 'retime' ? d.nextEligibleAt : `${d.kind}:${d.reason}`);

describe('Q-4 — out-of-office with an explicit return date', () => {
  it('retimes to the first permitted moment at or after return + delay, and does nothing else', () => {
    const d = decideFollowUpRetiming(sig(), ctx(), pol({ delayHours: 24 }), NOW);
    // Mon 16 Nov midnight London + 24h = Tue 00:00 → the window opens Tue 09:00 (GMT = UTC).
    expect(d).toMatchObject({ kind: 'retime', nextEligibleAt: '2026-11-17T09:00:00.000Z', actionKey: retimingActionKey(ORG, RUN, STEP) });
    expect(d.effects).toEqual(NOTHING);
  });

  it('a structured instant with an offset is used as given', () => {
    const d = decideFollowUpRetiming(sig({ returnDate: { kind: 'instant', at: '2026-11-16T13:30:00+01:00' } }), ctx(), pol(), NOW);
    expect(at(d)).toBe('2026-11-16T12:30:00.000Z');
  });

  it('never a time in the past: an old return date is now, or the next permitted moment', () => {
    expect(at(decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-10-01' } }), ctx(), pol(), NOW))).toBe(NOW);
    const evening = '2026-11-05T20:00:00.000Z';
    expect(at(decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-10-01' } }), ctx(), pol(), evening))).toBe('2026-11-06T09:00:00.000Z');
  });

  it('no window configured: return + delay exactly (never before now)', () => {
    expect(at(decideFollowUpRetiming(sig(), ctx(), pol({ window: null, tenantTimezone: 'Europe/London', delayHours: 3 }), NOW))).toBe('2026-11-16T03:00:00.000Z');
  });
});

describe('Q-4 — no date, an ambiguous one: hold for a person, never invent a date', () => {
  it.each([
    ['none', { kind: 'none' }, 'return_date_missing'],
    ['ambiguous', { kind: 'ambiguous' }, 'return_date_ambiguous'],
    ['not a calendar date', { kind: 'date', date: '2026-02-30' }, 'return_date_ambiguous'],
    ['free text', { kind: 'date', date: 'next Monday' }, 'return_date_ambiguous'],
    ['an instant with no offset', { kind: 'instant', at: '2026-11-16T09:00:00' }, 'return_date_ambiguous'],
    ['more than a year away', { kind: 'date', date: '2028-01-01' }, 'return_date_implausible'],
  ])('%s → hold_for_human', (_l, returnDate, reason) => {
    const d = decideFollowUpRetiming(sig({ returnDate: returnDate as RetimingSignal['returnDate'] }), ctx(), pol(), NOW);
    expect(d).toMatchObject({ kind: 'hold_for_human', reason });
    expect(d.effects).toEqual(NOTHING);
  });

  it('a calendar date with no zone anywhere is held, not read as UTC', () => {
    expect(decideFollowUpRetiming(sig(), ctx(), pol({ window: null }), NOW)).toMatchObject({ kind: 'hold_for_human', reason: 'return_date_zone_unknown' });
  });
});

describe('Q-4 — timezones and DST', () => {
  const everyDay = (timezone: string, start = 9, end = 17) => ({ timezone, start_hour: start, end_hour: end });

  it('New York across the spring-forward boundary (8 Mar 2026)', () => {
    const before = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-03-07' } }), ctx(), pol({ window: everyDay('America/New_York') }), '2026-03-01T00:00:00.000Z');
    const after = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-03-08' } }), ctx(), pol({ window: everyDay('America/New_York') }), '2026-03-01T00:00:00.000Z');
    expect(at(before)).toBe('2026-03-07T14:00:00.000Z'); // 09:00 EST
    expect(at(after)).toBe('2026-03-08T13:00:00.000Z'); // 09:00 EDT
    // A delay that crosses the boundary is counted in real hours.
    const crossing = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-03-07' } }), ctx(), pol({ delayHours: 24, window: null, tenantTimezone: 'America/New_York' }), '2026-03-01T00:00:00.000Z');
    expect(at(crossing)).toBe('2026-03-08T05:00:00.000Z');
  });

  it('London across the fall-back boundary (25 Oct 2026): midnight BST', () => {
    expect(zonedMidnight('2026-10-25', 'Europe/London')).toBe(Date.parse('2026-10-24T23:00:00.000Z'));
    expect(zonedMidnight('2026-10-26', 'Europe/London')).toBe(Date.parse('2026-10-26T00:00:00.000Z'));
    const d = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-10-26' } }), ctx(), pol(), '2026-10-01T00:00:00.000Z');
    expect(at(d)).toBe('2026-10-26T09:00:00.000Z'); // Monday 09:00 GMT
  });

  it('a half-hour zone (Asia/Kolkata) lands on its own window start', () => {
    const d = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-11-20' } }), ctx(), pol({ window: everyDay('Asia/Kolkata', 9, 18) }), NOW);
    expect(at(d)).toBe('2026-11-20T03:30:00.000Z');
  });

  it("the person's own zone places both the date and the window, as the sweeper does", () => {
    const d = decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date: '2026-11-20' } }), ctx(), pol({ personTimezone: 'Asia/Tokyo' }), NOW);
    expect(at(d)).toBe('2026-11-20T00:00:00.000Z'); // Fri 09:00 JST
  });

  it('two tenants, same date, different zones: different instants', () => {
    const a = decideFollowUpRetiming(sig(), ctx(), pol({ window: null, tenantTimezone: 'Europe/Berlin' }), NOW);
    const b = decideFollowUpRetiming(sig(), ctx(), pol({ window: null, tenantTimezone: 'America/Los_Angeles' }), NOW);
    expect(at(a)).toBe('2026-11-15T23:00:00.000Z');
    expect(at(b)).toBe('2026-11-16T08:00:00.000Z');
  });
});

describe('Q-4 — weekends and the window', () => {
  it.each([
    ['Fri, inside the window', '2026-11-20', 12, '2026-11-20T12:00:00.000Z'],
    ['Fri, after hours → Monday', '2026-11-20', 20, '2026-11-23T09:00:00.000Z'],
    ['Saturday → Monday', '2026-11-21', 0, '2026-11-23T09:00:00.000Z'],
    ['Sunday 10:00 → Monday', '2026-11-22', 10, '2026-11-23T09:00:00.000Z'],
    ['the last minute before close is still inside', '2026-11-19', 16.5, '2026-11-19T16:30:00.000Z'],
  ])('%s', (_l, date, delayHours, expected) => {
    expect(at(decideFollowUpRetiming(sig({ returnDate: { kind: 'date', date } }), ctx(), pol({ delayHours }), NOW))).toBe(expected);
  });

  it('a window that permits nothing in two weeks is held, not guessed', () => {
    const closed = { timezone: 'Europe/London', start_hour: 9, end_hour: 17, weekdays: [] as number[] };
    expect(decideFollowUpRetiming(sig(), ctx(), pol({ window: closed }), NOW)).toMatchObject({ kind: 'hold_for_human', reason: 'no_permitted_moment' });
  });
});

describe('Q-4 — follow_up ("contact me later")', () => {
  it('retimes the same way and records replied; nothing else', () => {
    const d = decideFollowUpRetiming(sig({ kind: 'follow_up' }), ctx(), pol({ delayHours: 24 }), NOW);
    expect(d).toMatchObject({ kind: 'retime', nextEligibleAt: '2026-11-17T09:00:00.000Z' });
    expect(d.effects).toEqual({ ...NOTHING, outcome: 'replied' });
  });
  it('its own recorded reply does not supersede it', () => {
    const d = decideFollowUpRetiming(sig({ kind: 'follow_up' }), ctx({ consequences: [{ outcome: 'replied', sourceId: 'msg-1' }] }), pol(), NOW);
    expect(d.kind).toBe('retime');
  });
});

describe('Q-4 — pause, kill switch and finished journeys win', () => {
  it.each([
    ['paused run', { runLifecycleState: 'paused' }, 'run_paused'],
    ['kill switch', { controlRefusal: 'tenant_kill_switch' }, 'controls_refuse'],
    ['global kill switch', { controlRefusal: 'global_kill_switch' }, 'controls_refuse'],
    ['completed run', { runLifecycleState: 'completed' }, 'run_finished'],
    ['cancelled (ended) run', { runLifecycleState: 'cancelled' }, 'run_finished'],
    ['failed run', { runLifecycleState: 'failed' }, 'run_finished'],
    ['step completed', { stepState: 'completed' }, 'step_settled'],
    ['step skipped', { stepState: 'skipped' }, 'step_settled'],
    ['step running', { stepState: 'running' }, 'step_settled'],
  ])('%s → no_change', (_l, over, reason) => {
    for (const kind of ['out_of_office', 'follow_up'] as const) {
      const d = decideFollowUpRetiming(sig({ kind }), ctx(over as Partial<RetimingContext>), pol(), NOW);
      expect(d).toMatchObject({ kind: 'no_change', reason, nextEligibleAt: null });
      expect(d.effects).toEqual(NOTHING);
    }
  });
});

describe('Q-4 — out of order: a later answer keeps its own consequence', () => {
  it.each(['replied', 'unsubscribed', 'complained', 'rejected', 'meeting_booked', 'converted'])('a recorded %s from another message wins', (outcome) => {
    const d = decideFollowUpRetiming(sig(), ctx({ consequences: [{ outcome, sourceId: null }] }), pol(), NOW);
    expect(d).toMatchObject({ kind: 'no_change', reason: 'superseded_by_consequence' });
    expect(d.effects).toEqual(NOTHING);
  });

  it('ooo → positive reply / unsubscribe / complaint, in that order: the earlier ooo cannot override any of them', () => {
    const first = decideFollowUpRetiming(sig(), ctx(), pol(), NOW);
    expect(first.kind).toBe('retime');
    const prior = { actionKey: first.actionKey, signalId: 'msg-1', receivedAt: '2026-11-05T08:00:00.000Z', nextEligibleAt: (first as { nextEligibleAt: string }).nextEligibleAt };
    for (const outcome of ['replied', 'unsubscribed', 'complained']) {
      // The same ooo re-evaluated (a repeated sweep) after the answer: superseded, not re-applied.
      const again = decideFollowUpRetiming(sig(), ctx({ prior, consequences: [{ outcome, sourceId: 'msg-2' }] }), pol(), NOW);
      expect(again).toMatchObject({ kind: 'no_change', reason: 'superseded_by_consequence' });
    }
  });

  it('opened / clicked are not answers and do not supersede', () => {
    expect(decideFollowUpRetiming(sig(), ctx({ consequences: [{ outcome: 'opened', sourceId: null }, { outcome: 'clicked', sourceId: null }] }), pol(), NOW).kind).toBe('retime');
  });

  it('an older signal never displaces a newer one; a newer one replaces it under the SAME action', () => {
    const prior = { actionKey: retimingActionKey(ORG, RUN, STEP), signalId: 'msg-2', receivedAt: '2026-11-05T09:00:00.000Z', nextEligibleAt: '2026-11-20T09:00:00.000Z' };
    expect(decideFollowUpRetiming(sig({ signalId: 'msg-1', receivedAt: '2026-11-05T08:00:00.000Z' }), ctx({ prior }), pol(), NOW))
      .toMatchObject({ kind: 'no_change', reason: 'older_than_prior', nextEligibleAt: '2026-11-20T09:00:00.000Z' });
    const newer = decideFollowUpRetiming(sig({ signalId: 'msg-3', receivedAt: '2026-11-05T10:00:00.000Z' }), ctx({ prior }), pol(), NOW);
    expect(newer).toMatchObject({ kind: 'retime', actionKey: prior.actionKey });
  });
});

describe('Q-4 — idempotent: duplicates and repeated scheduler runs create no second action', () => {
  it('the same signal again is a duplicate carrying the one scheduled time', () => {
    const first = decideFollowUpRetiming(sig(), ctx(), pol({ delayHours: 24 }), NOW) as { actionKey: string; nextEligibleAt: string };
    const prior = { actionKey: first.actionKey, signalId: 'msg-1', receivedAt: '2026-11-05T08:00:00.000Z', nextEligibleAt: first.nextEligibleAt };
    for (const later of [NOW, '2026-11-06T12:00:00.000Z', '2026-11-10T03:00:00.000Z']) {
      expect(decideFollowUpRetiming(sig(), ctx({ prior }), pol({ delayHours: 24 }), later))
        .toMatchObject({ kind: 'no_change', reason: 'duplicate_signal', nextEligibleAt: first.nextEligibleAt, actionKey: first.actionKey });
    }
  });

  it('a repeated evaluation with the same inputs is the same decision, and one action key per step', () => {
    const runs = Array.from({ length: 5 }, () => decideFollowUpRetiming(sig(), ctx(), pol({ delayHours: 24 }), NOW));
    for (const r of runs) expect(r).toEqual(runs[0]);
    const keys = new Set(['msg-1', 'msg-2', 'msg-3'].map((id) => decideFollowUpRetiming(sig({ signalId: id }), ctx(), pol(), NOW).actionKey));
    expect(keys.size).toBe(1);
    expect(retimingActionKey(ORG, RUN, '00000000-0000-4000-8000-000000000202')).not.toBe(retimingActionKey(ORG, RUN, STEP));
    expect(retimingActionKey('00000000-0000-4000-8000-00000000000b', RUN, STEP)).not.toBe(retimingActionKey(ORG, RUN, STEP));
  });
});

describe('Q-4 — not wired until SC7-R', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(p, out); } else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  it('the only runtime importers are the operator resume route and its reply evaluation (a person-typed date), never a classifier path', () => {
    const importers = [...walk(path.join(ROOT, 'backend')), ...walk(path.join(ROOT, 'pages'))]
      .filter((f) => /journeyRetiming['"]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
    // Prompt 5: the evaluation module is called only by that route, for a person's `retime`.
    expect(importers).toEqual(['backend/services/orchestration/journeyReplyEvaluation.ts', 'pages/api/execution-instances/[id].ts']);
    const evaluation = fs.readFileSync(path.join(ROOT, 'backend/services/orchestration/journeyReplyEvaluation.ts'), 'utf8');
    expect(evaluation).not.toMatch(/engagementClassification|replyClassification|replyConsequence/);
  });

  it('not_before has exactly one writer path: deferStepUntil, called only by the resume', () => {
    const files = [...walk(path.join(ROOT, 'backend')), ...walk(path.join(ROOT, 'pages'))];
    const callers = files.filter((f) => /deferStepUntil\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
    expect(callers).toEqual(['backend/services/orchestration/journeyRetiming.ts', 'backend/services/workflowExecution/stepProgressionStore.ts']);
    const writers = files.filter((f) => /not_before\s*:/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(writers).toEqual(['backend/services/workflowExecution/stepProgressionStore.ts']);
    for (const f of files.filter((x) => x.split(path.sep).includes('engagementClassification'))) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/journeyRetiming|deferStepUntil|not_before/);
    }
  });
  it('the engine does not read the (unratified) classifier', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/orchestration/journeyRetiming.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"][^'"]*engagementClassification/);
  });
});
