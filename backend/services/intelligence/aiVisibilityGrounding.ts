/**
 * D1 — THE single place an AI-visibility probe's evidence state is decided.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * Every LLM adapter used to end its probe with a literal `state: 'measured'`,
 * on the reasoning recorded in the contract itself: measured means "the adapter
 * actually queried the LLM". Querying a language model is not observing the
 * outside world. The probe asked `gpt-4o-mini` "What is {brand}?" — a question
 * that CONTAINS the brand — and scored the reply with a word-boundary regex for
 * that same brand. A model confabulating about a company it has never seen
 * produced `appeared: true, prominence: 1.0`, indistinguishable from a real
 * citation, and Report 1 printed "AI systems reliably identify the brand".
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────
 * `measured` requires TWO independent things, and neither implies the other:
 *
 *   1. the provider RETRIEVES (it is an answer engine, not a chat model), and
 *   2. the response actually carried externally checkable source evidence.
 *
 * A retrieval-grounded engine that answers without citing anything fails (2):
 * we cannot tell retrieval from recall, so we cannot claim an observation. A
 * chat model fails (1) permanently, no matter how confident its answer looks.
 *
 * ─── WHY A SEPARATE MODULE ─────────────────────────────────────────────────
 * Because the defect was one literal in each of six adapters. Centralising the
 * decision means a future adapter cannot reintroduce it by writing the word
 * `measured`, and one suite can prove the rule for all of them.
 */

import type { ScoreState } from '../snapshotReport/canonicalScoreState';

/**
 * What actually happened on a probe run. Distinct from `ScoreState` on purpose:
 * the canonical four-value state vocabulary is shared platform-wide and is not
 * widened here, but "we could not ask" and "we asked and it broke" are
 * different findings and the report must be able to tell them apart.
 */
export type ProbeObservationOutcome =
  /** A retrieval-grounded engine answered AND returned source evidence. */
  | 'grounded_observation'
  /** Something answered, but nothing external corroborates it. Not an observation. */
  | 'ungrounded_answer'
  /** No credential / no adapter. We never asked. */
  | 'no_provider'
  /** We asked and the provider errored, timed out, or was rate-limited. */
  | 'provider_failed'
  /** Nothing to ask — no queries were derived for this class. */
  | 'no_queries'
  /**
   * D2 — no company identity reached the probe, so nothing the answer said could
   * be attributed to anyone. The run is not a measurement of zero visibility; it
   * is a measurement of nothing. See `resolveProbeIdentity`.
   */
  | 'no_identity';

/** The only part of a mention this decision depends on. */
export type GroundingObservation = {
  readonly appeared: boolean;
  readonly grounded_sources: readonly string[];
};

export type ProbeOutcomeResolution = {
  readonly state: ScoreState;
  readonly outcome: ProbeObservationOutcome;
  readonly reason: string | null;
};

/**
 * D2 — THE single place "do we know whose visibility this is?" is decided.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * `buildAICitationMatrix` received `{ brandName, domain }` and forwarded neither
 * to `provider.probe()`. Both adapters read them off the probe through a cast,
 * so they silently defaulted to `''` and `null`. `extractCitation` then built an
 * EMPTY candidate set, every mention came back `appeared: false`, and the first
 * grounded run would have published `citation_rate: 0` in state `measured` for
 * every cell — a false measured zero, sourced `answer_engine`, for a company the
 * system never actually asked about.
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────
 * A citation rate is a statement about a named company. With no name and no
 * domain there is no subject, so there is no rate — not zero. Identity is
 * therefore a PRECONDITION of measurement, checked before the grounding rules
 * and before any paid provider call.
 *
 * Whitespace is not identity: a brand of `'   '` cannot match anything and is
 * treated exactly as absent.
 */
export type ProbeIdentity = {
  /** Trimmed brand label, or `''` when none was supplied. */
  readonly brandName: string;
  /** Trimmed domain, or null when none was supplied. */
  readonly domain: string | null;
  /**
   * True when at least ONE of brand / domain can anchor a match. Either alone is
   * enough: a brand label scores the prose, a domain scores the cited sources.
   */
  readonly resolved: boolean;
};

