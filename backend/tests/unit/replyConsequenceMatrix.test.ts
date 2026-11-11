/**
 * Prompt 5 — the reply consequence matrix, exhaustively: every SC-7 draft code, every
 * operational event, every abstention, against every governance restriction and control.
 *
 * Pure: the module reads nothing (the DB seams throw if touched).
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('the matrix reads nothing'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('the matrix reads nothing'); } } }));

import * as fs from 'fs';
import * as path from 'path';
import {
  ABSTENTION_REASONS, EXIT_RESTRICTIONS, HOLDING_RESTRICTIONS, LABEL_RULES, OPERATIONAL_EVENTS, SC7_CODES,
  replyConsequence, type ReplyConsequenceInput, type ReplySignal,
} from '../../services/orchestration/replyConsequence';
import { CANONICAL_CLASSIFICATION_CODES, GOVERNANCE_CLASSIFICATION_CODES } from '../../services/engagementClassification/vocabulary';
import { GOVERNANCE_TYPES } from '../../services/prospectIdentity/contactGovernance';

const cls = (code: string, extra: Partial<Extract<ReplySignal, { kind: 'classification' }>> = {}): ReplySignal =>
  ({ kind: 'classification', code, governance: [], ...extra });
const run = (signal: ReplySignal, over: Partial<ReplyConsequenceInput> = {}) =>
  replyConsequence({ signal, restrictions: [], controlRefusal: null, ...over });
const view = (r: ReturnType<typeof replyConsequence>) => [r.consequence, r.policy, r.businessOutcome, r.humanAction];

/** THE MATRIX, no governance in force. [code, consequence, policy, businessOutcome, humanAction]. */
const LABEL_TABLE: ReadonlyArray<readonly [string, string, string, string | null, string | null]> = [
  ['positive_interest', 'route_to_human', 'sc7.positive_interest', 'replied', 'sales_follow_up'],
  ['enquiry', 'route_to_human', 'sc7.enquiry', 'replied', 'sales_follow_up'],
  ['information_request', 'route_to_human', 'sc7.information_request', 'replied', 'sales_follow_up'],
  ['pricing', 'route_to_human', 'sc7.pricing', 'replied', 'sales_follow_up'],
  ['meeting_request', 'route_to_human', 'sc7.meeting_request', 'replied', 'sales_follow_up'],
  ['objection', 'route_to_human', 'sc7.objection', 'replied', 'sales_follow_up'],
  ['not_interested', 'route_to_human', 'sc7.not_interested', 'replied', 'decline_review'],
  ['follow_up', 'retime', 'sc7.follow_up', 'replied', null],
  ['complaint', 'route_to_human', 'sc7.complaint', null, 'governance_review'],
  ['support_request', 'route_to_human', 'sc7.support_request', 'replied', 'support'],
  ['unsubscribe', 'route_to_human', 'sc7.unsubscribe', null, 'governance_review'],
  ['stop', 'route_to_human', 'sc7.stop', null, 'governance_review'],
  ['wrong_recipient', 'route_to_human', 'sc7.wrong_recipient', null, 'contact_point_review'],
  ['out_of_office', 'retime', 'sc7.out_of_office', null, null],
  ['spam_suspicious', 'suspend', 'sc7.spam_suspicious', null, null],
  ['ambiguous', 'suspend', 'sc7.ambiguous', null, null],
];

const OPERATIONAL_TABLE: ReadonlyArray<readonly [string, string, string, string | null]> = [
  ['delivery', 'continue', 'operational.delivery', null],
  ['soft_bounce', 'continue', 'operational.soft_bounce', null],
  ['hard_bounce', 'route_to_human', 'operational.hard_bounce', 'contact_point_review'],
  ['reject', 'route_to_human', 'operational.reject', 'delivery_review'],
  ['unmapped', 'suspend', 'operational.unmapped', null],
];

const ALL_SIGNALS: readonly ReplySignal[] = [
  ...SC7_CODES.map((c) => cls(c)),
  ...GOVERNANCE_CLASSIFICATION_CODES.map((g) => cls(g, { governance: [g] })),
  ...SC7_CODES.map((c) => cls(c, { governance: ['stop'] })),
  ...OPERATIONAL_EVENTS.map((e) => ({ kind: 'operational' as const, event: e })),
  { kind: 'operational', event: 'opened' },
  ...ABSTENTION_REASONS.map((r) => ({ kind: 'abstain' as const, reason: r })),
  cls('not_a_code'),
];

