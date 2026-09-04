/**
 * WS-8 (FR-24 Next Best Action · FR-25 Outreach Readiness) — what to do, and
 * whether we are permitted to do it.
 *
 * WS-6 connected the canonical spine to the engines, so `runRecommendation`
 * (LI-C207) now has evidence to reason over. What did not exist is anything
 * that turns its facet into the frozen NBA record, or that asks the canonical
 * suppression authority whether the action may happen at all. This module is
 * those two steps, and deliberately nothing else.
 *
 * ─── IT RECOMMENDS NOTHING OF ITS OWN ─────────────────────────────────────
 * C-7 froze `engines/recommendation.ts` as canonical for FR-24 and RETAINED
 * `leadActions.buildLeadActionPlan` as the live legacy read-side. This module
 * adds no third producer: it reads the `recommendations` facet the assembly
 * already built and reshapes it. There is no threshold, no action vocabulary
 * and no channel rule here — a second spelling of "what should we do" is how
 * two recommenders come to disagree.
 *
 * ─── RECOMMENDATION AND ELIGIBILITY ARE DIFFERENT QUESTIONS ───────────────
 * "What should we do" is the engine's. "May we do it" is
 * `contact_governance_records` via `mayContact`, and it OVERRIDES: a high score
 * never makes a suppressed prospect contactable. The two answers are returned
 * side by side rather than folded together, so an operator can see that a good
 * recommendation exists AND that we are not permitted to act on it.
 *
 * ─── SUPPRESSION FAILS CLOSED ─────────────────────────────────────────────
 * `loadGovernanceRecords` returns `ok: false` when the store cannot be read,
 * and its own header is explicit that a caller must fail closed — reading
 * "nobody is suppressed" from a broken query would contact people who asked us
 * not to. Unreadable governance therefore yields `not_ready`, never `ready`.
 * The legacy `suppression_entries` / `outreach_suppressions` stores are never
 * read; a test asserts it.
 *
 * ─── NOTHING IS INVENTED FOR AN UNAVAILABLE FIELD ─────────────────────────
 * The frozen NBA field set includes `objective` and `expiry`. Neither exists
 * anywhere: the engine emits a MESSAGE STRATEGY (`lead_with_trigger_event`),
 * which is not an objective, and no expiry policy is defined in the repository.
 * Both are returned null with the reason recorded, because a plausible default
 * would read downstream as a decision somebody made.
 *
 * Timing is the engine's own relative window (`within_24h`, `this_week`) passed
 * through verbatim. It is NOT converted to a timestamp: that needs a timing
 * policy nobody has written, and `Date.now()` inside a deterministic decision
 * would make the same evidence yield different answers on different days.
 *
 * ─── THE CHANNEL IS READ, NOT CHOSEN ──────────────────────────────────────
 * Suppression is evaluated per channel, so the engine's recommendation has to
 * be resolved to a governance channel. `nextChannel` is the engine's own
 * ordered vocabulary — `email`, or `email_then_call` meaning email first — so
 * the steps are split on `_then_` and matched EXACTLY against
 * `KNOWN_CHANNELS`. No resemblance mapping: `call` is not turned into `phone`,
 * it is dropped and recorded. A recommendation naming no governable channel
 * cannot be checked for suppression, so it fails closed rather than being
 * assumed permitted.
 */

import {
  mayContact,
  KNOWN_CHANNELS,
  type GovernanceChannel,
  type MayContactResult,
} from '../prospectIdentity/contactGovernance';
import {
  loadGovernanceRecords,
  type GovernanceLoadResult,
} from '../prospectIdentity/contactGovernanceRepository';
import { assembleLeadUnderstanding } from '../leadUnderstanding/engines/assembly';
import type { ProspectContextResult } from '../leadUnderstanding/prospectContext';
import type { LeadUnderstanding } from '../leadUnderstanding/types';

/** Bumped when the decision contract changes, so a stored answer traces to it. */
export const OUTREACH_READINESS_VERSION = 'ws8.1';

/** The engine's composite channel vocabulary is ordered; this is the separator. */
const CHANNEL_STEP_SEPARATOR = '_then_';

