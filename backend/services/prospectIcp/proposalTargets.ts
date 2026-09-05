/**
 * ICP-SELECTION-CONTRACT-001 §12/§13 — the proposal-metadata validator.
 *
 * This is the counterpart to `criteria.ts`, and the division between them is
 * the contract's central rule rather than a filing decision:
 *
 *   criteria.ts        — the SCORING surface. Contract 17. Read by the evaluator.
 *   proposalTargets.ts — the RANKED SHORTLIST and its provenance. Read by nobody
 *                        but a human reviewer.
 *
 * §10 is explicit and mandatory: the ranked 2–5 targets MUST NOT become separate
 * ICP criteria. The evaluator computes `satisfied / evaluable`, so five targets
 * modelled as five criteria would score a person matching one role at 1/5 = 0.2
 * — a scoring defect that presents as poor data quality. The selected titles
 * become ONE union `one_of` criterion; everything this file validates stays in
 * `proposal` and has NO effect on scoring.
 *
 * Accordingly this module never imports, reads, constructs or returns an
 * `IcpCriterion`, and never touches the evaluator.
 *
 * ─── WHAT IT REFUSES, AND WHY ──────────────────────────────────────────────
 * §5's invariant is that every proposed role traces to named evidence — "no
 * evidence = no candidate". A validator that quietly defaulted a missing
 * `evidenceFields` to `[]` would convert an unsupported claim into a
 * well-formed record, which is the one failure this contract exists to prevent.
 * So a TARGET's evidence list may not be empty: absence is refused, never
 * filled in.
 *
 * That invariant is scoped to ROLES — "a ROLE that cannot cite a source field is
 * not a candidate" — and this file is scoped the same way. Two things it does
 * NOT police, because the frozen contract does not:
 *
 *   • `stageAssumption.evidenceFields` — §5 speaks only about roles, and no
 *     other section requires evidence for the stage conclusion.
 *   • a quote on a `directly_evidenced` target — §12 makes `derivation` itself
 *     the mechanism ("`derivation` is mandatory on every target for exactly this
 *     reason") and states no quote requirement.
 *
 * Both would be defensible product rules. Neither is in the contract, and
 * inventing a stricter rule here would put the validator ahead of the document
 * it enforces.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT ENFORCE ─────────────────────────────────
 * The 2–5 band. §8 calls it "the AI recommendation, never a product limit":
 * users may expand beyond five, and abstention upstream may legitimately yield
 * fewer than two (or none). This validator checks STRUCTURE, not the
 * recommendation. `MAX_ICP_TARGETS` below is a storage sanity bound in the
 * spirit of `MAX_CRITERIA`, not the band.
 *
 * This module is PURE: no database, no network, no clock.
 */

import { normalizeDisplayText } from '../prospectIdentity/attributes';
import {
  ICP_CONFIDENCE_LEVELS, ICP_CONFIDENCE_MULTIPLIER, ICP_ORG_STAGES,
  ICP_TARGET_DERIVATIONS, ICP_TARGET_ROLE_TYPES, IcpContractError,
  type IcpConfidenceLevel, type IcpOrgStage, type IcpProposal, type IcpRejected,
  type IcpStageAssumption, type IcpTarget, type IcpTargetDerivation, type IcpTargetFactors,
  type IcpTargetRoleType,
} from './types';

/**
 * A storage sanity bound, mirroring `MAX_CRITERIA`. This is NOT the §8
 * recommendation band — see the header.
 */
export const MAX_ICP_TARGETS = 100;

/** What `validateProposalTargets` returns: the three §13 fields, normalised. */
export interface ValidatedProposalTargets {
  targets: IcpTarget[];
  rejected: IcpRejected[];
  stageAssumption?: IcpStageAssumption;
}

