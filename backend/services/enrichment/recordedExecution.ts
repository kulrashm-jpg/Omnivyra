/**
 * A4A — the recording seam around one enrichment execution.
 *
 * Runs the EXISTING executor and records that it ran. It is a wrapper, not an
 * edit: `executeEnrichment` is frozen A3 contract and is called here exactly as
 * any other caller would call it, with its provider selection, tenant
 * credential resolution, duplicate suppression, tenant-funded cost gate and
 * LI-2 persistence all untouched and unaware of this module.
 *
 * ─── WHY WRAP RATHER THAN INSTRUMENT THE EXECUTOR ─────────────────────────
 * Writing the attempt from inside `executeEnrichment` would give the executor a
 * second responsibility and a database dependency it does not have today — it
 * currently persists only through injected ports, which is what makes it
 * testable without a database. Wrapping keeps that property and leaves the
 * frozen contract byte-identical.
 *
 * ─── THIS CREATES NO AUTOMATIC EXECUTION ──────────────────────────────────
 * Nothing calls this module. It is the seam A4B will call once a trigger and a
 * retry policy exist; until then it is reachable only from a test or an
 * explicit caller. A4A deliberately does not connect planner → executor, does
 * not add a job, and does not schedule anything.
 *
 * ─── AN OPEN ROW IS EVIDENCE ──────────────────────────────────────────────
 * The attempt is recorded BEFORE the executor runs and closed after. If the
 * process dies mid-call the row stays open, which is exactly the state a
 * maintenance loop needs to see — a single write after completion would lose
 * the crash case entirely, and that is the case most likely to loop.
 */

import {
  executeEnrichment,
  type ExecuteEnrichmentPorts,
  type ExecuteEnrichmentResult,
  ENRICHMENT_EXECUTOR_VERSION,
} from './providers/execute';
// Direct, not through `./providers` — that barrel registers adapters on import,
// and the recorder must not cause registration as a side effect of being loaded.
import { getProvider } from './providers/registry';
import type {
  EnrichmentOutcome, EnrichmentProviderAdapter, EnrichmentRequest,
} from './providers/contract';
import {
  recordAttempt,
  completeAttempt,
  nextAttemptNumber,
  claimEnrichmentWork,
  NON_CALLING_ATTEMPT_OUTCOMES,
} from './attempts';

/**
 * A4N — raised when the work item is already claimed by another worker.
 *
 * Distinct from `AttemptRecordRequiredError`: nothing failed. Another worker
 * legitimately holds the live slot, and the correct response is to do nothing.
 * A scheduler treats this as a no-op tick, not an incident.
 */
export class EnrichmentWorkClaimedError extends Error {
  constructor(detail: string) {
    super(`enrichment work is already claimed: ${detail}`);
    this.name = 'EnrichmentWorkClaimedError';
  }
}

/**
 * A4J (B1) — raised when a fail-closed caller could not establish the attempt.
 *
 * Deliberately an error and not an `EnrichmentOutcome`: nothing about the
 * provider happened, so there is no verdict to record, and A4F froze that
 * vocabulary as provider-facing. A scheduler catches this and skips the tick.
 */
export class AttemptRecordRequiredError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super(
      'the enrichment attempt could not be recorded, and this execution requires a '
      + 'recorded attempt before any provider call'
      + (cause instanceof Error ? `: ${cause.message}` : ''),
    );
    this.name = 'AttemptRecordRequiredError';
    this.cause = cause;
  }
}

/** Injectable so the seam is testable without a database. */
export interface AttemptRecorder {
  readonly record?: typeof recordAttempt;
  readonly complete?: typeof completeAttempt;
  readonly nextNumber?: typeof nextAttemptNumber;
  /** A4N — the atomic claim, used only when `options.lease` is supplied. */
  readonly claim?: typeof claimEnrichmentWork;
  readonly now?: () => string;
}

export interface RecordedEnrichmentResult {
  readonly result: ExecuteEnrichmentResult;
  /** Null only when the attempt could not be recorded — see below. */
  readonly attemptId: string | null;
  readonly attemptNumber: number | null;
}

/**
 * Execute one enrichment and record the attempt around it.
 *
 * `providerCalled` is taken from the executor's own answer rather than inferred
 * from the outcome: the executor is the only thing that knows whether egress
 * happened, and "how many paid calls did this tenant make" must not depend on a
 * mapping this module maintains separately.
 */
