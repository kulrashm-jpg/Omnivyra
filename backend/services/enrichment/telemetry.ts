/**
 * Observability for the enrichment subsystem — the one thing it had none of.
 *
 * Twenty-seven files decide, refuse, claim, call and close, and not one of them
 * recorded a metric, a counter or a log line. Every vocabulary in here exists
 * BECAUSE the distinctions matter — `PROVIDER_CALL_STATES` has three values
 * precisely so "died mid-call" cannot be read as "never asked" — and from
 * outside the subsystem all of them were equally invisible. The attempt table
 * holds the per-row truth; nothing held the aggregate.
 *
 * ─── MODELLED ON `prospectIdentity/telemetry.ts` ───────────────────────────
 * Same registry, same fail-safe recorder, same bounded-label discipline, same
 * refusal to carry a tenant id. Deliberately not a new observability domain:
 * `backend/observability/metrics` is the HARDEN-001 surface the snapshot and
 * the Prometheus exporter already enumerate generically.
 *
 * ─── IT INVENTS NO VOCABULARY ─────────────────────────────────────────────
 * Every label value below is a member of a closed set some other module owns
 * and froze: `ENRICHMENT_OUTCOMES` (13), `PLAN_REFUSALS` (6),
 * `PROVIDER_CALL_STATES` (3), `EXECUTION_STATUSES` (6), `RETRY_EVENTS` (8),
 * `RETRY_SKIPS` (2). A counter that named its own categories would become a
 * second, drifting answer to a question the attempt row already answers.
 *
 * They arrive as `import type` and NOT as runtime imports, for a reason worth
 * stating: the arrays live in `execution.ts` and `retryConsumer.ts`, and this
 * module is called FROM `execution.ts`. A runtime import would close a cycle
 * for no gain — the label values are the union members, so the compiler already
 * refuses anything outside the frozen set, and nothing here needs to enumerate
 * them. Series count is fixed at 44, forever, at any traffic or tenant count.
 *
 * ─── NO TENANT, NO ENTITY, NO PII, NO FREE TEXT ───────────────────────────
 * Organization, person, account, attempt, source-record and correlation ids are
 * NEVER labels: they are unbounded, and the registry is a platform aggregate
 * that tenant-facing code can read. Nor is `reason` or `detail` — those are
 * free text, and a provider's message can quote the data it was asked about.
 * Per-attempt tenant detail already has a home: the `prospect_enrichment_attempts`
 * row, which is tenant-scoped and access-controlled. This is the aggregate.
 *
 * ─── FAIL-SAFE: OBSERVATION NEVER GATES A DECISION ────────────────────────
 * Every recorder swallows its own failure and returns void. Nothing in this
 * module may change an enrichment outcome, a refusal, a claim or a spend
 * decision — least of all the money path, where a counter that could throw
 * would be a new way to fail a call the tenant is already being billed for.
 *
 * ─── PURE ─────────────────────────────────────────────────────────────────
 * No clock, no database, no credential, no network, no provider payload. The
 * only runtime dependency is the counter sink, which a test replaces by
 * mocking `backend/observability/metrics` — exactly as the identity module's
 * tests do.
 */

import { recordRawCounter } from '../../observability/metrics';
import type { EnrichmentOutcome } from './providers/contract';
import type { PlanRefusal } from './execution';
import type { ProviderCallState, ExecutionStatus } from './attempts';
import type { RetryEvent, RetrySkip } from './retryConsumer';

/** `<domain>.<subject>.<unit>`, matching the HARDEN-001 convention. */
export const ENRICHMENT_METRICS = {
  provider: {
    outcomes: 'enrichment.provider.outcomes',
    transport: 'enrichment.provider.transport',
    unevidenced: 'enrichment.provider.unevidenced',
  },
  plan: {
    refusals: 'enrichment.plan.refusals',
  },
  execution: {
    closes: 'enrichment.execution.closes',
  },
  retry: {
    events: 'enrichment.retry.events',
    skips: 'enrichment.retry.skips',
  },
} as const;

const counter = (name: string, labels: Record<string, string>): void => {
  try {
    recordRawCounter(name, 1, labels);
  } catch {
    /* observation must never break the path it observes */
  }
};

// ── Plan refusals ───────────────────────────────────────────────────────────

/**
 * One planned field that never reached the executor. 6 series.
 *
 * None of these is billable and none is evidence about the prospect, which is
 * exactly why they were invisible: a refusal leaves no attempt row, no
 * observation and no provider response. `not_executable` and `internal_source`
 * are healthy at volume; a rising `selector_missing` or `entity_not_active` is
 * an identity-layer problem showing up as enrichment doing nothing.
 */
