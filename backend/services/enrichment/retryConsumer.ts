/**
 * A7 — the automated retry consumer.
 *
 * A6 built every prerequisite and deliberately stopped short of using them:
 * the candidate reader had no caller, and the lease had no automated worker to
 * claim as. This is that caller, and ONLY that caller.
 *
 * ─── IT ORCHESTRATES; IT DOES NOT EXECUTE ─────────────────────────────────
 * Nothing here contacts a provider, resolves a credential, authorises a cost,
 * checks suppression or writes an observation. Every one of those already has
 * exactly one owner, and a scheduler that re-implemented any of them would be a
 * second execution path with its own drift. The consumer selects work, claims
 * it, and hands it to `executePlannedField` — the same entry point the
 * user-initiated route uses, with one option different: a lease.
 *
 * ─── WHY THE LEASE, AND NOT `requireAttemptRecord` ────────────────────────
 * `requireAttemptRecord` guarantees no provider call happens WITHOUT an attempt
 * row. That is the right guarantee for a person clicking a button: the loser of
 * a race is refused and can see why. It does not prevent the race, and it says
 * nothing about a process that dies mid-flight.
 *
 * An automated worker needs both, so it passes `lease`. On the leased path the
 * claim IS the record — `executeEnrichmentRecorded` takes the lease branch and
 * never reaches the `requireAttemptRecord` branch at all — so passing both
 * would be inert and would imply a second safety mechanism that is not there.
 *
 * ─── DEFAULT-DENY, TWICE ──────────────────────────────────────────────────
 * The reader already refuses anything not explicitly retryable. This re-asserts
 * the horizon before acting, because a candidate read a moment ago may have been
 * acted on since, and re-plans through the existing planner, because an
 * attribute that has become known in the meantime must not be paid for again.
 * Both are cheap; both fail towards doing nothing.
 *
 * NO cron, NO queue, NO loop, NO dispatch: the trigger lives in
 * `backend/jobs/prospectRetryJob.ts`, which is where this repository already
 * keeps cron-runtime wrappers.
 */

import type { RetryCandidateRow } from './retryCandidates';
import { isRetryCandidate, retryClassOf } from './retryCandidates';
import type { EnrichmentPlan, PlannedField } from './planner';
import type { ProspectSnapshot } from './service';
import type { PlanFieldExecution } from './execution';
import type { SourceStatus } from './providers/sources';

/**
 * Why one candidate was not executed.
 *
 * Every one of these is a REFUSAL, not a failure: nothing was spent and the
 * candidate is left exactly as it was, so the next cycle can reconsider it. They
 * are named individually because collapsing them into "skipped" would hide the
 * difference between "someone else is doing it" and "we cannot tell what to do".
 */
export const RETRY_SKIPS = [
  /** The horizon moved, or the row changed, between the read and now. */
  'not_due',
  /** Another worker holds the claim. Correct, and the common case. */
  'claim_lost',
  /** No lead in this tenant reaches the candidate's entity. */
  'prospect_unresolved',
  /** The plan is for a different entity than the candidate names. */
  'entity_mismatch',
  /** The planner no longer wants this enriched — typically now known or fresh. */
  'not_planned',
  /** The work item names an attribute set the plan route cannot execute. */
  'attribute_set_unsupported',
  /** The executor refused before egress. Its own reason is reported with it. */
  'execution_refused',
] as const;
export type RetrySkip = typeof RETRY_SKIPS[number];

export type RetryAttemptResult =
  | { readonly acted: true; readonly candidate: RetryCandidateRow; readonly execution: PlanFieldExecution }
  | { readonly acted: false; readonly candidate: RetryCandidateRow; readonly skip: RetrySkip; readonly reason: string };

/**
 * Everything the consumer cannot do itself.
 *
 * All six are existing production functions. They are ports so a test can
 * observe the ORDER and the ARGUMENTS without a database — not so that an
 * alternative implementation can be substituted in production.
 */
export interface RetryConsumerPorts {
  /** A6 — `listDueRetryCandidates`. Tenant-scoped, default-deny. */
  listCandidates(input: {
    organizationId: string; now: string; limit: number;
  }): Promise<readonly RetryCandidateRow[]>;

