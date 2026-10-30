/**
 * Prospect Problem Observation — the shared contract.
 *
 * ─── WHAT A PROBLEM OBSERVATION IS ────────────────────────────────────────
 * A problem **explicitly stated by, or attributable to, a prospect**, recorded
 * with enough provenance to tell what the prospect actually said apart from an
 * inference the platform made. It is an UTTERANCE: plural, historical, and
 * never arbitrated. Two problems stated two months apart are both true, and
 * neither supersedes the other — which is why this is not an attribute and does
 * not live on `source_assertions`, whose recency arbitration would turn a
 * visibly-unknown value into a confidently-wrong one.
 *
 * ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
 * NOT Problem Fit. Fit is a separate relation assessing how a tenant offering
 * matches a stated problem, and it remains UNSCORED and NON-SCORABLE until its
 * representation and weight are decided — migration `20261013000000` leaves
 * where fit lives undecided. Nothing in this module produces, implies or
 * enables a score, a dimension, a weight or a priority adjustment. Capturing
 * what a prospect said is not the same as deciding what it is worth, and this
 * file is the boundary between the two.
 *
 * ─── THE GATE IS NOT RE-IMPLEMENTED HERE ──────────────────────────────────
 * `offeringIntelligence/problemFit.ts` already publishes the admission contract
 * (`PROBLEM_FIT_BUY_SIDE_CONTRACT`, `PROBLEM_FIT_CONTRACT_VERSION = 'pf.1'`)
 * and `admitProspectProblem`, which until now had ZERO production callers. The
 * capture path CALLS it rather than restating its rules: one definition of what
 * an admissible prospect statement is, in the module that already owns it.
 */

/** Bumped when this contract changes, so a stored row traces to its shape. */
export const PROBLEM_OBSERVATION_CONTRACT_VERSION = 'pi-problem-obs.1';

/** The canonical spine subject a statement is attributed to. Exactly one. */
export type ProblemObservationSubjectType = 'person' | 'account';

/**
 * WHO recorded it, not what it says.
 *
 * `provider` — the statement arrived inside a provider record.
 * `human`    — an operator recorded it from an artefact they can name. A human
 *              origin REQUIRES a recording user, so an attested statement is
 *              never anonymous; the storage CHECK enforces the pairing.
 */
export type ProblemObservationOriginKind = 'provider' | 'human';

/**
 * The relation this capability writes. Named once so the readers' guard and the
 * repository cannot drift apart, and so no other module has to spell it.
 */
export const PROBLEM_OBSERVATION_RELATION = 'prospect_problem_observations';

/**
 * An origin may never name the capture relation itself.
 *
 * `origin.store` is WHERE THE WORDS CAN BE RE-READ — a CRM note, a call record,
 * an email thread. Naming this table would make the record its own evidence:
 * a statement attributed to nothing but the fact that someone typed it. That is
 * precisely the fabricated source attribution the contract exists to prevent,
 * so it is refused at the boundary rather than left to reviewer vigilance.
 */
export const SELF_ATTRIBUTED_ORIGIN_STORES: readonly string[] = [
  PROBLEM_OBSERVATION_RELATION,
  'prospect_problem_observation',
];

/** What a caller supplies. `organizationId` is the VERIFIED tenant, never a body field. */
export interface ProblemObservationInput {
  readonly organizationId: string;
  /**
   * `canonical_leads.id` — what "prospect id" means on the prospects surface.
   *
   * RESOLUTION ONLY, and deliberately NOT stored. It is how the caller names a
   * subject it is allowed to name; the row records the canonical subject the
   * prospect resolved to. Persisting it as well would add a fourth tenant FK
   * and a second answer to "whose statement is this", and a prospect is not an
   * additional subject — it is the route the caller arrived by.
   */
  readonly prospectId: string;
  readonly subjectType: ProblemObservationSubjectType;
  /** The canonical spine id for `subjectType`, resolved under the verified tenant. */
  readonly subjectId: string;
  /** The prospect's own words. Whitespace-normalised, never summarised. */
  readonly statement: string;
  /** As the source reported it. NULL is "not stated", never a guess. */
  readonly statementLanguage: string | null;
  /** Where the words can be re-read. Both parts required. */
  readonly origin: { readonly store: string; readonly recordId: string };
  readonly originKind: ProblemObservationOriginKind;
  /** Required when `originKind` is 'human'; must be null when 'provider'. */
  readonly recordedByUserId: string | null;
  /** Optional link to the provenance spine. */
  readonly sourceRecordId: string | null;
  /**
   * When the PROSPECT said it, as the source reported it. The ingest clock is
   * never substituted — an absent source time is an absence, not a default.
   *
   * REQUIRED AT CAPTURE, although the stored column is nullable. That asymmetry
   * is deliberate, and it is the gate's decision rather than this module's:
   * `admitProspectProblem` rejects an absent or unusable `observedAt`, so a
   * timeless statement is not admissible evidence, and capturing one would
   * create a row that can never become admissible — the orphan class this
   * design otherwise avoids. The column stays nullable to match
   * `source_assertions.observed_at` and to avoid a schema that would have to
   * change if the gate ever admits a timeless statement. Refusing is NOT the
   * same as substituting: the caller is told, and nothing is invented.
   */
  readonly observedAt: string;
  /** The source's own confidence in 0..1, or an explicit null. Never defaulted. */
  readonly confidence: number | null;
}

