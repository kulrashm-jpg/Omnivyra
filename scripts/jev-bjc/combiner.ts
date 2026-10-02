/**
 * BJC deterministic/advisory combiner (spec §2.4). PURE — no I/O.
 *
 * Deterministic evidence is authoritative. JEV can only ADD flags (conflict,
 * invariant concern, low confidence). It can never turn FAIL into PASS, PASS
 * into FAIL, or missing evidence into anything but INSUFFICIENT_EVIDENCE.
 */
import {
  DETERMINISTIC_EVIDENCE_KINDS,
  type AcKind,
  type BjcRequest,
  type DeterministicResult,
  type JevAcAnswer,
  type JevInvariantAnswer,
  type Verdict,
} from './contract';

/**
 * Derive the authoritative result from the evidence items themselves (never
 * from a caller-asserted flag): FAIL if any required-kind item for this AC
 * failed; PASS only if every required kind has a PASS item and none failed;
 * otherwise MISSING.
 */
export function deriveDeterministicResult(req: BjcRequest): DeterministicResult {
  const acId = req.acceptance_criterion.id;
  const required = req.acceptance_criterion.required_evidence;
  const relevant = req.evidence.filter(
    (ev) =>
      ev.ac_ids.includes(acId) &&
      (DETERMINISTIC_EVIDENCE_KINDS as readonly string[]).includes(ev.kind) &&
      (required as readonly string[]).includes(ev.kind),
  );
  if (relevant.some((ev) => ev.result === 'FAIL')) return 'FAIL';
  if (required.length === 0) return 'MISSING';
  const covered = required.every((kind) => relevant.some((ev) => ev.kind === kind && ev.result === 'PASS'));
  return covered ? 'PASS' : 'MISSING';
}

export interface CombineInput {
  kind: AcKind;
  deterministic: DeterministicResult;
  jev: JevAcAnswer;
  invariantAnswers: JevInvariantAnswer[];
}

export interface CombineResult {
  verdict: Verdict;
  conflict: boolean;
  review_required: boolean;
  verification_eligible: boolean;
  rationale: string;
}

export function combine(input: CombineInput): CombineResult {
  const invariantConcern = input.invariantAnswers.includes('VIOLATED');
  const invariantNote = invariantConcern ? ' JEV flags a possible invariant violation; review it.' : '';

  if (input.kind === 'JUDGMENT') {
    return {
      verdict: 'ADVISORY_ONLY',
      conflict: false,
      review_required: true,
      verification_eligible: false,
      rationale: `JUDGMENT criterion: JEV answered ${input.jev}, which is advisory only. A human disposition is required before it counts as verified.${invariantNote}`,
    };
  }

  if (input.deterministic === 'FAIL') {
    const conflict = input.jev === 'SUPPORTS';
    return {
      verdict: 'FAIL',
      conflict,
      review_required: conflict || invariantConcern,
      verification_eligible: false,
      rationale: conflict
        ? `Deterministic evidence FAILED. JEV answered SUPPORTS; the disagreement is surfaced for review, but FAIL stands.${invariantNote}`
        : `Deterministic evidence FAILED; JEV answered ${input.jev}. FAIL stands.${invariantNote}`,
    };
  }

  if (input.deterministic === 'MISSING') {
    return {
      verdict: 'INSUFFICIENT_EVIDENCE',
      conflict: false,
      review_required: invariantConcern,
      verification_eligible: false,
      rationale: `Required deterministic evidence is missing; JEV answered ${input.jev}, which cannot substitute for it.${invariantNote}`,
    };
  }

  if (input.jev === 'CONTRADICTS') {
    return {
      verdict: 'PASS_DISPUTED',
      conflict: true,
      review_required: true,
      verification_eligible: false,
      rationale: `Deterministic evidence PASSED, but JEV answered CONTRADICTS. The deterministic PASS stands; the conflict needs a human disposition.${invariantNote}`,
    };
  }

  const corroborated = input.jev === 'SUPPORTS';
  return {
    verdict: corroborated ? 'PASS_CORROBORATED' : 'PASS_UNCORROBORATED',
    conflict: false,
    review_required: invariantConcern,
    verification_eligible: !invariantConcern,
    rationale: corroborated
      ? `Deterministic evidence PASSED and JEV answered SUPPORTS.${invariantNote}`
      : `Deterministic evidence PASSED; JEV answered ${input.jev}, so the PASS is uncorroborated.${invariantNote}`,
  };
}
