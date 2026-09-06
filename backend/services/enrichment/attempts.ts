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
import { canonicalAttributeSet, toPgTextArrayLiteral } from './attributeSet';
import type { EnrichmentOutcome, EnrichmentSubject } from './providers/contract';

/** Bumped when the recording contract changes, so a row traces to its writer. */
export const ATTEMPT_RECORD_VERSION = 'a4a.1';

/**
 * A4Q (B3) — what we can PROVE about provider transport.
 *
 * Three values because the question has three answers, and the boolean
 * `provider_called` can only carry two. Nothing here is inferred: `outcome` is
 * null for both "never asked" and "died mid-call", `completed_at` is null for
 * both "in flight" and "abandoned", and the row's existence proves only that an
 * attempt began. Every available signal is silent on the one question that
 * matters, so the third value says so rather than guessing.
 *
 * `unknown` MUST NEVER be collapsed into `not_called`: that is the collapse
 * that lets a retry loop spend a tenant's provider quota twice.
 */
export const PROVIDER_CALL_STATES = [
  /** Transport was never entered. Provable: the pre-transport marker was never written. */
  'not_called',
  /** Transport was definitely entered. The executor observed it. */
  'called',
  /** Transport was about to be entered and the process did not survive to say what happened. */
  'unknown',
] as const;
export type ProviderCallState = typeof PROVIDER_CALL_STATES[number];

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
  /**
   * A4N — the lease, when this attempt is being claimed rather than merely
   * recorded. Absent on the manual, user-initiated path, which does not claim.
   */
  readonly claimedBy?: string;
  readonly claimedUntil?: string;
}

/**
 * A4N — the outcome of trying to claim a work item.
 *
 * `claimed: false` is not an error. It is the normal answer when another
 * worker holds the live slot, and the ONLY correct response to it is to do
 * nothing — in particular, not to contact a provider.
 */
export type AttemptClaim =
  | { readonly claimed: true; readonly attemptId: string; readonly attemptNumber: number; readonly reclaimed: boolean }
  | { readonly claimed: false; readonly reason: 'held_by_another_worker'; readonly detail: string };

/** PostgreSQL's unique-violation SQLSTATE. The arbiter's own answer. */
const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null
  && ((e as { code?: string }).code === UNIQUE_VIOLATION
    || /duplicate key value violates unique constraint/i.test(String((e as { message?: string }).message ?? '')));

export interface CompleteAttemptInput {
  readonly organizationId: string;
  readonly attemptId: string;
  /**
   * The provider's verdict, or `null` when there is none to record.
   *
   * A4E: null is not "unknown", it is "no provider verdict exists" — the
   * execution failed on OUR side (canonical persistence, cost release) after
   * the provider had already answered. Every value in `ENRICHMENT_OUTCOMES`
   * describes either what the provider said or a refusal we made before
   * contacting them, so none of them can name this without blaming the vendor
   * for our failure. The column is already nullable; `completed_at` being set
   * is what distinguishes "finished with no verdict" from "still in flight".
   */
  readonly outcome: EnrichmentOutcome | null;
  /**
   * "We can prove a call happened." Unchanged and still load-bearing across
   * A3/A4A/A4E/A4J/A4N — but it answers a NARROWER question than
   * `providerCallState`, and false covers both `not_called` and `unknown`.
   * Retry logic must read the state, never this.
   */
  readonly providerCalled: boolean;
  /** A4Q — the three-valued truth. Defaults from `providerCalled` when omitted. */
  readonly providerCallState?: ProviderCallState;
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
  /** A4Q — authoritative for retry safety. See `PROVIDER_CALL_STATES`. */
  readonly providerCallState: ProviderCallState;
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

