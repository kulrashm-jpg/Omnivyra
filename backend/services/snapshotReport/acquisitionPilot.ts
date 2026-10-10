/**
 * SLICE 3E — CONTROLLED PILOT MODEL.
 *
 * Given a decided acquisition posture that permits a controlled experiment, construct a
 * responsible pilot DEFINITION. Downstream of 3C/3D and strictly additive: the only field
 * this module may change on a decision is `pilot`.
 *
 * A pilot here is a structured experiment, not an ad campaign. Nothing in this module calls a
 * provider, creates an account, configures tracking, schedules anything or spends money.
 *
 * NOT a second pilot model: the shape is 3A's `AcquisitionPilot`, unchanged. This file holds
 * the constructor only, kept out of `acquisitionPosture.ts` so the posture engine stays
 * readable rather than growing a third responsibility.
 *
 * THE GOVERNING RULE
 *
 *   if the experiment cannot be responsibly specified, pilot = null
 *
 * Three fields are nullable in the 3A contract but are nonetheless MANDATORY for a pilot to
 * exist — audience, destination and conversion event. Nullability there exists so the shape
 * can carry an absence, not so an incomplete experiment can be recommended. Only
 * `durationDays` may legitimately be null inside a constructed pilot, because 3G owns the
 * review period and inventing a number here would be fabricating the one thing that makes a
 * pilot reviewable.
 */
import type {
  AcquisitionDecision,
  AcquisitionPilot,
  PilotChannel,
} from './acquisitionContract';

/** A destination already observed by the Report 1 crawl. Never constructed here. */
export type ObservedDestination = {
  url: string;
  /** Page classification from existing evidence (pricing, product, contact, demo, …). */
  kind: string;
  /** The homepage is not automatically an acquisition destination. */
  isHomepage: boolean;
};

/**
 * A primary conversion event observed on the public site.
 *
 * `ctaOnly` exists because a call-to-action is not a measurable business conversion. A button
 * that says "Get started" establishes intent to collect, not an observable conversion event.
 */
export type ObservedConversionEvent = {
  label: string;
  ctaOnly: boolean;
};

export type PilotChannelEvidence = {
  /** Company-specific evidence for one platform. Observation of an advertiser is supporting
   *  evidence, never on its own a recommendation to use that platform. */
  specific?: { name: string; basis: string } | null;
  /** Evidence supporting a class of channel without identifying a platform. */
  channelClass?: { name: string; basis: string } | null;
};

export type PilotConstructionInput = {
  /** Company-DECLARED targeting context. Read only; never mutated, never inferred. */
  declaredIcp?: string | null;
  declaredSegment?: string | null;
  declaredGeography?: string | null;
  /** Declared positioning / proposition, used to state the business question. */
  declaredPositioning?: string | null;

  observedDestination?: ObservedDestination | null;
  observedConversionEvent?: ObservedConversionEvent | null;
  channelEvidence?: PilotChannelEvidence | null;

  /** An existing, defensible duration from the product contract. Never invented here. */
  durationDays?: number | null;
};

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Audience from DECLARED context only.
 *
 * ICP or segment is the anchor; geography narrows an existing anchor but can never be one on
 * its own — "companies in India" is a filter, not an audience. Industry and positioning are
 * deliberately excluded: deriving an audience from them is the generic-industry assumption
 * the product rules forbid. No job title, company size, income, age, interest, lookalike,
 * remarketing or customer-list segment is ever synthesised.
 */
export function deriveDeclaredAudience(input: PilotConstructionInput): string | null {
  const anchor = text(input.declaredIcp) ?? text(input.declaredSegment);
  if (anchor === null) return null;
  const geography = text(input.declaredGeography);
  return geography === null ? anchor : `${anchor} in ${geography}`;
}

/**
 * Tiered channel scope: specific only on company-specific evidence, otherwise a class,
 * otherwise unavailable. An unknown platform NEVER becomes Google.
 */