export function resolveProbeIdentity(params: {
  brandName?: string | null;
  domain?: string | null;
}): ProbeIdentity {
  const brandName = (params.brandName ?? '').trim();
  const domainRaw = (params.domain ?? '').trim();
  const domain = domainRaw.length > 0 ? domainRaw : null;
  return { brandName, domain, resolved: brandName.length > 0 || domain !== null };
}

/** The customer-facing reason a probe was refused for want of a subject. */
export const NO_IDENTITY_REASON =
  'No company name or domain reached the AI visibility probe, so no answer could be attributed to this company. This is not a measured absence.';

/**
 * Decide the evidence state for one provider × query-class probe.
 *
 * @param retrievalGrounded whether the PROVIDER retrieves from the live web.
 *        A property of the adapter, never inferred from the response — a chat
 *        model that happens to emit a URL has still not retrieved anything.
 * @param identityResolved D2 — whether a company name or domain was actually
 *        supplied. Required rather than defaulted: a new adapter must state it,
 *        and cannot inherit a silent `true`.
 * @param observations one entry per query that produced an answer.
 * @param failureReason the first error seen, when no observation survived.
 */
export function resolveProbeOutcome(params: {
  retrievalGrounded: boolean;
  identityResolved: boolean;
  observations: readonly GroundingObservation[];
  failureReason: string | null;
}): ProbeOutcomeResolution {
  const { retrievalGrounded, identityResolved, observations, failureReason } = params;

  // D2 — checked FIRST, and ahead of the grounding rules, because without a
  // subject even a perfectly grounded answer set says nothing about this
  // company. `appeared: false` on every mention is then an artefact of having
  // nothing to look for, not an observation that the brand was absent.
  if (!identityResolved) {
    return { state: 'unavailable', outcome: 'no_identity', reason: NO_IDENTITY_REASON };
  }

  // Nothing came back at all. Separate "it broke" from "there was nothing to ask".
  if (observations.length === 0) {
    return failureReason
      ? { state: 'unavailable', outcome: 'provider_failed', reason: failureReason }
      : { state: 'unavailable', outcome: 'no_provider', reason: 'No observation was returned.' };
  }

  // A chat model cannot observe AI visibility, however fluent the answer. This
  // is the branch that closes D1, and it is checked BEFORE looking at sources
  // so that a model quoting a URL cannot promote itself.
  if (!retrievalGrounded) {
    return {
      state: 'insufficient_signal',
      outcome: 'ungrounded_answer',
      reason:
        'Provider is not retrieval-grounded: its answer reflects model recall, not observed AI visibility.',
    };
  }

  // The engine retrieves, but this run cited nothing — so we cannot show the
  // customer anything they could check, and we do not claim a measurement.
  const sourced = observations.filter((o) => o.grounded_sources.length > 0);
  if (sourced.length === 0) {
    return {
      state: 'insufficient_signal',
      outcome: 'ungrounded_answer',
      reason: 'The answer engine returned no source citations for this run.',
    };
  }

  return { state: 'measured', outcome: 'grounded_observation', reason: null };
}

/**
 * The host of a URL, or null when it is not a URL at all.
 *
 * Deliberately strict: corroboration is an authorisation-shaped decision (does
 * THIS source belong to THIS company), so a value that does not parse is
 * discarded rather than pattern-matched.
 */
function hostOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Whether the company's OWN domain appears among the sources the engine cited.
 *
 * This is the strongest claim the evidence supports: not merely that a model
 * said the brand's name, but that an answer engine pointed a reader at the
 * company's own pages.
 *
 * Matching is on host equality or a true subdomain — never substring. A
 * substring test would let `northwind.test.attacker.test` corroborate
 * `northwind.test`, which is the ordinary way domain checks are defeated.
 */
export function isCitationCorroborated(
  domain: string | null,
  groundedSources: readonly string[],
): boolean {
  const target = domain ? hostOf(domain) : null;
  if (!target) return false;
  return groundedSources.some((source) => {
    const host = hostOf(source);
    if (!host) return false;
    return host === target || host.endsWith(`.${target}`);
  });
}
