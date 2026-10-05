/**
 * SLICE 3B — Organic and Paid CONDITION ASSESSORS.
 *
 * These answer two questions and no others:
 *   A. What is the current publicly observable organic condition?
 *   B. What is publicly observable about paid activity, and what can responsibly be said
 *      about paid readiness?
 *
 * They are assessments, not decisions. Nothing here computes an acquisition need, a posture,
 * a pilot, a budget, a channel or a review gate -- those are 3C-3G, and the boundary is
 * enforced by test rather than by convention.
 *
 * NO NEW SCORING. Every number consumed here was already produced and already carries a
 * `ScoreState`. The band is assigned by the existing `canonicalBandFromValue`. There are no
 * weights, no aggregation and no new 0-100 value anywhere in this module.
 */
import { canonicalBandFromValue } from '../canonicalReport/canonicalReportTypes';
import type { ScoreState, ConfidenceBand } from './canonicalScoreState';
import type { ExperienceReadiness } from '../digitalExperience';
import type { AdvertiserResolutionState } from '../ads/advertiserIdentityResolver';
import type {
  AcquisitionEvidence,
  OrganicBand,
  OrganicCondition,
  OrganicSupportingDimension,
  PaidActivityObservation,
  PaidPresenceState,
  PaidReadiness,
} from './acquisitionContract';

/**
 * The dimensions that describe DURABLE, compounding acquisition.
 *
 * `conversion` is deliberately absent: it describes what happens once demand arrives, which
 * is paid-readiness evidence, not organic condition. Including it would let a weak conversion
 * path depress the organic band and then block paid for the same reason twice.
 */
export const ORGANIC_DIMENSION_KEYS = [
  'content_quality',
  'coverage',
  'reach',
  'authority',
  'aeo',
  'platforms',
] as const;

type DimensionInput = {
  key: string;
  value: number | null;
  state: ScoreState;
};

export type OrganicAssessmentInput = {
  dimensions: DimensionInput[];
  /** Public search visibility state, carried as supporting evidence only. */
  searchVisibilityState?: ScoreState | null;
  /** GEO composite state. Structural readiness -- never AI retrieval. */
  geoVisibilityState?: ScoreState | null;
};

const MEASURED_STATES: ReadonlySet<ScoreState> = new Set<ScoreState>(['measured', 'inferred']);

function confidenceFromMeasuredCount(measured: number, total: number): ConfidenceBand {
  if (total === 0 || measured === 0) return 'low';
  if (measured === total) return 'high';
  return measured > total / 2 ? 'medium' : 'low';
}

/**
 * Organic condition.
 *
 * Band = the band of the WEAKEST measured organic dimension.
 *
 * Chosen rather than an average because organic is a foundation, and because the report
 * already reasons this way: `score.limiting_factors` names the "strongest drag on total
 * score". Averaging would also have required weights, which this slice is forbidden to
 * invent. A dimension that was never measured contributes NOTHING -- not a zero, not a
 * floor -- it only lowers confidence and is named in `notMeasurable`.
 */
export function assessOrganicCondition(input: OrganicAssessmentInput): OrganicCondition {
  const relevant = input.dimensions.filter((d) =>
    (ORGANIC_DIMENSION_KEYS as readonly string[]).includes(d.key));

  const supportingDimensions: OrganicSupportingDimension[] = relevant.map((d) => ({
    key: d.key,
    value: d.value,
    state: d.state,
  }));

  const measured = relevant.filter((d) => MEASURED_STATES.has(d.state) && typeof d.value === 'number');
  const unmeasured = relevant.filter((d) => !MEASURED_STATES.has(d.state) || typeof d.value !== 'number');

  let band: OrganicBand = 'insufficient';
  if (measured.length > 0) {
    const weakest = measured.reduce((lo, d) => ((d.value as number) < (lo.value as number) ? d : lo));
    band = canonicalBandFromValue(weakest.value, weakest.state) as OrganicBand;
  }

  const notMeasurableParts: string[] = unmeasured.map((d) => d.key);
  if (input.searchVisibilityState && !MEASURED_STATES.has(input.searchVisibilityState)) {
    notMeasurableParts.push('public search visibility');
  }
  if (input.geoVisibilityState && !MEASURED_STATES.has(input.geoVisibilityState)) {
    notMeasurableParts.push('AI answer-engine visibility');
  }

  const evidence: AcquisitionEvidence = {
    state: measured.length > 0 ? 'inferred' : 'insufficient_signal',
    basis: measured.length > 0
      ? `Assessed from ${measured.length} publicly observed dimension(s): ${measured.map((d) => d.key).join(', ')}.`
      : 'No organic dimension could be observed for this domain.',
    notMeasurable: notMeasurableParts.length > 0
      ? `Not established from public evidence: ${notMeasurableParts.join(', ')}. An absence here is a gap in what could be seen, not a finding of zero performance.`
      : null,
    unlock: notMeasurableParts.length > 0
      ? 'Connect the corresponding sources (for example a backlink source for authority, or an answer-engine provider for AI visibility) to replace these gaps with measurement.'
      : null,
  };

  return {
    band,
    evidence,
    confidence: confidenceFromMeasuredCount(measured.length, relevant.length),
    supportingDimensions,
  };
}

// ── Paid: (A) activity observation ────────────────────────────────────────────

export type PaidActivityInput = {
  /** Null when no advertising observation exists at all for this run. */
  advertising: {
    platform: string | null;
    accessState: string;
    subjectLegalNameUsed: string | null;
    companyAdvertiserCount: number;
    otherAdvertiserCount: number;
    observedAt?: string | null;
  } | null;
};

