/**
 * B4-A1 — the single writer of `prospect_discovery_attempts`.
 *
 * ─── THE ARBITER IS THE DATABASE, NOT THIS FILE ───────────────────────────
 * The claim is the INSERT, adjudicated by the partial unique index over OPEN
 * executions (`prospect_discovery_attempts_live`). Of two racing callers —
 * a double-clicked button, a retried request, two workers — PostgreSQL rejects
 * exactly one with 23505. There is no read-then-write check here, because a
 * check cannot close the window between the read and the write, and a tenant
 * being billed twice for one search is precisely what that window costs.
 *
 * This mirrors `claimEnrichmentWork` deliberately: the repository already has
 * one answer to "how is a provider execution claimed", and a second shape would
 * mean two concurrency models to keep correct.
 *
 * ─── WHY RECLAIM STEALS THE ROW RATHER THAN OPENING A NEW ONE ─────────────
 * A discovery execution carries `continuation_state`. If a reclaimer closed the
 * dead row and opened a fresh one, the continuation would be stranded and the
 * new execution would restart from page one — paying the provider again for
 * pages already fetched. So an expired lease is stolen in place, which is also
 * exactly what the enrichment ledger does.
 *
 * ─── IT FAILS CLOSED ──────────────────────────────────────────────────────
 * Every function either proves what it did or refuses. A caller that cannot
 * prove it holds the claim must not contact a provider.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { safeDetail } from '../enrichment/attempts';
import {
  DISCOVERY_EXECUTOR_VERSION,
  isOpenDiscoveryStatus,
  type DiscoveryBounds,
  type DiscoveryExecutionStatus,
  type ProviderCallState,
} from './contract';

const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null
  && ((e as { code?: string }).code === UNIQUE_VIOLATION
    || /duplicate key value violates unique constraint/i.test(String((e as { message?: string }).message ?? '')));

/** Refuse a tenant-less or search-less write rather than guessing. */
function requireScope(organizationId: string, digest?: string): void {
  if (!organizationId?.trim()) {
    throw new Error('organizationId is required — a discovery execution is never tenant-less');
  }
  if (digest !== undefined && !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('searchDigest must be a lowercase sha256 hex digest');
  }
}

export interface DiscoveryAttemptRow {
  readonly id: string;
  readonly organizationId: string;
  readonly providerKey: string;
  readonly searchCriteria: Record<string, unknown>;
  readonly searchDigest: string;
  readonly bounds: DiscoveryBounds;
  readonly attemptNumber: number;
  readonly correlationId: string;
  readonly executionStatus: DiscoveryExecutionStatus;
  readonly providerCallState: ProviderCallState;
  readonly outcome: string | null;
  readonly claimedBy: string | null;
  readonly claimedUntil: string | null;
  readonly pagesFetched: number;
  readonly continuationState: unknown | null;
  readonly resultsObserved: number;
  readonly resultsIngested: number;
  readonly providerCallsMade: number;
  readonly providerRequestId: string | null;
  readonly providerCostState: 'unknown' | 'free' | 'billed';
  readonly providerCostUnits: number | null;
  readonly detail: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly nextRetryAt: string | null;
}

const SELECT_COLUMNS = [
  'id', 'organization_id', 'provider_key', 'search_criteria', 'search_digest',
  'max_pages', 'max_results', 'max_provider_calls', 'attempt_number', 'correlation_id',
  'execution_status', 'provider_call_state', 'outcome', 'claimed_by', 'claimed_until',
  'pages_fetched', 'continuation_state', 'results_observed', 'results_ingested',
  'provider_calls_made', 'provider_request_id', 'provider_cost_state', 'provider_cost_units',
  'detail', 'started_at', 'completed_at', 'next_retry_at',
].join(', ');

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

