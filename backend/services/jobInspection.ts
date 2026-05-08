/**
 * Job Inspection — operator-grade visibility into the dead-letter queue
 * and stuck-job state. Read-only by default; replay is opt-in via the
 * admin endpoint.
 *
 * What "stuck job" means here:
 *   A job that started (broker delivered, worker began) but never
 *   completed and never landed in the DLQ. Today the dominant signal
 *   for this is on the credit side (orphan HOLDs — handled separately
 *   by the credit-reaper). For non-credit jobs, the stuck-state is
 *   harder to detect because most workers do not write a "started" row.
 *   This service surfaces the DLQ — the canonical "permanently failed"
 *   set — and provides hooks for future stuck-job detectors.
 *
 * Replay safety:
 *   `replayDeadLetterEntry` does NOT execute the job. It returns the
 *   payload + execution context that an operator can hand to the
 *   appropriate trigger (queue / cron / admin endpoint) with `replayDLQ:
 *   true` set. The job runner then re-enters with the original context.
 *   This intentionally separates "I want to look at this" from "I want
 *   to retry this" — they should never be the same accidental click.
 */

import { ownedDbTable } from '../db/writeOwner';

export interface DeadLetterEntry {
  id: string;
  workerName: string;
  jobPayload: Record<string, unknown>;
  failureReason: string;
  attemptCount: number;
  lastAttemptAt: string;
  createdAt: string;
  /** When the job ran via the canonical runner, this surfaces the lineage. */
  executionContext: {
    executionId:     string;
    triggerSource:   string;
    tenantId:        string | null;
    principalUserId: string | null;
    principalKind:   string;
    correlationId:   string;
    idempotencyKey:  string;
    attempt:         number;
    startedAt:       string;
  } | null;
}

interface DLQRow {
  id: string;
  worker_name: string;
  job_payload: Record<string, unknown> | null;
  failure_reason: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
  created_at: string;
}

function parseExecutionContext(payload: Record<string, unknown> | null): DeadLetterEntry['executionContext'] {
  if (!payload || typeof payload !== 'object') return null;
  const ec = (payload as { __executionContext?: Record<string, unknown> }).__executionContext;
  if (!ec || typeof ec !== 'object') return null;
  // Type-safe extraction with sensible defaults — corrupt rows still surface.
  return {
    executionId:     String((ec as Record<string, unknown>).executionId     ?? ''),
    triggerSource:   String((ec as Record<string, unknown>).triggerSource   ?? 'unknown'),
    tenantId:        ((ec as Record<string, unknown>).tenantId as string | null) ?? null,
    principalUserId: ((ec as Record<string, unknown>).principalUserId as string | null) ?? null,
    principalKind:   String((ec as Record<string, unknown>).principalKind   ?? 'unknown'),
    correlationId:   String((ec as Record<string, unknown>).correlationId   ?? ''),
    idempotencyKey:  String((ec as Record<string, unknown>).idempotencyKey  ?? ''),
    attempt:         Number((ec as Record<string, unknown>).attempt         ?? 0),
    startedAt:       String((ec as Record<string, unknown>).startedAt       ?? ''),
  };
}

function rowToEntry(row: DLQRow): DeadLetterEntry {
  return {
    id:              row.id,
    workerName:      row.worker_name,
    jobPayload:      row.job_payload ?? {},
    failureReason:   row.failure_reason ?? '',
    attemptCount:    row.attempt_count ?? 0,
    lastAttemptAt:   row.last_attempt_at ?? row.created_at,
    createdAt:       row.created_at,
    executionContext: parseExecutionContext(row.job_payload),
  };
}

export interface ListDeadLettersInput {
  /** Filter by job / worker name. */
  workerName?: string;
  /** Filter by tenant (only matches entries with execution-context lineage). */
  tenantId?: string;
  /** Cap on rows returned. Default: 50. Hard max: 500. */
  limit?: number;
  /** Cursor pagination — pass the previous page's `nextCursor`. */
  before?: string;
}

export interface ListDeadLettersResult {
  entries: DeadLetterEntry[];
  /** Pass to the next call's `before` to paginate. Null when exhausted. */
  nextCursor: string | null;
}

/**
 * Browse the DLQ with optional filters. Sorted newest-first.
 */
export async function listDeadLetters(input: ListDeadLettersInput = {}): Promise<ListDeadLettersResult> {
  const cap = Math.min(Math.max(input.limit ?? 50, 1), 500);
  let query = ownedDbTable('worker_dead_letter_queue')
    .select('id, worker_name, job_payload, failure_reason, attempt_count, last_attempt_at, created_at')
    .order('created_at', { ascending: false })
    .limit(cap);

  if (input.workerName) query = query.eq('worker_name', input.workerName);
  if (input.before)     query = query.lt('created_at', input.before);
  // Tenant filter is JSON-keyed inside job_payload.__executionContext.tenantId.
  // We use Postgres' `->>` operator via Supabase's `.contains` semantics; the
  // runner writes the canonical shape so tenant search works for runner-driven
  // entries (legacy DLQ entries without context can still be returned via
  // workerName filter or no filter).
  if (input.tenantId) {
    query = query.contains('job_payload', {
      __executionContext: { tenantId: input.tenantId },
    });
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`listDeadLetters_query_failed: ${error.message}`);
  }

  const rows = (data ?? []) as DLQRow[];
  const entries = rows.map(rowToEntry);
  const nextCursor = entries.length === cap ? entries[entries.length - 1]!.createdAt : null;
  return { entries, nextCursor };
}

/**
 * Fetch a single DLQ entry by id.
 */
export async function getDeadLetter(id: string): Promise<DeadLetterEntry | null> {
  const { data, error } = await ownedDbTable('worker_dead_letter_queue')
    .select('id, worker_name, job_payload, failure_reason, attempt_count, last_attempt_at, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntry(data as DLQRow);
}

/**
 * Aggregate the DLQ by worker name. Operator dashboard hook: shows
 * "campaign.execute has 12 failures, scheduled-post-publish has 3,
 * everything else 0".
 */
export async function summarizeDeadLetters(input?: { since?: string }): Promise<Array<{ workerName: string; count: number }>> {
  let query = ownedDbTable('worker_dead_letter_queue').select('worker_name');
  if (input?.since) query = query.gte('created_at', input.since);
  const { data } = await query.limit(10_000);
  const rows = (data ?? []) as Array<{ worker_name: string }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.worker_name, (counts.get(r.worker_name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([workerName, count]) => ({ workerName, count }))
    .sort((a, b) => b.count - a.count);
}