/**
 * What the public ad record shows. NOT performance.
 *
 * Identity is derived from the partitioning the composer already performed, whose semantics
 * are fixed upstream: an advertiser reaches `companyAdvertisers` only when its provider-
 * verified legal name matched the legal name the site declares, and `subjectLegalNameUsed`
 * is null when the site declares none -- in which case the search COULD NOT have confirmed
 * ownership and `UNRESOLVED` is the only honest state.
 *
 * `none_found` never means "does not advertise". The public record can show nothing found;
 * it cannot establish absence.
 */
export function assessPaidActivity(input: PaidActivityInput): PaidActivityObservation {
  const ads = input.advertising;

  if (!ads) {
    return {
      platform: null,
      presence: 'not_observable',
      advertiserIdentity: 'INSUFFICIENT_EVIDENCE',
      evidence: {
        state: 'insufficient_signal',
        basis: 'No public advertising observation was made for this run.',
        notMeasurable: 'Whether this company advertises at all. Nothing was looked at.',
        unlock: 'Run a public ad-library observation for this domain.',
      },
    };
  }

  // The platform is whatever the observation was stamped with. Never defaulted: coercing an
  // unknown platform to Google would be a fabricated attribution.
  const platform = ads.platform ?? null;

  if (ads.accessState !== 'observed') {
    return {
      platform,
      presence: 'not_observable',
      advertiserIdentity: 'INSUFFICIENT_EVIDENCE',
      evidence: {
        state: 'insufficient_signal',
        basis: `The public ad record could not be read (${ads.accessState}).`,
        notMeasurable: 'Whether this company advertises. This is not a finding that it does not.',
        unlock: 'Retry the public ad-library observation when the provider is reachable.',
      },
    };
  }

  const identity: AdvertiserResolutionState = ads.companyAdvertiserCount > 0
    ? 'MATCHED'
    : ads.subjectLegalNameUsed === null
      ? 'UNRESOLVED'
      : 'NOT_MATCHED';

  const presence: PaidPresenceState = ads.companyAdvertiserCount > 0 ? 'observed' : 'none_found';

  const basis = ads.companyAdvertiserCount > 0
    ? `${ads.companyAdvertiserCount} advertiser account(s) matched this company's declared legal name in the public ad record.`
    : identity === 'UNRESOLVED'
      ? 'The public ad record was read, but the website declares no legal name, so an advertiser could not be confirmed as this company\'s even if one exists.'
      : `No advertiser matching "${ads.subjectLegalNameUsed}" was found in the public ad record.`;

  return {
    platform,
    presence,
    advertiserIdentity: identity,
    evidence: {
      state: 'measured',
      basis,
      // The performance boundary, stated on every paid observation.
      notMeasurable:
        'Spend, return on ad spend, cost per acquisition, conversion rate and profitability. The public ad record cannot establish any of these.',
      unlock: identity === 'UNRESOLVED'
        ? 'Publish a legal name on the website (Organization.legalName) so advertiser ownership can be confirmed.'
        : null,
    },
  };
}

// ── Paid: (B) readiness ───────────────────────────────────────────────────────

export type PaidReadinessInput = {
  /** From the existing ExperienceReadiness contract. Never a numeric score. */
  conversionReadiness?: ExperienceReadiness | null;
  /** Readiness of the pillar that carries offer / value communication. */
  valueCommunicationReadiness?: ExperienceReadiness | null;
  /** A publicly observed destination URL, where one was established. */
  destination?: string | null;
  /** Declared ICP or audience segment from Company Profile. READ ONLY. */
  declaredAudience?: string | null;
};

/**
 * Whether a responsible paid test COULD eventually be run. Independent of whether paid is
 * running, and independent of whether it should be recommended -- that is 3C.
 *
 * Every field abstains rather than defaulting. `conversionEventObservable: null` means the
 * question could not be answered, which is a measurement prerequisite for a later slice, not
 * a statement that conversion performs badly.
 */
export function assessPaidReadiness(input: PaidReadinessInput): PaidReadiness {
  const conversionReadiness: ExperienceReadiness | 'unknown' = input.conversionReadiness ?? 'unknown';

  const offerClarity: PaidReadiness['offerClarity'] =
    input.valueCommunicationReadiness == null || input.valueCommunicationReadiness === 'insufficient_evidence'
      ? 'unknown'
      : input.valueCommunicationReadiness === 'ready'
        ? 'clear'
        : 'unclear';

  const audienceDefinable: boolean | null =
    input.declaredAudience == null ? null : input.declaredAudience.trim().length > 0;

  // Observable only where the conversion pillar was actually evaluated. 'unknown' and
  // 'insufficient_evidence' both mean the question was not answered.
  const conversionEventObservable: boolean | null =
    conversionReadiness === 'unknown' || conversionReadiness === 'insufficient_evidence'
      ? null
      : true;

  const gaps: string[] = [];
  if (conversionEventObservable === null) gaps.push('an observable primary conversion event');
  if (input.destination == null) gaps.push('a destination page suitable for paid traffic');
  if (audienceDefinable !== true) gaps.push('a declared target audience');
  if (offerClarity === 'unknown') gaps.push('a publicly observable offer');

  return {
    conversionReadiness,
    destination: input.destination ?? null,
    offerClarity,
    audienceDefinable,
    conversionEventObservable,
    evidence: {
      state: gaps.length === 0 ? 'measured' : gaps.length >= 3 ? 'insufficient_signal' : 'inferred',
      basis: 'Assessed from the publicly observed conversion path, value communication and declared company context.',
      notMeasurable: gaps.length > 0
        ? `Not established: ${gaps.join(', ')}.`
        : null,
      unlock: gaps.length > 0
        ? 'Supply the missing context, or re-run once the site exposes a usable conversion path, to make a paid readiness assessment possible.'
        : null,
    },
  };
}
