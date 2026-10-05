/**
 * SLICE 3A — Organic + Paid acquisition: CONTRACT AND VOCABULARY ONLY.
 *
 * This module establishes SHAPES. 3B/3C establish MEANING.
 *
 * Nothing here reads tenant data, aggregates a dimension, or decides a posture. Every type
 * below is inert until a producer exists. That separation is deliberate: the acquisition
 * decision is the first Report 1 surface that can recommend spending money, and the shapes
 * it is expressed in should be settled before any logic can quietly round an absence into a
 * recommendation.
 *
 * REUSED, NOT REDEFINED:
 *  - `ScoreState`            evidence state         (canonicalScoreState)
 *  - `ConfidenceBand`        confidence             (canonicalScoreState)
 *  - `ExperienceReadiness`   conversion readiness   (digitalExperience)
 *
 * There is no second provenance system here. The evidence axis is `ScoreState`, exactly as
 * in every other Report 1 surface.
 */
import type { ConfidenceBand, ScoreState } from './canonicalScoreState';
import type { ExperienceReadiness } from '../digitalExperience';
import type { AdvertiserResolutionState } from '../ads/advertiserIdentityResolver';

// ── Posture vocabulary ────────────────────────────────────────────────────────

/**
 * The finite set of acquisition postures. 3A may REPRESENT these; it must never decide one.
 *
 * Two names carry a product decision each:
 *  - `PAID_SCALE_CANDIDATE` is named "candidate", not "recommended", because it is reachable
 *    only from a reviewed pilot. No first report can produce it.
 *  - `PAID_BLOCKED_BY_PREREQUISITE` is kept distinct from `PAID_NOT_CURRENTLY_RECOMMENDED`.
 *    "Fix your conversion path first" and "advertising is not right for you" lead a customer
 *    to opposite actions, and collapsing them would give the wrong advice to any company with
 *    a real offer and a weak site.
 */
export const ACQUISITION_POSTURES = [
  'ORGANIC_LED',
  'ORGANIC_PLUS_CONTROLLED_PAID_PILOT',
  'PAID_SUPPORTED_URGENCY',
  'PAID_SCALE_CANDIDATE',
  'PAID_BLOCKED_BY_PREREQUISITE',
  'PAID_NOT_CURRENTLY_RECOMMENDED',
  'INSUFFICIENT_EVIDENCE',
] as const;
export type AcquisitionPosture = (typeof ACQUISITION_POSTURES)[number];

/**
 * Applicability is a SEPARATE axis from evidence, and conflating the two is what the design's
 * §14 list risked: "not observed but relevant" and "not observed and not recommended" are
 * judgements about fit, not statements about what was seen. `ScoreState` keeps answering
 * "what did we observe"; this answers "does it apply". Same split as Phase 2's `geo_decision`.
 */
export const ACQUISITION_APPLICABILITIES = ['relevant', 'conditional', 'not_recommended', 'undetermined'] as const;
export type AcquisitionApplicability = (typeof ACQUISITION_APPLICABILITIES)[number];

// ── Shared evidence block ─────────────────────────────────────────────────────

/**
 * The Phase 2 `ai_retrieval` shape, generalised. Every acquisition claim carries one, so
 * "we could not establish this" always travels with what would make it establishable.
 */
export type AcquisitionEvidence = {
  state: ScoreState;
  /** What the claim actually rests on. */
  basis: string;
  /** What this evidence cannot establish. Null when nothing material is out of reach. */
  notMeasurable: string | null;
  /** What connection or input would unlock a real measurement. Null when already measured. */
  unlock: string | null;
};

// ── Dependencies ──────────────────────────────────────────────────────────────

/**
 * `blocking` suppresses a pilot outright; `advisory` lets it proceed with a stated caveat.
 * The distinction is the contract-level expression of the product rule that a missing
 * prerequisite is not the same as unsuitability.
 */
export const ACQUISITION_DEPENDENCY_KINDS = ['blocking', 'advisory'] as const;
export type AcquisitionDependencyKind = (typeof ACQUISITION_DEPENDENCY_KINDS)[number];