export function recordPlanRefusal(refusal: PlanRefusal): void {
  counter(ENRICHMENT_METRICS.plan.refusals, { refusal });
}

// ── One closed execution ────────────────────────────────────────────────────

/**
 * What the recording seam knows at the moment it closes an attempt.
 *
 * The same four dimensions the attempt row carries, and they are kept apart
 * here for the reason `attempts.ts` states: `outcome` is what the PROVIDER
 * said, `providerCallState` is whether transport happened, `executionStatus`
 * is how OUR execution ended. Collapsing any two would lose the distinction
 * the columns exist to preserve.
 */
export interface ExecutionCloseObservation {
  /** Null when no provider verdict exists — OUR failure, not theirs. */
  readonly outcome: EnrichmentOutcome | null;
  readonly providerCalled: boolean;
  readonly providerCallState: ProviderCallState;
  readonly executionStatus: ExecutionStatus;
  /** The LI-2 observation this call produced, or null if it produced none. */
  readonly sourceRecordId: string | null;
}

/**
 * Record one closed execution. 13 + 3 + 6 = 22 series, plus the counter below.
 *
 * `outcome` is emitted only when there IS one. A null outcome means the
 * provider issued no verdict, and there is no member of `ENRICHMENT_OUTCOMES`
 * that says so — `executionStatus` is what carries that case, which is why it
 * is a separate counter rather than a fourteenth outcome label.
 */
export function recordExecutionClose(observation: ExecutionCloseObservation): void {
  if (observation.outcome !== null) {
    counter(ENRICHMENT_METRICS.provider.outcomes, { outcome: observation.outcome });
  }
  counter(ENRICHMENT_METRICS.provider.transport, { state: observation.providerCallState });
  counter(ENRICHMENT_METRICS.execution.closes, { status: observation.executionStatus });

  if (observation.providerCalled && observation.sourceRecordId === null) {
    recordBillableCallWithoutEvidence(observation.executionStatus);
  }
}

/**
 * THE counter this module exists for: the tenant was billed and holds nothing.
 *
 * `providerCalled === true` with a null `sourceRecordId` means transport
 * happened — the vendor's meter moved, and the vendor invoices the tenant
 * directly — and no observation was persisted. Sometimes that is benign
 * (`no_match`: the provider looked and does not know this entity, and there is
 * nothing to store). Sometimes it is a defect we are paying for: a call that
 * returned fields and then failed to persist them closes `platform_failed`
 * with the fields lost and the bill standing.
 *
 * Why a counter and not the row: today this fact survives ONLY as a row in
 * `prospect_enrichment_attempts`, and that row is `ON DELETE CASCADE` on the
 * person and the account. Deleting the person — an ordinary, legitimate,
 * routinely-exercised operation, and a GDPR obligation — destroys the only
 * evidence the tenant was ever billed for that call. An aggregate counter
 * survives the cascade precisely because it holds no identifier to cascade on.
 *
 * Labelled by `executionStatus` and not by outcome: every billable call has an
 * execution status, whereas the alarming cases are exactly the ones whose
 * outcome is null. 6 series.
 *
 * SCOPE: this is observability for a recorded, deliberately-deferred gap. It
 * does not change the schema, does not add a provider request id, and does not
 * make anything refundable or reconcilable on its own.
 */
export function recordBillableCallWithoutEvidence(executionStatus: ExecutionStatus): void {
  counter(ENRICHMENT_METRICS.provider.unevidenced, { status: executionStatus });
}

// ── The retry path ──────────────────────────────────────────────────────────

/**
 * One event from a retry cycle's lifecycle. 8 series.
 *
 * `retryConsumer` already emits this vocabulary as structured events through an
 * injected port, which means it is observable only if whoever supplied the port
 * chose to write it down — and the sole production supplier is flag-dark. The
 * counter is the part that does not depend on that choice.
 */
export function recordRetryEvent(event: RetryEvent): void {
  counter(ENRICHMENT_METRICS.retry.events, { event });
}

/**
 * A candidate the scheduler could not assemble into a work item. 2 series.
 *
 * Kept apart from the decision vocabulary on purpose, as `RETRY_SKIPS` says:
 * a skip is "this could not be built", not "this should not be done". A cycle
 * that skips everything it discovers and a cycle that discovers nothing look
 * identical in a summary nobody reads.
 */
export function recordRetrySkip(skip: RetrySkip): void {
  counter(ENRICHMENT_METRICS.retry.skips, { skip });
}
