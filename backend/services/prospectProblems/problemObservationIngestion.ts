/**
 * PI — PROSPECT PROBLEM OBSERVATION: the ingestion and retrieval seam.
 *
 * `types.ts` publishes the contract. `offeringIntelligence/problemFit.ts`
 * publishes the admission gate. `problemObservationRepository.ts` owns the
 * relation. This module is the only thing that was missing: a reachable path
 * from a tenant-verified caller to that gate and then to that repository, with
 * the canonical subject resolved under the verified tenant on the way.
 *
 * ─── IT IS NOT A SECOND VALIDATOR ─────────────────────────────────────────
 * `admitProspectProblem` already decides what an admissible prospect statement
 * is, collects EVERY unmet requirement rather than the first, and enforces the
 * source audit. It had zero production callers until this file. Its rules are
 * not restated here and its refusal text is not copied: the rejections travel
 * out of this module unmodified, so a writer fixes one record against one
 * definition instead of reconciling two.
 *
 * The three refusals this module adds are the three the gate cannot make,
 * because they need either a second tenant or the capture relation's own name:
 *
 *   `self_attributed_origin`    — the origin named the capture relation, so the
 *                                 record would be its own evidence.
 *   `origin_actor_incoherent`   — a 'human' origin with nobody recording it, or
 *                                 a 'provider' origin with a human attached.
 *   `subject_not_found` /
 *   `subject_other_tenant`      — the gate can only check that a subject IS
 *                                 tenanted; only a reader holding the verified
 *                                 tenant can check WHICH tenant.
 *
 * ─── IT IS NOT A SECOND WRITER ────────────────────────────────────────────
 * This module performs the spine READ and nothing else. It contains no insert,
 * no update, no upsert and no delete call of any kind; every state change is a
 * call into the repository, which owns the relation. That is structural rather
 * than asserted — the file carries no mutating call at all, which is also what
 * keeps it outside `caCanonicalSoleWriter` and the identity ingestion-boundary
 * tripwires even though it legitimately reads the person and account spines.
 * `PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE` makes that property
 * test-visible rather than leaving it to reviewer vigilance.
 *
 * ─── TWO ENTRY POINTS, ONE GATE AND ONE WRITER ────────────────────────────
 * `recordProspectProblemObservation` takes a statement a caller supplies, on the
 * strength of the origin that caller names. `recordProspectProblemFromMessage`
 * takes a MESSAGE ID and nothing about the statement: `verifyProspectMessage`
 * reads the row, establishes that this prospect wrote it, DERIVES the words, the
 * instant and the origin from it, and returns the server-set attestation that
 * `admitProspectProblem` requires before it will admit an `engagement_messages`
 * origin at all.
 *
 * They share everything after that — the request-only refusals, the subject
 * resolver, the gate call and the repository call — so the verified path adds no
 * second validator, no second resolver and no second writer. The attestation is
 * a PARAMETER of the shared private path and is never read off a caller's input,
 * which is what makes it unforgeable rather than merely undocumented.
 *
 * ─── ABSENCE IS NEVER FILLED IN ───────────────────────────────────────────
 * The ingest clock is never substituted for a missing `observedAt`, and a
 * missing confidence is never defaulted to anything. An unread relation is
 * reported as `store_unavailable` / `unavailable` and never as "no
 * observations": "there are none" and "we could not look" are different
 * answers, and only the second is worth retrying.
 *
 * ─── IT SCORES NOTHING ────────────────────────────────────────────────────
 * No score, dimension, weight or priority is produced, implied or enabled
 * anywhere below. Capturing what a prospect said is not deciding what it is
 * worth, and the second is a frozen product decision owned elsewhere.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import {
  admitProspectProblem,
  type ProblemFitRejection,
} from '../offeringIntelligence/problemFit';
import {
  SELF_ATTRIBUTED_ORIGIN_STORES,
  type ProblemObservationInput,
  type ProblemObservationOriginKind,
  type ProblemObservationRead,
  type ProblemObservationRefusal,
  type ProblemObservationRejection,
  type ProblemObservationSubjectType,
  type SourceVerification,
  type RecordProblemObservationResult,
} from './types';
import {
  recordProblemObservation,
  readProblemObservations,
  type ProblemObservationQuery,
} from './problemObservationRepository';
import {
  PROSPECT_MESSAGE_RELATION,
  verifyProspectMessage,
  type ProspectMessageVerification,
} from './verifyProspectMessage';

/** Re-exported so every caller binds to ONE spelling of the repository query. */
export type { ProblemObservationQuery };

