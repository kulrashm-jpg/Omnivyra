/**
 * CPG-058 — company-administrator attestation.
 *
 * Public-domain evidence comes first and is resolved exactly as before by
 * `resolve()`; this module never changes that. Where public evidence does not
 * independently verify a value — it is missing, weak, stale or conflicting —
 * the product asks the tenant's authenticated company administrator, and the
 * answer is recorded as ADMINISTRATOR_ATTESTED.
 *
 * PRINCIPLE. Omnivyra's public-domain research is an independent evidence
 * layer, not an authority that automatically overrides the authenticated
 * organisation administrator's operational information. Administrator
 * attestation does not erase, alter, or relabel independent public evidence.
 *
 * Three guarantees follow, and the tests pin each one:
 *   • no public claim is ever edited, removed or relabelled here — `evidence`
 *     and `conflictingEvidence` pass through untouched;
 *   • ADMINISTRATOR_ATTESTED is a provenance class, not a claim of truth, and
 *     this module never produces PUBLICLY_VERIFIED — only `resolve()` applies
 *     the public verification bar;
 *   • where public evidence disagrees, neither side silently replaces the
 *     other: the administrator must choose, and both stay on record.
 *
 * AUTHORITY is not decided here. `applyAdministratorAttestationGuarded` in
 * groundingAccess.ts is the only authorized entry point; this function is pure
 * and trusts its caller, exactly as `applyUserDecision` does.
 *
 * Pure and deterministic: `attestedBy` and `asOf` are injected. No clock, no I/O.
 */

import type {
  AdministratorAttestation, AttestationConflictStatus, ClaimStatus, EvidenceClaim, EvidenceClass,
  GroundedField, GroundingHistoryEntry,
} from './types';

export class AttestationError extends Error {
  constructor(message: string) { super(message); this.name = 'AttestationError'; }
}

export interface AttestationRequest {
  value: string;
  normalizedValue: string;
  reason?: string | null;
  /**
   * Required to put the administrator's value into use when public evidence
   * disagrees with it. Without it the disagreement is recorded and left open.
   * To keep the public value instead, the administrator attests that value.
   */
  useAttestedValueOverPublic?: boolean;
}

export interface ApplyAttestationInput {
  grounded: GroundedField;
  request: AttestationRequest;
  attestedBy: string;
  asOf: string;
}

const NON_PUBLIC = new Set(['user', 'omnivyra_synthesis']);

/** A decision recorded WITHOUT an attestation closes any open attestation conflict before it. */
const DECISION_ACTIONS = new Set<GroundingHistoryEntry['action']>([
  'user_confirmed_own', 'user_accepted_public', 'user_corrected',
  'user_marked_source_stale', 'user_supplied_source', 'user_deferred',
]);

/** Every public claim on the field, de-duplicated, exactly as stored. */
function publicClaims(g: GroundedField): EvidenceClaim[] {
  const seen = new Set<string>();
  const out: EvidenceClaim[] = [];
  for (const e of [...g.evidence, ...g.conflictingEvidence]) {
    if (NON_PUBLIC.has(e.sourceType) || seen.has(e.claimId)) continue;
    seen.add(e.claimId);
    out.push(e);
  }
  return out;
}

/** Normalised form of the current effective value, from whichever side supplied it. */
function effectiveNormalized(g: GroundedField, pub: readonly EvidenceClaim[]): string | null {
  if (g.effectiveValue === null) return null;
  if (g.userClaim && g.userClaim.value === g.effectiveValue) return g.userClaim.normalizedValue;
  return pub.find((e) => e.value === g.effectiveValue)?.normalizedValue ?? g.effectiveValue.toLowerCase().trim();
}

/** The latest administrator attestation recorded for THIS company and field. */
export function latestAttestation(g: GroundedField): AdministratorAttestation | null {
  for (let i = g.history.length - 1; i >= 0; i--) {
    const a = g.history[i].attestation;
    if (a && a.companyId === g.companyId && a.field === g.field) return a;
  }
  return null;
}

