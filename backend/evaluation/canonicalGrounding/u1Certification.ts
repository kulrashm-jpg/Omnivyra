/**
 * DT-C4 — INDEPENDENT GROUND-TRUTH CERTIFICATION (evaluation-only, pure).
 *
 * ⚠️ STATUS AT TIME OF WRITING: **INDEPENDENT AUTHORSHIP NOT AVAILABLE** ⚠️
 * ---------------------------------------------------------------------------
 * No independent human participated in DT-C4. `CURRENT_CERTIFICATION` is `null`,
 * and `canonicalGrounding.u1Dataset.v2` therefore remains **NOT VERIFIED** — a
 * self-authored engineering fixture. Nothing in this module changes that; it
 * exists so that independence, when it is eventually obtained, is RECORDED AS
 * DATA and mechanically enforced rather than asserted in prose.
 *
 * WHAT THIS MODULE IS FOR
 * -----------------------
 * DT-C3 established that a dataset hash proves immutability but never
 * independence. This module closes that gap structurally:
 *
 *   • A certification is a DATA RECORD supplied from outside this codebase.
 *     The agent cannot synthesise one — there is no constructor that invents
 *     attestations, and none is exported.
 *   • `evaluateIndependence()` derives the verdict from the record alone. A
 *     missing record yields NOT_VERIFIED. There is no default-to-verified path.
 *   • `sealWithCertification()` REFUSES to seal unless the verdict is VERIFIED,
 *     so "sealed after independent approval" (§9) is enforced by the code rather
 *     than left to procedure.
 *   • A certification is bound to an exact `datasetSha256`. Editing so much as
 *     one company fact invalidates the certification automatically, which makes
 *     post-hoc dataset tampering detectable rather than merely prohibited.
 *
 * PURITY: no I/O, no network, no clock, no RNG, no database. Same input → same
 * output. `crypto` is used only as a pure hash of its input.
 *
 * PRIVACY: `authorRef` is a PSEUDONYMOUS reference (e.g. a role plus an opaque
 * id). Do NOT place names, emails, addresses or any other personal information
 * in a certification record — §3 asks only for what reproducibility and audit
 * require.
 */

import { createHash } from 'crypto';
import type { DatasetEntry } from './types';
import type { CompanySpec } from './u1Dataset002';
import { sealDataset, type DatasetSeal } from './u1DatasetValidator';

export type IndependenceVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_VERIFIED';

/** How the independent party related to the facts. */
export type AuthorshipMode = 'authored' | 'verified';

/**
 * The six §3 requirements for the independent human. Every field must be
 * asserted by that person — not inferred, not defaulted.
 */
export interface AuthorAttestations {
  /** §3.1 — did not implement the system under test (the grounding stack). */
  didNotImplementSystemUnderTest: boolean;
  /** §3.1 — did not implement DT-C1/DT-C2 evaluation infrastructure. */
  didNotImplementEvaluationInfrastructure: boolean;
  /** §3.3 — was NOT used merely to rubber-stamp AI-generated facts. */
  notMerelyNominalApprover: boolean;
  /** §3.4 — independently authored, or independently verified, the facts. */
  authorshipMode: AuthorshipMode | null;
  /** §3.5 — certified semantic distinctness (see `semanticDistinctness`). */
  certifiedSemanticDistinctness: boolean;
  /** §3.6 — approved the sealed dataset BEFORE any U1 model execution. */
  approvedBeforeFirstExecution: boolean;
}

/** §5 — model-output non-contamination. Every flag must be FALSE. */
export interface NonExposureAttestations {
  sawGroundedOutputs: boolean;
  sawUngroundedOutputs: boolean;
  sawScorerResults: boolean;
  sawSuccessFailureResults: boolean;
  anyModelOutputInfluencedDataset: boolean;
}

/** §7 — human semantic-distinctness certification. */
export interface SemanticDistinctnessCertification {
  /** The review procedure actually followed, in the reviewer's own words. */
  procedure: string;
  /**
   * §7 — the reviewer must explicitly acknowledge that machine string
   * comparison proves non-duplication, NOT semantic uniqueness.
   */
  acknowledgesMachineLimitationIsInsufficient: boolean;
  /** Companies (or pairs) actually reviewed. */
  companiesReviewed: number;
  certified: boolean;
}