  /**
   * The lead through which this canonical entity is reached, or null.
   *
   * The subject of a retry is the ENTITY, never the lead: the attempt record is
   * anchored on `person_id`/`account_id` and holds no lead. A plan, however, is
   * built for a lead, so one has to be named to re-enter the planner.
   *
   * Several leads may reach one account, and the choice between them cannot
   * change the outcome: the account half of a plan is derived from the account
   * row alone, so every lead of that account yields the same account plan. The
   * safety property is therefore NOT which lead was picked — it is the
   * `entity_mismatch` check below, which refuses unless the plan's entity is
   * exactly the entity the candidate names.
   */
  resolveProspect(input: {
    organizationId: string; subject: 'person' | 'account'; entityId: string;
  }): Promise<string | null>;

  /** `planProspectEnrichment`. The existing planner; nothing re-derives a plan. */
  plan(input: {
    organizationId: string; prospectId: string; now: string;
  }): Promise<{ plan: EnrichmentPlan; snapshot: ProspectSnapshot }>;

  /** `tenantSourceStatuses`. The tenant's own credential-aware source states. */
  statuses(organizationId: string): Promise<readonly SourceStatus[]>;

  /**
   * `executePlannedField`, already bound to the production ports.
   *
   * The consumer holds no `ExecuteEnrichmentPorts` of its own, so it cannot
   * reach a credential, a cost decision or a provider even by accident.
   */
  execute(input: {
    plan: EnrichmentPlan;
    field: PlannedField;
    snapshot: ProspectSnapshot;
    statuses: readonly SourceStatus[];
    correlationId: string;
    mode: string;
    lease: { claimedBy: string; ttlMs: number };
  }): Promise<PlanFieldExecution>;

  /** Structured events. Never a credential, never a provider payload. */
  emit(event: RetryEvent, fields: Readonly<Record<string, unknown>>): void;
}

/** The observable lifecycle. One event per decision, so a cycle is reconstructable. */
export const RETRY_EVENTS = [
  'candidate_discovered',
  'claim_won',
  'claim_lost',
  'suppressed',
  'credential_missing',
  'cost_denied',
  'provider_attempted',
  'provider_completed',
  'retry_scheduled',
  'retry_terminated',
  'unknown_skipped',
  'candidate_refused',
  'cycle_complete',
] as const;
export type RetryEvent = typeof RETRY_EVENTS[number];

/**
 * Conservative, and deliberately constants rather than configuration.
 *
 * A knob is a promise to support every value it accepts. Until this has run in
 * production once, the honest interface is a small fixed number that a reader
 * can reason about, and a follow-up that widens it on evidence.
 */
export const RETRY_BATCH_SIZE = 10;
/**
 * One at a time. Concurrency here buys throughput on a table that currently
 * holds no due rows, and costs the ability to state plainly what a cycle spends.
 */
export const RETRY_CONCURRENCY = 1;
/**
 * Lease TTL. Long enough for a provider call plus canonical persistence, short
 * enough that a crashed worker's work is reclaimable within one cycle.
 */
export const RETRY_LEASE_TTL_MS = 2 * 60 * 1000;

