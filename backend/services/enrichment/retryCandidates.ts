/**
 * A6 — the retry-candidate read.
 *
 * The state-consumption audit found the attempt state model write-only: nothing
 * asked it what work is due. This is that reader, and ONLY that reader. It
 * selects; it does not claim, execute, schedule, or decide policy beyond
 * eligibility. No scheduler, no worker, no loop, no dispatch.
 *
 * ─── DEFAULT-DENY, NOT DEFAULT-ALLOW ──────────────────────────────────────
 * An attempt is a candidate only when its outcome is on an explicit RETRYABLE
 * list. Every other outcome — including ones a future policy may legitimately
 * decide to retry — is excluded. That direction matters: a false negative
 * leaves work undone and visible, a false positive spends a tenant's provider
 * quota on a question already answered. Two outcomes are deliberately left
 * unclassified rather than guessed (see `REQUIRES_POLICY`).
 *
 * ─── WHY `next_retry_at` IS NECESSARY BUT NOT SUFFICIENT ──────────────────
 * The column records what a provider SAID, and its own migration is explicit
 * that NULL "does NOT mean retry now". So the horizon gates WHEN, and the
 * outcome gates WHETHER. Both must hold. An attempt with a due horizon but a
 * permanent outcome is not a candidate, and an attempt with a retryable outcome
 * but no horizon is not one either — nothing has said it is time.
 *
 * ─── `unknown` IS NEVER RETRIED — SETTLED POLICY, NOT AN OPEN QUESTION ────
 * `provider_call_state = 'unknown'` means transport was entered and the process
 * did not survive to say whether the provider answered. Retrying might be free
 * or might be the second charge for one question, and the row cannot tell us
 * which. Asked and decided (2026-09-07): these are NEVER retried automatically.
 * The alternative — retry and risk double-billing a tenant for one question —
 * trades a visible gap for an invisible charge, and only one of those can be
 * noticed and corrected by the person paying. They remain listable so the gap
 * IS visible; re-running one is an explicit human act, never a scheduled one.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { EnrichmentOutcome, EnrichmentSubject } from './providers/contract';
import type { ExecutionStatus, ProviderCallState } from './attempts';

/**
 * How each existing outcome behaves for retry. Total over `ENRICHMENT_OUTCOMES`
 * — a new outcome must be classified here before it can ever be retried,
 * because `retryClassOf` returns `requires_policy` for anything unlisted.
 */
export type RetryClass =
  /** Transient and provider-side. Re-asking the same question can answer it. */
  | 'retryable'
  /** Re-asking changes nothing without new input. */
  | 'permanent'
  /** The answer is already on file. */
  | 'suppressed'
  /** Blocked on a precondition, not on time. A clock cannot unblock it. */
  | 'not_yet_eligible'
  /** Cannot be classified from the record alone. Never retried by default. */
  | 'requires_policy';

export const RETRY_CLASS_BY_OUTCOME: Readonly<Record<EnrichmentOutcome, RetryClass>> = {
  // Transient: the provider was reachable enough to refuse, and said so.
  rate_limited: 'retryable',
  quota_exceeded: 'retryable',
  provider_unavailable: 'retryable',
  timeout: 'retryable',

  // Answered. Re-asking spends money to receive the same reply.
  enriched: 'permanent',
  // The provider looked and does not hold this entity/field. A later REFRESH is
  // a new question with a new freshness window — it is not a retry of this one.
  no_match: 'permanent',
  field_not_found: 'permanent',
  not_implemented: 'permanent',

  // Already on file.
  duplicate_suppressed: 'suppressed',

  // Blocked on a precondition. Time does not supply a credential or a budget.
  credential_missing: 'not_yet_eligible',
  cost_denied: 'not_yet_eligible',

  // ─── deliberately unclassified ──────────────────────────────────────────
  // `provider_declined`: the refusal reason is not recorded, and the two cases
  // are opposite — a policy/ToS refusal is permanent, a transient one is not.
  // `malformed_response`: a provider bug retried on a timer is a loop that
  // bills every iteration.
  provider_declined: 'requires_policy',
  malformed_response: 'requires_policy',
};

/** Outcomes a candidate may carry. Derived, never hand-maintained. */
export const RETRYABLE_OUTCOMES: readonly EnrichmentOutcome[] =
  (Object.keys(RETRY_CLASS_BY_OUTCOME) as EnrichmentOutcome[])
    .filter((o) => RETRY_CLASS_BY_OUTCOME[o] === 'retryable');

/**
 * Execution states that can carry a retryable outcome.
 *
 * `in_flight` has not finished. `refused_pre_call` is OUR refusal, already
 * covered by `not_yet_eligible`. `mark_failed` means the pre-transport marker
 * could not be written, so the row cannot say whether transport happened —
 * the same uncertainty as `unknown`. `abandoned` has no writer.
 */
export const RETRYABLE_EXECUTION_STATUSES: readonly ExecutionStatus[] = ['completed', 'platform_failed'];

/** An outcome's retry class. Unlisted values are never retried. */
export function retryClassOf(outcome: string | null | undefined): RetryClass {
  if (!outcome) return 'requires_policy';
  return RETRY_CLASS_BY_OUTCOME[outcome as EnrichmentOutcome] ?? 'requires_policy';
}