/** §4 — per-company factual provenance, recorded by the independent party. */
export interface CompanyProvenance {
  companySlug: string;
  /** 'real' requires externally verifiable sources; 'synthetic' does not. */
  realOrSynthetic: 'real' | 'synthetic';
  /** Where the facts came from. For synthetic: how they were constructed. */
  sourceDescription: string;
  externallyVerifiable: boolean;
  authoredOrVerifiedBy: string;
  reviewedByIndependentHuman: boolean;
}

/**
 * A complete certification record. Supplied AS DATA by an independent party.
 * This codebase provides no factory, builder or default for it — by design.
 */
export interface IndependentAuthorCertification {
  certificationId: string;
  datasetId: string;
  /** Binds this certification to EXACT dataset bytes. Any edit invalidates it. */
  datasetSha256: string;
  /** PSEUDONYMOUS reference only. Never a name or contact detail. */
  authorRef: string;
  authorRole: string;
  signedOn: string;
  attestations: AuthorAttestations;
  nonExposure: NonExposureAttestations;
  semanticDistinctness: SemanticDistinctnessCertification;
  provenance: CompanyProvenance[];
}

export interface IndependenceAssessment {
  verdict: IndependenceVerdict;
  /** Why the verdict is what it is. Never empty for a non-VERIFIED verdict. */
  reasons: string[];
  /** Requirements satisfied / total, for reporting. */
  satisfied: number;
  required: number;
  certificationPresent: boolean;
}

/**
 * THE CURRENT CERTIFICATION FOR `canonicalGrounding.u1Dataset.v2`.
 *
 * It is `null`, and that is the accurate value: no independent human authored
 * or verified the v2 facts. This constant must ONLY ever be set by supplying a
 * genuine record produced by a qualifying independent party. It must NEVER be
 * populated by an AI agent, and never to make a downstream gate pass.
 */
export const CURRENT_CERTIFICATION: IndependentAuthorCertification | null = null;

/**
 * Derive the independence verdict from a certification record.
 *
 * NOT_VERIFIED whenever the record is absent, is bound to a different dataset,
 * or fails any hard independence requirement.
 * PARTIALLY_VERIFIED when the hard independence requirements hold but the
 * review is incomplete (e.g. semantic distinctness not yet certified).
 * VERIFIED only when every requirement is satisfied.
 */
export function evaluateIndependence(
  cert: IndependentAuthorCertification | null,
  expected: { datasetId: string; datasetSha256: string },
): IndependenceAssessment {
  const reasons: string[] = [];

  if (!cert) {
    return {
      verdict: 'NOT_VERIFIED',
      reasons: [
        'No independent-author certification record exists.',
        'The dataset ground truth was authored by the implementation agent.',
        'The dataset remains an ENGINEERING FIXTURE.',
      ],
      satisfied: 0,
      required: 12,
      certificationPresent: false,
    };
  }

  // Binding checks — a certification is meaningless if it names another dataset.
  const bindingOk =
    cert.datasetId === expected.datasetId && cert.datasetSha256 === expected.datasetSha256;
  if (!bindingOk) {
    reasons.push(
      `Certification is bound to ${cert.datasetId}@${cert.datasetSha256.slice(0, 12)}… but the dataset presented is ${expected.datasetId}@${expected.datasetSha256.slice(0, 12)}… — the dataset changed after certification, or the record belongs elsewhere.`,
    );
  }

  const a = cert.attestations;
  const n = cert.nonExposure;
  const s = cert.semanticDistinctness;

  /** HARD requirements — any failure forces NOT_VERIFIED. */
  const hard: [boolean, string][] = [
    [bindingOk, 'certification bound to this exact dataset hash'],
    [a.didNotImplementSystemUnderTest, 'author did not implement the system under test'],
    [a.didNotImplementEvaluationInfrastructure, 'author did not implement the evaluation infrastructure'],
    [a.notMerelyNominalApprover, 'author was not merely a nominal approver of AI-generated facts'],
    [a.authorshipMode === 'authored' || a.authorshipMode === 'verified', 'author independently authored or verified the facts'],
    [!n.sawGroundedOutputs, 'author saw no grounded U1 outputs'],
    [!n.sawUngroundedOutputs, 'author saw no ungrounded U1 outputs'],
    [!n.sawScorerResults, 'author saw no scorer results'],
    [!n.sawSuccessFailureResults, 'author saw no success/failure results'],
    [!n.anyModelOutputInfluencedDataset, 'no model output influenced the dataset'],
  ];

  /** COMPLETENESS requirements — failure downgrades to PARTIALLY_VERIFIED. */
  const soft: [boolean, string][] = [
    [a.certifiedSemanticDistinctness && s.certified && s.acknowledgesMachineLimitationIsInsufficient,
      'human semantic-distinctness certification completed, acknowledging the machine test is insufficient'],
    [a.approvedBeforeFirstExecution && cert.provenance.length > 0 && cert.provenance.every((p) => p.reviewedByIndependentHuman),
      'dataset approved before first execution, with per-company provenance reviewed'],
  ];

  const hardFailures = hard.filter(([ok]) => !ok);
  const softFailures = soft.filter(([ok]) => !ok);
  for (const [, label] of hardFailures) reasons.push(`FAILED (hard): ${label}`);
  for (const [, label] of softFailures) reasons.push(`INCOMPLETE: ${label}`);

  const satisfied = hard.filter(([ok]) => ok).length + soft.filter(([ok]) => ok).length;
  const required = hard.length + soft.length;

  let verdict: IndependenceVerdict;
  if (hardFailures.length > 0) verdict = 'NOT_VERIFIED';
  else if (softFailures.length > 0) verdict = 'PARTIALLY_VERIFIED';
  else {
    verdict = 'VERIFIED';
    reasons.push('All independence requirements satisfied.');
  }

  return { verdict, reasons, satisfied, required, certificationPresent: true };
}