export async function executeEnrichmentRecorded(
  request: EnrichmentRequest,
  providerId: string,
  ports: ExecuteEnrichmentPorts,
  options: {
    freshnessDays?: number;
    adapter?: EnrichmentProviderAdapter;
    recorder?: AttemptRecorder;
    /**
     * A4J (B1) — refuse to contact a provider unless the attempt was recorded.
     *
     * Defaults to FALSE, preserving A4A's fail-open behaviour for the existing
     * user-initiated path, which no repository evidence says should change.
     * An automated caller sets it to true and gets the guarantee it needs:
     * recorded ⇒ the provider may be called; not recorded ⇒ it must not be.
     */
    requireAttemptRecord?: boolean;
    /**
     * A4N — claim the work item before executing.
     *
     * Presence switches attempt creation from a plain INSERT to an atomic
     * CLAIM arbitrated by the live partial unique index, so two concurrent
     * workers cannot both reach a provider for the same (tenant, entity,
     * provider). Claiming implies fail-closed: losing the claim, or failing to
     * establish it, both stop execution before any transport.
     *
     * Absent on the manual, user-initiated path, which does not claim and
     * keeps A4A/A4J behaviour exactly.
     */
    lease?: {
      /** Worker/process identifier. Never a credential, never a user. */
      readonly claimedBy: string;
      /** How long the lease is held before an abandoned attempt may be taken. */
      readonly ttlMs: number;
    };
  } = {},
): Promise<RecordedEnrichmentResult> {
  const rec = options.recorder ?? {};
  const record = rec.record ?? recordAttempt;
  const complete = rec.complete ?? completeAttempt;
  const nextNumber = rec.nextNumber ?? nextAttemptNumber;
  const claim = rec.claim ?? claimEnrichmentWork;
  const now = rec.now ?? (() => new Date().toISOString());

  const startedAt = now();
  let attemptId: string | null = null;
  let attemptNumber: number | null = null;

  // ── A4N: claim before anything else ───────────────────────────────────────
  // When a lease is requested the work item is CLAIMED rather than merely
  // recorded. The arbiter is the database's live partial unique index, not
  // this code: of two racing workers exactly one INSERT survives. A lost claim
  // returns here, before adapter resolution, credential resolution, duplicate
  // suppression, cost authorisation and any egress — so the loser performs
  // zero provider transport.
  //
  // This is deliberately NOT inside the fail-open try/catch below. A claim
  // refusal is not a recording failure to be tolerated; it is the whole point.
  if (options.lease) {
    const startNumber = await nextNumber({
      organizationId: request.organizationId,
      subject: request.subject,
      entityId: request.entityId,
      providerId,
    });
    const claimedUntil = new Date(Date.parse(startedAt) + Math.max(1, options.lease.ttlMs)).toISOString();
    const outcome = await claim({
      organizationId: request.organizationId,
      subject: request.subject,
      entityId: request.entityId,
      providerId,
      requestedAttributes: request.attributes,
      correlationId: request.correlationId,
      attemptNumber: startNumber,
      startedAt,
      claimedBy: options.lease.claimedBy,
      claimedUntil,
    });
    // `'reason' in outcome`, not `!outcome.claimed`: the root tsconfig sets
    // `strict: false`, which disables union narrowing on a negated discriminant.
    if ('reason' in outcome) throw new EnrichmentWorkClaimedError(outcome.detail);

    attemptId = outcome.attemptId;
    attemptNumber = outcome.attemptNumber;
  } else try {
    // ── open the attempt, unclaimed ─────────────────────────────────────────
    // The manual, user-initiated path. A recording failure must NOT prevent
    // the enrichment: the tenant asked for work, and losing the audit row is a
    // smaller harm than refusing to do it — unless the caller said otherwise
    // via `requireAttemptRecord` (A4J). Surfaced as a null attemptId, never
    // swallowed.
    attemptNumber = await nextNumber({
      organizationId: request.organizationId,
      subject: request.subject,
      entityId: request.entityId,
      providerId,
    });
    const opened = await record({
      organizationId: request.organizationId,
      subject: request.subject,
      entityId: request.entityId,
      providerId,
      requestedAttributes: request.attributes,
      correlationId: request.correlationId,
      attemptNumber,
      startedAt,
    });
    attemptId = opened.attemptId;
  } catch (err) {
    attemptId = null;
    attemptNumber = null;

    // ── A4J (B1): fail closed when the caller requires a record ─────────────
    // A4A's fail-open is right for a USER-INITIATED action: the tenant asked
    // for work, and losing the audit row is a smaller harm than refusing it.
    // It is wrong for an AUTOMATED one, where nobody is waiting and the row is
    // the only thing standing between a retry loop and a second paid call.
    //
    // Concretely: `nextAttemptNumber` is read-then-increment, so two workers
    // racing on the same (tenant, entity, provider) can compute the same
    // number. The partial unique index rejects the loser's INSERT — and before
    // this, the loser swallowed that rejection and called the provider anyway,
    // producing two provider calls and one attempt row. The record understated
    // the spend in exactly the case a scheduler creates.
    //
    // Throwing HERE is what makes it safe: this is before adapter resolution,
    // before credential resolution, before cost authorisation and before any
    // egress, so a caller that cannot be recorded cannot reach a provider.
    if (options.requireAttemptRecord) throw new AttemptRecordRequiredError(err);
  }

  // ── observe transport (A4E) ───────────────────────────────────────────────
  // The executor can throw AFTER `adapter.enrich` has already succeeded —
  // `persistObservation` and `releaseCost` are both unguarded. When it does,
  // there is no result to read `providerCalled` from, and the exception cannot
  // say whether egress happened: a persistence failure and a credential-store
  // failure both arrive as a thrown Error. Inferring from the message would
  // make "how many paid calls did this tenant make" depend on string matching.
  //
  // So the truth is taken from the one event that defines it — `enrich()` being
  // entered. The adapter the executor would have resolved is resolved here and
  // passed back through the existing `options.adapter` seam, wrapped so that
  // entering it flips the flag. The executor is still unmodified, still makes
  // exactly one call, and still sees an adapter with identical behaviour.
  const baseAdapter = options.adapter ?? getProvider(providerId);
  let providerCalled = false;
  const observed: EnrichmentProviderAdapter | undefined = baseAdapter
    ? {
      ...baseAdapter,
      enrich: (req) => {
        // Set BEFORE awaiting: transport has been initiated, which is exactly
        // what the executor itself reports when `enrich` throws.
        providerCalled = true;
        return baseAdapter.enrich(req);
      },
    }
    : undefined;   // no adapter registered — the executor answers not_implemented

  // ── close the attempt, on every exit ──────────────────────────────────────
  // Best-effort: a recorder that cannot write must not turn a completed
  // enrichment into a failure, nor replace the caller's error with its own.
  const close = async (fields: {
    outcome: EnrichmentOutcome | null;
    providerCalled: boolean;
    sourceRecordId?: string | null;
    attributesReturned?: readonly string[];
    detail: string | null;
  }): Promise<void> => {
    if (!attemptId) return;
    try {
      await complete({
        organizationId: request.organizationId,
        attemptId,
        sourceRecordId: null,
        ...fields,
        executorVersion: ENRICHMENT_EXECUTOR_VERSION,
        completedAt: now(),
      });
    } catch {
      // Left open. An open row is a truthful "started, end unknown"; inventing
      // a completion would be worse than the gap.
    }
  };

  let result: ExecuteEnrichmentResult;
  try {
    result = await executeEnrichment(request, providerId, ports, {
      freshnessDays: options.freshnessDays,
      adapter: observed,
    });
  } catch (err) {
    // G1. The provider may already have been contacted and the tenant's quota
    // already spent. Leaving the row open with its insert-time
    // `provider_called: false` would tell a future retry loop that no call was
    // made, and it would spend that quota a second time — the precise harm the
    // attempt record exists to prevent.
    //
    // `outcome` stays null: the provider issued no verdict, and every value in
    // ENRICHMENT_OUTCOMES describes either what a provider said or a refusal we
    // made before reaching one. Borrowing `provider_unavailable` would blame
    // the vendor for our own persistence failure. See `CompleteAttemptInput`.
    await close({
      outcome: null,
      providerCalled,
      detail: `execution failed after ${providerCalled ? 'the provider was called' : 'no provider call'}: `
        + (err instanceof Error ? err.message : String(err)),
    });
    throw err;   // the original failure, unchanged and unswallowed
  }

  await close({
    outcome: result.outcome,
    // The executor's own answer when it has one; it is the only thing that
    // knows whether a duplicate was suppressed before egress.
    providerCalled: result.providerCalled,
    sourceRecordId: result.sourceRecordId,
    attributesReturned: result.attributesReturned,
    detail: result.reason,
  });

  return { result, attemptId, attemptNumber };
}

export { NON_CALLING_ATTEMPT_OUTCOMES };
