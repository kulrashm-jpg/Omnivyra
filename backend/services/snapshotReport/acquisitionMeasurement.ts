/**
 * SLICE 3G — MEASUREMENT + REVIEW GATE.
 *
 * Answers: once a controlled pilot exists, how will the company know whether to STOP, MODIFY,
 * CONTINUE or SCALE it? Downstream of 3E/3F; adds `measurement` and `reviewGate` and changes
 * nothing else.
 *
 * A paid recommendation must never mean "spend money and see what happens". It means a
 * controlled experiment with a defined business outcome, a fixed review point and a decision
 * rule committed BEFORE any result is known. That ordering is the whole point: a threshold
 * chosen after seeing the numbers is not a threshold.
 *
 * TWO STRUCTURAL FACTS ABOUT THE 3A CONTRACT, both deliberate:
 *
 *  1. `AcquisitionReviewGate.proceed` IS the CONTINUE state. `continue` is a reserved word, so
 *     the field could not carry that name. Same four states, one different identifier.
 *
 *  2. The gate holds pre-committed CONDITIONS (`string[]` per state), not an outcome, and
 *     `AcquisitionDecision` has no review-outcome slot. That is correct: no runtime pilot
 *     execution exists anywhere in the product, so no experiment has ever run and no outcome
 *     could be anything but invented. 3G therefore builds the framework, never a verdict.
 *
 * WHAT REPORT 1 CAN ACTUALLY MEASURE TODAY: nothing about a paid result. There is no GA4,
 * Search Console, CRM or ad-account connection feeding this surface. So `measurementAvailable`
 * is false unless a caller supplies a real connected source, and the absence is reported as a
 * prerequisite — never as a zero, and never as a failure.
 */
import type {
  AcquisitionDecision,
  AcquisitionMeasurement,
  AcquisitionPilot,
  AcquisitionReviewGate,
} from './acquisitionContract';

export type DeclaredMeasurementInputs = {
  /**
   * A company-DECLARED success target, in the company's own words. Never invented, never
   * derived from a benchmark, and never confused with an observed result.
   */
  declaredSuccessThreshold?: string | null;
  /** True only where a trustworthy source for the PRIMARY conversion event actually exists. */
  primaryConversionSourceConnected?: boolean | null;
  /** The name of that source, when one is connected. */
  primaryConversionSource?: string | null;
  /** Secondary signals for which a real source exists. Empty unless genuinely available. */
  availableSecondarySignals?: string[];
};

const UNLOCK_NO_PRIMARY_SOURCE =
  'Connect a source that records this conversion event — your CRM, a form-submission record, or booking software. Without one the result of a paid test cannot be read, and an unread test cannot be judged.';

const UNLOCK_NO_THRESHOLD =
  'State what result would make this test worth continuing — for example a number of qualified enquiries you would consider a success. Report 1 will not assume one on your behalf.';

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Build the measurement plan for a constructed pilot.
 *
 * The primary KPI is the 3E conversion event verbatim — never substituted. Impressions,
 * clicks, reach and CTR can never become the primary business outcome here: they are only
 * admissible as secondary signals, and only when a caller states a real source for them.
 */
export function buildMeasurementPlan(
  pilot: AcquisitionPilot,
  inputs: DeclaredMeasurementInputs,
): AcquisitionMeasurement {
  const connected = inputs.primaryConversionSourceConnected === true;
  const source = connected ? text(inputs.primaryConversionSource) : null;
  const successThreshold = text(inputs.declaredSuccessThreshold);

  const gaps: string[] = [];
  if (!connected) gaps.push(UNLOCK_NO_PRIMARY_SOURCE);
  if (successThreshold === null) gaps.push(UNLOCK_NO_THRESHOLD);

  return {
    // The actual experiment outcome, carried through unchanged.
    primaryKpi: pilot.conversionEvent ?? '',
    secondaryKpis: [...(inputs.availableSecondarySignals ?? [])],
    // No observed baseline exists for a test that has never run. Null, not zero.
    baseline: null,
    successThreshold,
    // 3E deliberately declined to invent a duration; 3G does not invent one either.
    reviewPeriodDays: pilot.durationDays,
    source,
    measurementAvailable: connected,
    unlock: gaps.length > 0 ? gaps.join(' ') : null,
  };
}

