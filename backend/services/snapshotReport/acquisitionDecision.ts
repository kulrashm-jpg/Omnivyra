/**
 * ACQUISITION DECISION PRODUCER.
 *
 * The write side of the acquisition surface. 3A established the shapes, 3B-3G established the
 * meaning, 3H established the rendering — and nothing ever assigned the decision, so
 * `composed_report.acquisition_decision` was undefined on every report ever generated and the
 * renderer correctly emitted nothing. This module closes that gap and does only that.
 *
 * IT IS AN ORCHESTRATOR. It holds no acquisition rule of its own: no posture, no threshold, no
 * band, no budget arithmetic, no review condition, no advertising classification, no platform
 * default and no evidence-state transformation. Every verdict below is produced by the frozen
 * function that owns it; this file maps already-finished Report 1 state onto those functions'
 * input shapes and hands the result forward.
 *
 * PURE. No database read, no network call, no provider call, no mutation of anything it is
 * given. It operates entirely on values the composer has already produced.
 *
 * WHAT IT DELIBERATELY DOES NOT SUPPLY, and why the absence is passed through rather than
 * filled:
 *
 *  - DESTINATION. `canonical_pages.page_type` classifies pages (home|landing|blog|product|
 *    pricing|feature|docs|contact|other), but nothing in the product declares which of those
 *    classifications is an acquisition destination. Choosing one here would be a new business
 *    rule in the producer; reusing the private conversion-path keyword list inside
 *    `digitalExperience` would duplicate one. Both are forbidden, so no destination is
 *    established.
 *  - CONVERSION EVENT. No labelled, observable conversion event is modelled anywhere in Report
 *    1 evidence. `digitalExperience` establishes whether a conversion PATH is obstructed; it
 *    never names an event.
 *  - CHANNEL. No channel-evidence source exists. An unknown platform never becomes Google.
 *  - BUDGET / MEASUREMENT. No tenant declaration and no connected conversion source exists.
 *
 * The consequence, stated plainly so it is not mistaken for a defect: 3E abstains and the
 * pilot is null for every tenant until those inputs exist, so 3F and 3G are null too. The
 * decision still carries a posture, a demand need, the organic and paid conditions and any
 * dependencies — which is the whole of what the current evidence supports.
 */
import type { ScoreState } from './canonicalScoreState';
import type { AcquisitionDecision } from './acquisitionContract';
import type { DigitalExperienceResult, ExperienceReadiness } from '../digitalExperience';
import type { SnapshotAdvertising } from '../snapshotReportTypes';
import {
  assessOrganicCondition,
  assessPaidActivity,
  assessPaidReadiness,
} from './acquisitionAssessors';
import {
  assessAcquisitionNeed,
  attachAcquisitionDependencies,
  decideAcquisitionPosture,
  type ObstructedPillar,
} from './acquisitionPosture';
import { constructAcquisitionPilot, deriveDeclaredAudience } from './acquisitionPilot';
import { attachBudgetAndLearningFloor } from './acquisitionBudget';
import { attachMeasurementAndReview } from './acquisitionMeasurement';

/**
 * DECLARED Company Profile context, read only. Structural rather than importing
 * `CompanyProfile`, so the producer depends on the six columns it actually reads and nothing
 * else can quietly arrive through this door.
 */
export type DeclaredProfileContext = {
  ideal_customer_profile?: string | null;
  target_customer_segment?: string | null;
  geography?: string | null;
  brand_positioning?: string | null;
  growth_priorities?: string | null;
  goals?: string | null;
};

export type AcquisitionProducerInput = {
  /**
   * The finished score dimensions, carried whole. 3B owns `ORGANIC_DIMENSION_KEYS` and does its
   * own filtering, so passing the full set keeps the selection rule where it was decided.
   */
  scoreDimensions?: ReadonlyArray<{ key: string; value: number | null; state: ScoreState }> | null;
  /**
   * `search_visibility.state`, whose vocabulary includes `failed` — a provider outcome that is
   * not a `ScoreState`. See `scoreState` below for why it is passed as absent rather than
   * re-coded.
   */
  searchVisibilityState?: string | null;
  /** Already a `ScoreState`; passed through verbatim. */
  geoVisibilityState?: ScoreState | null;
  /** The finished advertising surface, or null when no observation was loaded. */
  advertising?: SnapshotAdvertising | null;
  /** The finished digital-experience assessment. Authoritative for every readiness input. */
  digitalExperience?: DigitalExperienceResult | null;
  declaredProfile?: DeclaredProfileContext | null;
};

const SCORE_STATES: ReadonlySet<string> = new Set<ScoreState>([
  'measured',
  'inferred',
  'insufficient_signal',
  'unavailable',
]);

/**
 * Admit a state only where it ALREADY is a `ScoreState`.
 *
 * A guard, not a mapping. `search_visibility.state` can be `failed`, and re-coding that to
 * `unavailable` here would be an evidence-state transformation performed by the producer —
 * exactly what this module is forbidden to do. Absent is the honest alternative: 3B treats an
 * unsupplied supporting state as not supplied, which is what it is.
 */
function scoreState(value: string | null | undefined): ScoreState | null {
  return typeof value === 'string' && SCORE_STATES.has(value) ? (value as ScoreState) : null;
}