describe('the matrix covers the SC-7 draft vocabulary exactly', () => {
  it('one rule per code, no more, no fewer', () => {
    expect(Object.keys(LABEL_RULES).sort()).toEqual([...CANONICAL_CLASSIFICATION_CODES].sort());
    expect(LABEL_TABLE.map((r) => r[0]).sort()).toEqual([...CANONICAL_CLASSIFICATION_CODES].sort());
  });

  it.each(LABEL_TABLE)('%s → %s (%s), outcome %s, human %s', (code, consequence, policy, outcome, humanAction) => {
    const r = run(cls(code));
    expect(view(r)).toEqual([consequence, policy, outcome, humanAction]);
    expect(r.endedBy).toBeNull();
    expect(r.exitOutcome).toBeNull();
    expect(r.reason.length).toBeGreaterThan(10);
  });

  it('an unknown code is ambiguous: suspend', () => {
    expect(view(run(cls('not_a_code')))).toEqual(['suspend', 'sc7.ambiguous', null, null]);
  });
});

describe('operational events and abstention', () => {
  it.each(OPERATIONAL_TABLE)('%s → %s (%s)', (event, consequence, policy, humanAction) => {
    const r = run({ kind: 'operational', event });
    expect(view(r)).toEqual([consequence, policy, null, humanAction]);
    expect(r.endedBy).toBeNull();
  });

  it('an operational event outside the list is unmapped: suspend, never continue', () => {
    for (const event of ['opened', 'clicked', 'complaint', '', 'DELIVERY']) {
      expect(run({ kind: 'operational', event }).consequence).toBe('suspend');
    }
  });

  it.each(ABSTENTION_REASONS)('abstention %s → suspend (R1: every reply pauses for a person)', (reason) => {
    expect(view(run({ kind: 'abstain', reason }))).toEqual(['suspend', `abstain.${reason}`, null, null]);
  });
});

describe('governance always wins (Prompt 4 precedence)', () => {
  it('the exit restrictions are journeyResponses.RESTRICTION_EXITS exactly', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/orchestration/journeyResponses.ts'), 'utf8');
    const block = /RESTRICTION_EXITS[^=]*=\s*\{([^}]*)\}/.exec(src)![1];
    const pairs = [...block.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual(EXIT_RESTRICTIONS.map(([a, b]) => [a, b]));
  });

  it('every canonical governance type is either an exit or a holding restriction', () => {
    expect([...EXIT_RESTRICTIONS.map(([t]) => t), ...HOLDING_RESTRICTIONS].sort()).toEqual([...GOVERNANCE_TYPES].sort());
  });

  it.each(ALL_SIGNALS.map((s) => [JSON.stringify(s), s] as const))('complaint in force + %s → exit by governance (complained)', (_l, signal) => {
    const r = run(signal, { restrictions: ['complaint', 'unsubscribe'] });
    expect(r).toMatchObject({ consequence: 'exit', endedBy: 'governance', exitOutcome: 'complained', policy: 'governance.restriction.complaint', businessOutcome: null });
  });

  it.each(ALL_SIGNALS.map((s) => [JSON.stringify(s), s] as const))('unsubscribe in force + %s → exit by governance (unsubscribed)', (_l, signal) => {
    const r = run(signal, { restrictions: ['unsubscribe'], controlRefusal: 'tenant_kill_switch' });
    expect(r).toMatchObject({ consequence: 'exit', endedBy: 'governance', exitOutcome: 'unsubscribed', policy: 'governance.restriction.unsubscribe' });
  });

  it.each(HOLDING_RESTRICTIONS)('%s in force → suspend for every signal; nothing continues or retimes past it', (type) => {
    for (const signal of ALL_SIGNALS) {
      const r = run(signal, { restrictions: [type] });
      expect({ signal, c: r.consequence, p: r.policy }).toEqual({ signal, c: 'suspend', p: `governance.restriction.${type}` });
      expect(r.endedBy).toBeNull();
    }
  });

  it('an unrecognised restriction fails closed: suspend', () => {
    expect(run(cls('positive_interest'), { restrictions: ['something_new'] }).policy).toBe('governance.restriction.unrecognised');
  });

  it.each(['global_kill_switch', 'tenant_not_enabled', 'tenant_kill_switch', 'channel_not_enabled'])('control %s → suspend for every signal', (refusal) => {
    for (const signal of ALL_SIGNALS) expect(run(signal, { controlRefusal: refusal })).toMatchObject({ consequence: 'suspend', policy: `control.${refusal}` });
  });
});