function toRow(r: Record<string, unknown>): DiscoveryAttemptRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    providerKey: String(r.provider_key),
    searchCriteria: (r.search_criteria ?? {}) as Record<string, unknown>,
    searchDigest: String(r.search_digest),
    bounds: {
      maxPages: Number(r.max_pages),
      maxResults: Number(r.max_results),
      maxProviderCalls: Number(r.max_provider_calls),
    },
    attemptNumber: Number(r.attempt_number),
    correlationId: String(r.correlation_id),
    executionStatus: r.execution_status as DiscoveryExecutionStatus,
    providerCallState: r.provider_call_state as ProviderCallState,
    outcome: (r.outcome ?? null) as string | null,
    claimedBy: (r.claimed_by ?? null) as string | null,
    claimedUntil: iso(r.claimed_until),
    pagesFetched: Number(r.pages_fetched ?? 0),
    continuationState: r.continuation_state ?? null,
    resultsObserved: Number(r.results_observed ?? 0),
    resultsIngested: Number(r.results_ingested ?? 0),
    providerCallsMade: Number(r.provider_calls_made ?? 0),
    providerRequestId: (r.provider_request_id ?? null) as string | null,
    providerCostState: (r.provider_cost_state ?? 'unknown') as 'unknown' | 'free' | 'billed',
    providerCostUnits: r.provider_cost_units === null || r.provider_cost_units === undefined
      ? null : Number(r.provider_cost_units),
    detail: (r.detail ?? null) as string | null,
    startedAt: String(iso(r.started_at)),
    completedAt: iso(r.completed_at),
    nextRetryAt: iso(r.next_retry_at),
  };
}

export interface OpenDiscoveryInput {
  readonly organizationId: string;
  readonly providerKey: string;
  readonly canonicalFilters: Record<string, unknown>;
  readonly searchDigest: string;
  readonly bounds: DiscoveryBounds;
  readonly attemptNumber: number;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly claimedBy?: string;
  readonly claimedUntil?: string;
}

/**
 * Open an execution record.
 *
 * Born `pending` with `provider_call_state = 'not_called'`, which is the only
 * honest pair before anything has been asked of a provider. The SQLSTATE is
 * preserved on a thrown error so the claim path can tell "another execution
 * holds the live slot" from a broken database — collapsing those would make a
 * lost race indistinguishable from an outage, and only one is safe to ignore.
 */
export async function openDiscoveryExecution(
  input: OpenDiscoveryInput,
): Promise<{ id: string }> {
  requireScope(input.organizationId, input.searchDigest);
  if (!input.providerKey?.trim()) throw new Error('providerKey is required');
  if (!input.correlationId?.trim()) throw new Error('correlationId is required');
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new Error('attemptNumber must be an integer >= 1');
  }

  const row = {
    organization_id: input.organizationId,
    provider_key: input.providerKey,
    search_criteria: input.canonicalFilters,
    search_digest: input.searchDigest,
    max_pages: input.bounds.maxPages,
    max_results: input.bounds.maxResults,
    max_provider_calls: input.bounds.maxProviderCalls,
    attempt_number: input.attemptNumber,
    correlation_id: input.correlationId,
    // Stated explicitly rather than left to the column defaults, so the
    // TypeScript vocabulary stays the source of truth for the opening state.
    execution_status: 'pending' satisfies DiscoveryExecutionStatus,
    provider_call_state: 'not_called' satisfies ProviderCallState,
    provider_cost_state: 'unknown',
    started_at: input.startedAt,
    executor_version: DISCOVERY_EXECUTOR_VERSION,
    ...(input.claimedBy ? { claimed_by: input.claimedBy } : {}),
    ...(input.claimedUntil ? { claimed_until: input.claimedUntil } : {}),
  };

  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .insert(row).select('id').single();
  if (error) {
    throw Object.assign(
      new Error(`prospect_discovery_attempts insert failed: ${error.message}`),
      { code: (error as { code?: string }).code },
    );
  }
  return { id: (data as { id: string }).id };
}

/**
 * The next attempt number for this search.
 *
 * Read-then-increment, and that is SAFE here only because it is not the
 * concurrency control: the live partial unique index is. If two callers compute
 * the same number, one INSERT is rejected; if they compute different numbers,
 * the live index still rejects the second. The number is history, not a lock.
 */