  // A4Y — the attribute set is part of work-item identity, so it is stored in
  // exactly one representation. Order and duplicates are repaired (they carry
  // no information); a malformed token throws rather than being trimmed into
  // something the capability layer would have refused. The database enforces
  // the same rule via `pi_canonical_attribute_set`, so a writer that skipped
  // this would be rejected rather than silently creating a second identity.
  const requestedAttributes = canonicalAttributeSet(input.requestedAttributes);

  const row = {
    organization_id: input.organizationId,
    ...subjectColumns(input.subject, input.entityId),
    provider_key: input.providerId,
    requested_attributes: [...requestedAttributes],
    attempt_number: input.attemptNumber,
    correlation_id: input.correlationId,
    provider_called: false,
    started_at: input.startedAt,
    ...(input.claimedBy ? { claimed_by: input.claimedBy } : {}),
    ...(input.claimedUntil ? { claimed_until: input.claimedUntil } : {}),
  };

  const { data, error } = await ownedDbTable('prospect_enrichment_attempts')
    .insert(row).select('id').single();
  if (error) {
    // The SQLSTATE is preserved on the thrown error so `claimEnrichmentWork`
    // can tell "another worker holds the live slot" from a real insert failure.
    // Collapsing them would make a lost race indistinguishable from a broken
    // database, and only one of those is safe to treat as a no-op.
    throw Object.assign(
      new Error(`prospect_enrichment_attempts insert failed: ${error.message}`),
      { code: (error as { code?: string }).code },
    );
  }
  return { attemptId: (data as { id: string }).id };
}

/**
 * A4N — claim one enrichment work item, atomically.
 *
 * ─── THE ARBITER IS THE DATABASE, NOT THIS FUNCTION ───────────────────────
 * A4J made a lost attempt-record fail closed, which stopped UNRECORDED
 * provider calls. It did not stop two RECORDED ones: read-then-increment lets
 * worker B compute a different attempt number and proceed in parallel. Distinct
 * attempt numbers are two independent executions, not safe concurrency.
 *
 * So the claim is not a number this function chooses — it is the INSERT itself,
 * arbitrated by the partial unique index over live (open) attempts that
 * migration 20261016000000 adds. Of two racing workers the database rejects
 * exactly one with 23505. There is no window in which both proceed, and no
 * dependence on the two workers agreeing on anything.
 *
 * ─── RECLAIM IS A CONDITIONAL UPDATE, FOR THE SAME REASON ─────────────────
 * A process that dies mid-execution leaves an open row (A4E, deliberately),
 * which would otherwise hold the slot forever. Reclaiming steals it only when
 * the lease has expired, through a conditional UPDATE whose WHERE re-checks
 * expiry — PostgreSQL takes the row lock and re-evaluates after acquiring it,
 * so of two racing reclaimers exactly one gets a row back. This is the same
 * mechanism `supabaseExecutionQueue` documents for its own atomic claim.
 *
 * ─── IT FAILS CLOSED ──────────────────────────────────────────────────────
 * Anything other than a definite success returns `claimed: false` or throws.
 * A caller that cannot prove it holds the claim must not contact a provider.
 */