function fail(message: string, code: string): never {
  throw new IcpContractError(message, code);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const includes = (vocab: readonly string[], v: unknown): v is string =>
  typeof v === 'string' && vocab.includes(v);

/** A required, non-blank display string. Blank and non-string both refuse. */
function requiredText(value: unknown, what: string, code: string): string {
  const text = normalizeDisplayText(typeof value === 'string' ? value : null);
  if (text === null) fail(`${what} is required and must be a non-blank string`, code);
  return text;
}

/**
 * An array of non-blank strings. `allowEmpty` is false wherever §5's invariant
 * applies, so an empty evidence list is refused rather than accepted.
 */
function stringArray(value: unknown, what: string, code: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`, `${code}_not_array`);
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeDisplayText(typeof item === 'string' ? item : null);
    if (text === null) fail(`${what} must contain only non-blank strings`, `${code}_blank_entry`);
    out.push(text);
  }
  if (!allowEmpty && out.length === 0) fail(`${what} must not be empty`, `${code}_empty`);
  return out;
}

/**
 * §7's factor block. `c` must AGREE with the target's `confidence` rather than
 * being free: the two encode the same fact, and a proposal asserting `low`
 * confidence with a ×1.0 multiplier is internally contradictory provenance.
 */
function validateFactors(
  value: unknown, rank: number, confidence: IcpConfidenceLevel,
): IcpTargetFactors {
  if (!isRecord(value)) fail(`target ${rank}: factors must be an object`, 'target_factors_not_object');

  const score = (key: 'e' | 'p' | 'b' | 'f' | 'r'): 0 | 1 | 2 => {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 2) {
      fail(`target ${rank}: factors.${key} must be an integer 0-2`, 'target_factor_out_of_range');
    }
    return raw as 0 | 1 | 2;
  };

  const e = score('e');
  if (e === 0) {
    fail(
      `target ${rank}: factors.e is 0, which §7 makes a HARD EXCLUSION — a candidate `
      + 'with no evidence is not a target and belongs in `rejected`',
      'target_evidence_factor_zero',
    );
  }

  const expected = ICP_CONFIDENCE_MULTIPLIER[confidence];
  if (typeof value.c !== 'number' || value.c !== expected) {
    fail(
      `target ${rank}: factors.c must be ${expected} for confidence '${confidence}' (§7)`,
      'target_multiplier_mismatch',
    );
  }

  return { e, p: score('p'), b: score('b'), f: score('f'), r: score('r'), c: value.c };
}

function validateTarget(raw: unknown, index: number): IcpTarget {
  if (!isRecord(raw)) fail(`target at position ${index} must be an object`, 'target_not_object');

  const rank = raw.rank;
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1) {
    fail(`target at position ${index}: rank must be a positive integer`, 'target_rank_invalid');
  }

  const title = requiredText(raw.title, `target ${rank}: title`, 'target_title_missing');

  const roles = stringArray(raw.roleTypes, `target ${rank}: roleTypes`, 'target_role_types', false);
  for (const role of roles) {
    if (!includes(ICP_TARGET_ROLE_TYPES, role)) {
      fail(
        `target ${rank}: '${role}' is not a role type (${ICP_TARGET_ROLE_TYPES.join(', ')})`,
        'target_role_type_invalid',
      );
    }
  }
  // Deterministic, so two equivalent submissions store byte-identically.
  const roleTypes = [...new Set(roles)].sort() as IcpTargetRoleType[];

  if (!includes(ICP_TARGET_DERIVATIONS, raw.derivation)) {
    fail(
      `target ${rank}: derivation must be ${ICP_TARGET_DERIVATIONS.join(' | ')}`,
      'target_derivation_invalid',
    );
  }
  const derivation = raw.derivation as IcpTargetDerivation;

  // Case is normalised because the source (`field_confidence`) capitalises and
  // the repository's TypeScript vocabulary does not. Anything outside the
  // vocabulary is still refused, never coerced to a neighbour.
  const confidenceRaw = typeof raw.confidence === 'string' ? raw.confidence.trim().toLowerCase() : raw.confidence;
  if (!includes(ICP_CONFIDENCE_LEVELS, confidenceRaw)) {
    fail(
      `target ${rank}: confidence must be ${ICP_CONFIDENCE_LEVELS.join(' | ')}`,
      'target_confidence_invalid',
    );
  }
  const confidence = confidenceRaw as IcpConfidenceLevel;

  const evidenceFields = stringArray(
    raw.evidenceFields, `target ${rank}: evidenceFields`, 'target_evidence_fields', false);

  // Absent means "none supplied", and that is permitted for either derivation.
  // §12 assigns the "never presented as observed" guarantee to `derivation`
  // being mandatory, not to the presence of a quote — see the header.
  const evidenceQuotes = raw.evidenceQuotes === undefined
    ? []
    : stringArray(raw.evidenceQuotes, `target ${rank}: evidenceQuotes`, 'target_evidence_quotes', true);

  const orgAssumption = requiredText(
    raw.orgAssumption, `target ${rank}: orgAssumption`, 'target_org_assumption_missing');

  return {
    rank, title, roleTypes, derivation, confidence, evidenceFields, evidenceQuotes, orgAssumption,
    factors: validateFactors(raw.factors, rank, confidence),
  };
}

/**
 * An EMPTY or absent target list is permitted and is not an error — §9 makes
 * abstention a first-class outcome, and `validateCriteria` takes the same
 * position about an empty criteria array for the same reason.
 */
function validateTargets(value: unknown): IcpTarget[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('targets must be an array', 'targets_not_array');
  if (value.length > MAX_ICP_TARGETS) {
    fail(
      `targets exceeds the ${MAX_ICP_TARGETS}-target storage bound (got ${value.length})`,
      'targets_too_many',
    );
  }

  const out = value.map((raw, index) => validateTarget(raw, index));

  // Titles are compared case-insensitively: a shortlist offering "Marketing
  // Manager" and "marketing manager" as two of its targets is a review defect,
  // even though both are distinct match strings once they reach the union
  // criterion — where enumerating casings IS legitimate.
  const seenTitle = new Set<string>();
  for (const target of out) {
    const key = target.title.toLowerCase();
    if (seenTitle.has(key)) {
      fail(
        `duplicate target title '${target.title}' — the shortlist is a set of distinct roles`,
        'target_title_duplicate',
      );
    }
    seenTitle.add(key);
  }

  // Ranks must be unique AND contiguous from 1. A shortlist ranked 1,2,4 has
  // lost a target somewhere between selection and serialisation.
  const ranks = out.map((t) => t.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i += 1) {
    if (ranks[i] !== i + 1) {
      fail(
        `target ranks must be unique and contiguous from 1 to ${ranks.length} (got ${ranks.join(', ')})`,
        'target_ranks_incoherent',
      );
    }
  }

  return [...out].sort((a, b) => a.rank - b.rank);
}

function validateRejected(value: unknown): IcpRejected[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('rejected must be an array', 'rejected_not_array');

  const out: IcpRejected[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) fail('each rejected entry must be an object', 'rejected_not_object');
    const title = requiredText(raw.title, 'rejected entry: title', 'rejected_title_missing');
    const reason = requiredText(raw.reason, `rejected '${title}': reason`, 'rejected_reason_missing');
    const key = title.toLowerCase();
    if (seen.has(key)) fail(`duplicate rejected title '${title}'`, 'rejected_title_duplicate');
    seen.add(key);
    out.push({ title, reason });
  }
  // Rejections carry no inherent order; sorting makes storage deterministic.
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function validateStageAssumption(value: unknown): IcpStageAssumption {
  if (!isRecord(value)) fail('stageAssumption must be an object', 'stage_assumption_not_object');

  const stage = typeof value.stage === 'string' ? value.stage.trim().toLowerCase() : value.stage;
  if (!includes(ICP_ORG_STAGES, stage)) {
    fail(
      `stageAssumption.stage must be ${ICP_ORG_STAGES.join(' | ')}`,
      'stage_assumption_stage_invalid',
    );
  }

  // §5's invariant covers ROLES, not the stage conclusion, so an absent or
  // empty list is accepted here — unlike on a target. The field is still always
  // emitted, so §12's "retains" shape holds.
  const evidenceFields = value.evidenceFields === undefined || value.evidenceFields === null
    ? []
    : stringArray(value.evidenceFields, 'stageAssumption.evidenceFields', 'stage_assumption_evidence', true);

  return {
    stage: stage as IcpOrgStage,
    evidenceFields,
    rationale: normalizeDisplayText(typeof value.rationale === 'string' ? value.rationale : null),
  };
}

/**
 * Validate the §13 proposal metadata. Accepts anything object-shaped — normally
 * an `IcpProposal` — and reads only `targets`, `rejected` and `stageAssumption`.
 *
 * It returns the normalised triple rather than a whole proposal, so a caller
 * composes it back onto the proposal it already holds. It never inspects,
 * derives from, or returns criteria.
 *
 * @throws IcpContractError with a `code` naming the exact rule that refused.
 */
export function validateProposalTargets(input: unknown): ValidatedProposalTargets {
  if (!isRecord(input)) fail('proposal metadata must be an object', 'proposal_not_object');

  const stage = input.stageAssumption;
  return {
    targets: validateTargets(input.targets),
    rejected: validateRejected(input.rejected),
    stageAssumption: stage === undefined || stage === null ? undefined : validateStageAssumption(stage),
  };
}

/**
 * The writer's entry point: validate a whole proposal's §13 metadata and return
 * the proposal with the NORMALISED metadata substituted in.
 *
 * Two properties matter more than the validation itself.
 *
 * ADDITIVE. Only keys the caller actually supplied are written back. A proposal
 * that never mentions targets is returned unchanged, with no new keys — so
 * every proposal shape that was storable before this contract existed still
 * stores byte-identically, and nothing has to be migrated.
 *
 * SEPARATE. It reads and returns only `proposal`. It never sees the criteria
 * array, so no target can leak into the scoring surface (§10).
 *
 * @throws IcpContractError before the caller writes anything.
 */
export function withValidatedTargets(proposal?: IcpProposal | null): IcpProposal {
  const base: IcpProposal = proposal ?? {};
  const validated = validateProposalTargets(base);
  const out: IcpProposal = { ...base };

  if (base.targets !== undefined) out.targets = validated.targets;
  if (base.rejected !== undefined) out.rejected = validated.rejected;
  if (base.stageAssumption !== undefined) {
    // An explicit `null` validates to "absent", and absent means the key goes.
    if (validated.stageAssumption === undefined) delete out.stageAssumption;
    else out.stageAssumption = validated.stageAssumption;
  }
  return out;
}
