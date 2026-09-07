/**
 * A7 — retry SELECTION. The scheduler's half of the retry path, and only that.
 *
 * ─── WHAT THIS IS AFTER RECONCILIATION ─────────────────────────────────────
 * An earlier version of this module decided eligibility itself, re-planned
 * through the planner and called `executePlannedField`. Every one of those
 * responsibilities now has an owner on `main`, so this module gave them up:
 *
 *   deciding what to do with a work item   → `decideEnrichmentAction` (A7D)
 *   acting on that decision                → `consumeEnrichmentWork`  (A7E)
 *   assembling the production ports        → `makeProductionEnrichmentPorts` (A7A)
 *   claiming, executing, completing        → the existing recorded-execution seam
 *
 * What is left is the part nothing else does: choosing WHICH work items a tenant
 * has due, bounding how many are taken per cycle, and handing each to the
 * consumer. Selection, and nothing else.
 *
 * ─── WHY SELECTION IS STILL SEPARATE FROM DECISION ────────────────────────
 * They answer different questions and are not the same rule stated twice.
 * `listDueRetryCandidates` answers "which rows are worth LOOKING at?" — an
 * indexed, tenant-scoped, default-deny narrowing that keeps a cycle from
 * scanning a tenant's history. `decideEnrichmentAction` answers "what should be
 * done with THIS work item?" — authoritatively, from the item's latest attempt.
 * The reader may propose an item the decision then declines; that direction is
 * safe and expected. The reverse cannot happen: nothing is executed that the
 * decision did not choose.
 *
 * ─── IT CANNOT EXECUTE ANYTHING ITSELF ────────────────────────────────────
 * This module holds no adapter, no credential resolver, no cost port and no
 * database handle. Its only runtime imports are a selector helper and a
 * predicate. Every capability that could reach a provider arrives as a port it
 * merely forwards.
 *
 * NO cron, NO queue, NO loop, NO dispatch: the trigger lives in
 * `backend/jobs/prospectRetryJob.ts`.
 */

import type { RetryCandidateRow } from './retryCandidates';
import { canonicalSelectors } from './execution';
import type { ConsumeEnrichmentWorkResult } from './consumeEnrichmentWork';
import type { ExecuteEnrichmentPorts } from './providers/execute';

/**
 * Why one candidate was not handed to the consumer.
 *
 * These are the scheduler's OWN refusals, and there are deliberately few of
 * them: everything that is a judgement about the work item belongs to A7D and
 * is reported as a decision instead. What is left is the cases where a work
 * item cannot be ASSEMBLED — nothing to search on, or an attribute set the
 * consumer's contract cannot carry.
 */
export const RETRY_SKIPS = [
  /** No canonical identity the provider could search on. */
  'selector_missing',
  /** The canonical entity row could not be read in this tenant. */
  'entity_unreadable',
] as const;
export type RetrySkip = typeof RETRY_SKIPS[number];

export type RetryAttemptResult =
  /** The consumer was asked. Its decision — including a refusal — is inside. */
  | { readonly handed: true; readonly candidate: RetryCandidateRow; readonly outcome: ConsumeEnrichmentWorkResult }
  /** The work item could not be assembled; the consumer was never asked. */
  | { readonly handed: false; readonly candidate: RetryCandidateRow; readonly skip: RetrySkip; readonly reason: string };

/**
 * Everything the selector cannot do itself.
 *
 * Each is an existing production function. They are ports so a test can observe
 * ORDER and ARGUMENTS without a database — not so an alternative implementation
 * can be substituted in production.
 */
export interface RetryConsumerPorts {
  /** A6 — `listDueRetryCandidates`. Tenant-scoped, default-deny. */
  listCandidates(input: {
    organizationId: string; now: string; limit: number;
  }): Promise<readonly RetryCandidateRow[]>;

  /**
   * The canonical entity row — `unified_persons` or `prospect_accounts` — from
   * which the provider's search selectors are derived.
   *
   * The attempt is anchored on this entity, so this read is what turns a
   * candidate into a work item. It returns null when the row cannot be read in
   * this tenant, which is refused rather than guessed at.
   */
  loadEntity(input: {
    organizationId: string; subject: 'person' | 'account'; entityId: string;
  }): Promise<Readonly<Record<string, unknown>> | null>;

