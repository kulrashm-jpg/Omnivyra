/**
 * A4A — the enrichment attempt & outcome record.
 *
 * Records that an execution was ATTEMPTED, and how it ended. Nothing else: it
 * schedules nothing, retries nothing, and decides nothing about when the next
 * attempt should happen.
 *
 * ─── WHY THIS IS THE FIRST MAINTENANCE PIECE ──────────────────────────────
 * The A4 audit found the executor safe to call repeatedly but found no record
 * that it ever ran. Without one, a future refresh loop cannot know it already
 * failed against this provider an hour ago — and the thing it would spend on
 * the retry is the TENANT'S provider quota, not ours. Every other maintenance
 * capability (cooldown, retry ceiling, loop prevention, failure visibility)
 * reduces to a question this table answers and nothing else currently can.
 *
 * ─── ATTEMPT IDENTITY IS NOT OBSERVATION IDENTITY ─────────────────────────
 * A3's `duplicate_suppressed` asks whether an OBSERVATION is still fresh; this
 * module asks whether an EXECUTION was attempted. A suppressed duplicate is a
 * real attempt with a real outcome and is recorded as one — it simply did not
 * contact the provider, which `providerCalled: false` states exactly. Conflating
 * the two would make "we already have fresh data" indistinguishable from "we
 * already tried and it failed", and those call for opposite next actions.
 *
 * ─── THE TENANT IS THE PREDICATE ──────────────────────────────────────────
 * Every function takes `organizationId` explicitly and puts it in the WHERE
 * clause, the convention `integrationCredentialService` established: a row
 * belonging to another tenant is never found rather than found-then-refused.
 * There is no active-org inference — a context pointer is not a credential.
 *
 * ─── NO SECRETS, EVER ─────────────────────────────────────────────────────
 * `detail` is a short diagnostic classification. Credentials, authorization
 * headers and raw provider payloads are never written here; evidence is
 * referenced through `sourceRecordId`, which points at the row LI-2 already
 * wrote. A redaction pass strips anything credential-shaped before insert, so
 * a careless caller cannot leak one through the diagnostic field.
 *
 * ─── APPEND-ONLY ──────────────────────────────────────────────────────────
 * `recordAttempt` inserts; `completeAttempt` closes the row it opened. No
 * attempt is ever deleted or overwritten by a later one — a retry is a new row
 * with a higher `attempt_number`, so the failure that caused it survives.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { EnrichmentOutcome, EnrichmentSubject } from './providers/contract';

/** Bumped when the recording contract changes, so a row traces to its writer. */
export const ATTEMPT_RECORD_VERSION = 'a4a.1';

/**
 * Outcomes that mean the provider was NOT contacted.
 *
 * Imported in spirit from `NON_CALLING_OUTCOMES`, but stated here as a
 * dedicated list because this module must also treat `not_implemented` and the
 * pre-egress refusals as non-calling. It is asserted against the canonical
 * contract in the tests rather than trusted.
 */
export const NON_CALLING_ATTEMPT_OUTCOMES: readonly EnrichmentOutcome[] = [
  'credential_missing', 'not_implemented', 'cost_denied', 'duplicate_suppressed', 'provider_declined',
];

export interface AttemptSubjectRef {
  readonly subject: EnrichmentSubject;
  /** Canonical id: `unified_persons.id` or `prospect_accounts.id`. Never a name. */
  readonly entityId: string;
}

export interface RecordAttemptInput extends AttemptSubjectRef {
  readonly organizationId: string;
  readonly providerId: string;
  readonly requestedAttributes: readonly string[];
  readonly correlationId: string;
  /** 1 for a first attempt; the caller supplies the retry number. */
  readonly attemptNumber: number;
  readonly startedAt: string;
}

export interface CompleteAttemptInput {
  readonly organizationId: string;
  readonly attemptId: string;
  readonly outcome: EnrichmentOutcome;
  readonly providerCalled: boolean;
  readonly sourceRecordId?: string | null;
  readonly attributesReturned?: readonly string[];
  readonly detail?: string | null;
  readonly executorVersion?: string | null;
  readonly completedAt: string;
}