export class CertificationRequiredError extends Error {
  constructor(public readonly assessment: IndependenceAssessment) {
    super(
      `Refusing to seal an independently-certified dataset: independence verdict is ${assessment.verdict}. ` +
        `Reasons: ${assessment.reasons.join(' | ')}`,
    );
    this.name = 'CertificationRequiredError';
  }
}

export interface CertifiedSeal extends DatasetSeal {
  independenceVerdict: IndependenceVerdict;
  certificationId: string;
  certificationFingerprint: string;
  authorRef: string;
  signedOn: string;
}

/** Stable serialisation for the certification fingerprint. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return value;
}

export function certificationFingerprint(cert: IndependentAuthorCertification): string {
  return createHash('sha256').update(JSON.stringify(stable(cert))).digest('hex');
}

/**
 * Seal a dataset AS INDEPENDENTLY CERTIFIED.
 *
 * THROWS unless independence is VERIFIED. This is the structural enforcement of
 * §9 ("seal after independent human approval") and §11 ("do not choose VERIFIED
 * merely because a human reviewed AI-generated material"). There is deliberately
 * no override flag, no `force`, and no bypass.
 *
 * `sealDataset()` in u1DatasetValidator remains available for uncertified
 * engineering-fixture sealing — that path yields no independence claim.
 */
export function sealWithCertification(
  entries: readonly DatasetEntry[],
  specs: readonly CompanySpec[],
  identity: { datasetId: string; datasetVersion: string; provenanceClass: string },
  cert: IndependentAuthorCertification | null,
): CertifiedSeal {
  const base = sealDataset(entries, specs, identity);
  const assessment = evaluateIndependence(cert, {
    datasetId: identity.datasetId,
    datasetSha256: base.sha256,
  });

  if (assessment.verdict !== 'VERIFIED' || !cert) {
    throw new CertificationRequiredError(assessment);
  }

  return {
    ...base,
    independenceVerdict: assessment.verdict,
    certificationId: cert.certificationId,
    certificationFingerprint: certificationFingerprint(cert),
    authorRef: cert.authorRef,
    signedOn: cert.signedOn,
  };
}

/** Human-readable status line for reports. Never overstates the verdict. */
export function describeIndependence(assessment: IndependenceAssessment): string {
  const map: Record<IndependenceVerdict, string> = {
    VERIFIED: 'INDEPENDENCE VERIFIED',
    PARTIALLY_VERIFIED: 'INDEPENDENCE PARTIALLY VERIFIED',
    NOT_VERIFIED: 'INDEPENDENCE NOT VERIFIED',
  };
  return `${map[assessment.verdict]} (${assessment.satisfied}/${assessment.required} requirements satisfied)`;
}
