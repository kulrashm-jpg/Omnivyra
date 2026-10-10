/**
 * SLICE 3C — ACQUISITION NEED + POSTURE ENGINE.
 *
 * The first slice permitted to make an acquisition decision. It consumes the 3B condition
 * outputs and produces a posture, a structured rationale and an evidence state. It does NOT
 * wire dependencies (3D), create a pilot (3E), derive a budget (3F), build measurement or
 * review gates (3G), render (3H) or validate against a tenant (3I) — those fields stay null.
 *
 * The governing principle, and the reason the rules are ordered as they are:
 *
 *   Organic is the compounding foundation. Paid is a controlled accelerator that buys
 *   information and time.
 *
 * So weak organic is not a reason to scale paid, and incomplete organic is not a reason to
 * forbid it. The question is whether the company needs near-term demand and could
 * responsibly buy some.
 */
import type {
  AcquisitionDecision,
  AcquisitionDependency,
  AcquisitionEvidence,
  AcquisitionNeed,
  AcquisitionNeedState,
  AcquisitionPosture,
  AcquisitionApplicability,
  OrganicBand,
  OrganicCondition,
  PaidActivityObservation,
  PaidPresenceState,
  PaidReadiness,
} from './acquisitionContract';
import type { ConfidenceBand } from './canonicalScoreState';
import type { ExperienceReadiness } from '../digitalExperience';

// ── Acquisition need ──────────────────────────────────────────────────────────