export type AcquisitionDependency = {
  /** Stable id, aligned with the existing `dependsOn` vocabulary (e.g. 'conversion_readiness'). */
  id: string;
  kind: AcquisitionDependencyKind;
  label: string;
  why: string;
  /** What resolves it. Null when the resolution is not yet known. */
  resolvedBy: string | null;
};

// ── Organic condition ─────────────────────────────────────────────────────────

/**
 * 3B CORRECTION. 3A proposed a fresh `strong|adequate|weak|unknown` taxonomy. Tracing the
 * real contracts for 3B found an equivalent one already in use -- `canonicalBandFromValue`
 * in `canonicalReport/canonicalReportTypes`, which already maps (value, ScoreState) to
 * leading|operational|developing|foundational|insufficient and already returns `insufficient`
 * for a null or unmeasured input.
 *
 * Reusing it rather than introducing a second band vocabulary: a parallel taxonomy would have
 * to be mapped at every boundary, and the two would drift.
 */
export const ORGANIC_BANDS = ['leading', 'operational', 'developing', 'foundational', 'insufficient'] as const;
export type OrganicBand = (typeof ORGANIC_BANDS)[number];

/**
 * A supporting dimension carried WITH its state. A dimension that was never measured is
 * `value: null`, never 0 — the defect class this programme exists to prevent. 3B aggregates
 * these; 3A only states that they travel together.
 */
export type OrganicSupportingDimension = {
  key: string;
  value: number | null;
  state: ScoreState;
};

export type OrganicCondition = {
  band: OrganicBand;
  evidence: AcquisitionEvidence;
  confidence: ConfidenceBand;
  supportingDimensions: OrganicSupportingDimension[];
};

// ── Paid condition: two distinct concepts ─────────────────────────────────────

/**
 * (A) What the public ad record shows. NOT performance.
 *
 * `presence` deliberately has no "does not advertise" member. The public record can show
 * nothing found; it cannot establish absence, and for a subject whose legal name never
 * resolved it cannot even establish that the search was capable of succeeding.
 */
export const PAID_PRESENCE_STATES = ['observed', 'none_found', 'not_observable'] as const;
export type PaidPresenceState = (typeof PAID_PRESENCE_STATES)[number];

export type PaidActivityObservation = {
  /** The platform the observation was stamped with. Never defaulted; null when unknown. */
  platform: string | null;
  presence: PaidPresenceState;
  /**
   * 3B CORRECTION. 3A modelled this as `boolean | null`, which cannot distinguish
   * PROBABLE_MATCH from NOT_MATCHED from UNRESOLVED -- precisely the distinction the paid
   * assessor is required to preserve ("identity unresolved" is not "no advertiser observed").
   * Adopts the existing `AdvertiserResolutionState` instead of flattening it.
   */
  advertiserIdentity: AdvertiserResolutionState;
  evidence: AcquisitionEvidence;
};

/**
 * (B) Whether paid COULD be run responsibly. Independent of whether it is running.
 * `conversionEventObservable: false` is a measurement prerequisite, not a performance claim.
 */
export type PaidReadiness = {
  /** Reuses the existing evidence-backed readiness contract rather than a numeric floor. */
  conversionReadiness: ExperienceReadiness | 'unknown';
  destination: string | null;
  offerClarity: 'clear' | 'unclear' | 'unknown';
  audienceDefinable: boolean | null;
  conversionEventObservable: boolean | null;
  evidence: AcquisitionEvidence;
};

// ── Acquisition need ──────────────────────────────────────────────────────────

/**
 * 3C CORRECTION. 3A used `absent`, which asserts there IS no near-term demand need --
 * a stronger claim than public evidence can support. `not_established` says only that the
 * evidence did not establish one, which is the same discipline applied to `none_found` for
 * advertising and `insufficient_signal` for scores.
 */
export const ACQUISITION_NEED_STATES = ['observed', 'not_established', 'undetermined'] as const;
export type AcquisitionNeedState = (typeof ACQUISITION_NEED_STATES)[number];

/**
 * Urgency may come only from DECLARED Company Profile context (`growth_priorities` / `goals`).
 * It is never inferred from weak organic performance — inferred urgency is how reckless spend
 * gets justified. 3A states the shape; 3C enforces the source.
 */
export type AcquisitionNeed = {
  state: AcquisitionNeedState;
  rationale: string;
  evidence: AcquisitionEvidence;
  confidence: ConfidenceBand;
};

