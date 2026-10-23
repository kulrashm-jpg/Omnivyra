/**
 * D1 — the ICP EVALUATOR. Pure, deterministic, and the implementation of
 * contract 18.
 *
 * It evaluates ONE ratified version (contract 14: there is only one) against
 * the observed attributes of ONE side of a prospect. Calling it twice — once
 * with `subject: 'account'`, once with `subject: 'person'` — is how account fit
 * and person fit are produced. They are two evaluations, never two ICPs.
 *
 * Modelled directly on `qualificationIntelligence/fromPolicy.ts`, which
 * evaluates a versioned, typed, IMMUTABLE policy against per-criterion
 * observations and abstains when nothing is evaluable. Same posture, same
 * `satisfied / unsatisfied / unknown` triple, same refusal to fabricate a state.
 *
 * ─── CONTRACT 18, THE THREE RULES ─────────────────────────────────────────
 *
 *   1. NO RATIFIED ICP  ⇒  NO CONTRIBUTION AT ALL.
 *      Not `value: 0`. Not `value: 0.5`. An empty `contributions` array.
 *      `combineDimension` filters on `value !== null && evidence.length > 0`
 *      and reports `abstained: true` when nothing survives — so emitting
 *      nothing is how this module says "we do not know", and it conforms to
 *      the frozen combiner instead of fighting it.
 *
 *   2. A MISSING ATTRIBUTE ⇒ `unknown`.
 *      Neither satisfied nor unsatisfied. A prospect is not a worse fit because
 *      WE never enriched their headcount; that is our gap, not their flaw. An
 *      `unknown` is excluded from the denominator entirely.
 *
 *   3. EVERY CONTRIBUTION CARRIES AN EvidenceRef NAMING (icp_id, version).
 *      Guaranteed structurally: `icpVersionEvidence` is always the FIRST
 *      element of the contribution's evidence array, and it is the only way a
 *      contribution is ever constructed here. A score that cannot say which
 *      version of which profile produced it is not explainable.
 *
 * ─── THE FIT VALUE ────────────────────────────────────────────────────────
 * `satisfied / (satisfied + unsatisfied)` over the criteria for this subject,
 * with one override: any UNSATISFIED `mandatory` criterion forces 0.
 *
 * There is no weighting, because there are no weights (see types.ts). The
 * denominator excludes `unknown` by rule 2. `mandatory` forcing zero mirrors
 * `fromPolicy`, where an unsatisfied mandatory criterion yields `disqualified`
 * regardless of what else passed.
 *
 * CONFIDENCE is coverage, not agreement: `0.5 + 0.5 * (evaluable / total)`. A
 * verdict reached from two of ten criteria is a real verdict held weakly; one
 * reached from ten of ten is the same verdict held firmly. It never reaches 0,
 * because an abstention is expressed by emitting nothing rather than by a
 * zero-confidence claim.
 *
 * No clock, no database, no network. `asOf` is passed in.
 */

import { clamp01, evidenceRef } from '../intelligence/canonical';
import type { EvidenceRef } from '../intelligence/canonical';
import {
  normalizeAnnualRevenue, normalizeCountryCode, normalizeDisplayText,
  normalizeEmployeeCount, normalizeFoundedYear, normalizeTechnologies,
} from '../prospectIdentity/attributes';
import { isMinorityCoverage } from './types';
import type {
  IcpContribution, IcpCriterion, IcpCriterionBasis, IcpCriterionOutcome,
  IcpCriterionRationale, IcpCriterionRationaleState, IcpCriterionResult,
  IcpEvaluationRationale, IcpEvaluationReason, IcpFitEvaluation, IcpRationaleState,
  IcpSubjectFacts, RatifiedIcp,
} from './types';

const CONTRIBUTOR = 'prospect_icp';

export interface IcpEvaluationInput {
  /**
   * The ratified version, or NULL when the tenant has none.
   *
   * `null` is a first-class input rather than a reason to skip the call: a
   * caller that only invokes the evaluator when an ICP exists has to remember
   * to abstain itself, and that is exactly the memory contract 18 exists to
   * remove.
   */
  ratified: RatifiedIcp | null;
  facts: IcpSubjectFacts;
  /** Deterministic evaluation instant. Never `Date.now()` inside. */
  asOf: string;
}

