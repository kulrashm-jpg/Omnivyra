/**
 * Prospect Problem Observation — the SOLE writer of the capture relation.
 *
 * Storage, and nothing else. Every rule about what an admissible prospect
 * statement is lives in `offeringIntelligence/problemFit.ts`, every rule about
 * which subject a statement may be attributed to lives in the ingestion module
 * that resolves it, and neither is restated here. What this file owns is the
 * narrow question "is this row stored, already stored, or not storable", and it
 * answers it against the database constraints rather than against a second copy
 * of the policy.
 *
 * ─── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────
 * No score, dimension, weight or priority — not computed, not read, not stored.
 * Capturing what a prospect said is not deciding what it is worth, and this
 * module is on the capture side of that line. It imports no fit module, and it
 * writes no table other than its own.
 *
 * ─── TENANT IS A PREDICATE, NOT A FILTER TO REMEMBER ──────────────────────
 * `organizationId` is a required argument on every entry point, is the FIRST
 * predicate of every query, and is RE-ASSERTED ON THE RETURNED ROWS. There is
 * no all-tenants form and no global scope. The re-assertion is the convention
 * stated at `prospectIdentity/relationshipRepository.ts:324-329`: these rows are
 * verbatim statements attributed to named people, so a row from another tenant
 * must be incapable of reaching a caller even if a query were later edited
 * wrongly.
 *
 * ─── SUBJECT EXISTENCE IS NOT CHECKED HERE ────────────────────────────────
 * On purpose. The composite tenant-safe foreign keys refuse a subject that does
 * not exist under the tenant (23503), which this module reports as
 * `subject_not_found` — the contract's own wording, "indistinguishable from
 * absent, deliberately". A pre-read of the canonical spine would belong to the
 * resolving module, which performs no writes; keeping it out of the writer is
 * also what keeps the writer out of the canonical sole-writer scans.
 *
 * ─── IDEMPOTENCY IS A CONSTRAINT, NOT A LOOKUP ────────────────────────────
 * The insert is attempted and a 23505 is a SUCCESS carrying `duplicate: true`
 * — the pattern at `prospectIdentity/ingestionBoundary.ts:377-418`. There is no
 * SELECT-then-INSERT: that is a race dressed as a guarantee. The only read on
 * the conflict path happens AFTER the database has already decided, purely to
 * recover the identifier of the row that won.
 *
 * ─── UNREADABLE IS NOT EMPTY ──────────────────────────────────────────────
 * A missing relation, a missing column or a stale PostgREST schema cache yields
 * `store_unavailable` on write and `state: 'unavailable'` on read. It is NEVER
 * rendered as "this prospect has stated no problems": absence and unreadability
 * are different answers, and collapsing them states something the data never
 * said.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { computeValueHash } from '../prospectIdentity/ingestionBoundary';
import { isRelationIllegible } from '../prospectIdentity/relationshipRepository';
import {
  PROBLEM_OBSERVATION_RELATION,
  SELF_ATTRIBUTED_ORIGIN_STORES,
  type ProblemObservationInput,
  type ProblemObservationRead,
  type ProblemObservationRejection,
  type ProblemObservationSubjectType,
  type RecordProblemObservationResult,
  type StoredProblemObservation,
} from './types';

/** Columns a read returns. Narrow and explicit: nothing selects `*`. */
const SELECT_COLS = [
  'id',
  'organization_id',
  'entity_type',
  'person_id',
  'account_id',
  'statement',
  'statement_hash',
  'statement_language',
  'origin_store',
  'origin_record_id',
  'origin',
  'recorded_by_user_id',
  'source_record_id',
  'confidence',
  'observed_at',
  'recorded_at',
].join(', ');

/** Reads are bounded. A caller may ask for fewer, never for more. */
export const PROBLEM_OBSERVATION_READ_LIMIT_DEFAULT = 100;
export const PROBLEM_OBSERVATION_READ_LIMIT_MAX = 500;