export interface RetryCandidateRow {
  readonly attemptId: string;
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  readonly entityId: string;
  readonly providerKey: string;
  /** A4Y — the work item. A different attribute set is different work. */
  readonly requestedAttributes: readonly string[];
  readonly attemptNumber: number;
  readonly correlationId: string;
  readonly outcome: EnrichmentOutcome;
  readonly executionStatus: ExecutionStatus;
  readonly providerCallState: ProviderCallState;
  /** A7 — already selected and already required by the rule; now surfaced, so
   *  a consumer can re-assert eligibility from the row instead of approximating it. */
  readonly completedAt: string;
  readonly nextRetryAt: string;
}

/**
 * Decide eligibility from a row, independently of the query.
 *
 * The database predicate and this function must agree; keeping the rule in one
 * readable place is what lets a test prove the agreement rather than restate
 * the SQL. Applied again to every returned row, so a widened query cannot leak
 * an ineligible attempt into the candidate set.
 */
export function isRetryCandidate(row: {
  outcome?: string | null;
  execution_status?: string | null;
  provider_call_state?: string | null;
  completed_at?: string | null;
  next_retry_at?: string | null;
}, now: string): boolean {
  if (retryClassOf(row.outcome) !== 'retryable') return false;
  if (!RETRYABLE_EXECUTION_STATUSES.includes(row.execution_status as ExecutionStatus)) return false;
  // Uncertain transport is withheld for policy, never scheduled.
  if (row.provider_call_state === 'unknown') return false;
  // Only a finished attempt can be retried; a live one is still someone's work.
  if (!row.completed_at) return false;
  if (!row.next_retry_at) return false;
  return Date.parse(row.next_retry_at) <= Date.parse(now);
}

const SELECT_COLUMNS =
  'id, organization_id, person_id, account_id, provider_key, requested_attributes, ' +
  'attempt_number, correlation_id, outcome, execution_status, provider_call_state, ' +
  'completed_at, next_retry_at';

/**
 * The PostgREST builder shape this read uses. Declared rather than `any` so a
 * test double must offer the same chain the production table does, and a typo in
 * a predicate name is a compile error instead of a silently dropped filter.
 */
export interface RetryCandidateChain {
  eq(column: string, value: unknown): RetryCandidateChain;
  neq(column: string, value: unknown): RetryCandidateChain;
  not(column: string, operator: string, value: unknown): RetryCandidateChain;
  lte(column: string, value: unknown): RetryCandidateChain;
  in(column: string, values: readonly unknown[]): RetryCandidateChain;
  order(column: string, options: { ascending: boolean }): RetryCandidateChain;
  limit(count: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type RetryCandidateQuery = (columns: string) => RetryCandidateChain;

/**
 * Attempts whose provider-stated horizon has arrived, for ONE tenant.
 *
 * The tenant is a required argument and is applied as the first predicate — a
 * cross-tenant retry would spend one customer's quota answering another's
 * question. There is deliberately no "all tenants" mode: a scheduler that wants
 * several tenants asks for each, so the isolation cannot be lost in a default.
 */
export async function listDueRetryCandidates(input: {
  organizationId: string;
  now: string;
  limit?: number;
  /** Injected for tests. Production uses the real table. */
  query?: RetryCandidateQuery;
}): Promise<readonly RetryCandidateRow[]> {
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) throw new Error('organizationId is required to list retry candidates');
  if (!input.now?.trim()) throw new Error('now is required to list retry candidates');

  const table: RetryCandidateQuery = input.query
    ?? ((columns: string) => ownedDbTable('prospect_enrichment_attempts').select(columns) as unknown as RetryCandidateChain);
  const { data, error } = await table(SELECT_COLUMNS)
    .eq('organization_id', organizationId)                       // tenant — never optional
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', input.now)
    .not('completed_at', 'is', null)
    .in('execution_status', RETRYABLE_EXECUTION_STATUSES)
    .neq('provider_call_state', 'unknown')
    .in('outcome', RETRYABLE_OUTCOMES)
    .order('next_retry_at', { ascending: true })
    .limit(input.limit ?? 50);

  if (error) throw new Error(`prospect_enrichment_attempts retry read failed: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>)
    // Re-applied in code: the query and the rule must agree, and if they ever
    // diverge the safe direction is to return fewer rows, not more.
    .filter((r) => isRetryCandidate(r as never, input.now))
    .map((r) => ({
      attemptId: String(r.id),
      organizationId: String(r.organization_id),
      subject: (r.person_id ? 'person' : 'account') as EnrichmentSubject,
      entityId: String(r.person_id ?? r.account_id),
      providerKey: String(r.provider_key),
      requestedAttributes: Array.isArray(r.requested_attributes) ? (r.requested_attributes as string[]) : [],
      attemptNumber: Number(r.attempt_number),
      correlationId: String(r.correlation_id ?? ''),
      outcome: r.outcome as EnrichmentOutcome,
      executionStatus: r.execution_status as ExecutionStatus,
      providerCallState: (r.provider_call_state as ProviderCallState) ?? 'not_called',
      completedAt: String(r.completed_at),
      nextRetryAt: String(r.next_retry_at),
    }));
}

/**
 * Why an attempt with uncertain transport is not a candidate, however due it is.
 *
 * Reported, never scheduled — and that is the settled answer, not a placeholder
 * waiting for one. Silently dropping these would hide work that never finished;
 * scheduling them would risk billing a tenant twice for one question.
 */
export const UNKNOWN_TRANSPORT_NEVER_RETRIED =
  'provider_call_state=unknown: transport was entered and the outcome is unrecorded. '
  + 'Retrying may be a second charge for one question, so it is never retried '
  + 'automatically. Re-running it is an explicit human decision.';