/**
 * The evidence reference that names `(icp_id, version)`.
 *
 * Every non-abstaining contribution carries this as evidence[0]. `source.ref`
 * is the durable `<icpId>@v<version>` coordinate, so a stored contribution can
 * be resolved back to the exact immutable document that produced it years
 * later — which is only meaningful because contract 16 makes that document
 * unchangeable.
 */
function icpVersionEvidence(icp: RatifiedIcp, at: string): EvidenceRef {
  return evidenceRef({
    id: `prospect_icp:${icp.icpId}:v${icp.version}`,
    kind: 'structured',
    label: 'icp_version',
    value: `${icp.icpId}@v${icp.version}`,
    source: { system: CONTRIBUTOR, ref: `${icp.icpId}@v${icp.version}` },
    observedAt: icp.ratifiedAt,
    recordedAt: at,
  });
}

function criterionEvidence(
  icp: RatifiedIcp, c: IcpCriterion, outcome: IcpCriterionOutcome, at: string,
): EvidenceRef {
  return evidenceRef({
    id: `prospect_icp:${icp.icpId}:v${icp.version}:${c.id}`,
    kind: 'structured',
    label: `icp_criterion:${c.id}`,
    value: outcome,
    source: { system: CONTRIBUTOR, ref: `${icp.icpId}@v${icp.version}` },
    observedAt: at,
    recordedAt: at,
  });
}

/** `null` means ABSENT — which is `unknown`, never a failed match. */
function readText(value: unknown): string | null {
  if (typeof value === 'number') return normalizeDisplayText(String(value));
  return normalizeDisplayText(typeof value === 'string' ? value : null);
}

function readNumber(attribute: string, value: unknown): number | null {
  const v = value as number | string | null | undefined;
  if (attribute === 'employee_count') return normalizeEmployeeCount(v);
  if (attribute === 'annual_revenue') return normalizeAnnualRevenue(v);
  if (attribute === 'founded_year') return normalizeFoundedYear(v);
  // Unreachable while `criteria.ts` owns the numeric attribute list; kept so a
  // future numeric attribute degrades to `unknown` rather than to a wrong match.
  return null;
}

/**
 * A technology list. `normalizeTechnologies` yields JSON ARRAY TEXT (its own
 * contract, because canonical values travel through a text column), so it is
 * parsed back here rather than re-implemented.
 *
 * An EMPTY list is `unknown`, not "matches nothing". LI-1 preserves `[]` as
 * "we looked and found none", but an ICP criterion asking whether a company
 * uses a technology cannot be answered from a list that contains nothing.
 */
function readStringArray(value: unknown): string[] | null {
  const json = normalizeTechnologies(value as string[] | string | null | undefined);
  if (json === null) return null;
  const parsed = JSON.parse(json) as string[];
  return parsed.length ? parsed : null;
}

/**
 * PI-WP-C3 — was the attribute ABSENT, or present-and-unreadable?
 *
 * Both collapse to `unknown`, and both are correctly excluded from the score.
 * They are NOT the same fact: one says we never enriched the prospect, the
 * other says a provider gave us something we refused to trust. Neither is a
 * negative, and this is read from the RAW value before any normaliser erases
 * the difference by returning `null` for both.
 */
function scalarPresence(raw: unknown): 'absent' | 'present' {
  if (raw === null || raw === undefined) return 'absent';
  // A blank string in a scalar field is a recorded nothing, not a bad value.
  if (typeof raw === 'string' && raw.trim().length === 0) return 'absent';
  return 'present';
}

interface CriterionReading {
  outcome: IcpCriterionOutcome;
  basis: IcpCriterionBasis;
}

const unknownReading = (basis: IcpCriterionBasis): CriterionReading => ({ outcome: 'unknown', basis });
const decided = (hit: boolean): CriterionReading => ({
  outcome: hit ? 'satisfied' : 'unsatisfied', basis: 'observed',
});

/**
 * Evaluate one criterion. Absence is `unknown`; only a present value can fail.
 *
 * The OUTCOME half of this function is unchanged by PI-WP-C3 — every branch
 * returns exactly what it always returned. The `basis` half is new and is
 * carried alongside, never consulted, by the scoring path.
 */