// ─────────────────────────────────────────────────────────────────────────────
// FR-24 — Next Best Action
// ─────────────────────────────────────────────────────────────────────────────

/** The frozen NBA record. Every field is read from evidence or is null. */
export interface NextBestAction {
  readonly version: string;
  readonly prospectId: string;
  readonly accountId: string | null;
  /** The canonical engine's `nextAction`. Never substituted or defaulted. */
  readonly action: string | null;
  /**
   * Null, always, and deliberately: the engine emits a MESSAGE STRATEGY, not an
   * objective, and no objective vocabulary exists in the repository.
   */
  readonly objective: null;
  readonly reason: string | null;
  /** The engine's message strategy, kept under its own name. */
  readonly messageStrategy: string | null;
  /** Verbatim from the engine. Not resolved, not inferred. */
  readonly channel: string | null;
  /** The engine's relative window. Never converted to a timestamp. */
  readonly timing: string | null;
  /** Null: no expiry policy is defined anywhere. A default would be a decision. */
  readonly expiry: null;
  readonly confidence: number | null;
  /** The `priority` dimension as the combiner produced it — abstention included. */
  readonly priority: { readonly value: number | null; readonly confidence: number; readonly abstained: boolean };
  /** Evidence ids behind the recommendation, so the claim is traceable. */
  readonly evidenceIds: readonly string[];
  /** What the engine assumed and what it could not know. */
  readonly assumptions: readonly string[];
  readonly unknowns: readonly string[];
  /** True when the engine had nothing to reason over. Then nothing is proposed. */
  readonly abstained: boolean;
}

/**
 * Reshape the canonical recommendation into the frozen NBA field set.
 *
 * Pure and total: it reads the Understanding the assembly already built and
 * calculates nothing. When the engine abstained, every proposal field is null —
 * a prospect that exists is not a reason to propose an action.
 */
