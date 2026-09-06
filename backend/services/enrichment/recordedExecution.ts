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
import type { EnrichmentProviderAdapter, EnrichmentRequest } from './providers/contract';
import {
  recordAttempt,
  completeAttempt,
  nextAttemptNumber,
  NON_CALLING_ATTEMPT_OUTCOMES,
} from './attempts';

/** Injectable so the seam is testable without a database. */
export interface AttemptRecorder {
  readonly record?: typeof recordAttempt;
  readonly complete?: typeof completeAttempt;
  readonly nextNumber?: typeof nextAttemptNumber;
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
  } = {},
): Promise<RecordedEnrichmentResult> {
  const rec = options.recorder ?? {};
  const record = rec.record ?? recordAttempt;
  const complete = rec.complete ?? completeAttempt;
  const nextNumber = rec.nextNumber ?? nextAttemptNumber;
  const now = rec.now ?? (() => new Date().toISOString());

  const startedAt = now();
  let attemptId: string | null = null;
  let attemptNumber: number | null = null;

  // ── open the attempt ──────────────────────────────────────────────────────
  // A recording failure must NOT prevent the enrichment: the tenant asked for
  // work, and losing the audit row is a smaller harm than refusing to do it.
  // The failure is surfaced through a null attemptId rather than swallowed.
  try {
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
  } catch {
    attemptId = null;
    attemptNumber = null;
  }

  // ── the existing executor, unchanged ──────────────────────────────────────
  const result = await executeEnrichment(request, providerId, ports, {
    freshnessDays: options.freshnessDays,
    adapter: options.adapter,
  });

  // ── close it ──────────────────────────────────────────────────────────────
  if (attemptId) {
    try {
      await complete({
        organizationId: request.organizationId,
        attemptId,
        outcome: result.outcome,
        providerCalled: result.providerCalled,
        sourceRecordId: result.sourceRecordId,
        attributesReturned: result.attributesReturned,
        detail: result.reason,
        executorVersion: ENRICHMENT_EXECUTOR_VERSION,
        completedAt: now(),
      });
    } catch {
      // Left open deliberately. An open row is a truthful "started, end
      // unknown"; inventing a completion would be worse than the gap.
    }
  }

  return { result, attemptId, attemptNumber };
}

export { NON_CALLING_ATTEMPT_OUTCOMES };