/** Bumped when this seam's contract changes. */
export const PROBLEM_OBSERVATION_INGESTION_VERSION = 'pi-problem-obs-ingest.1';

/**
 * A structural property, exported so a guard can read it instead of trusting a
 * header comment: this module delegates every mutation to the repository.
 */
export const PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE = true;

/**
 * What a caller supplies. Exactly the published input MINUS `subjectId`, which
 * is not the caller's to assert: it is resolved here from the prospect id under
 * the verified tenant. A caller that could name the canonical subject directly
 * could name one belonging to another prospect.
 */
export type ProblemObservationCapture = Omit<ProblemObservationInput, 'subjectId'>;

/**
 * The repository, injected. One port, so this seam is testable without a
 * database and so there is exactly one place that reaches the relation — the
 * convention `prospectOutcomes/icpOutcomeProposal.ts` and `enrichment/service.ts`
 * already established.
 */
export interface ProblemObservationPorts {
  record(input: ProblemObservationInput): Promise<RecordProblemObservationResult>;
  read(query: ProblemObservationQuery): Promise<ProblemObservationRead>;
}

export const defaultProblemObservationPorts: ProblemObservationPorts = {
  record: recordProblemObservation,
  read: readProblemObservations,
};

/**
 * The origin store a VERIFIED capture cites, taken from the verifier rather than
 * spelled again here. The relation that was attested and the relation that is
 * cited have to be the same string, and two spellings is how they stop being.
 */
export const VERIFIED_MESSAGE_ORIGIN_STORE = PROSPECT_MESSAGE_RELATION;

/**
 * The verified path's ports: the repository, plus the verification itself.
 *
 * A separate interface rather than a third member on `ProblemObservationPorts`,
 * so no existing caller has to supply something it has no use for, and so the
 * only path that can reach the verifier is the one that needs it.
 */
export interface VerifiedMessageCapturePorts extends ProblemObservationPorts {
  verify(input: {
    readonly organizationId: string;
    readonly messageId: string;
    readonly subjectType: ProblemObservationSubjectType;
    readonly subjectId: string;
    readonly personId: string;
  }): Promise<ProspectMessageVerification>;
}

export const defaultVerifiedMessageCapturePorts: VerifiedMessageCapturePorts = {
  ...defaultProblemObservationPorts,
  verify: verifyProspectMessage,
};

/** A read answers with the subject it resolved, so a caller can cite it. */
export type ReadProblemObservationsResult =
  | {
    readonly ok: true;
    readonly subjectType: ProblemObservationSubjectType;
    readonly subjectId: string;
    readonly read: ProblemObservationRead;
  }
  | {
    readonly ok: false;
    readonly refusal: ProblemObservationRefusal;
    readonly detail: string;
  };

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cleaned = v.trim();
  return cleaned.length > 0 ? cleaned : null;
};

const refuse = (
  refusal: ProblemObservationRefusal,
  detail: string,
  rejections: readonly ProblemObservationRejection[] = [],
): RecordProblemObservationResult => ({ ok: false, refusal, detail, rejections });

/**
 * The gate's rejections, widened to the contract's shape and NOTHING else.
 *
 * `field` loosens from the gate's union to a string so the contract does not
 * have to track the gate's field vocabulary; `reason` is passed through
 * verbatim, because the gate's own words are the part a writer can act on.
 */
const carryRejections = (
  rejections: readonly ProblemFitRejection[],
): readonly ProblemObservationRejection[] =>
  rejections.map((r) => ({ field: String(r.field), reason: r.reason }));

/**
 * Is this origin store the capture relation itself?
 *
 * Case-insensitive and tolerant of a schema qualifier, mirroring
 * `auditedProblemSource`'s normalisation — `public.prospect_problem_observations`
 * and `prospect_problem_observations` are the same relation, and a self-citation
 * check that could be bypassed by spelling is not a check.
 */
function namesCaptureRelation(store: string | null): boolean {
  if (store === null) return false;
  const key = store.toLowerCase().replace(/^public\./, '');
  return SELF_ATTRIBUTED_ORIGIN_STORES.some((s) => s.toLowerCase() === key);
}