  /**
   * A7A's suppression lookup — the ANSWER, which `consumeEnrichmentWork`
   * requires as an input. The SAME singleton the executor uses, so the question
   * asked here and the one enforced later cannot diverge.
   */
  freshEvidenceCovers(input: {
    organizationId: string; subject: 'person' | 'account'; entityId: string;
    providerId: string; attributes: readonly string[]; now: string;
  }): Promise<boolean>;

  /** Whether this tenant can call this provider at all, from live source state. */
  sourceReadiness(input: {
    organizationId: string; providerId: string;
  }): Promise<{ credentialAvailable: boolean; sourceOperational: boolean }>;

  /** A7A — `makeProductionEnrichmentPorts`. Forwarded, never inspected. */
  enrichmentPorts(): ExecuteEnrichmentPorts;

  /** A7E — `consumeEnrichmentWork`. The ONLY path from here to a provider. */
  consume(input: {
    workItem: {
      organizationId: string; subject: 'person' | 'account'; entityId: string;
      providerId: string; requestedAttributes: readonly string[];
      selectors: Readonly<Record<string, string>>;
    };
    now: string;
    freshEvidenceCoversRequest: boolean;
    credentialAvailable: boolean;
    sourceOperational: boolean;
    ports: ExecuteEnrichmentPorts;
    lease: { claimedBy: string; ttlMs: number };
    correlationId?: string;
    purpose?: string;
  }): Promise<ConsumeEnrichmentWorkResult>;

  /** Structured events. Never a credential, never a provider payload. */
  emit(event: RetryEvent, fields: Readonly<Record<string, unknown>>): void;
}

/** The observable lifecycle. One event per decision, so a cycle is reconstructable. */
export const RETRY_EVENTS = [
  'candidate_discovered',
  'candidate_skipped',
  'work_item_handed',
  'decision',
  'executed',
  'claim_lost',
  'attempt_not_recorded',
  'cycle_complete',
] as const;
export type RetryEvent = typeof RETRY_EVENTS[number];

/**
 * Conservative, and deliberately constants rather than configuration.
 *
 * A knob is a promise to support every value it accepts. Until this has run in
 * production once, the honest interface is a small fixed number a reader can
 * reason about, and a follow-up that widens it on evidence.
 */
export const RETRY_BATCH_SIZE = 10;
/**
 * One at a time. Concurrency buys throughput on a table that currently holds no
 * due rows, and costs the ability to state plainly what a cycle spends.
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
  readonly handed: number;
  readonly executed: number;
  /** A7D's verdicts, counted. The scheduler reports them; it decides none. */
  readonly decisions: Readonly<Record<string, number>>;
  readonly skipped: Readonly<Record<string, number>>;
  readonly results: readonly RetryAttemptResult[];
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * Assemble ONE candidate into a work item and hand it to the consumer.
 *
 * Exported for the tests that hold each refusal individually; the cycle below is
 * the production entry point.
 */
