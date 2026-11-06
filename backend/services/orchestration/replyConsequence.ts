/**
 * Prompt 5 — the reply consequence matrix: what an inbound signal does to a journey.
 *
 * PURE and deterministic: it reads nothing, writes nothing, calls nothing, and the same input
 * always gives the same consequence. It covers the SC-7 draft codes (`sc7-draft-1`,
 * docs/outreach/platform/SHARED-CONTRACTS-D4.md §2.1), the operational events (hard bounce,
 * soft bounce, delivery, reject, unmapped) and abstention.
 *
 * NOT WIRED. SC7-R is unratified: every inbound reply still pauses the run for a person
 * (Prompt 4, R1), and no classifier output changes a journey or PI. Nothing in the sweeper,
 * an engine adapter or a journey module imports this; its only importer is
 * replyClassificationAdapter.ts, behind a flag that defaults OFF (a guard test pins both).
 *
 * ─── PRECEDENCE (Prompt 4's, journeyResponses.assessJourneyResponse), first match wins ──
 *   1. a canonical restriction that ends a run: complaint, then unsubscribe → `exit`, by
 *      governance (the same two as journeyResponses.RESTRICTION_EXITS; a test pins that);
 *   2. any other canonical restriction in force (dnc, consent withdrawn, hard bounce,
 *      invalid contact, ...) → `suspend`: governance refuses the contact, and as in Prompt 4
 *      it does not end the run on its own;
 *   3. a refusing control (kill switch, tenant or channel off) → `suspend`;
 *   4. only then the signal:
 *      - an operational event: a transport fact, never a business outcome;
 *      - abstention (no classification) → `suspend`, the R1 default: a person evaluates;
 *      - a classification: a deterministic governance class in it (complaint > stop >
 *        unsubscribe) → `route_to_human` for review BEFORE any label is read (Q-1: a phrase
 *        match goes to an operator before anything is recorded); else the most restrictive
 *        consequence among its labels.
 *
 * ─── INVARIANTS (the table tests pin each) ─────────────────────────────────
 *   - A classifier label can NEVER exit a journey. Only governance (step 1) or a person
 *     (journeyReplyEvaluation) ends a run; `endedBy` is `governance` on every exit.
 *   - No label overrides STOP, complaint, unsubscribe or a bounce: those are decided at
 *     steps 1-3, or as a governance class / operational event, before any label is read.
 *   - A classifier `not_interested` is never `rejected`: rejection needs a person.
 *   - A meeting request is `replied`, never `meeting_booked`.
 *   - Out-of-office, bounce and complaint are not business outcomes (`businessOutcome` null).
 *   - No label `continue`s a journey by itself: the least it does is `retime`.
 */

import {
  CANONICAL_CLASSIFICATION_CODES, isCanonicalClassificationCode,
  type CanonicalClassificationCode, type GovernanceClassificationCode,
} from '../engagementClassification/vocabulary';

export const REPLY_CONSEQUENCE_VERSION = 'p5.reply-consequence.v1';

export const JOURNEY_CONSEQUENCES = ['continue', 'retime', 'suspend', 'route_to_human', 'exit'] as const;
export type JourneyConsequence = typeof JOURNEY_CONSEQUENCES[number];

export const OPERATIONAL_EVENTS = ['hard_bounce', 'soft_bounce', 'delivery', 'reject', 'unmapped'] as const;
export type OperationalEvent = typeof OPERATIONAL_EVENTS[number];

export const ABSTENTION_REASONS = ['classification_disabled', 'no_content', 'classifier_unavailable', 'unsupported_channel'] as const;
export type AbstentionReason = typeof ABSTENTION_REASONS[number];

export type HumanAction =
  | 'sales_follow_up' | 'support' | 'governance_review' | 'contact_point_review' | 'decline_review' | 'delivery_review';

export type ReplySignal =
  | {
    readonly kind: 'classification';
    /** classifyMessage's primary code. */
    readonly code: string;
    /** Every class it found, governance first. Defaults to `[code]`. */
    readonly labels?: readonly string[];
    /** The deterministic detector's governance classes. */
    readonly governance: readonly string[];
  }
  | { readonly kind: 'operational'; readonly event: string }
  | { readonly kind: 'abstain'; readonly reason: string };

export interface ReplyConsequenceInput {
  readonly signal: ReplySignal;
  /** Canonical restriction types in force on the person (contact_governance_records). */
  readonly restrictions: readonly string[];
  /** The central gate's refusal for the channel (journeyGovernance.channelRefusal), or null. */
  readonly controlRefusal: string | null;
}