/**
 * The two refusals that are decidable FROM THE REQUEST ALONE, in one place.
 *
 * Both entry points run exactly this, and both run it before any database round
 * trip: a self-citing origin and an incoherent actor cost nothing to decide, and
 * spending a read on them would be spending it to learn nothing. Shared rather
 * than copied so the verified path cannot acquire a second, weaker version of
 * either rule — the verified path derives its own origin and actor, so these
 * checks hold there by construction, and running them anyway is what keeps that
 * claim true if the derivation ever changes.
 *
 * Returns the refusal, or null when the request clears both.
 */
function requestOnlyRefusal(
  originStore: string | null,
  originKind: ProblemObservationOriginKind | null,
  recordedByUserId: string | null,
): RecordProblemObservationResult | null {
  // ── EVIDENCE MAY NOT CITE ITSELF ────────────────────────────────────────
  if (namesCaptureRelation(originStore)) {
    return refuse(
      'self_attributed_origin',
      `origin.store names the capture relation (${String(originStore)}) — origin.store is where the words `
      + 'can be RE-READ, and a record whose only source is the fact that someone typed it is a fabricated '
      + 'source attribution',
    );
  }

  // ── WHO RECORDED IT MUST BE COHERENT WITH HOW ───────────────────────────
  // The storage CHECK enforces the same pairing; refusing here means a caller
  // is told what is wrong with their record instead of receiving a constraint
  // violation, and means the rule holds for callers that never reach storage.
  if (!originKind) {
    return refuse('origin_actor_incoherent', "originKind must be 'provider' or 'human'");
  }
  if (originKind === 'human' && !recordedByUserId) {
    return refuse(
      'origin_actor_incoherent',
      'a human origin requires the user who recorded it — an attested statement is never anonymous',
    );
  }
  if (originKind === 'provider' && recordedByUserId) {
    return refuse(
      'origin_actor_incoherent',
      'a provider origin must carry no recording user — naming one would attribute a provider record to a person',
    );
  }

  return null;
}

/**
 * What the spine read concluded. A SINGLE shape rather than a discriminated
 * union, deliberately: the backend project does not compile under `strict`, so
 * narrowing a union by a boolean discriminant type-checks and then loses the
 * member's own fields. One shape cannot degrade that way — the same reason
 * `prospectIdentity/relationshipObservationIngestion.ts` gives.
 */
interface SubjectResolution {
  readonly resolved: boolean;
  readonly subjectId: string | null;
  /**
   * Kept so the distinction between "no such prospect here" and "that prospect
   * belongs to someone else" survives into the LOGS. A transport must still
   * answer both identically; see the route.
   */
  readonly refusal: ProblemObservationRefusal | null;
  readonly detail: string;
}

const resolvedSubject = (subjectId: string): SubjectResolution =>
  ({ resolved: true, subjectId, refusal: null, detail: 'ok' });

const unresolvedSubject = (
  refusal: ProblemObservationRefusal, detail: string,
): SubjectResolution => ({ resolved: false, subjectId: null, refusal, detail });

/**
 * Resolve a prospect id to the canonical subject a statement is attributed to,
 * UNDER THE VERIFIED TENANT.
 *
 * Every read carries the tenant as a mandatory `.eq` predicate AND re-asserts it
 * on the row that came back. The predicate is what makes the query correct; the
 * re-assertion is what keeps it correct if the query is ever edited wrongly, and
 * it is the only thing that can tell `subject_other_tenant` from
 * `subject_not_found` — a distinction this module keeps and the transport
 * deliberately collapses.
 *
 * Three columns per table and no more. Identity, tenancy and the employer
 * pointer are all this seam may see: a resolver that could read a title or a
 * seniority would be one refactor away from deriving a statement from one.
 */