export function deriveChannel(evidence: PilotChannelEvidence | null | undefined): PilotChannel {
  const specific = evidence?.specific;
  if (specific && text(specific.name) && text(specific.basis)) {
    return { kind: 'specific_channel', name: specific.name.trim(), basis: specific.basis.trim() };
  }
  const klass = evidence?.channelClass;
  if (klass && text(klass.name) && text(klass.basis)) {
    return { kind: 'channel_class', name: klass.name.trim(), basis: klass.basis.trim() };
  }
  return {
    kind: 'unavailable',
    unlock: 'Identify where this audience can actually be reached — a declared channel, or public evidence of where comparable demand is addressed — before a paid test can be specified.',
  };
}

/**
 * A destination must be an observed page that can carry the intended action. The homepage is
 * rejected: a page existing is not evidence it suits acquisition traffic, and accepting it
 * would let every subject pass this gate.
 */
export function acceptableDestination(destination: ObservedDestination | null | undefined): string | null {
  if (!destination) return null;
  if (destination.isHomepage) return null;
  return text(destination.url);
}

/** A conversion event must be observed and must be more than a call-to-action. */
export function acceptableConversionEvent(event: ObservedConversionEvent | null | undefined): string | null {
  if (!event) return null;
  if (event.ctaOnly) return null;
  return text(event.label);
}

/** One business question, stated from declared context. Null when it cannot be stated. */
export function deriveObjective(audience: string | null, conversionEvent: string | null, proposition: string | null): string | null {
  if (audience === null || conversionEvent === null) return null;
  const subject = proposition === null ? 'the current proposition' : proposition;
  return `Test whether ${audience} responds to ${subject} strongly enough to generate ${conversionEvent}.`;
}

/**
 * Construct the pilot, or abstain.
 *
 * Eligible posture is ORGANIC_PLUS_CONTROLLED_PAID_PILOT alone. ORGANIC_LED,
 * PAID_BLOCKED_BY_PREREQUISITE, PAID_NOT_CURRENTLY_RECOMMENDED and INSUFFICIENT_EVIDENCE do
 * not permit an experiment. PAID_SCALE_CANDIDATE already represents a REVIEWED experiment, so
 * fabricating another one here would misrepresent it. PAID_SUPPORTED_URGENCY is unreachable
 * in 3C and is treated as non-pilot-producing until its semantics are decided.
 *
 * A blocking dependency abstains regardless of posture.
 */
export function constructAcquisitionPilot(
  decision: AcquisitionDecision,
  input: PilotConstructionInput,
): AcquisitionDecision {
  if (decision.posture !== 'ORGANIC_PLUS_CONTROLLED_PAID_PILOT') {
    return { ...decision, pilot: null };
  }
  if (decision.dependencies.some((dependency) => dependency.kind === 'blocking')) {
    return { ...decision, pilot: null };
  }

  const audience = deriveDeclaredAudience(input);
  const destination = acceptableDestination(input.observedDestination);
  const conversionEvent = acceptableConversionEvent(input.observedConversionEvent);
  const channel = deriveChannel(input.channelEvidence);
  const objective = deriveObjective(audience, conversionEvent, text(input.declaredPositioning));

  // Every mandatory element must be responsibly available. An unavailable channel abstains:
  // the 3A contract can REPRESENT `kind: 'unavailable'`, but an experiment with nowhere to run
  // is not a deferred experiment definition, it is an incomplete one, and the completeness
  // rule forbids recommending that. `durationDays` is the sole exception — see the header.
  if (
    objective === null
    || audience === null
    || destination === null
    || conversionEvent === null
    || channel.kind === 'unavailable'
  ) {
    return { ...decision, pilot: null };
  }

  const pilot: AcquisitionPilot = {
    objective,
    audience,
    channel,
    destination,
    conversionEvent,
    durationDays: typeof input.durationDays === 'number' && Number.isFinite(input.durationDays)
      ? input.durationDays
      : null,
  };

  return { ...decision, pilot };
}