function pillarReadiness(
  experience: DigitalExperienceResult | null | undefined,
  pillar: string,
): ExperienceReadiness | null {
  return experience?.pillars?.find((candidate) => candidate.pillar === pillar)?.readiness ?? null;
}

function obstructedPillars(experience: DigitalExperienceResult | null | undefined): ObstructedPillar[] {
  return (experience?.pillars ?? [])
    .filter((pillar) => pillar.readiness === 'obstructed')
    .map((pillar) => ({ pillar: pillar.pillar, label: pillar.label }));
}

/**
 * Produce the acquisition decision.
 *
 * Map existing state, call the existing functions in their established order, compose the
 * result. The order below is the slice order and is load-bearing: dependencies are attached to
 * a decided posture, the pilot is constructed only once dependencies are known, and budget and
 * measurement are attached only to a decision that carries a pilot.
 */
export function buildAcquisitionDecision(input: AcquisitionProducerInput): AcquisitionDecision {
  const experience = input.digitalExperience ?? null;
  const profile = input.declaredProfile ?? null;

  // 3B — organic condition from the finished dimensions.
  const organic = assessOrganicCondition({
    dimensions: (input.scoreDimensions ?? []).map((dimension) => ({
      key: dimension.key,
      value: dimension.value,
      state: dimension.state,
    })),
    searchVisibilityState: scoreState(input.searchVisibilityState),
    geoVisibilityState: input.geoVisibilityState ?? null,
  });

  // 3B — what the public ad record shows. Never re-observed and never re-partitioned: the
  // counts below are the partition `buildAdvertisingSurface` already performed.
  const advertising = input.advertising ?? null;
  const paidActivity = assessPaidActivity({
    advertising: advertising
      ? {
        platform: advertising.platform ?? null,
        accessState: advertising.accessState,
        subjectLegalNameUsed: advertising.subjectLegalNameUsed ?? null,
        companyAdvertiserCount: advertising.companyAdvertisers.length,
        otherAdvertiserCount: advertising.otherAdvertisers.length,
        observedAt: advertising.observedAt ?? null,
      }
      : null,
  });

  // The declared audience is derived by the exported 3E helper rather than re-implemented, so
  // ICP/segment precedence exists in exactly one place.
  const declaredAudience = deriveDeclaredAudience({
    declaredIcp: profile?.ideal_customer_profile ?? null,
    declaredSegment: profile?.target_customer_segment ?? null,
    declaredGeography: profile?.geography ?? null,
  });

  const conversionPillarReadiness = pillarReadiness(experience, 'conversion_readiness');
  const valueCommunicationReadiness = pillarReadiness(experience, 'value_communication');

  // 3B — whether paid COULD be run responsibly. `destination: null` because none is
  // established; see the module header.
  const paidReadiness = assessPaidReadiness({
    conversionReadiness: conversionPillarReadiness,
    valueCommunicationReadiness,
    destination: null,
    declaredAudience,
  });

  // 3C — demand need from DECLARED context alone. No time-bound driver field exists anywhere
  // in the profile, so its absence is passed through rather than inferred from anything else.
  const need = assessAcquisitionNeed({
    declaredGrowthPriorities: profile?.growth_priorities ?? null,
    declaredGoals: profile?.goals ?? null,
    declaredTimeBoundDriver: null,
  });

  // 3C — the posture. `reviewedPilot` is omitted: no runtime pilot execution exists, so no
  // review evidence could be anything but invented.
  const decided = decideAcquisitionPosture({
    organic,
    paidActivity,
    paidReadiness,
    need,
    overallExperienceReadiness: experience?.readiness ?? null,
    conversionPillarReadiness,
  });

  // 3D — prerequisites, named from the pillars actually observed as obstructed.
  const withDependencies = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: experience?.readiness ?? null,
    conversionPillarReadiness,
    obstructedPillars: obstructedPillars(experience),
  });

  // 3E — the pilot, or abstention. Destination, conversion event and channel evidence are all
  // absent, so the completeness rule inside 3E governs the outcome.
  const withPilot = constructAcquisitionPilot(withDependencies, {
    declaredIcp: profile?.ideal_customer_profile ?? null,
    declaredSegment: profile?.target_customer_segment ?? null,
    declaredGeography: profile?.geography ?? null,
    declaredPositioning: profile?.brand_positioning ?? null,
    observedDestination: null,
    observedConversionEvent: null,
    channelEvidence: null,
    durationDays: null,
  });

  // 3F — budget and learning floor. No tenant declaration exists; `avg_deal_size` is free text
  // and is deliberately not parsed.
  const withBudget = attachBudgetAndLearningFloor(withPilot, {
    declaredAmount: null,
    declaredCurrency: null,
    declaredAcceptableCostPerConversion: null,
    declaredAcceptableCostCurrency: null,
  });

  // 3G — measurement plan and pre-committed review gate. No connected conversion source and no
  // declared success threshold exist, and no observed outcome could exist at all.
  return attachMeasurementAndReview(withBudget, {
    declaredSuccessThreshold: null,
    primaryConversionSourceConnected: false,
    primaryConversionSource: null,
    availableSecondarySignals: [],
  });
}