export async function nextDiscoveryAttemptNumber(input: {
  readonly organizationId: string;
  readonly providerKey: string;
  readonly searchDigest: string;
}): Promise<number> {
  requireScope(input.organizationId, input.searchDigest);
  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .select('attempt_number')
    .eq('organization_id', input.organizationId)
    .eq('provider_key', input.providerKey)
    .eq('search_digest', input.searchDigest)
    .order('attempt_number', { ascending: false })
    .limit(1);
  if (error) throw new Error(`discovery attempt number lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ attempt_number: number }>;
  return rows.length ? Number(rows[0].attempt_number) + 1 : 1;
}

/**
 * Find the live execution of a search, if one exists.
 *
 * Tenant-scoped, and returns ALL matches rather than `.single()` so a caller is
 * never handed an arbitrary row: the live index guarantees at most one, and if
 * that guarantee were ever broken this returns the evidence instead of hiding it
 * behind a silent pick.
 */
export async function findLiveDiscoveryExecution(input: {
  readonly organizationId: string;
  readonly providerKey: string;
  readonly searchDigest: string;
}): Promise<DiscoveryAttemptRow[]> {
  requireScope(input.organizationId, input.searchDigest);
  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .select(SELECT_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('provider_key', input.providerKey)
    .eq('search_digest', input.searchDigest)
    .is('completed_at', null);
  if (error) throw new Error(`live discovery lookup failed: ${error.message}`);
  // Through `unknown`: the client's row type is a union that includes an error
  // shape, and the two do not overlap structurally.
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toRow);
}

/** Read one execution. Tenant-scoped: another tenant's id answers null. */
export async function getDiscoveryExecution(input: {
  readonly organizationId: string;
  readonly id: string;
}): Promise<DiscoveryAttemptRow | null> {
  requireScope(input.organizationId);
  if (!input.id?.trim()) throw new Error('id is required');
  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .select(SELECT_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.id);
  if (error) throw new Error(`discovery execution read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.length === 1 ? toRow(rows[0]) : null;
}

/**
 * Steal an expired lease, in place.
 *
 * A conditional UPDATE, which is atomic for the same reason the enrichment
 * reclaim is: PostgreSQL takes the row lock and re-evaluates the WHERE after
 * acquiring it, so of two racing reclaimers exactly one gets a row back. The
 * WHERE re-checks expiry rather than trusting the read that found the row.
 *
 * `continuation_state`, the counters and the bounds are untouched: reclaim moves
 * OWNERSHIP, never the question being asked or the progress already paid for.
 */
export async function reclaimExpiredDiscoveryExecution(input: {
  readonly organizationId: string;
  readonly providerKey: string;
  readonly searchDigest: string;
  readonly claimedBy: string;
  readonly claimedUntil: string;
  readonly now: string;
}): Promise<DiscoveryAttemptRow | null> {
  requireScope(input.organizationId, input.searchDigest);
  if (!input.claimedBy?.trim()) throw new Error('claimedBy is required to reclaim');

  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .update({
      claimed_by: input.claimedBy,
      claimed_until: input.claimedUntil,
      execution_status: 'claimed' satisfies DiscoveryExecutionStatus,
      recovered_at: input.now,
    })
    .eq('organization_id', input.organizationId)
    .eq('provider_key', input.providerKey)
    .eq('search_digest', input.searchDigest)
    .is('completed_at', null)
    .lt('claimed_until', input.now)
    .select(SELECT_COLUMNS);
  if (error) throw new Error(`discovery reclaim failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.length ? toRow(rows[0]) : null;
}

export type DiscoveryClaim =
  | { readonly claimed: true; readonly id: string; readonly attemptNumber: number; readonly reclaimed: boolean }
  | { readonly claimed: false; readonly reason: 'already_live'; readonly activeId: string | null };

/**
 * Claim one discovery execution, atomically.
 *
 * Insert first; on a unique violation, try to reclaim an expired lease; if the
 * live execution is genuinely someone else's active work, refuse and say which
 * row holds it so the caller can report that rather than guess.
 */
export async function claimDiscoveryExecution(input: OpenDiscoveryInput & {
  readonly claimedBy: string;
  readonly claimedUntil: string;
  readonly now: string;
  readonly ports?: {
    readonly open?: typeof openDiscoveryExecution;
    readonly reclaim?: typeof reclaimExpiredDiscoveryExecution;
    readonly findLive?: typeof findLiveDiscoveryExecution;
  };
}): Promise<DiscoveryClaim> {
  requireScope(input.organizationId, input.searchDigest);
  if (!input.claimedBy?.trim()) throw new Error('claimedBy is required to claim a discovery execution');
  if (!input.claimedUntil?.trim()) throw new Error('claimedUntil is required to claim a discovery execution');

  const open = input.ports?.open ?? openDiscoveryExecution;
  const reclaim = input.ports?.reclaim ?? reclaimExpiredDiscoveryExecution;
  const findLive = input.ports?.findLive ?? findLiveDiscoveryExecution;

  try {
    const opened = await open(input);
    return { claimed: true, id: opened.id, attemptNumber: input.attemptNumber, reclaimed: false };
  } catch (err) {
    // A real failure — not a lost race — must still fail closed, loudly.
    if (!isUniqueViolation(err)) throw err;
  }

  const stolen = await reclaim({
    organizationId: input.organizationId,
    providerKey: input.providerKey,
    searchDigest: input.searchDigest,
    claimedBy: input.claimedBy,
    claimedUntil: input.claimedUntil,
    now: input.now,
  });
  if (stolen) {
    return { claimed: true, id: stolen.id, attemptNumber: stolen.attemptNumber, reclaimed: true };
  }

  const live = await findLive({
    organizationId: input.organizationId,
    providerKey: input.providerKey,
    searchDigest: input.searchDigest,
  });
  return { claimed: false, reason: 'already_live', activeId: live.length === 1 ? live[0].id : null };
}

/**
 * A4V's pre-transport marker, for discovery.
 *
 * Written BEFORE a provider is contacted and moving the row to
 * `provider_call_state = 'unknown'`: if the process dies inside the call, the
 * row already says "transport may have happened", which is the truth. Were the
 * marker written afterwards, a death mid-call would leave `not_called` and a
 * retry would spend the tenant's quota a second time on the strength of it.
 *
 * Returns false if the marker could not be persisted, and the caller MUST then
 * refuse to contact the provider.
 */
export async function markDiscoveryProviderCallPending(input: {
  readonly organizationId: string;
  readonly id: string;
}): Promise<boolean> {
  requireScope(input.organizationId);
  const { data, error } = await ownedDbTable('prospect_discovery_attempts')
    .update({
      provider_call_state: 'unknown' satisfies ProviderCallState,
      execution_status: 'provider_running' satisfies DiscoveryExecutionStatus,
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.id)
    .is('completed_at', null)
    .select('id');
  if (error) return false;
  return ((data ?? []) as unknown[]).length === 1;
}

/**
 * Record one page's results.
 *
 * Counters are written as ABSOLUTE totals computed by the caller from the row it
 * holds, not as relative increments: this adapter surface has no atomic `+1`, and
 * a read-modify-write of a counter under the execution's own lease is safe
 * precisely because the lease means nobody else is advancing it. The database
 * still has the final word — `pages_fetched <= max_pages`,
 * `results_observed <= max_results` and `provider_calls_made <=
 * max_provider_calls` are CHECKs, so an overrun is rejected here rather than
 * discovered later in a bill.
 */
export async function recordDiscoveryPage(input: {
  readonly organizationId: string;
  readonly id: string;
  readonly pagesFetched: number;
  readonly resultsObserved: number;
  readonly resultsIngested: number;
  readonly providerCallsMade: number;
  readonly continuationState: unknown | null;
  readonly providerRequestId?: string | null;
  readonly providerCostState?: 'unknown' | 'free' | 'billed';
  readonly providerCostUnits?: number | null;
}): Promise<void> {
  requireScope(input.organizationId);
  const patch: Record<string, unknown> = {
    // Transport provably happened: we hold a page from the provider.
    provider_call_state: 'called' satisfies ProviderCallState,
    pages_fetched: input.pagesFetched,
    results_observed: input.resultsObserved,
    results_ingested: input.resultsIngested,
    provider_calls_made: input.providerCallsMade,
    continuation_state: input.continuationState ?? null,
  };
  if (input.providerRequestId !== undefined) patch.provider_request_id = input.providerRequestId;
  if (input.providerCostState !== undefined) {
    patch.provider_cost_state = input.providerCostState;
    // Units are only meaningful once the state is no longer `unknown`; the
    // database enforces the same rule, so sending both keeps them consistent.
    patch.provider_cost_units = input.providerCostState === 'unknown'
      ? null
      : (input.providerCostUnits ?? null);
  }

  const { error } = await ownedDbTable('prospect_discovery_attempts')
    .update(patch)
    .eq('organization_id', input.organizationId)
    .eq('id', input.id)
    .is('completed_at', null);
  if (error) {
    throw Object.assign(
      new Error(`discovery page record failed: ${error.message}`),
      { code: (error as { code?: string }).code },
    );
  }
}

/**
 * Close an execution.
 *
 * `executionStatus` is REQUIRED and must be terminal: an omitted value would
 * leave a finished row claiming `pending`, which is worse than having no column
 * at all. `providerCallState` is required too, because the one thing a closed
 * row must answer is whether a provider was contacted.
 */
export async function completeDiscoveryExecution(input: {
  readonly organizationId: string;
  readonly id: string;
  readonly executionStatus: DiscoveryExecutionStatus;
  readonly providerCallState: ProviderCallState;
  readonly outcome: string | null;
  readonly detail?: string | null;
  readonly completedAt: string;
  readonly nextRetryAt?: string | null;
  readonly lastFailureAt?: string | null;
  /**
   * The counters as the closing executor knows them.
   *
   * Supplied on close because a run that DIED IN TRANSPORT never reached
   * `recordDiscoveryPage`, so without this the row would close reporting zero
   * provider calls for a call that may well have been billed — the one number
   * the ledger exists to make answerable. Written in the SAME statement as
   * `provider_call_state`, so the "no result without transport" CHECK sees a
   * consistent row rather than an intermediate one.
   */
  readonly counters?: {
    readonly pagesFetched: number;
    readonly resultsObserved: number;
    readonly resultsIngested: number;
    readonly providerCallsMade: number;
  };
}): Promise<void> {
  requireScope(input.organizationId);
  if (isOpenDiscoveryStatus(input.executionStatus)) {
    throw new Error(
      `completeDiscoveryExecution requires a terminal status, got '${input.executionStatus}'`,
    );
  }

  const { error } = await ownedDbTable('prospect_discovery_attempts')
    .update({
      execution_status: input.executionStatus,
      provider_call_state: input.providerCallState,
      outcome: input.outcome,
      detail: safeDetail(input.detail ?? null),
      completed_at: input.completedAt,
      // The lease is released on close: a terminal row holds no slot, and a
      // stale `claimed_until` on history would make the expired-lease read lie.
      claimed_by: null,
      claimed_until: null,
      ...(input.counters
        ? {
            pages_fetched: input.counters.pagesFetched,
            results_observed: input.counters.resultsObserved,
            results_ingested: input.counters.resultsIngested,
            provider_calls_made: input.counters.providerCallsMade,
          }
        : {}),
      ...(input.nextRetryAt !== undefined ? { next_retry_at: input.nextRetryAt } : {}),
      ...(input.lastFailureAt !== undefined ? { last_failure_at: input.lastFailureAt } : {}),
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.id)
    .is('completed_at', null);
  if (error) {
    throw Object.assign(
      new Error(`discovery completion failed: ${error.message}`),
      { code: (error as { code?: string }).code },
    );
  }
}