/**
 * Build the pre-committed review gate.
 *
 * Every condition below is written before any result exists, and each is phrased so that an
 * ABSENCE of data can never satisfy it:
 *
 *  - STOP requires an observed result measured against a declared target. "We could not read
 *    the result" is a measurement prerequisite, not evidence of failure, and must never reach
 *    this list.
 *  - SCALE requires a completed pilot AND a declared target that the observed result met.
 *    Budget size, an advertiser match, observed ads, traffic, clicks and impressions are all
 *    incapable of producing it — 3C's reviewed-pilot rule remains the only route.
 *
 * Where the inputs for a state cannot be committed to yet, the list says what is missing
 * rather than offering a condition that could be satisfied by nothing.
 */
export function buildReviewGate(measurement: AcquisitionMeasurement): AcquisitionReviewGate {
  const hasThreshold = measurement.successThreshold !== null;
  const canMeasure = measurement.measurementAvailable;
  const judgeable = hasThreshold && canMeasure;

  const stop: string[] = judgeable
    ? [
        `At the review point, the observed count of ${measurement.primaryKpi} was measured and fell short of the declared target (${measurement.successThreshold}) by a margin the company judges decisive.`,
        'Stopping requires an observed result. Being unable to read the result is a measurement problem, not a failed test.',
      ]
    : [
        'No stop condition can be pre-committed yet: stopping requires an observed result measured against a declared target, and one of those is missing. An unread test must not be recorded as a failed one.',
      ];

  const modify: string[] = judgeable
    ? [
        `At the review point, some ${measurement.primaryKpi} were observed but the declared target was not met. Change exactly one controlled variable — audience, proposition, channel or destination — and review again.`,
      ]
    : [
        'Modification requires an observed result to react to. Establish measurement and a declared target first.',
      ];

  const proceed: string[] = judgeable
    ? [
        `At the review point, ${measurement.primaryKpi} were observed and the direction is useful, but the evidence is not yet strong enough to justify increasing exposure. Continue unchanged to the next review.`,
        'Continuing is not scaling: it buys more evidence at the same risk.',
      ]
    : [
        'Continuing cannot be judged until the result can be read and a target exists to read it against.',
      ];

  const scale: string[] = judgeable
    ? [
        `The pilot ran to completion, the observed count of ${measurement.primaryKpi} met the declared target (${measurement.successThreshold}), and the conversion path still holds.`,
        'All three are required. A larger budget, a matched advertiser, observed ads, more traffic, clicks or impressions do not substitute for any of them.',
      ]
    : [
        `Scale cannot be considered yet.${hasThreshold ? '' : ' No business success threshold has been declared, and one must be supplied before increasing exposure.'}${canMeasure ? '' : ' The primary conversion event cannot currently be observed, so no result could be judged.'}`,
        'This is a safeguard, not a defect: increasing spend without a pre-committed target and a readable result is spending without a decision rule.',
      ];

  return { stop, modify, proceed, scale };
}

/**
 * Attach the measurement plan and review gate.
 *
 * Only a decision carrying a pilot receives them. With no experiment, a measurement plan would
 * be describing how to judge something that does not exist — and a review gate would imply one
 * had run. Everything else on the decision passes through untouched.
 */
export function attachMeasurementAndReview(
  decision: AcquisitionDecision,
  inputs: DeclaredMeasurementInputs,
): AcquisitionDecision {
  if (decision.pilot === null) {
    return { ...decision, measurement: null, reviewGate: null };
  }

  const measurement = buildMeasurementPlan(decision.pilot, inputs);
  const reviewGate = buildReviewGate(measurement);

  return { ...decision, measurement, reviewGate };
}