/** The attestation that opened a still-unresolved disagreement, if that is why the field is in conflict. */
function openConflictAttestation(g: GroundedField): AdministratorAttestation | null {
  if (!g.isMaterialConflict) return null;
  for (let i = g.history.length - 1; i >= 0; i--) {
    const h = g.history[i];
    const a = h.attestation;
    if (a && a.companyId === g.companyId && a.field === g.field) return a.conflictStatus === 'UNRESOLVED' ? a : null;
    if (DECISION_ACTIONS.has(h.action)) return null;
  }
  return null;
}

/**
 * Record an administrator attestation. Returns a NEW GroundedField; the input
 * is never mutated. See the module header for the guarantees.
 */
export function applyAdministratorAttestation(input: ApplyAttestationInput): GroundedField {
  const { grounded: g, request, attestedBy, asOf } = input;
  if (g.kind === 'SYNTHESIS' || g.kind === 'RECOMMENDATION') {
    throw new AttestationError('an Omnivyra synthesis or recommendation is not an organisational fact and cannot be attested');
  }
  if (!request.value.trim()) throw new AttestationError('an attestation must state a value; a blank is never recorded');
  if (!attestedBy.trim()) throw new AttestationError('an attestation must identify the authenticated administrator');

  const pub = publicClaims(g);
  const agreeing = pub.filter((e) => e.normalizedValue === request.normalizedValue);
  const disagreeing = pub.filter((e) => e.normalizedValue !== request.normalizedValue);
  const agreesWithEffective = effectiveNormalized(g, pub) === request.normalizedValue;
  const open = openConflictAttestation(g);
  // The status the field held before an administrator disagreement opened it.
  const baseStatus: ClaimStatus = open ? open.previousStatus : g.status;

  const attest = (
    conflictStatus: AttestationConflictStatus,
    verificationStatus: AdministratorAttestation['verificationStatus'],
    previousStatus: ClaimStatus,
  ): AdministratorAttestation => ({
    sourceType: 'ADMINISTRATOR', companyId: g.companyId, field: g.field,
    value: request.value, normalizedValue: request.normalizedValue,
    attestedBy, authority: 'COMPANY_ADMIN', attestedAt: asOf,
    previousValue: g.effectiveValue, previousStatus,
    reason: request.reason?.trim() || null,
    publicEvidence: baseStatus === 'PUBLICLY_VERIFIED' ? 'VERIFIES' : pub.length === 0 ? 'NONE' : 'BELOW_VERIFIED_BAR',
    publicEvidenceConsidered: pub.map((e) => ({ claimId: e.claimId, value: e.value, sourceUrl: e.sourceUrl })),
    conflictStatus, verificationStatus,
  });
  const entry = (
    action: GroundingHistoryEntry['action'], toValue: string | null, note: string,
    evidenceIds: string[], attestation: AdministratorAttestation,
  ): GroundingHistoryEntry => ({ at: asOf, actor: attestedBy, action, fromValue: g.effectiveValue, toValue, note, evidenceIds, attestation });
  const ids = (claims: EvidenceClaim[]) => claims.map((e) => e.claimId);

  // ── Case A — public evidence already stands, and the administrator agrees ──
  // Nothing about the public evidence or its status changes; the attestation
  // is recorded as corroboration. An open administrator disagreement closes.
  const publicStands = agreesWithEffective && (g.effectiveValueSource === 'public_evidence' || baseStatus === 'PUBLICLY_VERIFIED');
  if (publicStands) {
    const a = attest('NONE', 'CORROBORATED_BY_PUBLIC_EVIDENCE', g.status);
    return {
      ...g,
      status: baseStatus,
      isMaterialConflict: open ? false : g.isMaterialConflict,
      confirmationStatus: open
        ? (g.effectiveValueSource === 'public_evidence' ? 'USER_ACCEPTED_PUBLIC_VALUE' : 'USER_CONFIRMED_OWN_VALUE')
        : g.confirmationStatus,
      adjudication: open && g.adjudication
        ? { ...g.adjudication, evidenceState: 'EFFECTIVE', requiresReview: false, reason: 'the company administrator confirmed the publicly evidenced value' }
        : g.adjudication,
      history: [...g.history, entry(
        g.effectiveValueSource === 'public_evidence' ? 'user_accepted_public' : 'user_confirmed_own',
        g.effectiveValue,
        'Company administrator confirmed the publicly evidenced value. Public evidence and its status are unchanged.',
        ids(agreeing), a,
      )],
    };
  }

  // ── Case C (open) — public evidence disagrees and the administrator has not chosen ──
  // Neither side replaces the other: the effective value, the user claim and
  // every public claim stay exactly as they were. The disagreement is surfaced.
  if (disagreeing.length > 0 && !request.useAttestedValueOverPublic) {
    const a = attest('UNRESOLVED', 'NOT_INDEPENDENTLY_VERIFIED', baseStatus);
    return {
      ...g,
      status: 'CONFLICTING',
      isMaterialConflict: true,
      confirmationStatus: 'PENDING_USER_CONFIRMATION',
      adjudication: g.adjudication
        ? { ...g.adjudication, evidenceState: 'CONFLICTING', requiresReview: true, reason: 'the company administrator stated a value that differs from public evidence; awaiting their choice' }
        : g.adjudication,
      history: [...g.history, entry(
        'conflict_detected', request.value,
        'Company administrator stated a value that differs from public evidence. Both are retained; the administrator must choose which represents the organisation.',
        ids(disagreeing), a,
      )],
    };
  }

  // ── Case B, and Case C resolved in the administrator's favour ──
  // The administrator's value becomes effective. Status never rises above
  // PUBLICLY_REPORTED here: only resolve() can verify, and it re-applies the
  // public bar on the next resolution.
  const conflicted = disagreeing.length > 0;
  const changesValue = g.effectiveValue !== null && !agreesWithEffective;
  const status: ClaimStatus = conflicted ? 'CONFLICTING' : agreeing.length > 0 ? 'PUBLICLY_REPORTED' : 'USER_PROVIDED';
  const a = attest(conflicted ? 'RESOLVED_ATTESTED_VALUE' : 'NONE', 'NOT_INDEPENDENTLY_VERIFIED', g.status);
  const action: GroundingHistoryEntry['action'] = conflicted ? 'user_confirmed_own'
    : changesValue ? 'user_corrected'
    : g.userClaim === null ? 'user_asserted'
    : 'user_confirmed_own';
  return {
    ...g,
    status,
    effectiveValue: request.value,
    effectiveValueSource: changesValue ? 'user_correction' : 'user',
    userClaim: { field: g.field, value: request.value, normalizedValue: request.normalizedValue, assertedAt: asOf, assertedBy: attestedBy },
    isMaterialConflict: false,
    confirmationStatus: conflicted ? 'USER_CONFIRMED_OWN_VALUE' : changesValue ? 'USER_CONFIRMED_CORRECTION' : 'NOT_REQUIRED',
    adjudication: g.adjudication
      ? { ...g.adjudication, evidenceState: 'EFFECTIVE', outcome: 'USER_DECISION', requiresReview: false, reason: "effective value set by the company administrator's attestation — not independently verified" }
      : g.adjudication,
    history: [...g.history, entry(
      action, request.value,
      conflicted
        ? 'Company administrator chose their value over differing public evidence. Public evidence retained for audit. Not independently verified.'
        : 'Company administrator attested this value. Not independently verified.',
      ids(conflicted ? disagreeing : agreeing), a,
    )],
  };
}