async function resolveSubject(
  organizationId: string,
  prospectId: string,
  subjectType: ProblemObservationSubjectType,
): Promise<SubjectResolution> {
  const lead = await ownedDbTable('canonical_leads')
    .select('id, company_id, unified_person_id')
    .eq('id', prospectId)
    .eq('company_id', organizationId)            // tenant boundary — never optional
    .maybeSingle();
  if (lead.error) return unresolvedSubject('store_unavailable', `canonical_leads read failed: ${lead.error.message}`);

  const leadRow = (lead.data as {
    company_id?: unknown; unified_person_id?: unknown;
  } | null) ?? null;
  if (!leadRow) return unresolvedSubject('subject_not_found', 'no such prospect in this tenant');
  // Re-asserted on the DATA, not only in the query.
  if (text(leadRow.company_id) !== organizationId) {
    return unresolvedSubject('subject_other_tenant', 'the prospect belongs to another tenant');
  }

  const personId = text(leadRow.unified_person_id);
  if (!personId) {
    return unresolvedSubject(
      'subject_not_found',
      'the prospect has no resolved canonical person, so there is no subject to attribute a statement to',
    );
  }

  const person = await ownedDbTable('unified_persons')
    .select('id, company_id, account_id')
    .eq('id', personId)
    .eq('company_id', organizationId)            // tenant boundary — never optional
    .maybeSingle();
  if (person.error) return unresolvedSubject('store_unavailable', `person spine read failed: ${person.error.message}`);

  const personRow = (person.data as { company_id?: unknown; account_id?: unknown } | null) ?? null;
  if (!personRow) return unresolvedSubject('subject_not_found', 'no such person in this tenant');
  if (text(personRow.company_id) !== organizationId) {
    return unresolvedSubject('subject_other_tenant', 'the person belongs to another tenant');
  }

  if (subjectType === 'person') return resolvedSubject(personId);

  const accountId = text(personRow.account_id);
  if (!accountId) {
    return unresolvedSubject(
      'subject_not_found',
      'the prospect has no resolved account, so an account-attributed statement has no subject',
    );
  }

  const account = await ownedDbTable('prospect_accounts')
    .select('id, organization_id')
    .eq('id', accountId)
    .eq('organization_id', organizationId)       // tenant boundary — never optional
    .maybeSingle();
  if (account.error) return unresolvedSubject('store_unavailable', `account spine read failed: ${account.error.message}`);

  const accountRow = (account.data as { organization_id?: unknown } | null) ?? null;
  if (!accountRow) return unresolvedSubject('subject_not_found', 'no such account in this tenant');
  if (text(accountRow.organization_id) !== organizationId) {
    return unresolvedSubject('subject_other_tenant', 'the account belongs to another tenant');
  }

  return resolvedSubject(accountId);
}

/**
 * Everything a capture carries by the time its subject is resolved. Both entry
 * points assemble one of these; only the verified one can fill it from a row.
 */
interface AdmissionRequest {
  readonly organizationId: string;
  readonly prospectId: string;
  readonly subjectType: ProblemObservationSubjectType;
  readonly subjectId: string;
  readonly statement: string | null | undefined;
  readonly statementLanguage: string | null;
  readonly origin: { readonly store: string | null; readonly recordId: string | null };
  readonly originKind: ProblemObservationOriginKind;
  readonly recordedByUserId: string | null;
  readonly sourceRecordId: string | null;
  readonly observedAt: string | null | undefined;
  readonly confidence: number | null;
}

/**
 * The gate's candidate, plus the attestation the gate reads when it has one.
 *
 * Derived from the gate's OWN parameter type rather than restated, so this seam
 * cannot drift from the contract it calls. `sourceVerification` is optional here
 * because `offeringIntelligence/problemFit.ts` owns that field and is adding it
 * concurrently: typing it here as optional means this seam compiles and behaves
 * correctly both before and after that lands, and that it never silently stops
 * passing the attestation.
 */
type GateCandidate = Parameters<typeof admitProspectProblem>[0] & {
  readonly sourceVerification?: SourceVerification | null;
};

/**
 * THE GATE, THEN THE REPOSITORY. One call to each, for every entry point.
 *
 * Shared so that adding a verified path adds no second validator and no second
 * writer: `admitProspectProblem` still decides what an admissible statement is
 * and still reports every unmet requirement at once, and the repository still
 * owns the relation and still reports a replay as `duplicate` on the strength of
 * its unique constraint rather than an application pre-check.
 *
 * `derivedFrom` is the literal the gate admits and is set HERE, never taken from
 * a caller: a record must ATTEST that the prospect stated this, and nothing
 * downstream can tell a statement from a derivation after the fact.
 *
 * `verification` is a PARAMETER and never a field read off the caller's input.
 * That is the whole reason it is unforgeable: there is no code path by which a
 * request body reaches it, so the only way a candidate carries one is for a
 * module in this capability to have done the reads that produce it.
 */