describe('a deterministic governance class in the message outranks every label', () => {
  it.each(GOVERNANCE_CLASSIFICATION_CODES)('%s detected with any label → route_to_human for review, never continue/retime/exit', (g) => {
    for (const label of SC7_CODES) {
      const r = run(cls(label, { labels: [g, label], governance: [g] }));
      expect(r).toMatchObject({ consequence: 'route_to_human', policy: `sc7.governance_detected.${g}`, humanAction: 'governance_review', businessOutcome: null, endedBy: null });
    }
  });

  it('precedence complaint > stop > unsubscribe', () => {
    expect(run(cls('stop', { governance: ['unsubscribe', 'stop', 'complaint'] })).policy).toBe('sc7.governance_detected.complaint');
    expect(run(cls('stop', { governance: ['unsubscribe', 'stop'] })).policy).toBe('sc7.governance_detected.stop');
  });
});

describe('the invariants, over the whole input space', () => {
  const RESTRICTION_SETS: readonly (readonly string[])[] = [[], ...[...GOVERNANCE_TYPES].map((t) => [t]), ['bounce_hard', 'dnc_channel']];
  const CONTROLS = [null, 'tenant_kill_switch'];
  const all = () => {
    const out: Array<{ input: ReplyConsequenceInput; r: ReturnType<typeof replyConsequence> }> = [];
    for (const signal of ALL_SIGNALS) for (const restrictions of RESTRICTION_SETS) for (const controlRefusal of CONTROLS) {
      const input = { signal, restrictions, controlRefusal };
      out.push({ input, r: replyConsequence(input) });
    }
    return out;
  };

  it('only governance ends a run: every exit is a complaint or unsubscribe restriction', () => {
    for (const { input, r } of all()) {
      if (r.consequence === 'exit') {
        expect(r.endedBy).toBe('governance');
        expect(input.restrictions.some((t) => t === 'complaint' || t === 'unsubscribe')).toBe(true);
      } else {
        expect(r.endedBy).toBeNull();
      }
    }
  });

  it('a classifier label never exits, and no label continues a journey by itself', () => {
    for (const { input, r } of all()) {
      if (input.signal.kind === 'classification' && input.restrictions.length === 0) {
        expect(r.consequence).not.toBe('exit');
        expect(r.consequence).not.toBe('continue');
      }
    }
  });

  it('the business outcome is only ever `replied` or nothing: never rejected, meeting_booked, complained or unsubscribed', () => {
    for (const { r } of all()) expect([null, 'replied']).toContain(r.businessOutcome);
    expect(run(cls('not_interested')).businessOutcome).toBe('replied');
    expect(run(cls('meeting_request')).businessOutcome).toBe('replied');
    for (const c of ['out_of_office', 'complaint']) expect(run(cls(c)).businessOutcome).toBeNull();
    for (const e of ['hard_bounce', 'soft_bounce']) expect(run({ kind: 'operational', event: e }).businessOutcome).toBeNull();
  });

  it('no label overrides STOP, complaint, unsubscribe or bounce', () => {
    for (const label of SC7_CODES) {
      expect(run(cls(label), { restrictions: ['unsubscribe'] }).consequence).toBe('exit');
      expect(run(cls(label), { restrictions: ['complaint'] }).consequence).toBe('exit');
      expect(run(cls(label), { restrictions: ['bounce_hard'] }).consequence).toBe('suspend');
      expect(run(cls(label, { governance: ['stop'] })).consequence).toBe('route_to_human');
    }
  });

  it('the most restrictive label decides among several', () => {
    expect(run(cls('out_of_office', { labels: ['out_of_office', 'positive_interest'] })).policy).toBe('sc7.positive_interest');
    expect(run(cls('follow_up', { labels: ['follow_up', 'ambiguous'] })).policy).toBe('sc7.ambiguous');
    expect(run(cls('follow_up', { labels: ['follow_up', 'out_of_office'] })).policy).toBe('sc7.follow_up');
  });

  it('deterministic: the same input always gives the same consequence', () => {
    for (const { input, r } of all()) expect(replyConsequence(input)).toEqual(r);
  });
});