export interface RetryCycleSummary {
  readonly organizationId: string;
  readonly workerId: string;
  readonly discovered: number;
  readonly executed: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly results: readonly RetryAttemptResult[];
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * Execute ONE due candidate, or refuse and say why.
 *
 * Exported for the tests that hold each refusal individually; the cycle below
 * is the production entry point.
 */
export async function retryOneCandidate(
  candidate: RetryCandidateRow,
  ports: RetryConsumerPorts,
  input: { workerId: string; now: string; leaseTtlMs?: number },
): Promise<RetryAttemptResult> {
  const no = (skip: RetrySkip, reason: string): RetryAttemptResult => {
    ports.emit('candidate_refused', {
      organizationId: candidate.organizationId, subject: candidate.subject,
      entityId: candidate.entityId, provider: candidate.providerKey,
      attemptNumber: candidate.attemptNumber, correlationId: candidate.correlationId,
      workerId: input.workerId, skip, reason,
    });
    return { acted: false, candidate, skip, reason };
  };

  // ── the rule, re-asserted ────────────────────────────────────────────────
  // The reader applied it at read time. Between then and now another worker may
  // have completed this work item, and a row that is no longer a candidate must
  // not become one merely because it was in a list. `unknown` transport cannot
  // pass this: `isRetryCandidate` refuses it, and there is no override.
  const stillDue = isRetryCandidate({
    outcome: candidate.outcome,
    execution_status: candidate.executionStatus,
    provider_call_state: candidate.providerCallState,
    completed_at: candidate.completedAt,
    next_retry_at: candidate.nextRetryAt,
  }, input.now);
  if (!stillDue) {
    if (candidate.providerCallState === 'unknown') {
      ports.emit('unknown_skipped', {
        organizationId: candidate.organizationId, entityId: candidate.entityId,
        provider: candidate.providerKey, attemptNumber: candidate.attemptNumber,
      });
    }
    return no('not_due', `${candidate.outcome}/${candidate.providerCallState} is not due at ${input.now}`);
  }

  // ── ONE attribute per work item ──────────────────────────────────────────
  // The plan route creates single-attribute work items — `executePlannedField`
  // requests exactly `[field.attribute]` — so a multi-attribute set did not come
  // from this path and cannot be replayed through it. Refused rather than split,
  // because splitting would invent two work items where the record holds one.
  if (candidate.requestedAttributes.length !== 1) {
    return no('attribute_set_unsupported',
      `the work item names ${candidate.requestedAttributes.length} attributes; `
      + 'the plan route executes exactly one');
  }
  const attribute = text(candidate.requestedAttributes[0]);
  if (!attribute) return no('attribute_set_unsupported', 'the work item names a blank attribute');

  // ── locate the plan this entity belongs to ───────────────────────────────
  const prospectId = await ports.resolveProspect({
    organizationId: candidate.organizationId,
    subject: candidate.subject,
    entityId: candidate.entityId,
  });
  if (!prospectId) {
    return no('prospect_unresolved',
      `no lead in tenant ${candidate.organizationId} reaches ${candidate.subject} ${candidate.entityId}`);
  }

  const { plan, snapshot } = await ports.plan({
    organizationId: candidate.organizationId, prospectId, now: input.now,
  });

  // ── the safety property ──────────────────────────────────────────────────
  // Whatever lead was chosen, the plan MUST concern the entity the candidate
  // names. Without this a retry could spend a tenant's quota enriching a
  // different person or account than the one the attempt is recorded against.
  const planned = candidate.subject === 'person' ? snapshot.personId : snapshot.accountId;
  if (planned !== candidate.entityId) {
    return no('entity_mismatch',
      `plan for lead ${prospectId} concerns ${candidate.subject} ${planned ?? 'none'}, `
      + `not ${candidate.entityId}`);
  }

  // ── re-planning is the second default-deny ───────────────────────────────
  // If the attribute has become known or fresh since the failed attempt, the
  // planner says so and nothing is spent. Suppression would catch it a layer
  // later anyway; catching it here avoids the round trip entirely.
  const field = plan.fields.find(
    (f) => f.attribute === attribute && f.subject === candidate.subject);
  if (!field) return no('not_planned', `${candidate.subject}.${attribute} is not in this plan`);
  if (field.action !== 'enrich') return no('not_planned', `${field.action}: ${field.reason}`);

  ports.emit('provider_attempted', {
    organizationId: candidate.organizationId, subject: candidate.subject,
    entityId: candidate.entityId, provider: candidate.providerKey,
    attribute, attemptNumber: candidate.attemptNumber,
    correlationId: candidate.correlationId, workerId: input.workerId,
  });

  let execution: PlanFieldExecution;
  try {
    execution = await ports.execute({
      plan,
      field,
      snapshot,
      statuses: await ports.statuses(candidate.organizationId),
      // Lineage: the retry belongs to the same investigation as the attempt it
      // follows, so the correlation id is carried, never regenerated.
      correlationId: candidate.correlationId,
      // The SAME provider that failed. An explicit mode, so A3C's rule holds and
      // no substitute source is tried on the tenant's behalf.
      mode: candidate.providerKey,
      // A6C — the claim. Of two workers reaching this work item, the database
      // admits exactly one; the loser throws before adapter, credential,
      // suppression, cost and egress.
      lease: { claimedBy: input.workerId, ttlMs: input.leaseTtlMs ?? RETRY_LEASE_TTL_MS },
    });
  } catch (err) {
    // A lost claim is the expected shape of a race, not an incident: another
    // worker holds this work item and is doing exactly what we would have done.
    const message = err instanceof Error ? err.message : String(err);
    ports.emit('claim_lost', {
      organizationId: candidate.organizationId, entityId: candidate.entityId,
      provider: candidate.providerKey, workerId: input.workerId,
    });
    return no('claim_lost', message);
  }

  if (!execution.executed) {
    return no('execution_refused', `${execution.refusal}: ${execution.reason}`);
  }

  ports.emit('claim_won', {
    organizationId: candidate.organizationId, entityId: candidate.entityId,
    provider: candidate.providerKey, attemptId: execution.attemptId,
    attemptNumber: execution.attemptNumber, workerId: input.workerId,
  });
  ports.emit('provider_completed', {
    organizationId: candidate.organizationId, entityId: candidate.entityId,
    provider: execution.providerId, outcome: execution.outcome,
    providerCalled: execution.providerCalled, attemptId: execution.attemptId,
    correlationId: execution.correlationId, workerId: input.workerId,
  });

  // Reported, never decided. Whether this attempt earns another horizon is the
  // provider's answer, recorded by `completeAttempt`; the consumer only says
  // which way it went so a cycle is legible.
  if (execution.outcome === 'duplicate_suppressed') {
    ports.emit('suppressed', { organizationId: candidate.organizationId, entityId: candidate.entityId });
  } else if (execution.outcome === 'credential_missing') {
    ports.emit('credential_missing', { organizationId: candidate.organizationId, provider: execution.providerId });
  } else if (execution.outcome === 'cost_denied') {
    ports.emit('cost_denied', { organizationId: candidate.organizationId, provider: execution.providerId });
  }
  ports.emit(
    isRetryableOutcome(execution.outcome) ? 'retry_scheduled' : 'retry_terminated',
    {
      organizationId: candidate.organizationId, entityId: candidate.entityId,
      outcome: execution.outcome, attemptId: execution.attemptId,
    },
  );

  return { acted: true, candidate, execution };
}

/**
 * Whether this outcome can produce a further candidate.
 *
 * Asks the canonical classification rather than restating it: a second list of
 * retryable outcomes here would be a second retry policy, and the two would
 * drift the first time one of them was edited.
 */
const isRetryableOutcome = (outcome: string | null | undefined): boolean =>
  retryClassOf(outcome) === 'retryable';

/**
 * One bounded cycle for ONE tenant.
 *
 * Bounded three ways: a per-cycle candidate limit, a tenant that must be named,
 * and no loop — the cycle returns and the caller decides whether there is
 * another. There is deliberately no "all tenants" form, for the same reason the
 * reader has none: a cross-tenant sweep would spend one customer's quota
 * answering another's question, and that must not be losable in a default.
 */
export async function runRetryCycle(
  input: {
    organizationId: string;
    workerId: string;
    now: string;
    batchSize?: number;
    leaseTtlMs?: number;
  },
  ports: RetryConsumerPorts,
): Promise<RetryCycleSummary> {
  const organizationId = text(input.organizationId);
  if (!organizationId) throw new Error('organizationId is required to run a retry cycle');
  const workerId = text(input.workerId);
  if (!workerId) throw new Error('workerId is required to run a retry cycle — a lease has an owner');
  if (!text(input.now)) throw new Error('now is required to run a retry cycle');

  const limit = Math.max(1, Math.min(input.batchSize ?? RETRY_BATCH_SIZE, RETRY_BATCH_SIZE));
  const candidates = await ports.listCandidates({ organizationId, now: input.now, limit });

  ports.emit('candidate_discovered', { organizationId, workerId, count: candidates.length, limit });

  const results: RetryAttemptResult[] = [];
  const skipped: Record<string, number> = {};
  const outcomes: Record<string, number> = {};

  // Sequential on purpose (RETRY_CONCURRENCY = 1). Two candidates in one cycle
  // are different work items and could safely run together, but a cycle whose
  // spend is one call at a time is one whose cost can be stated exactly.
  for (const candidate of candidates) {
    const result = await retryOneCandidate(candidate, ports, {
      workerId, now: input.now, leaseTtlMs: input.leaseTtlMs,
    });
    results.push(result);
    // `'skip' in result`, not `!result.acted`: the root tsconfig sets
    // `strict: false`, which disables union narrowing on a negated discriminant.
    // Same reason `execute.ts` writes `'reason' in decision`.
    if ('skip' in result) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
    } else {
      const key = String(result.execution.outcome ?? 'none');
      outcomes[key] = (outcomes[key] ?? 0) + 1;
    }
  }

  const summary: RetryCycleSummary = {
    organizationId,
    workerId,
    discovered: candidates.length,
    executed: results.filter((r) => r.acted).length,
    skipped,
    outcomes,
    results,
  };
  ports.emit('cycle_complete', {
    organizationId, workerId,
    discovered: summary.discovered, executed: summary.executed,
    skipped: summary.skipped, outcomes: summary.outcomes,
  });
  return summary;
}