async function admitAndRecord(
  request: AdmissionRequest,
  verification: SourceVerification | null,
  ports: ProblemObservationPorts,
): Promise<RecordProblemObservationResult> {
  const candidate: GateCandidate = {
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    organizationId: request.organizationId,
    statement: request.statement,
    origin: { store: request.origin.store, recordId: request.origin.recordId },
    observedAt: request.observedAt,
    confidence: request.confidence,
    derivedFrom: 'prospect_statement',
    ...(verification ? { sourceVerification: verification } : {}),
  };

  const admission = admitProspectProblem(candidate);
  if (!admission.admissible || !admission.problem) {
    return refuse(
      'inadmissible_evidence',
      'the statement did not satisfy the prospect-problem admission contract',
      carryRejections(admission.rejections),
    );
  }

  // The admitted problem's own fields are used for everything the gate
  // normalised, so a stored statement is the one that was admitted. Absence
  // stays absence: `confidence` and `statementLanguage` are carried through as
  // null rather than defaulted, and `observedAt` is the SOURCE's instant — the
  // ingest clock is the repository's separate `recordedAt` and is never read
  // for the other.
  try {
    return await ports.record({
      organizationId: request.organizationId,
      prospectId: request.prospectId,
      subjectType: request.subjectType,
      subjectId: admission.problem.subjectId,
      statement: admission.problem.statement,
      statementLanguage: request.statementLanguage,
      origin: admission.problem.origin,
      originKind: request.originKind,
      recordedByUserId: request.recordedByUserId,
      sourceRecordId: request.sourceRecordId,
      observedAt: admission.problem.observedAt,
      confidence: admission.problem.confidence,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error('problem_observation_write_unavailable', {
      organizationId: request.organizationId, prospectId: request.prospectId, detail,
    });
    return refuse('store_unavailable', detail);
  }
}

/**
 * Record one problem a prospect stated.
 *
 * ORDER, and why it is this one:
 *   1. the two refusals that cost nothing — a self-citing origin and an
 *      incoherent actor are decidable from the request alone, so they are
 *      decided before a database round trip is spent on them;
 *   2. the canonical subject, resolved under the verified tenant, because the
 *      gate needs a subject id and cannot be handed a guessed one;
 *   3. `admitProspectProblem`, which decides everything else and reports every
 *      unmet requirement at once;
 *   4. the repository, which owns the relation and reports a replay as
 *      `duplicate` because its unique constraint — not an application-level
 *      pre-check — is what makes that a guarantee rather than a race.
 *
 * It never throws for an input problem: a refusal is a value here, because a
 * thrown exception on an ingestion path tends to be caught and flattened into a
 * generic failure, and the refusal vocabulary exists precisely so a caller can
 * tell these apart. A missing tenant IS thrown, because that is a programming
 * error in the caller, not a bad record.
 */
export async function recordProspectProblemObservation(
  input: ProblemObservationCapture,
  ports: ProblemObservationPorts = defaultProblemObservationPorts,
): Promise<RecordProblemObservationResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'recordProspectProblemObservation: organizationId is required — a problem observation is never '
      + 'tenant-less, and the tenant is the VERIFIED one, never a body field',
    );
  }

  const prospectId = text(input?.prospectId);
  if (!prospectId) {
    return refuse('subject_not_found', 'no prospect id was supplied, so there is nothing to attribute a statement to');
  }

  const subjectType = input?.subjectType === 'person' || input?.subjectType === 'account'
    ? input.subjectType : null;
  if (!subjectType) {
    return refuse(
      'subject_not_found',
      "subjectType must be 'person' or 'account' — a statement is attributed to exactly one canonical subject",
    );
  }

  // ── 1. THE REFUSALS THAT COST NOTHING, BEFORE ANY ROUND TRIP ────────────
  const originStore = text(input?.origin?.store);
  const originKind = input?.originKind === 'provider' || input?.originKind === 'human'
    ? input.originKind : null;
  const recordedByUserId = text(input?.recordedByUserId);
  const cheap = requestOnlyRefusal(originStore, originKind, recordedByUserId);
  if (cheap) return cheap;

  // ── 2. THE SUBJECT, UNDER THE VERIFIED TENANT ───────────────────────────
  const subject = await resolveSubject(organizationId, prospectId, subjectType);
  if (!subject.resolved || !subject.subjectId) {
    // The internal distinction is kept HERE and nowhere a client can see it.
    logger.warn('problem_observation_subject_unresolved', {
      organizationId, prospectId, subjectType, refusal: subject.refusal, detail: subject.detail,
    });
    return refuse(subject.refusal ?? 'subject_not_found', subject.detail);
  }

  // ── 3 & 4. THE GATE, THEN THE REPOSITORY ────────────────────────────────
  // No attestation on this path: a caller-supplied statement is admitted on the
  // strength of the origin it names, and this entry point has read no row. The
  // null is explicit rather than omitted so that "unverified" is a decision
  // taken here instead of an argument nobody passed.
  return admitAndRecord({
    organizationId,
    prospectId,
    subjectType,
    subjectId: subject.subjectId,
    statement: input?.statement,
    statementLanguage: text(input?.statementLanguage),
    origin: { store: originStore, recordId: input?.origin?.recordId ?? null },
    originKind,
    recordedByUserId,
    sourceRecordId: text(input?.sourceRecordId),
    observedAt: input?.observedAt,
    confidence: input?.confidence ?? null,
  }, null, ports);
}