/**
 * The provenance class of the field's current value.
 *
 * Precedence: an open disagreement is always shown; a publicly sourced value
 * keeps its public status (never relabelled); a user value that public
 * evidence independently verifies stays PUBLICLY_VERIFIED; a user value the
 * company administrator attested is ADMINISTRATOR_ATTESTED; otherwise the
 * stored status stands (USER_PROVIDED, UNVERIFIED, …).
 */
export function classifyEvidence(g: GroundedField): EvidenceClass {
  if (g.kind === 'SYNTHESIS' || g.kind === 'RECOMMENDATION' || g.status === 'SYNTHESIZED') return 'SYNTHESIZED';
  if (g.isMaterialConflict) return 'CONFLICTING';
  if (g.effectiveValueSource === 'public_evidence') return g.status;
  if (g.status === 'PUBLICLY_VERIFIED') return 'PUBLICLY_VERIFIED';
  const a = latestAttestation(g);
  if (a && a.conflictStatus !== 'UNRESOLVED' && g.effectiveValue !== null && a.value === g.effectiveValue) {
    return 'ADMINISTRATOR_ATTESTED';
  }
  return g.status;
}

/** User-facing labels. Only PUBLICLY_VERIFIED may say "verified" without a negation. */
export const EVIDENCE_CLASS_LABELS: Readonly<Record<EvidenceClass, string>> = Object.freeze({
  PUBLICLY_VERIFIED: 'Independently verified from public sources',
  PUBLICLY_REPORTED: 'Publicly reported — not independently verified',
  ADMINISTRATOR_ATTESTED: "Confirmed by your organisation's administrator — not independently verified",
  CONFLICTING: 'Differs from public sources — needs review',
  UNVERIFIED: 'Not verified',
  USER_PROVIDED: 'Provided by a user — not independently verified',
  SYNTHESIZED: 'Omnivyra interpretation — not a fact',
});