export async function claimEnrichmentWork(input: {
  organizationId: string;
  subject: EnrichmentSubject;
  entityId: string;
  providerId: string;
  requestedAttributes: readonly string[];
  correlationId: string;
  attemptNumber: number;
  startedAt: string;
  claimedBy: string;
  /** Lease deadline. After this an abandoned attempt may be reclaimed. */
  claimedUntil: string;
  /**
   * A4U — cutoff at which an UNLEASED open attempt counts as abandoned.
   * Omitted ⇒ only an expired lease is recoverable, exactly as A4N behaved.
   */
  abandonedBefore?: string;
  /** Injected for testability; defaults to the real writers. */
  ports?: {
    record?: typeof recordAttempt;
    reclaim?: typeof reclaimExpiredAttempt;
  };
}): Promise<AttemptClaim> {
  requireScope(input.organizationId, input.entityId);
  if (!input.claimedBy?.trim()) throw new Error('claimedBy is required to claim enrichment work');
  if (!input.claimedUntil?.trim()) throw new Error('claimedUntil is required to claim enrichment work');

  const record = input.ports?.record ?? recordAttempt;
  const reclaim = input.ports?.reclaim ?? reclaimExpiredAttempt;

  try {
    const opened = await record({
      organizationId: input.organizationId,
      subject: input.subject,
      entityId: input.entityId,
      providerId: input.providerId,
      requestedAttributes: input.requestedAttributes,
      correlationId: input.correlationId,
      attemptNumber: input.attemptNumber,
      startedAt: input.startedAt,
      claimedBy: input.claimedBy,
      claimedUntil: input.claimedUntil,
    });
    return { claimed: true, attemptId: opened.attemptId, attemptNumber: input.attemptNumber, reclaimed: false };
  } catch (err) {
    // A real failure — not a lost race — must still fail closed, loudly.
    if (!isUniqueViolation(err)) throw err;
  }

  // A live attempt already exists. It may be another worker's active execution,
  // or an abandoned one whose lease has expired. Only the second may be taken.
  const stolen = await reclaim({
    organizationId: input.organizationId,
    subject: input.subject,
    entityId: input.entityId,
    providerId: input.providerId,
    // A4Y — reclaim the SAME work item or none. Passing this was the missing
    // half: it was already given to `record`, so an insert collided correctly,
    // but reclaim had no attribute predicate and could take over another set's
    // abandoned attempt.
    requestedAttributes: input.requestedAttributes,
    claimedBy: input.claimedBy,
    claimedUntil: input.claimedUntil,
    now: input.startedAt,
    abandonedBefore: input.abandonedBefore,
  });
  if (stolen) {
    return { claimed: true, attemptId: stolen.attemptId, attemptNumber: stolen.attemptNumber, reclaimed: true };
  }

  return {
    claimed: false,
    reason: 'held_by_another_worker',
    detail: `a live enrichment attempt for '${input.providerId}' on this ${input.subject} is already claimed`,
  };
}

/**
 * A4Q (B3) — record that transport is ABOUT to be entered.
 *
 * This is the whole mechanism. `unknown` cannot be derived after the fact,
 * because after a process death there is nothing left to derive from: `outcome`
 * is null for both "never asked" and "died mid-call", `completed_at` is null
 * for both "in flight" and "abandoned", and the row's existence proves only
 * that an attempt began. So the intent is written BEFORE the call, and the
 * proven answer overwrites it after.
 *
 * A row still holding `unknown` is therefore exactly a process that did not
 * survive its own provider call — the one thing the boolean could never say.
 *
 * Tenant-scoped, and narrowed to the still-open attempt: a completed row is
 * never re-opened by this.
 */
export async function markProviderCallPending(input: {
  organizationId: string;
  attemptId: string;
}): Promise<void> {
  requireScope(input.organizationId);
  if (!input.attemptId?.trim()) throw new Error('attemptId is required');

  const { error } = await ownedDbTable('prospect_enrichment_attempts')
    .update({ provider_call_state: 'unknown' })
    .eq('id', input.attemptId)
    .eq('organization_id', input.organizationId)     // tenant — never optional
    .is('completed_at', null);
  if (error) throw new Error(`prospect_enrichment_attempts call-state mark failed: ${error.message}`);
}

export interface ReclaimAttemptInput {
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  readonly entityId: string;
  readonly providerId: string;
  /**
   * A4Y — the work item being reclaimed, not merely the entity and provider.
   *
   * Required, and canonicalised here: without it a worker executing
   * `[founded_year]` could take over an abandoned attempt whose row says
   * `[employee_count]`, leaving a record that misreports what was asked. A
   * different set — including a subset or a superset — is a DIFFERENT work
   * item and must be opened alongside, never stolen.
   */
  readonly requestedAttributes: readonly string[];
  readonly claimedBy: string;
  readonly claimedUntil: string;
  readonly now: string;
  /**
   * A4U — the cutoff at which an UNLEASED open attempt counts as abandoned.
   *
   * Omit it and behaviour is byte-identical to A4N: only an expired lease is
   * recoverable. Supply it and an attempt that was never leased — the manual
   * path never leases — becomes recoverable once it started before this
   * instant. See `reclaimExpiredAttempt` for why it is required rather than
   * assumed.
   */
  readonly abandonedBefore?: string;
}