export interface ReplyConsequence {
  readonly version: string;
  readonly consequence: JourneyConsequence;
  /** The rule that decided, e.g. `governance.restriction.complaint`, `sc7.meeting_request`. */
  readonly policy: string;
  readonly reason: string;
  /** Who ends the run, on an exit only. Never a classifier. */
  readonly endedBy: 'governance' | null;
  /** The run's exit outcome, on an exit only. A journey exit reason, not a business outcome. */
  readonly exitOutcome: 'complained' | 'unsubscribed' | null;
  /** What the signal would mean as a business outcome. Never fed to PI this round (P-1 = a). */
  readonly businessOutcome: 'replied' | null;
  readonly humanAction: HumanAction | null;
}

/** The restrictions that END a run, most severe first. Equal to journeyResponses.RESTRICTION_EXITS. */
export const EXIT_RESTRICTIONS: ReadonlyArray<readonly ['complaint' | 'unsubscribe', 'complained' | 'unsubscribed']> = [
  ['complaint', 'complained'],
  ['unsubscribe', 'unsubscribed'],
];

/** Every other canonical restriction, in the order a reason names them. */
export const HOLDING_RESTRICTIONS = [
  'dnc_permanent', 'consent_withdrawn', 'dnc_channel', 'bounce_hard', 'invalid_contact', 'campaign_exclusion', 'deferred',
] as const;

interface Rule {
  readonly consequence: Exclude<JourneyConsequence, 'exit' | 'continue'>;
  readonly businessOutcome: 'replied' | null;
  readonly humanAction: HumanAction | null;
  readonly reason: string;
}

const human = (humanAction: HumanAction, businessOutcome: 'replied' | null, reason: string): Rule =>
  ({ consequence: 'route_to_human', businessOutcome, humanAction, reason });

/** One rule per SC-7 draft code. Exhaustive by type: a new code without a rule does not compile. */
export const LABEL_RULES: Readonly<Record<CanonicalClassificationCode, Rule>> = {
  positive_interest: human('sales_follow_up', 'replied', 'interest: a person takes the conversation over; the journey does not end on a label'),
  enquiry: human('sales_follow_up', 'replied', 'a commercial enquiry: a person answers it'),
  information_request: human('sales_follow_up', 'replied', 'a question: a person answers it'),
  pricing: human('sales_follow_up', 'replied', 'a pricing question: a person answers it'),
  meeting_request: human('sales_follow_up', 'replied', 'a meeting request is a reply, not a booked meeting; a person books it'),
  objection: human('sales_follow_up', 'replied', 'pushback: a person handles it'),
  not_interested: human('decline_review', 'replied', 'a decline is a reply; only a person records a rejection or ends the run'),
  follow_up: { consequence: 'retime', businessOutcome: 'replied', humanAction: null, reason: 'contact me later: the next follow-up waits for the return date (Q-4); with no reliable date a person decides' },
  complaint: human('governance_review', null, 'a complaint label without the detector: reviewed by a person, never enforced from a label'),
  support_request: human('support', 'replied', 'a product problem: routed to support'),
  unsubscribe: human('governance_review', null, 'an unsubscribe label without the detector: reviewed by a person, never enforced from a label'),
  stop: human('governance_review', null, 'a STOP label without the detector: reviewed by a person, never enforced from a label'),
  wrong_recipient: human('contact_point_review', null, 'the wrong person: a person reviews the contact point; no outcome'),
  out_of_office: { consequence: 'retime', businessOutcome: null, humanAction: null, reason: 'out of office: not an outcome; the next follow-up waits for the return date (Q-4); with no reliable date a person decides' },
  spam_suspicious: { consequence: 'suspend', businessOutcome: null, humanAction: null, reason: 'the inbound looks like spam: no outcome; the run waits for a person' },
  ambiguous: { consequence: 'suspend', businessOutcome: null, humanAction: null, reason: 'nothing determinable: no outcome; the run waits for a person (R1)' },
};

/** The detector's precedence (governanceDetection.GOVERNANCE_PRECEDENCE). */
const GOVERNANCE_ORDER: readonly GovernanceClassificationCode[] = ['complaint', 'stop', 'unsubscribe'];

/** How restrictive a label consequence is; the most restrictive label decides. */
const RANK: Readonly<Record<Rule['consequence'], number>> = { retime: 1, suspend: 2, route_to_human: 3 };