export const ATTESTATION_PROMPTS = Object.freeze({
  INSUFFICIENT: "We couldn't independently verify this information from available public sources. Please confirm the information you want Omnivyra to use for your organisation.",
  CONFLICT: 'We found information that differs from the information provided by your organisation. Please review and confirm which information represents your current organisation.',
});

export interface EvidenceDescription {
  evidenceClass: EvidenceClass;
  label: string;
  independentlyVerified: boolean;
  /** Whether the company administrator has confirmed the value now in use. */
  administratorConfirmed: boolean;
  administratorConfirmedAt: string | null;
  publicConflict: 'NONE' | 'UNRESOLVED' | 'RESOLVED_BY_ADMINISTRATOR';
  /** The question to put to the administrator, or null when none is needed. */
  prompt: string | null;
}

/**
 * What the provenance UI shows. Deliberately omits the attester's identity:
 * the UI says "your organisation's administrator", never a person.
 */
export function describeEvidence(g: GroundedField): EvidenceDescription {
  const evidenceClass = classifyEvidence(g);
  const a = latestAttestation(g);
  const confirmed = !!a && a.conflictStatus !== 'UNRESOLVED' && g.effectiveValue !== null && a.value === g.effectiveValue;
  const publicConflict = g.isMaterialConflict ? 'UNRESOLVED'
    : confirmed && a!.conflictStatus === 'RESOLVED_ATTESTED_VALUE' ? 'RESOLVED_BY_ADMINISTRATOR'
    : 'NONE';
  const settled = evidenceClass === 'ADMINISTRATOR_ATTESTED' || evidenceClass === 'SYNTHESIZED'
    || confirmed || (evidenceClass === 'PUBLICLY_VERIFIED' && g.freshness !== 'stale');
  const prompt = publicConflict === 'UNRESOLVED' ? ATTESTATION_PROMPTS.CONFLICT
    : settled ? null
    : ATTESTATION_PROMPTS.INSUFFICIENT;
  return {
    evidenceClass,
    label: EVIDENCE_CLASS_LABELS[evidenceClass],
    independentlyVerified: evidenceClass === 'PUBLICLY_VERIFIED',
    administratorConfirmed: confirmed,
    administratorConfirmedAt: confirmed ? a!.attestedAt : null,
    publicConflict,
    prompt,
  };
}