/**
 * ─── THE VERIFIED ENTRY POINT ─────────────────────────────────────────────
 * Record a problem a prospect stated IN ONE ENGAGEMENT MESSAGE.
 *
 * The caller names a message and NOTHING ABOUT THE STATEMENT. There is no
 * parameter for the words, for the instant or for the origin, because every one
 * of them is read out of the row by `verifyProspectMessage`: a caller that could
 * supply the text alongside the id could supply text the row does not contain,
 * and the attestation would then certify a sentence nobody said. That absence of
 * parameters is the guarantee — not a validation step that could be skipped.
 *
 * ORDER, and why it is this one:
 *   1. the request-only refusals, shared with the supplied-statement path, so
 *      nothing reads before the decisions that need no read;
 *   2. the canonical subject, resolved by the SAME private resolver — there is
 *      no second subject resolver in this capability;
 *   3. the verification, which is the only thing that may derive a statement,
 *      an instant or an origin from a message;
 *   4. the shared gate-and-repository path, unchanged, so there is still exactly
 *      one call to `admitProspectProblem` and exactly one call into the
 *      repository in this module.
 *
 * `originKind` is `'provider'` with no recording user: the words arrived inside
 * a provider record, nobody attested them, and the storage CHECK enforces that
 * pairing. `confidence` and `statementLanguage` stay null because the source
 * reports neither, and a null is what "not stated" looks like.
 */