export interface ProblemObservationQuery {
  readonly organizationId: string;
  readonly subjectType: ProblemObservationSubjectType;
  readonly subjectId: string;
  /** Clamped to PROBLEM_OBSERVATION_READ_LIMIT_MAX. */
  readonly limit?: number;
}

type DbError = { code?: string; message?: string; details?: string } | null;

/** The raw row shape, before it is mapped onto the published contract. */
interface ObservationRow {
  id?: string;
  organization_id?: string;
  entity_type?: string;
  person_id?: string | null;
  account_id?: string | null;
  statement?: string;
  statement_hash?: string;
  statement_language?: string | null;
  origin_store?: string;
  origin_record_id?: string;
  origin?: string;
  recorded_by_user_id?: string | null;
  source_record_id?: string | null;
  confidence?: number | null;
  observed_at?: string | null;
  recorded_at?: string;
}

function requireTenant(organizationId: string, fn: string): void {
  if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new Error(`${fn}: organizationId is required — an observation without a tenant is never valid`);
  }
}

function requireSubject(subjectId: string, fn: string): void {
  if (!subjectId || typeof subjectId !== 'string' || !subjectId.trim()) {
    throw new Error(`${fn}: subjectId is required — a statement attributed to nothing is never stored`);
  }
}

// "The relation could not be read or written AS A RELATION" — absent, a column
// absent, or a PostgREST schema cache that does not know it yet (42P01 / 42703 /
// PGRST205). `isRelationIllegible` is REUSED from the existing repository rather
// than restated: a second spelling of "this table is not there" would drift from
// the first, and the whole point of the distinction is that every reader answers
// "unreadable" and "empty" the same way.

const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * sha256 of the TRIMMED statement, lowercase hex.
 *
 * Reuses `computeValueHash`, the helper that already produces
 * `source_assertions.value_hash` and satisfies the same `^[a-f0-9]{64}$` CHECK.
 * A second hashing path for the same purpose would be a second convention, and
 * a digest that disagreed with the stored one would silently break idempotency.
 *
 * Note what is NOT done: no casefolding, no punctuation stripping, no stemming.
 * Any of those would be a normalisation of a sentence — the classifier the
 * contract refuses — and would quietly merge two different utterances into one.
 */
export function computeStatementHash(statement: string): string {
  return computeValueHash(typeof statement === 'string' ? statement.trim() : '', null);
}

/** One refusal, in the closed vocabulary the contract publishes. */
function refusal(
  kind: 'inadmissible_evidence' | 'subject_not_found' | 'subject_other_tenant'
    | 'self_attributed_origin' | 'origin_actor_incoherent' | 'store_unavailable',
  detail: string,
  rejections: readonly ProblemObservationRejection[] = [],
): RecordProblemObservationResult {
  return { ok: false, refusal: kind, detail, rejections };
}

/**
 * Store one statement. Never throws for a database condition; a thrown error
 * means a caller passed something that cannot be a request at all (no tenant,
 * no subject).
 *
 * THE ONLY WRITE PATH FOR THIS RELATION. A second writer would be a second
 * answer to "is a replay a duplicate", and the idempotency key only holds
 * because every insert carries the same hash convention.
 */