const out = (
  consequence: JourneyConsequence, policy: string, reason: string,
  extra: Partial<Pick<ReplyConsequence, 'endedBy' | 'exitOutcome' | 'businessOutcome' | 'humanAction'>> = {},
): ReplyConsequence => ({
  version: REPLY_CONSEQUENCE_VERSION, consequence, policy, reason,
  endedBy: extra.endedBy ?? null, exitOutcome: extra.exitOutcome ?? null,
  businessOutcome: extra.businessOutcome ?? null, humanAction: extra.humanAction ?? null,
});

function operational(event: string): ReplyConsequence {
  switch (event) {
    case 'delivery':
      return out('continue', 'operational.delivery', 'delivered: a transport fact; the journey goes on as authored');
    case 'soft_bounce':
      return out('continue', 'operational.soft_bounce', 'a transient bounce: a transport fact; no bounded re-send policy exists (a gap for Outreach), so the journey goes on as authored');
    case 'hard_bounce':
      return out('route_to_human', 'operational.hard_bounce', 'the address is undeliverable: governance refuses it; a person decides whether the journey goes on another way or ends', { humanAction: 'contact_point_review' });
    case 'reject':
      return out('route_to_human', 'operational.reject', 'the message was rejected before delivery: a person reviews it', { humanAction: 'delivery_review' });
    default:
      return out('suspend', 'operational.unmapped', 'an event that cannot be mapped never moves a journey on; the run waits for a person');
  }
}

function classification(signal: Extract<ReplySignal, { kind: 'classification' }>): ReplyConsequence {
  const gov = GOVERNANCE_ORDER.find((g) => signal.governance.includes(g)) ?? null;
  if (gov !== null) {
    return out('route_to_human', `sc7.governance_detected.${gov}`,
      `the deterministic detector found ${gov}: a person reviews it before anything is recorded (Q-1); a recorded restriction ends the run through governance, never this label`,
      { humanAction: 'governance_review' });
  }
  const labels = signal.labels !== undefined && signal.labels.length > 0 ? signal.labels : [signal.code];
  let best: { code: CanonicalClassificationCode; rule: Rule } | null = null;
  for (const raw of labels) {
    const code: CanonicalClassificationCode = isCanonicalClassificationCode(raw) ? raw : 'ambiguous';
    const rule = LABEL_RULES[code];
    if (best === null || RANK[rule.consequence] > RANK[best.rule.consequence]) best = { code, rule };
  }
  const chosen = best ?? { code: 'ambiguous' as const, rule: LABEL_RULES.ambiguous };
  return out(chosen.rule.consequence, `sc7.${chosen.code}`, chosen.rule.reason, {
    businessOutcome: chosen.rule.businessOutcome, humanAction: chosen.rule.humanAction,
  });
}

/** The journey consequence of one inbound signal. Pure; see the header for the precedence. */
export function replyConsequence(input: ReplyConsequenceInput): ReplyConsequence {
  const restrictions = Array.isArray(input.restrictions) ? input.restrictions : [];
  for (const [type, exitOutcome] of EXIT_RESTRICTIONS) {
    if (restrictions.includes(type)) {
      return out('exit', `governance.restriction.${type}`, `a ${type} restriction is in force: governance ends the run, whatever the signal says`,
        { endedBy: 'governance', exitOutcome });
    }
  }
  const holding = HOLDING_RESTRICTIONS.find((t) => restrictions.includes(t))
    ?? (restrictions.length > 0 ? 'unrecognised' : null);
  if (holding !== null) {
    return out('suspend', `governance.restriction.${holding}`, `a ${holding} restriction is in force: governance refuses the contact; nothing a signal says lifts it, and the run waits for a person`);
  }
  if (input.controlRefusal !== null && input.controlRefusal !== undefined) {
    return out('suspend', `control.${input.controlRefusal}`, `the channel is not available (${input.controlRefusal}): nothing moves, and the run waits`);
  }

  const signal = input.signal;
  if (signal === null || typeof signal !== 'object') return out('suspend', 'abstain.no_signal', 'no signal: the run waits for a person (R1)');
  if (signal.kind === 'operational') return operational(signal.event);
  if (signal.kind === 'classification') return classification(signal);
  const reason = (ABSTENTION_REASONS as readonly string[]).includes(signal.reason) ? signal.reason : 'unspecified';
  return out('suspend', `abstain.${reason}`, 'no classification: every inbound reply pauses the run for a person (R1)');
}

/** Every SC-7 draft code, for exhaustive tables. */
export const SC7_CODES: readonly CanonicalClassificationCode[] = CANONICAL_CLASSIFICATION_CODES;