function evaluateCriterion(c: IcpCriterion, attributes: Record<string, unknown>): CriterionReading {
  const raw = attributes[c.attribute];
  const p = c.predicate;

  if (p.op === 'between' || p.op === 'at_least' || p.op === 'at_most') {
    const n = readNumber(c.attribute, raw);
    if (n === null) return unknownReading(scalarPresence(raw) === 'absent' ? 'absent' : 'unreadable');
    if (p.op === 'between') return decided(n >= p.min && n <= p.max);
    if (p.op === 'at_least') return decided(n >= p.value);
    return decided(n <= p.value);
  }

  if (p.op === 'includes_any' || p.op === 'includes_all') {
    // Three different nothings, told apart before `readStringArray` flattens
    // them: no list at all, a list we could not parse, and a list with nothing
    // in it. Only the third means "we looked and the set is empty".
    if (raw === null || raw === undefined) return unknownReading('absent');
    if (typeof raw === 'string' && raw.trim().length === 0) return unknownReading('absent');
    const parseable = normalizeTechnologies(raw as string[] | string | null | undefined);
    if (parseable === null) return unknownReading('unreadable');
    const list = readStringArray(raw);
    if (list === null) return unknownReading('empty');
    const held = new Set(list);
    return decided(p.op === 'includes_any'
      ? p.values.some((v) => held.has(v))
      : p.values.every((v) => held.has(v)));
  }

  // `one_of` — the only text predicate. EXACT membership (contract 17): no
  // case-folding beyond the country code's own rule, no substring, no fuzz.
  const text = c.attribute === 'country_code'
    ? normalizeCountryCode(typeof raw === 'string' ? raw : null)
    : readText(raw);
  if (text === null) return unknownReading(scalarPresence(raw) === 'absent' ? 'absent' : 'unreadable');
  return decided(p.values.includes(text));
}

// ── PI-WP-C3 — the rationale, derived AFTER the fact ────────────────────────
/**
 * Basis + outcome ⇒ the criterion's rationale state. A total mapping with no
 * default branch that could quietly turn an unhandled case into a negative:
 * `negative_evidence` is reachable ONLY from `outcome === 'unsatisfied'`, which
 * `evaluateCriterion` produces only after reading a real value.
 */
function criterionState(r: CriterionReading): IcpCriterionRationaleState {
  if (r.outcome === 'satisfied') return 'satisfied';
  if (r.outcome === 'unsatisfied') return 'negative_evidence';
  return r.basis === 'absent' ? 'no_evidence' : 'uninterpretable';
}

/** A rendering of the record. Every token comes from the criterion itself. */
function criterionStatement(c: IcpCriterion, r: CriterionReading): string {
  const what = `${c.attribute} (criterion ${c.id}, ${c.predicate.op})`;
  if (r.outcome === 'satisfied') return `${what} was observed and satisfies the criterion`;
  if (r.outcome === 'unsatisfied') return `${what} was observed and does not satisfy the criterion`;
  if (r.basis === 'absent') return `${what} was not observed; not evaluated, and not a negative`;
  if (r.basis === 'empty') return `${what} was observed as an empty set; not evaluated, and not a negative`;
  return `${what} was observed but could not be interpreted; not evaluated, and not a negative`;
}

function criterionRationale(c: IcpCriterion, r: CriterionReading): IcpCriterionRationale {
  return {
    id: c.id,
    kind: c.kind,
    subject: c.subject,
    attribute: c.attribute,
    predicate: c.predicate.op,
    outcome: r.outcome,
    basis: r.basis,
    state: criterionState(r),
    suppressing: c.kind === 'mandatory' && r.outcome === 'unsatisfied',
    statement: criterionStatement(c, r),
  };
}

const STATE_ORDER: readonly IcpRationaleState[] = [
  'not_applicable', 'suppressed', 'no_evidence', 'uninterpretable',
  'insufficient_confidence', 'negative_evidence', 'satisfied',
];