export interface EnrichmentAttemptRow {
  readonly id: string;
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  readonly entityId: string;
  readonly providerKey: string;
  readonly attemptNumber: number;
  readonly correlationId: string;
  readonly outcome: EnrichmentOutcome | null;
  readonly providerCalled: boolean;
  readonly sourceRecordId: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

/** Refuse a tenant-less or subject-less write rather than guessing. */
function requireScope(organizationId: string, entityId?: string): void {
  if (!organizationId?.trim()) {
    throw new Error('organizationId is required — an enrichment attempt is never tenant-less');
  }
  if (entityId !== undefined && !entityId.trim()) {
    throw new Error('entityId is required — an attempt is always about a canonical entity');
  }
}

/**
 * Keys whose VALUE must never reach the diagnostic column.
 *
 * A provider error can echo a request header back, and an adapter author can
 * pass an error message straight through. Redacting here means the rule lives
 * in the one place that writes the column, rather than in every caller.
 *
 * Everything from the marker to the END OF THE LINE is removed, not just the
 * next token. A first version consumed one token and left
 * `Authorization: Bearer <key>` with the key intact, because `Bearer` absorbed
 * the match — a redactor that stops at the first token is worse than none,
 * since it looks like it worked.
 */
const CREDENTIAL_SHAPED = /\b(api[_-]?key|apikey|authorization|bearer|token|secret|password|x-api-key)\b[^\n]*/gi;

/** Truncate and strip anything credential-shaped. Diagnostics, not payloads. */
export function safeDetail(detail: string | null | undefined, max = 500): string | null {
  if (typeof detail !== 'string') return null;
  const redacted = detail.replace(CREDENTIAL_SHAPED, '$1 [redacted]').trim();
  if (!redacted) return null;
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}

const subjectColumns = (subject: EnrichmentSubject, entityId: string) =>
  (subject === 'person'
    ? { person_id: entityId, account_id: null }
    : { person_id: null, account_id: entityId });

/**
 * Open an attempt. Returns the attempt id the caller closes with
 * `completeAttempt`.
 *
 * Deliberately separate from completion: an executor that crashes mid-call
 * leaves an OPEN row, which is itself the evidence that something was started
 * and never finished. A single write-on-completion would lose exactly the case
 * a maintenance loop most needs to see.
 */
export async function recordAttempt(input: RecordAttemptInput): Promise<{ attemptId: string }> {
  requireScope(input.organizationId, input.entityId);
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new Error('attemptNumber must be an integer >= 1');
  }
  if (!input.providerId?.trim()) throw new Error('providerId is required');
  if (!input.correlationId?.trim()) throw new Error('correlationId is required');

  const row = {
    organization_id: input.organizationId,
    ...subjectColumns(input.subject, input.entityId),
    provider_key: input.providerId,
    requested_attributes: [...input.requestedAttributes],
    attempt_number: input.attemptNumber,
    correlation_id: input.correlationId,
    provider_called: false,
    started_at: input.startedAt,
  };

  const { data, error } = await ownedDbTable('prospect_enrichment_attempts')
    .insert(row).select('id').single();
  if (error) throw new Error(`prospect_enrichment_attempts insert failed: ${error.message}`);
  return { attemptId: (data as { id: string }).id };
}

/**
 * Close an attempt with its outcome.
 *
 * Tenant-scoped by predicate: an update naming another tenant's attempt id
 * matches no row rather than being refused after the fact.
 */
export async function completeAttempt(input: CompleteAttemptInput): Promise<void> {
  requireScope(input.organizationId);
  if (!input.attemptId?.trim()) throw new Error('attemptId is required');

  const { error } = await ownedDbTable('prospect_enrichment_attempts')
    .update({
      outcome: input.outcome,
      provider_called: input.providerCalled,
      source_record_id: input.sourceRecordId ?? null,
      attributes_returned: input.attributesReturned ? [...input.attributesReturned] : null,
      detail: safeDetail(input.detail),
      executor_version: input.executorVersion ?? null,
      completed_at: input.completedAt,
    })
    .eq('id', input.attemptId)
    .eq('organization_id', input.organizationId);
  if (error) throw new Error(`prospect_enrichment_attempts update failed: ${error.message}`);
}

/**
 * The attempts already recorded for one entity and provider, newest first.
 *
 * This is the read a future maintenance loop needs in order to choose the next
 * `attemptNumber` and to see how the previous one ended. It deliberately
 * returns rows and NOT a decision: retry policy is not settled, and this module
 * must not imply one.
 */
export async function listAttempts(input: {
  organizationId: string;
  subject: EnrichmentSubject;
  entityId: string;
  providerId?: string;
  limit?: number;
}): Promise<readonly EnrichmentAttemptRow[]> {
  requireScope(input.organizationId, input.entityId);

  let query = ownedDbTable('prospect_enrichment_attempts')
    .select('id, organization_id, person_id, account_id, provider_key, attempt_number, correlation_id, outcome, provider_called, source_record_id, started_at, completed_at')
    .eq('organization_id', input.organizationId)
    .eq(input.subject === 'person' ? 'person_id' : 'account_id', input.entityId);

  if (input.providerId) query = query.eq('provider_key', input.providerId);

  const { data, error } = await query
    .order('started_at', { ascending: false })
    .limit(input.limit ?? 50);
  if (error) throw new Error(`prospect_enrichment_attempts read failed: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    organizationId: String(r.organization_id),
    subject: (r.person_id ? 'person' : 'account') as EnrichmentSubject,
    entityId: String(r.person_id ?? r.account_id),
    providerKey: String(r.provider_key),
    attemptNumber: Number(r.attempt_number),
    correlationId: String(r.correlation_id),
    outcome: (r.outcome as EnrichmentOutcome | null) ?? null,
    providerCalled: Boolean(r.provider_called),
    sourceRecordId: (r.source_record_id as string | null) ?? null,
    startedAt: String(r.started_at),
    completedAt: (r.completed_at as string | null) ?? null,
  }));
}

/**
 * The next attempt number for one (tenant, entity, provider).
 *
 * Arithmetic over recorded history, not a policy: it says which number a retry
 * WOULD carry, never whether a retry should happen.
 */
export async function nextAttemptNumber(input: {
  organizationId: string;
  subject: EnrichmentSubject;
  entityId: string;
  providerId: string;
}): Promise<number> {
  const prior = await listAttempts({ ...input, limit: 1 });
  return prior.length ? prior[0].attemptNumber + 1 : 1;
}