export async function recordProblemObservation(
  input: ProblemObservationInput,
): Promise<RecordProblemObservationResult> {
  requireTenant(input.organizationId, 'recordProblemObservation');
  requireSubject(input.subjectId, 'recordProblemObservation');

  // ── Shape refusals the storage CHECKs would make anyway ─────────────────
  // These are the constraints restated, not the admission gate re-implemented:
  // the gate decides whether a statement is admissible evidence, and it has
  // already run by the time a caller reaches the writer. What is checked here
  // is only whether the row CAN be a row, so the caller gets a named refusal
  // instead of a 23514 it has to decode.
  const rejections: ProblemObservationRejection[] = [];
  if (blank(input.statement)) {
    rejections.push({ field: 'statement', reason: 'a statement may not be blank' });
  }
  if (blank(input.origin?.store)) {
    rejections.push({ field: 'origin.store', reason: 'the store the words can be re-read in is required' });
  }
  if (blank(input.origin?.recordId)) {
    rejections.push({ field: 'origin.recordId', reason: 'the record the words can be re-read in is required' });
  }
  if (rejections.length > 0) {
    return refusal('inadmissible_evidence', 'the row is not well formed', rejections);
  }

  // ── Evidence may not cite itself ───────────────────────────────────────
  // An origin naming the capture relation would make the record its own source:
  // a statement attributed to nothing but the fact that someone typed it.
  const store = input.origin.store.trim();
  if (SELF_ATTRIBUTED_ORIGIN_STORES.some((s) => s.toLowerCase() === store.toLowerCase())) {
    return refusal(
      'self_attributed_origin',
      `origin.store may not name the capture relation (${PROBLEM_OBSERVATION_RELATION})`,
      [{ field: 'origin.store', reason: 'evidence may not cite itself' }],
    );
  }

  // ── human <=> a named recorder ─────────────────────────────────────────
  // Checked here as well as by `ppo_origin_actor` so the caller is told which
  // half of the pairing is wrong. The CHECK remains the guarantee.
  const recordedBy = typeof input.recordedByUserId === 'string' && input.recordedByUserId.trim()
    ? input.recordedByUserId.trim()
    : null;
  if (input.originKind === 'human' && recordedBy === null) {
    return refusal('origin_actor_incoherent', 'a human-recorded statement must name the recording user',
      [{ field: 'recordedByUserId', reason: 'required when originKind is human' }]);
  }
  if (input.originKind === 'provider' && recordedBy !== null) {
    return refusal('origin_actor_incoherent', 'a provider-recorded statement must not name a recording user',
      [{ field: 'recordedByUserId', reason: 'must be null when originKind is provider' }]);
  }

  const statement = input.statement.trim();
  const statementHash = computeStatementHash(statement);

  const row = {
    organization_id: input.organizationId,
    // ONE SUBJECT PER ROW, and `entity_type` declares which. Both legs are
    // gated on the declared type, so a caller that supplied the wrong one
    // cannot have the other leg populated behind its back.
    entity_type: input.subjectType,
    person_id: input.subjectType === 'person' ? input.subjectId : null,
    account_id: input.subjectType === 'account' ? input.subjectId : null,
    statement,
    statement_hash: statementHash,
    statement_language: typeof input.statementLanguage === 'string' && input.statementLanguage.trim()
      ? input.statementLanguage.trim()
      : null,
    origin_store: store,
    origin_record_id: input.origin.recordId.trim(),
    origin: input.originKind,
    recorded_by_user_id: recordedBy,
    source_record_id: typeof input.sourceRecordId === 'string' && input.sourceRecordId.trim()
      ? input.sourceRecordId.trim()
      : null,
    // The SOURCE's confidence, or an explicit null. Never defaulted.
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
    // The SOURCE's clock. An absent source time stays absent: `recorded_at` is
    // the database's own default and is never copied into this column.
    observed_at: typeof input.observedAt === 'string' && input.observedAt.trim()
      ? input.observedAt
      : null,
  };

  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(PROBLEM_OBSERVATION_RELATION)
      .insert(row)
      .select('id, organization_id')
      .single();
  } catch (e) {
    return refusal('store_unavailable', `write threw: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error === null) {
    const written = (res.data as ObservationRow | null) ?? null;
    if (written === null || blank(written.id)) {
      return refusal('store_unavailable', 'the write returned no row identity');
    }
    // Re-asserted on the DATA, not only in the query.
    if (written.organization_id !== input.organizationId) {
      return refusal('store_unavailable', 'the written row reported another tenant');
    }
    return { ok: true, observationId: written.id as string, duplicate: false };
  }

  if (isRelationIllegible(error)) {
    return refusal('store_unavailable', `the relation could not be written: ${error.message ?? error.code}`);
  }

  // A REPLAY IS A SUCCESS. The unique index has already decided; the read below
  // only recovers the identifier of the row that won, and is therefore not the
  // SELECT-then-INSERT race the constraint exists to avoid.
  if (error.code === '23505') {
    const existing = await readStoredIdByOriginKey(
      input.organizationId, store, row.origin_record_id, statementHash,
      input.subjectType, input.subjectId,
    );
    if (existing.ok === false) {
      return refusal('store_unavailable',
        `the statement is already stored but its identity could not be read: ${existing.detail}`);
    }
    return { ok: true, observationId: existing.id, duplicate: true };
  }

  // A composite tenant-safe FK refused the subject or the cited source record.
  // Under the contract this is indistinguishable from absent, deliberately.
  if (error.code === '23503') {
    return refusal('subject_not_found',
      `no such subject or source record in this tenant: ${error.message ?? '23503'}`,
      [{ field: 'subjectId', reason: 'not present under this tenant' }]);
  }

  // A CHECK refused the row. Named so a writer fixes one record rather than
  // guessing which rule it broke.
  if (error.code === '23514') {
    return refusal('inadmissible_evidence',
      `the storage layer refused the row: ${error.message ?? '23514'}`,
      [{ field: 'row', reason: String(error.details ?? error.message ?? 'check constraint violated') }]);
  }

  return refusal('store_unavailable', `write failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`);
}

/**
 * The identifier of the row that already holds this statement FOR THIS SUBJECT,
 * under its tenant.
 *
 * Keyed exactly on `uq_ppo_person_origin_statement` /
 * `uq_ppo_account_origin_statement`, so it can match at most one row by
 * construction. THE SUBJECT IS PART OF THAT KEY AND SO IS PART OF THIS READ:
 * an earlier revision keyed this read on (tenant, store, record, hash) alone,
 * which was consistent with the subject-free index it was written against. Once
 * the index became subject-aware, the same origin record can legitimately hold
 * one row per subject, and a subject-free read here would have used
 * `maybeSingle()` across several matching rows — recovering a sibling subject's
 * identifier, or failing outright and reporting `store_unavailable` for what was
 * actually a clean replay. The read must be keyed as narrowly as the constraint
 * that produced the conflict, or it answers a different question.
 */
async function readStoredIdByOriginKey(
  organizationId: string,
  originStore: string,
  originRecordId: string,
  statementHash: string,
  subjectType: ProblemObservationSubjectType,
  subjectId: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(PROBLEM_OBSERVATION_RELATION)
      .select('id, organization_id')
      .eq('organization_id', organizationId)       // tenant boundary — never optional
      .eq('origin_store', originStore)
      .eq('origin_record_id', originRecordId)
      .eq('statement_hash', statementHash)
      .eq('entity_type', subjectType)
      .eq(subjectType === 'person' ? 'person_id' : 'account_id', subjectId)
      .maybeSingle();
  } catch (e) {
    return { ok: false, detail: `read threw: ${(e as Error)?.message ?? 'unknown'}` };
  }
  if (res && res.error) return { ok: false, detail: res.error.message ?? String(res.error.code) };
  const found = (res.data as ObservationRow | null) ?? null;
  if (found === null || blank(found.id)) return { ok: false, detail: 'the conflicting row could not be located' };
  // Re-asserted on the DATA.
  if (found.organization_id !== organizationId) {
    return { ok: false, detail: 'the conflicting row reported another tenant' };
  }
  return { ok: true, id: found.id as string };
}

/** The published row shape, or null when a row fails its own invariants. */
function toStored(row: ObservationRow, organizationId: string): StoredProblemObservation | null {
  if (!row || blank(row.id) || blank(row.statement)) return null;
  // TENANT RE-ASSERTED ON THE ROW. See the file header.
  if (row.organization_id !== organizationId) return null;

  const subjectType: ProblemObservationSubjectType | null =
    row.entity_type === 'person' ? 'person' : row.entity_type === 'account' ? 'account' : null;
  if (subjectType === null) return null;

  const subjectId = subjectType === 'person' ? row.person_id : row.account_id;
  if (blank(subjectId)) return null;

  const originKind = row.origin === 'human' ? 'human' : row.origin === 'provider' ? 'provider' : null;
  if (originKind === null) return null;

  return {
    id: row.id as string,
    organizationId,
    subjectType,
    subjectId: subjectId as string,
    statement: row.statement as string,
    statementLanguage: typeof row.statement_language === 'string' ? row.statement_language : null,
    originStore: row.origin_store as string,
    originRecordId: row.origin_record_id as string,
    originKind,
    recordedByUserId: typeof row.recorded_by_user_id === 'string' ? row.recorded_by_user_id : null,
    sourceRecordId: typeof row.source_record_id === 'string' ? row.source_record_id : null,
    confidence: typeof row.confidence === 'number' ? row.confidence
      : row.confidence == null ? null : Number(row.confidence),
    observedAt: typeof row.observed_at === 'string' ? row.observed_at : null,
    recordedAt: row.recorded_at as string,
  };
}

/**
 * Every statement stored for ONE subject, in ONE tenant, newest first.
 *
 * Returns `state: 'unavailable'` when the question could not be asked. A caller
 * that renders that as "this prospect has stated no problems" is stating
 * something the data never said — which is why the state is in the return type
 * rather than expressed as an empty array.
 *
 * Ordered on the SOURCE's clock, with unstated times last: a statement whose
 * time the source never gave must not sort as though it were the most recent
 * thing the prospect said. `recorded_at` breaks the tie, so the order is total.
 */
export async function readProblemObservations(
  query: ProblemObservationQuery,
): Promise<ProblemObservationRead> {
  requireTenant(query.organizationId, 'readProblemObservations');
  requireSubject(query.subjectId, 'readProblemObservations');

  const requested = typeof query.limit === 'number' && query.limit > 0
    ? Math.floor(query.limit)
    : PROBLEM_OBSERVATION_READ_LIMIT_DEFAULT;
  const limit = Math.min(requested, PROBLEM_OBSERVATION_READ_LIMIT_MAX);
  const subjectColumn = query.subjectType === 'person' ? 'person_id' : 'account_id';

  let res: { data?: unknown; error?: DbError };
  try {
    res = await ownedDbTable(PROBLEM_OBSERVATION_RELATION)
      .select(SELECT_COLS)
      .eq('organization_id', query.organizationId)   // tenant boundary — always FIRST
      .eq('entity_type', query.subjectType)
      .eq(subjectColumn, query.subjectId)
      .order('observed_at', { ascending: false, nullsFirst: false })
      .order('recorded_at', { ascending: false })
      .limit(limit);
  } catch (e) {
    return { state: 'unavailable', detail: `read threw: ${(e as Error)?.message ?? 'unknown'}`, observations: [] };
  }

  const error: DbError = (res && res.error) ? res.error : null;
  if (error !== null) {
    const detail = isRelationIllegible(error)
      ? `the relation could not be read: ${error.message ?? error.code}`
      : `read failed (${error.code ?? 'unknown'}): ${error.message ?? ''}`;
    return { state: 'unavailable', detail, observations: [] };
  }

  const rows = Array.isArray(res.data) ? (res.data as ObservationRow[]) : [];
  const observations: StoredProblemObservation[] = [];
  for (const raw of rows) {
    // Tenant AND subject re-asserted on the row, not only in the query. A row
    // for a different subject must be incapable of reaching a caller even if
    // the query above were later edited wrongly.
    const mapped = toStored(raw, query.organizationId);
    if (mapped === null) continue;
    if (mapped.subjectType !== query.subjectType) continue;
    if (mapped.subjectId !== query.subjectId) continue;
    observations.push(mapped);
  }

  return { state: 'available', detail: null, observations };
}