function evaluationStatement(rationale: Omit<IcpEvaluationRationale, 'statement'>, reason: IcpEvaluationReason): string {
  const { state, coverage: cov } = rationale;
  if (state === 'not_applicable') return `no ICP fit was evaluated for this subject (${reason})`;
  if (state === 'suppressed') {
    return `disqualified: mandatory criteria observed and not satisfied — ${rationale.suppressedBy.join(', ')}`;
  }
  if (state === 'no_evidence' || state === 'uninterpretable') {
    return `no criterion could be evaluated: of ${cov.total} criteria, ${rationale.missingEvidence.length} had no evidence held and ${rationale.uninterpretable.length} had evidence that could not be interpreted; this is not a negative`;
  }
  if (state === 'insufficient_confidence') {
    const why = rationale.unevaluableMandatory.length
      ? `mandatory criteria were not evaluable — ${rationale.unevaluableMandatory.join(', ')}`
      : `the verdict rests on a minority of the profile`;
    return `evaluated on ${cov.evaluable} of ${cov.total} criteria; ${why}`;
  }
  if (state === 'negative_evidence') {
    return `${rationale.negativeEvidence.length} of ${cov.evaluable} evaluated criteria were observed and not satisfied — ${rationale.negativeEvidence.join(', ')}`;
  }
  return `all ${cov.evaluable} evaluated criteria were satisfied`;
}

/**
 * Assemble the evaluation-level rationale from the per-criterion records.
 *
 * Reads the SAME `results` the score was derived from and adds no input of its
 * own, so it cannot disagree with the score it explains. `applicable` is not a
 * verdict — it is `false` only when there was no ICP or no criterion for this
 * subject, i.e. when nothing at all was claimed about the prospect.
 */
function buildRationale(
  criteria: IcpCriterionRationale[], reason: IcpEvaluationReason, applicable: boolean,
): IcpEvaluationRationale {
  const negativeEvidence = criteria.filter((c) => c.state === 'negative_evidence').map((c) => c.id);
  const missingEvidence = criteria.filter((c) => c.state === 'no_evidence').map((c) => c.id);
  const uninterpretable = criteria.filter((c) => c.state === 'uninterpretable').map((c) => c.id);
  const suppressedBy = criteria.filter((c) => c.suppressing).map((c) => c.id);
  const unevaluableMandatory = criteria
    .filter((c) => c.kind === 'mandatory' && c.outcome === 'unknown').map((c) => c.id);

  const evaluable = criteria.filter((c) => c.outcome !== 'unknown').length;
  const coverage = { evaluable, total: criteria.length };

  const applies = new Set<IcpRationaleState>();
  if (!applicable) {
    applies.add('not_applicable');
  } else if (evaluable === 0) {
    // Nothing was evaluated, so the ONLY thing to explain is which nothing we
    // held. Both may apply at once — some attributes absent, others present
    // and unreadable — and both are then listed, with their exact ids below.
    if (missingEvidence.length) applies.add('no_evidence');
    if (uninterpretable.length) applies.add('uninterpretable');
  } else {
    // A verdict WAS reached. `no_evidence` and `uninterpretable` are not
    // evaluation-level states here — gaps that did not prevent a verdict are
    // reported as ids, and their effect on trust is `insufficient_confidence`.
    // Promoting them to the headline would read as "we concluded nothing" for
    // an evaluation that concluded something.
    if (suppressedBy.length) applies.add('suppressed');
    if (unevaluableMandatory.length || isMinorityCoverage(evaluable, criteria.length)) {
      applies.add('insufficient_confidence');
    }
    if (negativeEvidence.length) applies.add('negative_evidence');
    if (applies.size === 0) applies.add('satisfied');
  }

  const contributing = STATE_ORDER.filter((s) => applies.has(s));
  const base = {
    state: contributing[0],
    contributing,
    criteria,
    negativeEvidence,
    missingEvidence,
    uninterpretable,
    suppressedBy,
    unevaluableMandatory,
    coverage,
  };
  return { ...base, statement: evaluationStatement(base, reason) };
}