export async function recordProspectProblemFromMessage(
  input: {
    readonly organizationId: string;
    readonly prospectId: string;
    readonly messageId: string;
    readonly subjectType: ProblemObservationSubjectType;
  },
  ports: VerifiedMessageCapturePorts = defaultVerifiedMessageCapturePorts,
): Promise<RecordProblemObservationResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'recordProspectProblemFromMessage: organizationId is required — a problem observation is never '
      + 'tenant-less, and the tenant is the VERIFIED one, never a body field',
    );
  }

  const prospectId = text(input?.prospectId);
  if (!prospectId) {
    return refuse('subject_not_found', 'no prospect id was supplied, so there is nothing to attribute a statement to');
  }

  const subjectType = input?.subjectType === 'person' || input?.subjectType === 'account'
    ? input.subjectType : null;
  if (!subjectType) {
    return refuse(
      'subject_not_found',
      "subjectType must be 'person' or 'account' — a statement is attributed to exactly one canonical subject",
    );
  }

  const messageId = text(input?.messageId);
  if (!messageId) {
    return refuse('source_message_not_found', 'no message id was supplied, so there is no evidence to verify');
  }

  // ── 1. THE REFUSALS THAT COST NOTHING, BEFORE ANY ROUND TRIP ────────────
  // The origin and the actor are DERIVED on this path rather than supplied, so
  // these two hold by construction — and they are run anyway, against the
  // derived values, because a check that is only true by construction stops
  // being true the moment the construction changes.
  const cheap = requestOnlyRefusal(VERIFIED_MESSAGE_ORIGIN_STORE, 'provider', null);
  if (cheap) return cheap;

  // ── 2. THE SUBJECT, UNDER THE VERIFIED TENANT ───────────────────────────
  const subject = await resolveSubject(organizationId, prospectId, subjectType);
  if (!subject.resolved || !subject.subjectId) {
    logger.warn('problem_observation_subject_unresolved', {
      organizationId, prospectId, subjectType, messageId, refusal: subject.refusal, detail: subject.detail,
    });
    return refuse(subject.refusal ?? 'subject_not_found', subject.detail);
  }

  // ── 3. THE VERIFICATION ─────────────────────────────────────────────────
  // On the person path the canonical subject IS the canonical person, so one
  // resolved id answers both. An ACCOUNT subject is refused by the verifier
  // before it reads anything, because a thread links to a person and never to
  // an account — see `verifyProspectMessage`.
  let verification: ProspectMessageVerification;
  try {
    verification = await ports.verify({
      organizationId,
      messageId,
      subjectType,
      subjectId: subject.subjectId,
      personId: subject.subjectId,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error('problem_observation_verification_unavailable', { organizationId, prospectId, messageId, detail });
    return refuse('store_unavailable', detail);
  }

  if (!verification?.verified) {
    // The internal half of the detail is kept HERE and nowhere a client can see
    // it: absent and belonging-to-another-tenant must answer identically.
    logger.warn('problem_observation_message_unverified', {
      organizationId,
      prospectId,
      messageId,
      refusal: verification?.refusal ?? null,
      detail: verification?.internalDetail ?? null,
    });
    return refuse(
      verification?.refusal ?? 'source_message_not_found',
      verification?.detail ?? 'the message could not be verified as a statement by this prospect',
    );
  }

  // ── 4. THE SHARED GATE-AND-REPOSITORY PATH ──────────────────────────────
  return admitAndRecord({
    organizationId,
    prospectId,
    subjectType,
    subjectId: subject.subjectId,
    statement: verification.statement,
    statementLanguage: null,
    origin: {
      store: verification.origin?.store ?? null,
      recordId: verification.origin?.recordId ?? null,
    },
    originKind: 'provider',
    recordedByUserId: null,
    sourceRecordId: null,
    observedAt: verification.observedAt,
    confidence: null,
  }, verification.sourceVerification, ports);
}

/**
 * Read the problems a prospect has stated, under the verified tenant.
 *
 * The subject is resolved by the same reader as the write path, so a prospect
 * that cannot be read for a capture cannot be read for a retrieval either. An
 * unreadable relation comes back as `state: 'unavailable'` and is NEVER
 * flattened into an empty list.
 */
export async function readProspectProblemObservations(
  input: {
    readonly organizationId: string;
    readonly prospectId: string;
    readonly subjectType: ProblemObservationSubjectType;
    readonly limit?: number;
  },
  ports: ProblemObservationPorts = defaultProblemObservationPorts,
): Promise<ReadProblemObservationsResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error('readProspectProblemObservations: organizationId is required — a read is never tenant-less');
  }

  const prospectId = text(input?.prospectId);
  if (!prospectId) return { ok: false, refusal: 'subject_not_found', detail: 'no prospect id was supplied' };

  const subjectType = input?.subjectType === 'person' || input?.subjectType === 'account'
    ? input.subjectType : null;
  if (!subjectType) {
    return {
      ok: false,
      refusal: 'subject_not_found',
      detail: "subjectType must be 'person' or 'account'",
    };
  }

  const subject = await resolveSubject(organizationId, prospectId, subjectType);
  if (!subject.resolved || !subject.subjectId) {
    logger.warn('problem_observation_read_subject_unresolved', {
      organizationId, prospectId, subjectType, refusal: subject.refusal, detail: subject.detail,
    });
    return { ok: false, refusal: subject.refusal ?? 'subject_not_found', detail: subject.detail };
  }

  try {
    const read = await ports.read({
      organizationId,
      subjectType,
      subjectId: subject.subjectId,
      limit: input?.limit,
    });
    return { ok: true, subjectType, subjectId: subject.subjectId, read };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error('problem_observation_read_unavailable', { organizationId, prospectId, detail });
    return { ok: false, refusal: 'store_unavailable', detail };
  }
}