export async function retryOneCandidate(
  candidate: RetryCandidateRow,
  ports: RetryConsumerPorts,
  input: { workerId: string; now: string; leaseTtlMs?: number },
): Promise<RetryAttemptResult> {
  const no = (skip: RetrySkip, reason: string): RetryAttemptResult => {
    ports.emit('candidate_skipped', {
      organizationId: candidate.organizationId, subject: candidate.subject,
      entityId: candidate.entityId, provider: candidate.providerKey,
      workerId: input.workerId, skip, reason,
    });
    return { handed: false, candidate, skip, reason };
  };

  // ── the work item's identity ─────────────────────────────────────────────
  // Taken verbatim from the attempt the candidate describes. Nothing here
  // widens, narrows or re-sorts the attribute set: A4Y made that set part of
  // the work item's identity, and the consumer scopes its attempt read by it.
  const row = await ports.loadEntity({
    organizationId: candidate.organizationId,
    subject: candidate.subject,
    entityId: candidate.entityId,
  });
  if (!row) {
    return no('entity_unreadable',
      `canonical ${candidate.subject} ${candidate.entityId} could not be read in this tenant`);
  }

  // The existing helper, so the scheduler searches on exactly what the
  // user-initiated path searches on.
  const selectors = canonicalSelectors(candidate.subject, row);
  if (Object.keys(selectors).length === 0) {
    return no('selector_missing',
      `no canonical identity is held for ${candidate.subject} ${candidate.entityId} `
      + 'that a provider could search on');
  }

  // ── the ambient facts A7D is told, and does not look up ──────────────────
  const [freshEvidenceCoversRequest, readiness] = await Promise.all([
    ports.freshEvidenceCovers({
      organizationId: candidate.organizationId,
      subject: candidate.subject,
      entityId: candidate.entityId,
      providerId: candidate.providerKey,
      attributes: candidate.requestedAttributes,
      now: input.now,
    }),
    ports.sourceReadiness({
      organizationId: candidate.organizationId,
      providerId: candidate.providerKey,
    }),
  ]);

  ports.emit('work_item_handed', {
    organizationId: candidate.organizationId, subject: candidate.subject,
    entityId: candidate.entityId, provider: candidate.providerKey,
    attemptNumber: candidate.attemptNumber, correlationId: candidate.correlationId,
    workerId: input.workerId,
  });

  // ── hand off; every judgement past this line belongs to A7D/A7E ──────────
  const outcome = await ports.consume({
    workItem: {
      organizationId: candidate.organizationId,
      subject: candidate.subject,
      entityId: candidate.entityId,
      providerId: candidate.providerKey,
      requestedAttributes: candidate.requestedAttributes,
      selectors,
    },
    now: input.now,
    freshEvidenceCoversRequest,
    credentialAvailable: readiness.credentialAvailable,
    sourceOperational: readiness.sourceOperational,
    // A7A's composition, forwarded whole. The scheduler never inspects or
    // replaces a member, so suppression cannot be lost on this path.
    ports: ports.enrichmentPorts(),
    // A4N — the claim is the arbiter. Of two workers reaching this work item the
    // database admits exactly one; the loser is refused before any egress.
    lease: { claimedBy: input.workerId, ttlMs: input.leaseTtlMs ?? RETRY_LEASE_TTL_MS },
    // The retry belongs to the same investigation as the attempt it follows, so
    // the correlation id is carried rather than regenerated.
    correlationId: candidate.correlationId,
    purpose: `scheduled retry of attempt ${candidate.attemptNumber}`,
  });

  ports.emit('decision', {
    organizationId: candidate.organizationId, entityId: candidate.entityId,
    provider: candidate.providerKey, decision: outcome.decision,
    reason: outcome.reason, workerId: input.workerId,
  });
  if (outcome.refusal === 'claim_lost') {
    ports.emit('claim_lost', {
      organizationId: candidate.organizationId, entityId: candidate.entityId,
      provider: candidate.providerKey, workerId: input.workerId,
    });
  } else if (outcome.refusal === 'attempt_not_recorded') {
    ports.emit('attempt_not_recorded', {
      organizationId: candidate.organizationId, entityId: candidate.entityId,
      provider: candidate.providerKey, workerId: input.workerId,
    });
  } else if (outcome.executed) {
    ports.emit('executed', {
      organizationId: candidate.organizationId, entityId: candidate.entityId,
      provider: candidate.providerKey,
      outcome: outcome.result?.result?.outcome ?? null,
      attemptId: outcome.result?.attemptId ?? null,
      workerId: input.workerId,
    });
  }

  return { handed: true, candidate, outcome };
}

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
  const decisions: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  // Sequential on purpose (RETRY_CONCURRENCY = 1). Two candidates in one cycle
  // are different work items and could safely run together, but a cycle whose
  // spend is one call at a time is one whose cost can be stated exactly.
  for (const candidate of candidates) {
    const result = await retryOneCandidate(candidate, ports, {
      workerId, now: input.now, leaseTtlMs: input.leaseTtlMs,
    });
    results.push(result);
    // `'skip' in result`, not `!result.handed`: the root tsconfig sets
    // `strict: false`, which disables union narrowing on a negated discriminant.
    if ('skip' in result) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
    } else {
      const key = String(result.outcome.decision);
      decisions[key] = (decisions[key] ?? 0) + 1;
    }
  }

  const summary: RetryCycleSummary = {
    organizationId,
    workerId,
    discovered: candidates.length,
    handed: results.filter((r) => r.handed).length,
    executed: results.filter((r) => r.handed && r.outcome.executed).length,
    decisions,
    skipped,
    results,
  };
  ports.emit('cycle_complete', {
    organizationId, workerId,
    discovered: summary.discovered, handed: summary.handed,
    executed: summary.executed, decisions: summary.decisions, skipped: summary.skipped,
  });
  return summary;
}