// ── Pilot ─────────────────────────────────────────────────────────────────────

/**
 * Tiered channel scope. Specificity must be EVIDENCED, never defaulted — the same doctrine
 * the ads platform dimension already enforces, where coercing an unknown platform to Google
 * would be a fabricated attribution.
 */
export type PilotChannel =
  | { kind: 'specific_channel'; name: string; basis: string }
  | { kind: 'channel_class'; name: string; basis: string }
  | { kind: 'unavailable'; unlock: string };

export type AcquisitionPilot = {
  /** The single business question the pilot exists to answer. */
  objective: string;
  /** Null rather than invented when no declared audience exists. */
  audience: string | null;
  channel: PilotChannel;
  destination: string | null;
  conversionEvent: string | null;
  durationDays: number | null;
};

// ── Learning floor ────────────────────────────────────────────────────────────

/**
 * Expressed in expected primary CONVERSION EVENTS, never currency. A pilot too small to
 * produce interpretable evidence is not caution, it is waste — so this exists to stop the
 * recommendation collapsing into uselessness, not to justify spend.
 *
 * `unavailable` is the default and is the honest state whenever the tenant has supplied no
 * deal value or spend tolerance. It CONSTRAINS risk posture; it does not block a pilot.
 */
export type LearningFloor =
  | { state: 'derived'; expectedConversionEvents: number; basis: string }
  | { state: 'unavailable'; unlock: string };

// ── Budget ────────────────────────────────────────────────────────────────────

export const BUDGET_POSTURES = ['low_risk_test', 'moderate_test', 'scale_ready'] as const;
export type BudgetPosture = (typeof BUDGET_POSTURES)[number];

/**
 * A monetary amount is representable ONLY in the `declared` and `range_derivable` arms, and
 * only when a tenant-supplied or publicly-observed input makes it derivable. `unavailable`
 * carries no number at all — the type makes fabricating one impossible rather than merely
 * discouraged.
 */
export type AcquisitionBudget =
  | { state: 'unavailable'; posture: BudgetPosture; unlock: string }
  | { state: 'range_derivable'; posture: BudgetPosture; min: number; max: number; currency: string; basis: string }
  | { state: 'declared'; posture: BudgetPosture; amount: number; currency: string; meetsLearningFloor: boolean | null };

// ── Measurement and review ────────────────────────────────────────────────────

/**
 * `measurementAvailable: false` means the customer cannot currently read the result. That is
 * a prerequisite to state, never a reason to substitute a vanity metric.
 */
export type AcquisitionMeasurement = {
  primaryKpi: string;
  secondaryKpis: string[];
  baseline: string | null;
  successThreshold: string | null;
  reviewPeriodDays: number | null;
  source: string | null;
  measurementAvailable: boolean;
  unlock: string | null;
};

/** Thresholds are pre-committed before spend: a recommendation without a stop condition is a
 *  recommendation to spend indefinitely. `scale` requires prior pilot evidence. */
export type AcquisitionReviewGate = {
  stop: string[];
  modify: string[];
  proceed: string[];
  scale: string[];
};

// ── The decision ──────────────────────────────────────────────────────────────

/**
 * `posture: AcquisitionPosture | null` — null is the 3A state and the honest state for any
 * run where no producer has decided. A renderer must treat null as "no decision", never as a
 * default posture.
 */
export type AcquisitionDecision = {
  posture: AcquisitionPosture | null;
  applicability: AcquisitionApplicability;
  rationale: string;
  evidence: AcquisitionEvidence;
  confidence: ConfidenceBand;

  organic: OrganicCondition | null;
  paidActivity: PaidActivityObservation | null;
  paidReadiness: PaidReadiness | null;
  need: AcquisitionNeed | null;

  dependencies: AcquisitionDependency[];

  /** Null unless the posture permits a pilot. Absence is the default. */
  pilot: AcquisitionPilot | null;
  learningFloor: LearningFloor | null;
  budget: AcquisitionBudget | null;
  measurement: AcquisitionMeasurement | null;
  reviewGate: AcquisitionReviewGate | null;

  horizon: 'immediate' | 'short' | 'medium' | 'long' | null;
  priority: 'high' | 'medium' | 'low' | null;
};