export function toNextBestAction(
  built: ProspectContextResult,
  understanding: LeadUnderstanding,
): NextBestAction {
  const facet = understanding.facets.recommendations;
  const value = facet?.value ?? null;
  const trace = understanding.reasoning.find((r) => r.claim === 'next_best_action') ?? null;
  const priorityDim = understanding.score.dimensions.priority;

  const abstained = value === null;

  return {
    version: OUTREACH_READINESS_VERSION,
    prospectId: built.context.key.leadKey,
    accountId: built.context.companyId ?? null,
    action: value?.nextAction ?? null,
    objective: null,
    reason: trace ? `${trace.claim}: ${String(trace.conclusion)}` : null,
    messageStrategy: value?.nextMessage ?? null,
    channel: value?.nextChannel ?? null,
    timing: value?.nextTiming ?? null,
    expiry: null,
    confidence: facet?.confidence ?? null,
    priority: {
      value: priorityDim.value,
      confidence: priorityDim.confidence,
      abstained: priorityDim.abstained,
    },
    evidenceIds: (facet?.evidence ?? []).map((e) => e.id),
    assumptions: trace?.assumptions ?? [],
    unknowns: trace?.unknowns ?? [],
    abstained,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-25 — Outreach Readiness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ready` — an action is proposed and governance permits it.
 * `deferred` — governance says try later; the action itself is sound.
 * `blocked` — a standing instruction forbids contact. Score is irrelevant.
 * `not_ready` — we cannot act yet: nothing proposed, or something required is
 *               missing, or governance could not be read. Never optimistic.
 */
export type ReadinessState = 'ready' | 'deferred' | 'blocked' | 'not_ready';

/** A field whose absence genuinely blocks THIS action — not every empty column. */
export type RequiredMissingField =
  | 'recommended_action'
  | 'governable_channel'
  | 'contact_anchor'
  | 'readable_suppression_state';

export interface OutreachReadiness {
  readonly version: string;
  readonly prospectId: string;
  readonly accountId: string | null;
  readonly personId: string | null;
  readonly readiness: ReadinessState;
  readonly reason: string;
  /** Null: no objective vocabulary exists. See the NBA note. */
  readonly objective: null;
  /** The engine's recommendation, verbatim. Null when it abstained. */
  readonly recommendedChannel: string | null;
  /** The exact `KNOWN_CHANNELS` member suppression was evaluated on. */
  readonly governanceChannel: GovernanceChannel | null;
  /** The engine's relative window. Never a fabricated timestamp. */
  readonly recommendedTiming: string | null;
  readonly confidence: number | null;
  readonly requiredMissingFields: readonly RequiredMissingField[];
  /** Facts that shape the decision without blocking it. */
  readonly constraints: readonly string[];
  /** The canonical evaluator's verdict, verbatim. Null when it was not reached. */
  readonly suppression: MayContactResult | null;
  /** What a downstream executor may cite. PI never composes a message. */
  readonly messageContext: {
    readonly action: string | null;
    readonly messageStrategy: string | null;
    readonly evidenceIds: readonly string[];
    readonly unknowns: readonly string[];
  };
  readonly nextBestAction: NextBestAction;
}

/** Everything WS-8 reads. Both entries are another module's published seam. */
export interface OutreachReadinessPorts {
  /** The canonical governance store, tenant-scoped. Fails closed on error. */
  loadGovernance(lookup: {
    organizationId: string; personId?: string | null; target?: string | null; channel: GovernanceChannel;
  }): Promise<GovernanceLoadResult>;
  /** The assembly. Injected only so a test can drive it; never reimplemented. */
  assemble(built: ProspectContextResult): LeadUnderstanding;
}

export const defaultOutreachReadinessPorts: OutreachReadinessPorts = {
  loadGovernance: (lookup) => loadGovernanceRecords(lookup),
  assemble: (built) => assembleLeadUnderstanding(built.context).understanding,
};

export interface OutreachReadinessInput {
  /** The WS-6 context result, carrying its evidence and its gaps. */
  readonly built: ProspectContextResult;
  /** Recipient address for target-anchored governance, when the caller has one. */
  readonly target?: string | null;
  /** Injected. The deterministic decision instant. */
  readonly now: string;
}

/**
 * Resolve the engine's channel recommendation to a governance channel.
 *
 * `nextChannel` is an ORDERED step list in the engine's own vocabulary, so the
 * steps are split and matched EXACTLY against `KNOWN_CHANNELS`; the first
 * governable step is the one suppression is evaluated on, because it is the one
 * that would be used first. A step with no exact match is DROPPED and reported,
 * never mapped to something it resembles.
 */
export function resolveGovernanceChannel(recommended: string | null): {
  channel: GovernanceChannel | null; ungovernableSteps: string[];
} {
  const steps = (recommended ?? '').split(CHANNEL_STEP_SEPARATOR).map((s) => s.trim()).filter(Boolean);
  const known = (KNOWN_CHANNELS as readonly string[]);
  const governable = steps.filter((s) => known.includes(s));
  return {
    channel: governable[0] ?? null,
    ungovernableSteps: steps.filter((s) => !known.includes(s)),
  };
}

/**
 * Decide whether this Prospect is ready for outreach, and say why.
 *
 * PI decides WHAT and WHETHER. Outreach Automation decides HOW and WHEN and
 * performs the send: nothing here creates a campaign, composes a message,
 * schedules, retries or dispatches anything.
 *
 * Deterministic for identical evidence and `now`: it reads, evaluates and
 * returns. No clock, no random value, no write.
 */
export async function assessOutreachReadiness(
  input: OutreachReadinessInput,
  ports: OutreachReadinessPorts = defaultOutreachReadinessPorts,
): Promise<OutreachReadiness> {
  const { built } = input;
  const organizationId = built.context.key.companyId;
  if (!organizationId?.trim()) {
    throw new Error('organizationId is required to assess outreach readiness');
  }
  if (!input.now?.trim()) {
    throw new Error('now is required — outreach readiness is never anchored to ambient time');
  }

  const understanding = ports.assemble(built);
  const nba = toNextBestAction(built, understanding);
  const personId = built.evidence.engagement?.personId ?? null;

  const missing: RequiredMissingField[] = [];
  const constraints: string[] = [];

  // The WS-6 gaps are constraints, not blockers: they explain a weak or absent
  // recommendation, and the engine has already accounted for them by abstaining.
  for (const gap of built.gaps) constraints.push(`context:${gap.kind}`);

  const base = {
    version: OUTREACH_READINESS_VERSION,
    prospectId: nba.prospectId,
    accountId: nba.accountId,
    personId,
    objective: null as null,
    recommendedChannel: nba.channel,
    recommendedTiming: nba.timing,
    confidence: nba.confidence,
    nextBestAction: nba,
    messageContext: {
      action: nba.action,
      messageStrategy: nba.messageStrategy,
      evidenceIds: nba.evidenceIds,
      unknowns: nba.unknowns,
    },
  };

  // ── NOTHING PROPOSED ⇒ NOT READY ────────────────────────────────────────
  // Abstention is preserved, never converted into a default action. There is
  // no outreach to be ready for.
  if (nba.abstained || !nba.action) {
    missing.push('recommended_action');
    return {
      ...base,
      readiness: 'not_ready',
      reason: 'the canonical recommendation engine abstained — there is no proposed action to be ready for',
      governanceChannel: null,
      requiredMissingFields: missing,
      constraints,
      suppression: null,
    };
  }

  // ── CHANNEL ─────────────────────────────────────────────────────────────
  const { channel, ungovernableSteps } = resolveGovernanceChannel(nba.channel);
  for (const step of ungovernableSteps) constraints.push(`ungovernable_channel_step:${step}`);

  if (!channel) {
    // Suppression is evaluated per channel. With no governable channel there is
    // no suppression verdict to be had, so this fails CLOSED rather than
    // assuming permission on a channel we cannot check.
    missing.push('governable_channel');
    return {
      ...base,
      readiness: 'not_ready',
      reason: `'${nba.channel}' names no governance channel, so suppression cannot be evaluated for it`,
      governanceChannel: null,
      requiredMissingFields: missing,
      constraints,
      suppression: null,
    };
  }

  // ── SUPPRESSION — the canonical authority, and it overrides ─────────────
  const target = input.target ?? null;
  if (!personId && !target) {
    // Governance is anchored to a person or a target. With neither, no record
    // could match, and "no match" would read as ALLOWED — which is the one
    // thing an unanchored evaluation must never conclude.
    missing.push('contact_anchor');
    return {
      ...base,
      readiness: 'not_ready',
      reason: 'no person and no contact target, so suppression cannot be anchored; permission is not assumed',
      governanceChannel: channel,
      requiredMissingFields: missing,
      constraints,
      suppression: null,
    };
  }

  const loaded = await ports.loadGovernance({ organizationId, personId, target, channel });
  if (!loaded.ok) {
    // The repository's own contract: an unreadable store must fail closed.
    missing.push('readable_suppression_state');
    return {
      ...base,
      readiness: 'not_ready',
      reason: `suppression state is unreadable (${loaded.error ?? 'unknown error'}); failing closed`,
      governanceChannel: channel,
      requiredMissingFields: missing,
      constraints,
      suppression: null,
    };
  }

  const suppression = mayContact({
    organizationId, personId, targetNormalized: target, channel, now: input.now, records: loaded.records,
  });

  if (suppression.decision !== 'allowed') {
    // OVERRIDES the recommendation, whatever it scored. The NBA is still
    // returned in full, so an operator sees that a sound action exists and that
    // we are not permitted to take it — rather than seeing nothing at all.
    return {
      ...base,
      readiness: suppression.decision === 'deferred' ? 'deferred' : 'blocked',
      reason: `canonical suppression: ${suppression.reason}`,
      governanceChannel: channel,
      requiredMissingFields: missing,
      constraints,
      suppression,
    };
  }

  return {
    ...base,
    readiness: 'ready',
    reason: `'${nba.action}' proposed on ${channel}; governance permits contact`,
    governanceChannel: channel,
    requiredMissingFields: missing,
    constraints,
    suppression,
  };
}