/** The shape returned whenever nothing may be contributed. */
function abstain(
  subject: IcpSubjectFacts['subject'],
  reason: IcpFitEvaluation['reason'],
  icp: RatifiedIcp | null,
  results: IcpCriterionResult[] = [],
  rationaleCriteria: IcpCriterionRationale[] = [],
): IcpFitEvaluation {
  return {
    icpId: icp?.icpId ?? null,
    version: icp?.version ?? null,
    subject,
    results,
    satisfied: [],
    unsatisfied: [],
    unknown: results.map((r) => r.id),
    contributions: [],          // contract 18: nothing, not zero
    evidence: [],
    abstained: true,
    reason,
    // An abstention with no criteria at all is `not_applicable`: there was no
    // ratified ICP, or none of it addresses this subject. That is a gap in the
    // PROFILE, not in what we know about the prospect, and it is the one thing
    // the five prospect-facing states must not be used to describe.
    rationale: buildRationale(rationaleCriteria, reason, rationaleCriteria.length > 0),
  };
}

export function evaluateIcpFit(input: IcpEvaluationInput): IcpFitEvaluation {
  const { ratified, facts, asOf } = input;
  const subject = facts.subject;

  // RULE 1. No ratified ICP ⇒ no contribution at all. A draft or a proposal
  // never reaches here: `RatifiedIcp` is the only accepted type, so an
  // unratified version cannot be passed in without a deliberate cast.
  if (!ratified) return abstain(subject, 'no_ratified_icp', null);

  const criteria = ratified.criteria
    .filter((c) => c.subject === subject)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));   // deterministic ordering

  if (criteria.length === 0) return abstain(subject, 'no_criteria_for_subject', ratified);

  const at = facts.observedAt ?? asOf;
  const results: IcpCriterionResult[] = [];
  const satisfied: string[] = [];
  const unsatisfied: string[] = [];
  const unknown: string[] = [];
  const criterionEv: EvidenceRef[] = [];
  const rationaleCriteria: IcpCriterionRationale[] = [];

  for (const c of criteria) {
    const reading = evaluateCriterion(c, facts.attributes ?? {});
    const outcome = reading.outcome;
    results.push({ id: c.id, kind: c.kind, subject: c.subject, attribute: c.attribute, outcome });
    rationaleCriteria.push(criterionRationale(c, reading));
    if (outcome === 'satisfied') satisfied.push(c.id);
    else if (outcome === 'unsatisfied') unsatisfied.push(c.id);
    else unknown.push(c.id);
    // Evidence is recorded for EVALUATED criteria only. An `unknown` produced
    // no observation, so citing one would assert that we looked and saw.
    if (outcome !== 'unknown') criterionEv.push(criterionEvidence(ratified, c, outcome, at));
  }

  const evaluable = satisfied.length + unsatisfied.length;

  // RULE 2's consequence: every criterion was `unknown`, so there is nothing to
  // conclude from. Abstain rather than score a prospect on our own data gaps.
  if (evaluable === 0) {
    const out = abstain(subject, 'no_evaluable_criteria', ratified, results, rationaleCriteria);
    return { ...out, unknown };
  }

  const mandatoryUnsatisfied = results.some((r) => r.kind === 'mandatory' && r.outcome === 'unsatisfied');
  const value = mandatoryUnsatisfied ? 0 : clamp01(satisfied.length / evaluable);
  const confidence = clamp01(0.5 + 0.5 * (evaluable / criteria.length));

  // RULE 3. The version reference is evidence[0], always.
  const evidence: EvidenceRef[] = [icpVersionEvidence(ratified, asOf), ...criterionEv];

  const contribution: IcpContribution = {
    dimension: 'icp',
    contributor: CONTRIBUTOR,
    method: 'deterministic',
    value,
    confidence,
    evidence,
    asOf: at,
  };

  const reason: IcpEvaluationReason = mandatoryUnsatisfied ? 'mandatory_unsatisfied' : 'evaluated';

  return {
    icpId: ratified.icpId,
    version: ratified.version,
    subject,
    results,
    satisfied,
    unsatisfied,
    unknown,
    contributions: [contribution],
    evidence,
    abstained: false,
    reason,
    // Derived from `rationaleCriteria`, which is the same reading `value` and
    // `confidence` were derived from — so the explanation and the score cannot
    // drift. Nothing above this line reads it.
    rationale: buildRationale(rationaleCriteria, reason, true),
  };
}