/** A row as it comes back. `recordedAt` is OUR clock and is a different field. */
export interface StoredProblemObservation {
  readonly id: string;
  readonly organizationId: string;
  readonly subjectType: ProblemObservationSubjectType;
  readonly subjectId: string;
  readonly statement: string;
  readonly statementLanguage: string | null;
  readonly originStore: string;
  readonly originRecordId: string;
  readonly originKind: ProblemObservationOriginKind;
  readonly recordedByUserId: string | null;
  readonly sourceRecordId: string | null;
  readonly confidence: number | null;
  /** The SOURCE's time. */
  readonly observedAt: string | null;
  /** OUR time. Distinct by contract; one is never read for the other. */
  readonly recordedAt: string;
}

/**
 * Why a capture was refused. A closed union, because a caller that cannot
 * enumerate the refusals will collapse them into a generic failure.
 */
export type ProblemObservationRefusal =
  /** `admitProspectProblem` rejected the evidence; `rejections` carries every reason. */
  | 'inadmissible_evidence'
  /** No such prospect/subject in this tenant. Indistinguishable from absent, deliberately. */
  | 'subject_not_found'
  /** The subject resolved, but to another tenant. Never recorded. */
  | 'subject_other_tenant'
  /** The origin named this capture relation — evidence may not cite itself. */
  | 'self_attributed_origin'
  /** A 'human' origin without a recording user, or a 'provider' origin with one. */
  | 'origin_actor_incoherent'
  /**
   * No such message under this tenant. COLLAPSES the other-tenant case, exactly
   * as `subject_other_tenant` collapses into `subject_not_found`, so the route
   * is not a cross-tenant existence oracle. The distinction survives in logs.
   */
  | 'source_message_not_found'
  /**
   * Stored evidence does not establish that the PROSPECT wrote it: no author,
   * an author that is one of this workspace's own connected accounts, or an
   * author whose platform identity does not resolve to the subject.
   *
   * `direction` is deliberately not trusted for this. It has no CHECK, its
   * column default is `'inbound'`, and a live writer emits `'outgoing'` — so
   * `'inbound'` is indistinguishable from "no writer stated a direction", which
   * is the "default standing in for evidence" the audit refuses elsewhere.
   */
  | 'source_not_prospect_authored'
  /**
   * The message's thread resolves to a different canonical person than the
   * observation's subject. A thread is not single-author: `message_type`
   * defaults to `'comment'`, so a third party can post in the prospect's
   * thread, and that is not the prospect speaking.
   */
  | 'source_subject_mismatch'
  /** The message carries no text to transcribe. An empty statement is an absence. */
  | 'source_statement_absent'
  /**
   * The source reports no instant for the utterance. `platform_created_at` is
   * the only source clock on this path; `created_at` and `detected_at` are
   * OURS and are never substituted, so an absent source time is a refusal.
   */
  | 'source_observation_time_absent'
  /** The relation could not be read or written. NOT "no observations". */
  | 'store_unavailable';

/**
 * The server-set attestation that one specific message was verified.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * `admitProspectProblem` refuses `engagement_messages` as a store, and that
 * refusal is correct as a universal claim: nothing about the relation
 * guarantees a given row is an utterance by a given prospect. But a row CAN be
 * verified one at a time, and the gate is pure — it never reads a row — so the
 * only way to let a verified row through is to hand it a token saying the
 * verification happened.
 *
 * ─── WHY A CALLER CANNOT FORGE IT ─────────────────────────────────────────
 * It is never read from a request body. The route refuses the key outright, and
 * the only producer is the verification module, which constructs it after the
 * reads it names. A type label a caller could set would be no evidence at all;
 * that is the whole reason this is server-set rather than a request field.
 */
export interface SourceVerification {
  /** The module that performed the reads. Pinned by the gate, not free text. */
  readonly verifier: string;
  /** The relation verified — must equal the audited entry's own relation. */
  readonly relation: string;
  /** The row verified — must equal the candidate's `origin.recordId`. */
  readonly recordId: string;
}

/** The identifier of the verifier, so the gate and the producer cannot drift. */
export const PROSPECT_MESSAGE_VERIFIER = 'prospectProblems/verifyProspectMessage';

/** One unmet requirement, passed through from the gate unmodified. */
export interface ProblemObservationRejection {
  readonly field: string;
  readonly reason: string;
}

export type RecordProblemObservationResult =
  | {
    readonly ok: true;
    readonly observationId: string;
    /**
     * TRUE when the identical statement from the identical source record was
     * already stored. A replay is a success, not an error, and not a second row.
     */
    readonly duplicate: boolean;
  }
  | {
    readonly ok: false;
    readonly refusal: ProblemObservationRefusal;
    readonly detail: string;
    /** Every unmet requirement, so a writer fixes one record rather than one field. */
    readonly rejections: readonly ProblemObservationRejection[];
  };

/**
 * A read answers one of three things, and they are not the same.
 *
 * `available`   — observations were read (possibly zero of them).
 * `unavailable` — the relation could not be read. NEVER rendered as "none".
 */
export type ProblemObservationReadState = 'available' | 'unavailable';

export interface ProblemObservationRead {
  readonly state: ProblemObservationReadState;
  readonly detail: string | null;
  readonly observations: readonly StoredProblemObservation[];
}
