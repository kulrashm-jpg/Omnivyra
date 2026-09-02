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
import type {
  IcpContribution, IcpCriterion, IcpCriterionOutcome, IcpCriterionResult,
  IcpFitEvaluation, IcpSubjectFacts, RatifiedIcp,
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

/** Evaluate one criterion. Absence is `unknown`; only a present value can fail. */
function evaluateCriterion(c: IcpCriterion, attributes: Record<string, unknown>): IcpCriterionOutcome {
  const raw = attributes[c.attribute];
  const p = c.predicate;

  if (p.op === 'between' || p.op === 'at_least' || p.op === 'at_most') {
    const n = readNumber(c.attribute, raw);
    if (n === null) return 'unknown';
    if (p.op === 'between') return n >= p.min && n <= p.max ? 'satisfied' : 'unsatisfied';
    if (p.op === 'at_least') return n >= p.value ? 'satisfied' : 'unsatisfied';
    return n <= p.value ? 'satisfied' : 'unsatisfied';
  }

  if (p.op === 'includes_any' || p.op === 'includes_all') {
    const list = readStringArray(raw);
    if (list === null) return 'unknown';
    const held = new Set(list);
    const hit = p.op === 'includes_any'
      ? p.values.some((v) => held.has(v))
      : p.values.every((v) => held.has(v));
    return hit ? 'satisfied' : 'unsatisfied';
  }

  // `one_of` — the only text predicate. EXACT membership (contract 17): no
  // case-folding beyond the country code's own rule, no substring, no fuzz.
  const text = c.attribute === 'country_code'
    ? normalizeCountryCode(typeof raw === 'string' ? raw : null)
    : readText(raw);
  if (text === null) return 'unknown';
  return p.values.includes(text) ? 'satisfied' : 'unsatisfied';
}

/** The shape returned whenever nothing may be contributed. */
function abstain(
  subject: IcpSubjectFacts['subject'],
  reason: IcpFitEvaluation['reason'],
  icp: RatifiedIcp | null,
  results: IcpCriterionResult[] = [],
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

  for (const c of criteria) {
    const outcome = evaluateCriterion(c, facts.attributes ?? {});
    results.push({ id: c.id, kind: c.kind, subject: c.subject, attribute: c.attribute, outcome });
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
    const out = abstain(subject, 'no_evaluable_criteria', ratified, results);
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
    reason: mandatoryUnsatisfied ? 'mandatory_unsatisfied' : 'evaluated',
  };
}