export type AcquisitionNeedInput = {
  /**
   * DECLARED company context only, as the tenant wrote it. Never a model inference, and
   * never rewritten into a stronger claim than the declaration supports — a stated intent to
   * grow is evidence of intent, not of urgency.
   */
  declaredGrowthPriorities?: string | null;
  declaredGoals?: string | null;
  /** True only where the tenant has declared a time-bound commercial driver. */
  declaredTimeBoundDriver?: boolean | null;
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Need is established from DECLARED context or not at all.
 *
 * Deliberately NOT inferable from weak organic, low search visibility, weak conversion,
 * absent ads, absent competitors or low GEO readiness. Every one of those describes current
 * performance, not whether the company needs demand now, and treating them as urgency is how
 * reckless spend gets justified.
 */
export function assessAcquisitionNeed(input: AcquisitionNeedInput): AcquisitionNeed {
  const declared = hasText(input.declaredGrowthPriorities) || hasText(input.declaredGoals);
  const timeBound = input.declaredTimeBoundDriver === true;

  let state: AcquisitionNeedState;
  let rationale: string;
  let confidence: ConfidenceBand = 'low';

  if (timeBound) {
    state = 'observed';
    rationale = 'The company has declared a time-bound commercial driver for near-term demand.';
    confidence = 'medium';
  } else if (declared) {
    state = 'observed';
    rationale =
      'The company has declared growth priorities or goals implying a near-term demand need. This is a declaration of intent, not an observed shortfall.';
  } else {
    state = 'undetermined';
    rationale =
      'No declared growth priority, goal or time-bound driver was available, so a near-term demand need could not be established either way.';
  }

  const evidence: AcquisitionEvidence = {
    state: state === 'observed' ? 'inferred' : 'insufficient_signal',
    basis: state === 'observed'
      ? 'Declared Company Profile context (growth priorities / goals).'
      : 'No declared Company Profile context was available for this question.',
    notMeasurable:
      'Actual pipeline shortfall, revenue pressure or runway. None is publicly observable, and none was inferred from marketing performance.',
    unlock: state === 'observed'
      ? null
      : 'Declare your growth priorities and whether a time-bound commercial driver exists, so demand need can be assessed.',
  };

  return { state, rationale, evidence, confidence };
}

// ── Conversion gate ───────────────────────────────────────────────────────────

/** The locked conversion gate. Readiness, never a numeric score. */
export type ConversionGate = 'BLOCKING' | 'CONSTRAINED' | 'ADEQUATE' | 'NO_POSTURE';

export function conversionGateFrom(
  overallReadiness: ExperienceReadiness | null | undefined,
  conversionPillarReadiness: ExperienceReadiness | null | undefined,
): ConversionGate {
  // BLOCKING is the only arm that also considers OVERALL experience readiness: a critical
  // obstruction anywhere on the path still receives the paid traffic. The remaining arms key
  // on the conversion pillar alone, exactly as locked.
  if (overallReadiness === 'obstructed' || conversionPillarReadiness === 'obstructed') return 'BLOCKING';
  if (conversionPillarReadiness === 'partial') return 'CONSTRAINED';
  if (conversionPillarReadiness === 'ready') return 'ADEQUATE';
  return 'NO_POSTURE';
}

/**
 * Evidence that a PRIOR pilot was run and reviewed. The only route to PAID_SCALE_CANDIDATE,
 * and absent on every first report — public evidence can never establish readiness to scale.
 */
export type ReviewedPilotEvidence = {
  completed: true;
  metSuccessThreshold: boolean;
  basis: string;
};

export type PostureInput = {
  organic: OrganicCondition;
  paidActivity: PaidActivityObservation;
  paidReadiness: PaidReadiness;
  need: AcquisitionNeed;
  overallExperienceReadiness?: ExperienceReadiness | null;
  conversionPillarReadiness?: ExperienceReadiness | null;
  /** Omitted on a first report. Never synthesised. */
  reviewedPilot?: ReviewedPilotEvidence | null;
};

const WEAK_ORGANIC_BANDS: ReadonlySet<string> = new Set(['developing', 'foundational']);

// ── Presentation phrasing for the PERSISTED evidence basis ────────────────────
//
// `evidence.basis` is customer-facing prose AND it is persisted, so it is read by consumers
// that have no display layer at all: the stored report, an export, an API reader. Building it
// by interpolating the raw internal tokens published `demand need observed` to a company whose
// need was merely DECLARED -- contradicting, in the same section, both `need.rationale` ("a
// declaration of intent, not an observed shortfall") and `need.evidence.state` (`inferred`).
// `BLOCKING`, `none_found` and `UNRESOLVED` leaked the same way.
//
// Only the rendering of those tokens into this one sentence changes here. No state value, no
// posture, no gate and no evidence state is altered: `need.state` stays `observed` on its own
// axis and `need.evidence.state` stays `inferred` on the evidence axis, exactly as the contract
// intends.
//
// The wording is taken from the vocabulary 3H already shows customers and from this file's own
// rationales, so the two can never disagree. It is restated rather than imported because those
// maps live inside the HTML renderer: a decision service must not depend on a renderer, and 3H
// is frozen. Each map is keyed by its closed union, so a new member cannot silently fall back
// to a raw token -- it fails to compile until it is given words.

const ORGANIC_BAND_PHRASE: Record<OrganicBand, string> = {
  leading: 'is leading',
  operational: 'is operational',
  developing: 'is developing',
  foundational: 'is foundational',
  insufficient: 'could not be established',
};

const CONVERSION_GATE_PHRASE: Record<ConversionGate, string> = {
  BLOCKING: 'the publicly observed conversion path carries a critical obstruction',
  CONSTRAINED: 'the conversion pillar is partial rather than ready',
  ADEQUATE: 'the conversion path can carry a bounded test',
  NO_POSTURE: 'conversion readiness could not be evaluated',
};

const PAID_PRESENCE_PHRASE: Record<PaidPresenceState, string> = {
  observed: 'public advertising was observed',
  none_found: 'no public advertising was found through the available search',
  not_observable: 'the public ad record could not be read',
};

// Inline `import type` deliberately: a top-level import of this module would put the word
// "advertiser" into the region above `ConversionGate`, where a 3C test scans to prove that
// `assessAcquisitionNeed` cannot reach ads, organic, conversion or competitor signals. That
// assertion is correct and worth keeping, so the reference lives here instead.
const ADVERTISER_IDENTITY_PHRASE:
  Record<import('../ads/advertiserIdentityResolver').AdvertiserResolutionState, string> = {
  MATCHED: 'advertiser identity matched this company',
  PROBABLE_MATCH: 'advertiser identity is a probable match',
  NOT_MATCHED: 'no advertiser matched this company',
  UNRESOLVED: 'advertiser ownership could not be established',
  INSUFFICIENT_EVIDENCE: 'there was not enough evidence to resolve advertiser identity',
};

/**
 * Demand-need phrasing.
 *
 * The only correct reading of `observed` on the NEED axis is that a need was established FROM
 * A DECLARATION -- never that a shortfall was seen. This is the same sentence 3H shows, so the
 * persisted basis and the rendered label cannot drift apart.
 */
const DEMAND_NEED_PHRASE: Record<AcquisitionNeedState, string> = {
  observed: 'a near-term demand need was declared',
  not_established: 'no near-term demand need was established',
  undetermined: 'a near-term demand need could not be established either way',
};

/** Capitalise a phrase that begins a sentence. The maps stay lower-case for mid-sentence use. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Decide the posture. Order encodes the locked matrix.
 *
 *  CASE E  blocking conversion path outranks everything — buying traffic into it wastes money
 *  CASE D  scale requires reviewed pilot evidence; nothing else can produce it
 *  CASE G  insufficient evidence never collapses into another posture
 *          positive evidence of unsuitability, and only that, yields NOT_CURRENTLY_RECOMMENDED
 *  CASE B/C declared need + a path that can carry a test yields a CONTROLLED EXPERIMENT
 *  CASE A  a healthy foundation with no established need stays organic-led
 */
export function decideAcquisitionPosture(input: PostureInput): AcquisitionDecision {
  const gate = conversionGateFrom(input.overallExperienceReadiness, input.conversionPillarReadiness);
  const organicBand = input.organic.band;
  const needObserved = input.need.state === 'observed';
  const testable = gate === 'ADEQUATE' || gate === 'CONSTRAINED';

  let posture: AcquisitionPosture;
  let applicability: AcquisitionApplicability;
  let rationale: string;

  if (gate === 'BLOCKING') {
    posture = 'PAID_BLOCKED_BY_PREREQUISITE';
    applicability = 'conditional';
    rationale =
      'The publicly observed conversion path carries a critical obstruction, so paid traffic would arrive somewhere that cannot carry it. The prerequisite is fixing that path. This is a sequencing judgement, not a finding that advertising is wrong for this business. Re-run the acquisition decision once conversion readiness improves.';
  } else if (input.reviewedPilot?.completed === true && input.reviewedPilot.metSuccessThreshold) {
    posture = 'PAID_SCALE_CANDIDATE';
    applicability = 'relevant';
    rationale = `A prior pilot was completed and met its pre-set success threshold. ${input.reviewedPilot.basis}`;
  } else if (gate === 'NO_POSTURE' || organicBand === 'insufficient') {
    posture = 'INSUFFICIENT_EVIDENCE';
    applicability = 'undetermined';
    rationale =
      'The evidence needed for a defensible acquisition decision was not available: '
      + (gate === 'NO_POSTURE'
        ? 'conversion readiness could not be evaluated'
        : 'no organic dimension could be observed')
      + '. That is a gap in what could be seen, not a finding about this company.';
  } else if (input.paidReadiness.audienceDefinable === false && input.paidReadiness.offerClarity === 'unclear') {
    // POSITIVE evidence of unsuitability only. Never reached by absence of ads, absence of
    // analytics, weak organic, or an unresolved advertiser identity.
    posture = 'PAID_NOT_CURRENTLY_RECOMMENDED';
    applicability = 'not_recommended';
    rationale =
      'No definable audience was available and the offer was observed not to communicate clearly, so there is nothing a paid test could responsibly carry yet. This describes present readiness, not a permanent conclusion.';
  } else if (needObserved && testable) {
    // CASES B and C. Declared need plus a path that can carry a test yields a controlled
    // experiment at ANY organic band — never a scale recommendation.
    posture = 'ORGANIC_PLUS_CONTROLLED_PAID_PILOT';
    applicability = 'relevant';
    rationale =
      input.need.rationale
      + ' The conversion path can carry a bounded test'
      + (gate === 'CONSTRAINED'
        ? ', though only a constrained one: the conversion pillar is partial rather than ready'
        : '')
      + '. Organic work continues regardless — paid does not replace the foundation, it buys information and time while the foundation compounds.';
  } else if (WEAK_ORGANIC_BANDS.has(organicBand)) {
    // MATRIX GAP, resolved conservatively. Cases B and C both require an established demand
    // need; a weak organic band with no declared need is covered by neither, and Case A is
    // explicit that paid is not recommended merely because it is possible. So the foundation
    // keeps building and no spend is proposed.
    posture = 'ORGANIC_LED';
    applicability = 'relevant';
    rationale =
      'Organic discovery is still building and no near-term demand need was established, so there is no evidenced reason to buy demand yet. Continued organic investment is the better use of effort. This is not a finding that paid would fail — declare a growth priority or a time-bound driver and the decision can be revisited.';
  } else {
    // CASE A.
    posture = 'ORGANIC_LED';
    applicability = 'relevant';
    rationale =
      'The organic foundation is performing and no near-term demand need was established, so continued organic investment is the better use of effort. Paid is possible but not indicated; being able to advertise is not a reason to advertise.';
  }

  const confidence: ConfidenceBand =
    posture === 'INSUFFICIENT_EVIDENCE' ? 'low' : input.organic.confidence;

  const evidence: AcquisitionEvidence = {
    state: posture === 'INSUFFICIENT_EVIDENCE' ? 'insufficient_signal' : 'inferred',
    basis: [
      `Organic condition ${ORGANIC_BAND_PHRASE[organicBand]}.`,
      `${sentenceCase(CONVERSION_GATE_PHRASE[gate])}.`,
      `${sentenceCase(PAID_PRESENCE_PHRASE[input.paidActivity.presence])}, and `
        + `${ADVERTISER_IDENTITY_PHRASE[input.paidActivity.advertiserIdentity]}.`,
      `${sentenceCase(DEMAND_NEED_PHRASE[input.need.state])}.`,
    ].join(' '),
    notMeasurable:
      'Spend, return on ad spend, cost per acquisition, conversion rate, lifetime value and profitability. No private performance data was available, and none was inferred from public evidence.',
    unlock: posture === 'INSUFFICIENT_EVIDENCE'
      ? 'Re-run once the site exposes an observable conversion path, and declare growth priorities so a near-term demand need can be assessed.'
      : posture === 'ORGANIC_LED' && input.need.state === 'undetermined'
        ? 'Declare your growth priorities or a time-bound commercial driver to have paid acquisition reconsidered.'
        : null,
  };

  return {
    posture,
    applicability,
    rationale,
    evidence,
    confidence,

    organic: input.organic,
    paidActivity: input.paidActivity,
    paidReadiness: input.paidReadiness,
    need: input.need,

    // 3D–3G own these. A posture without its prerequisites, pilot, budget and review gate is
    // incomplete by design; filling them here would be inventing them.
    dependencies: [],
    pilot: null,
    learningFloor: null,
    budget: null,
    measurement: null,
    reviewGate: null,

    horizon: posture === 'PAID_BLOCKED_BY_PREREQUISITE' ? 'immediate'
      : posture === 'ORGANIC_LED' ? 'long'
        : posture === 'INSUFFICIENT_EVIDENCE' ? null
          : 'short',
    priority: posture === 'PAID_BLOCKED_BY_PREREQUISITE' ? 'high'
      : posture === 'INSUFFICIENT_EVIDENCE' ? null
        : 'medium',
  };
}

// ── SLICE 3D — DEPENDENCY WIRING ──────────────────────────────────────────────
//
// 3D attaches the prerequisites the decision ALREADY established to the existing
// `AcquisitionDependency` contract. It is downstream of posture and must never feed back
// into it: `attachAcquisitionDependencies` takes a finished decision and returns the same
// decision with `dependencies` populated. Nothing else on it is read for a verdict or
// rewritten, and a test asserts posture, need, organic and paid are byte-identical before
// and after.
//
// No new dependency abstraction: `AcquisitionDependency` is the 3A contract and its `id`
// already uses the `ExperiencePillar` vocabulary the rest of Report 1 uses. The other
// `dependsOn` in the codebase (`SnapshotPlanItem.dependsOn`) carries plan-item ordering,
// which is a different concern and is left alone.

export type ObstructedPillar = {
  /** An `ExperiencePillar` id. */
  pillar: string;
  label: string;
};

export type DependencyWiringInput = {
  overallExperienceReadiness?: ExperienceReadiness | null;
  conversionPillarReadiness?: ExperienceReadiness | null;
  /**
   * The pillars actually observed as obstructed. Supplied so a blocking dependency names the
   * REAL prerequisite: the 3C gate blocks on overall readiness OR the conversion pillar, so a
   * subject can be blocked while its conversion pillar is only `partial` -- naming conversion
   * there would misreport the evidence.
   */
  obstructedPillars?: ObstructedPillar[];
};

/**
 * Attach prerequisites to a decided acquisition decision.
 *
 * Deliberately narrow. A dependency is emitted ONLY where the upstream decision already
 * established the prerequisite:
 *
 *  - BLOCKING, only when the posture is already PAID_BLOCKED_BY_PREREQUISITE. 3D never
 *    discovers a blocker the posture engine did not.
 *  - ADVISORY, only for a `partial` conversion pillar under a controlled-pilot posture,
 *    because 3C's own rationale already states the test must be constrained for that reason.
 *
 * Everything else gets nothing. Weak organic is not a paid prerequisite -- the product model
 * exists precisely so a foundation can be built while a bounded test runs. Absent ads, an
 * UNRESOLVED or NOT_MATCHED advertiser, an unknown platform and undeclared urgency are
 * evidence conditions, not prerequisites. Insufficient evidence is not a defect: its unlock
 * already lives on `decision.evidence`, and duplicating it as a blocker would turn
 * uncertainty into a finding.
 */
export function attachAcquisitionDependencies(
  decision: AcquisitionDecision,
  input: DependencyWiringInput,
): AcquisitionDecision {
  const dependencies: AcquisitionDependency[] = [];

  if (decision.posture === 'PAID_BLOCKED_BY_PREREQUISITE') {
    const pillarObstructed = input.conversionPillarReadiness === 'obstructed';

    // Name the prerequisite from the evidence, not from the gate's name. When the conversion
    // pillar itself is obstructed it is the blocker; otherwise the blocker is whichever
    // pillar(s) the crawl actually found obstructed.
    const others = (input.obstructedPillars ?? []).filter((p) => p.pillar !== 'conversion_readiness');

    if (pillarObstructed) {
      dependencies.push({
        id: 'conversion_readiness',
        kind: 'blocking',
        label: 'Conversion readiness',
        why: 'The conversion path is currently obstructed. Resolve the identified conversion prerequisite before treating paid acquisition as a responsible next step.',
        resolvedBy: 'Fix the critical findings on the conversion path, then re-run this report.',
      });
    } else if (others.length > 0) {
      for (const pillar of others) {
        dependencies.push({
          id: pillar.pillar,
          kind: 'blocking',
          label: pillar.label,
          why: `${pillar.label} is currently obstructed on the public site, which obstructs the path paid traffic would arrive on. Resolve this prerequisite before treating paid acquisition as a responsible next step.`,
          resolvedBy: `Fix the critical ${pillar.label.toLowerCase()} findings, then re-run this report.`,
        });
      }
    } else {
      // Blocked, but the specific pillar was not supplied. Say that rather than guessing.
      dependencies.push({
        id: 'experience_readiness',
        kind: 'blocking',
        label: 'Website experience readiness',
        why: 'The publicly observed experience is obstructed, which obstructs the path paid traffic would arrive on. Resolve the identified prerequisite before treating paid acquisition as a responsible next step.',
        resolvedBy: 'Fix the critical findings identified in the website experience evidence, then re-run this report.',
      });
    }
  } else if (
    decision.posture === 'ORGANIC_PLUS_CONTROLLED_PAID_PILOT'
    && input.conversionPillarReadiness === 'partial'
  ) {
    // Advisory, not blocking. 3C deliberately permits the constrained pilot path.
    dependencies.push({
      id: 'conversion_readiness',
      kind: 'advisory',
      label: 'Conversion readiness',
      why: 'The conversion pillar is partial rather than ready. A bounded test can still run, but improving the conversion path first would raise what the test is able to tell you.',
      resolvedBy: 'Address the non-critical conversion findings alongside the test.',
    });
  }

  return { ...decision, dependencies };
}