/** The atomic storage operation. Injectable so the rule is testable. */
export type AttemptReclaimPort =
  (input: ReclaimAttemptInput) => Promise<{ attemptId: string; attemptNumber: number } | null>;

/**
 * The conditional UPDATE. Atomic for the reason `supabaseExecutionQueue`
 * documents: PostgreSQL takes the row lock and re-evaluates the WHERE after
 * acquiring it, so of two racing recoverers exactly one gets a row back.
 *
 * It writes ONLY ownership. `provider_call_state`, `provider_called`,
 * `outcome`, `source_record_id`, `attributes_returned`, `requested_attributes`
 * and `correlation_id` are all untouched — recovery changes who is working on
 * an attempt, never what is known about it. That is what keeps `unknown` from
 * decaying into `not_called`.
 */
const dbReclaim: AttemptReclaimPort = async (input) => {
  const q = ownedDbTable('prospect_enrichment_attempts')
    .update({ claimed_by: input.claimedBy, claimed_until: input.claimedUntil })
    .eq('organization_id', input.organizationId)                            // tenant — never optional
    .eq(input.subject === 'person' ? 'person_id' : 'account_id', input.entityId)
    .eq('provider_key', input.providerId)
    // A4Y — the work item, not just the entity and provider. A different
    // attribute set (subset and superset included) is different work and is
    // never taken over. Rendered as a quoted PostgreSQL array literal rather
    // than joined bare, so an element containing a comma or quote cannot
    // silently widen or narrow which row matches.
    .filter('requested_attributes', 'eq',
      toPgTextArrayLiteral(canonicalAttributeSet(input.requestedAttributes)))
    .is('completed_at', null);                                              // live only

  // Expired lease, OR — only when the caller supplied a cutoff — an unleased
  // attempt that started before it. Both alternatives sit INSIDE one WHERE, so
  // the check and the take remain a single atomic statement.
  const scoped = input.abandonedBefore
    ? q.or(`claimed_until.lt.${input.now},and(claimed_until.is.null,started_at.lt.${input.abandonedBefore})`)
    : q.lt('claimed_until', input.now);

  const { data, error } = await scoped.select('id, attempt_number');
  if (error) throw new Error(`prospect_enrichment_attempts reclaim failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; attempt_number: number }>;
  if (!rows.length) return null;
  return { attemptId: String(rows[0].id), attemptNumber: Number(rows[0].attempt_number) };
};

/**
 * A4N + A4U — take over a live attempt that nobody is working on.
 *
 * ─── WHY AN UNLEASED ROW NEEDED A CUTOFF (A4T Blocker 1) ──────────────────
 * A4N made the live partial unique index the concurrency arbiter, and recovery
 * its escape hatch: `completed_at IS NULL AND claimed_until < now`. The manual
 * path never sets `claimed_until` — it does not claim — so an abandoned manual
 * attempt has a NULL lease, and `NULL < now()` evaluates to NULL, which a WHERE
 * clause treats as false. The row could never be reclaimed while the live index
 * went on blocking every future attempt for that work item. One dead manual
 * execution, or one failed completion write, wedged it permanently.
 *
 * ─── WHY NOT SIMPLY RECLAIM EVERY NULL LEASE ──────────────────────────────
 * `claimed_until IS NULL` does not mean "dead", it means "unleased" — and an
 * unleased execution may be perfectly alive, because that is how the manual
 * path runs. Taking every NULL-lease row on sight would steal work from a
 * running execution and let two workers call one provider, which is precisely
 * what A4N exists to prevent.
 *
 * ─── THE DISCRIMINATOR IS TEMPORAL, AND THAT IS A HEURISTIC ───────────────
 * The schema affords exactly one way to tell a live unleased execution from a
 * dead one: how long ago it started. So `abandonedBefore` is REQUIRED from the
 * caller rather than assumed here — the same treatment the lease TTL already
 * gets — and omitting it preserves A4N exactly. A caller that supplies a
 * generous cutoff is choosing a policy, not receiving a proof: a genuinely slow
 * manual execution can exceed any threshold. Making that distinction provable
 * would require every attempt to carry a liveness deadline, which is a change
 * to A4A/A4N semantics and is deliberately not made here.
 */
export async function reclaimExpiredAttempt(
  input: ReclaimAttemptInput & { ports?: { reclaim?: AttemptReclaimPort } },
): Promise<{ attemptId: string; attemptNumber: number } | null> {
  requireScope(input.organizationId, input.entityId);
  const run = input.ports?.reclaim ?? dbReclaim;
  return run(input);
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
      // A4Q: when the caller does not state it, derive from the boolean —
      // which is safe here and ONLY here, because completion means the process
      // survived and therefore knows. `unknown` is never produced by this
      // path; it is written before transport and survives only a process death.
      provider_call_state: input.providerCallState
        ?? (input.providerCalled ? 'called' : 'not_called'),
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
  /**
   * A4Y — narrow to one work item. Omitted, the read is unchanged: the whole
   * attempt history for this entity, across every attribute set. Supplied, it
   * is the history of ONE work item, which is what `nextAttemptNumber` needs.
   */
  requestedAttributes?: readonly string[];
  limit?: number;
}): Promise<readonly EnrichmentAttemptRow[]> {
  requireScope(input.organizationId, input.entityId);

  let query = ownedDbTable('prospect_enrichment_attempts')
    .select('id, organization_id, person_id, account_id, provider_key, attempt_number, correlation_id, outcome, provider_called, provider_call_state, source_record_id, started_at, completed_at')
    .eq('organization_id', input.organizationId)
    .eq(input.subject === 'person' ? 'person_id' : 'account_id', input.entityId);

  if (input.providerId) query = query.eq('provider_key', input.providerId);
  if (input.requestedAttributes) {
    query = query.filter('requested_attributes', 'eq',
      toPgTextArrayLiteral(canonicalAttributeSet(input.requestedAttributes)));
  }

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
    providerCallState: (r.provider_call_state as ProviderCallState | null) ?? 'not_called',
    sourceRecordId: (r.source_record_id as string | null) ?? null,
    startedAt: String(r.started_at),
    completedAt: (r.completed_at as string | null) ?? null,
  }));
}

/**
 * The next attempt number for one WORK ITEM — (tenant, entity, provider,
 * canonical attribute set).
 *
 * Arithmetic over recorded history, not a policy: it says which number a retry
 * WOULD carry, never whether a retry should happen.
 *
 * ─── WHY THE ATTRIBUTE SET BELONGS HERE (A4Y) ─────────────────────────────
 * Scoped to the entity alone, the first ever attempt at `[founded_year]` would
 * be numbered 2 merely because `[employee_count]` had been tried once, and
 * `attempt_number` would stop meaning "the Nth try of this work item" — making
 * a per-work-item retry budget underivable from the record. Scoped to the work
 * item, set A and set B each legitimately start at 1, which is exactly what the
 * A4A unique indexes now permit.
 */
export async function nextAttemptNumber(input: {
  organizationId: string;
  subject: EnrichmentSubject;
  entityId: string;
  providerId: string;
  requestedAttributes: readonly string[];
}): Promise<number> {
  const prior = await listAttempts({ ...input, limit: 1 });
  return prior.length ? prior[0].attemptNumber + 1 : 1;
}
