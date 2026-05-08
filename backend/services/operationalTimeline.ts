/**
 * Operational Timeline — cross-domain event reconstruction.
 *
 * Pulls events from every operationally-significant table (capability
 * audit log, dead-letter queue, credit transactions) and merges them
 * into a single chronological stream for incident reconstruction.
 *
 * The merge keys are deliberately overlapping so the same query can
 * answer different operator questions:
 *
 *   - by `userId`        → "show me everything that happened to this user"
 *   - by `orgId`         → "show me everything that happened to this org"
 *   - by `correlationId` → "show me every event that came from this
 *                          request / job / cron tick"
 *
 * Read-only. Never writes. Returns events ordered newest-first by their
 * occurred_at timestamp; the caller can re-sort as needed.
 *
 * What this is NOT:
 *   - Not a structured-log shipper. Stays in-database.
 *   - Not a metric counter. Returns rows, not aggregates. (See driftSummary.)
 *   - Not a search engine. Bounded queries with explicit filters.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type TimelineEventSource = 'audit' | 'dlq' | 'credit_ledger';

export interface TimelineEvent {
  source:         TimelineEventSource;
  occurredAt:     string;
  /** Free-text capability / job-name / transaction-type — semantic depends on source. */
  kind:           string;
  /** allowed / denied / failed / completed / etc. — semantic depends on source. */
  decision:       string | null;
  actorUserId:    string | null;
  principalUserId:string | null;
  organizationId: string | null;
  resourceId:     string | null;
  reason:         string | null;
  /** When extractable from the event, the upstream correlationId. */
  correlationId:  string | null;
  /** When extractable, the executionContext id (jobRunner only). */
  executionId:    string | null;
  viaLegacyBridge:boolean | null;
  /** Free-form payload, source-specific. Caller renders or hides as needed. */
  metadata:       Record<string, unknown>;
}

export interface QueryTimelineInput {
  /** Filter by a user's id — matches both actor and principal. */
  userId?:        string;
  /** Filter by an org id. */
  orgId?:         string;
  /** Filter by an upstream correlationId. Substring match against the audit
   *  log's `reason` (where runJob writes `corr=…`) and the DLQ's
   *  `__executionContext.correlationId`. */
  correlationId?: string;
  /** ISO-8601 lower bound (inclusive). Defaults to 7 days ago. */
  since?:         string;
  /** ISO-8601 upper bound (exclusive). Defaults to now. */
  until?:         string;
  /** Per-source row cap. Final stream is at most 3× this. Default: 200. */
  limitPerSource?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const HARD_MAX_PER_SOURCE = 1000;

function clampLimit(input?: number): number {
  if (!Number.isFinite(input) || (input as number) <= 0) return 200;
  return Math.min(input as number, HARD_MAX_PER_SOURCE);
}

function defaultRange(input: QueryTimelineInput): { since: string; until: string } {
  const until = input.until ?? new Date().toISOString();
  const since = input.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
  return { since, until };
}

interface AuditRow {
  occurred_at: string;
  capability: string | null;
  decision: string | null;
  actor_user_id: string | null;
  principal_user_id: string | null;
  organization_id: string | null;
  resource_id: string | null;
  reason: string | null;
  via_legacy_bridge: boolean | null;
  ip: string | null;
  user_agent: string | null;
  stepup_factor: string | null;
}

interface DlqRow {
  id: string;
  worker_name: string;
  job_payload: Record<string, unknown> | null;
  failure_reason: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
  created_at: string;
}

interface CreditTxRow {
  id: string;
  organization_id: string;
  transaction_type: string | null;
  execution_phase: string | null;
  category: string | null;
  free_delta: number | null;
  paid_delta: number | null;
  incentive_delta: number | null;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string | null;
  idempotency_key: string | null;
  note: string | null;
  created_at: string;
}

// ── Audit-log extraction ─────────────────────────────────────────────────────

const CORR_REGEX = /\bcorr=([\w-]+)/;
const EXECID_REGEX = /\bexecutionId=([\w-]+)/;

function extractCorrelationFromReason(reason: string | null | undefined): { correlationId: string | null; executionId: string | null } {
  if (!reason) return { correlationId: null, executionId: null };
  const corr = CORR_REGEX.exec(reason)?.[1] ?? null;
  const exec = EXECID_REGEX.exec(reason)?.[1] ?? null;
  return { correlationId: corr, executionId: exec };
}

async function fetchAuditEvents(input: QueryTimelineInput): Promise<TimelineEvent[]> {
  const { since, until } = defaultRange(input);
  const limit = clampLimit(input.limitPerSource);

  let q = ownedDbTable('capability_audit_log')
    .select('occurred_at, capability, decision, actor_user_id, principal_user_id, organization_id, resource_id, reason, via_legacy_bridge, ip, user_agent, stepup_factor')
    .gte('occurred_at', since)
    .lt('occurred_at', until)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (input.userId) {
    // Match either actor or principal in one query via OR.
    q = q.or(`actor_user_id.eq.${input.userId},principal_user_id.eq.${input.userId}`);
  }
  if (input.orgId) q = q.eq('organization_id', input.orgId);
  if (input.correlationId) {
    // The audit log doesn't have a dedicated correlation column; runJob
    // writes `corr=<id>` into `reason`. Use a substring match against
    // reason. Operators with structured needs should also query by
    // userId/orgId — correlation matching is best-effort here.
    q = q.ilike('reason', `%corr=${input.correlationId}%`);
  }

  const { data, error } = await q;
  if (error) {
    logger.warn('timeline_audit_query_failed', { message: error.message });
    return [];
  }

  return (data ?? []).map((r) => {
    const row = r as AuditRow;
    const { correlationId, executionId } = extractCorrelationFromReason(row.reason);
    return {
      source:          'audit' as const,
      occurredAt:      row.occurred_at,
      kind:            row.capability ?? '',
      decision:        row.decision,
      actorUserId:     row.actor_user_id,
      principalUserId: row.principal_user_id,
      organizationId:  row.organization_id,
      resourceId:      row.resource_id,
      reason:          row.reason,
      correlationId,
      executionId,
      viaLegacyBridge: row.via_legacy_bridge,
      metadata: {
        ip:           row.ip,
        userAgent:    row.user_agent,
        stepupFactor: row.stepup_factor,
      },
    };
  });
}

// ── DLQ extraction ───────────────────────────────────────────────────────────

async function fetchDlqEvents(input: QueryTimelineInput): Promise<TimelineEvent[]> {
  const { since, until } = defaultRange(input);
  const limit = clampLimit(input.limitPerSource);

  let q = ownedDbTable('worker_dead_letter_queue')
    .select('id, worker_name, job_payload, failure_reason, attempt_count, last_attempt_at, created_at')
    .gte('created_at', since)
    .lt('created_at', until)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Tenant + correlation matching is JSONB-keyed inside job_payload.
  if (input.orgId) {
    q = q.contains('job_payload', { __executionContext: { tenantId: input.orgId } });
  }
  if (input.userId) {
    q = q.contains('job_payload', { __executionContext: { principalUserId: input.userId } });
  }
  if (input.correlationId) {
    q = q.contains('job_payload', { __executionContext: { correlationId: input.correlationId } });
  }

  const { data, error } = await q;
  if (error) {
    logger.warn('timeline_dlq_query_failed', { message: error.message });
    return [];
  }

  return (data ?? []).map((r) => {
    const row = r as DlqRow;
    const ctx = (row.job_payload && typeof row.job_payload === 'object'
      ? (row.job_payload as { __executionContext?: Record<string, unknown> }).__executionContext
      : null) ?? null;
    return {
      source:          'dlq' as const,
      occurredAt:      row.last_attempt_at ?? row.created_at,
      kind:            row.worker_name,
      decision:        'failed',
      actorUserId:     (ctx?.principalUserId as string | null) ?? null,
      principalUserId: (ctx?.principalUserId as string | null) ?? null,
      organizationId:  (ctx?.tenantId as string | null) ?? null,
      resourceId:      row.id,
      reason:          row.failure_reason,
      correlationId:   (ctx?.correlationId as string | null) ?? null,
      executionId:     (ctx?.executionId as string | null) ?? null,
      viaLegacyBridge: null,
      metadata: {
        attemptCount:  row.attempt_count,
        triggerSource: ctx?.triggerSource,
        idempotencyKey: ctx?.idempotencyKey,
      },
    };
  });
}

// ── Credit-ledger extraction ─────────────────────────────────────────────────

async function fetchCreditLedgerEvents(input: QueryTimelineInput): Promise<TimelineEvent[]> {
  const { since, until } = defaultRange(input);
  const limit = clampLimit(input.limitPerSource);

  if (!input.orgId && !input.userId) {
    // Without a tenant or actor scope, the ledger query would return
    // every recent transaction in the system. Skip this source unless
    // the caller has scoped — the audit log + DLQ are still merged.
    return [];
  }

  let q = ownedDbTable('credit_transactions')
    .select('id, organization_id, transaction_type, execution_phase, category, free_delta, paid_delta, incentive_delta, reference_type, reference_id, performed_by, idempotency_key, note, created_at')
    .gte('created_at', since)
    .lt('created_at', until)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (input.orgId)  q = q.eq('organization_id', input.orgId);
  if (input.userId) q = q.eq('performed_by', input.userId);

  const { data, error } = await q;
  if (error) {
    logger.warn('timeline_credit_query_failed', { message: error.message });
    return [];
  }

  return (data ?? []).map((r) => {
    const row = r as CreditTxRow;
    return {
      source:          'credit_ledger' as const,
      occurredAt:      row.created_at,
      kind:            `credit:${row.execution_phase ?? row.transaction_type ?? 'unknown'}`,
      decision:        row.transaction_type,
      actorUserId:     row.performed_by,
      principalUserId: null,
      organizationId:  row.organization_id,
      resourceId:      row.id,
      reason:          row.note,
      correlationId:   null,
      executionId:     null,
      viaLegacyBridge: null,
      metadata: {
        category:       row.category,
        free_delta:     row.free_delta,
        paid_delta:     row.paid_delta,
        incentive_delta: row.incentive_delta,
        reference_type: row.reference_type,
        reference_id:   row.reference_id,
        idempotency_key: row.idempotency_key,
      },
    };
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reconstruct the operational timeline for the given filter. At least
 * ONE filter (userId / orgId / correlationId) must be supplied so the
 * query is scoped — unscoped queries would return platform-wide noise.
 */
export async function queryTimeline(input: QueryTimelineInput): Promise<TimelineEvent[]> {
  if (!input.userId && !input.orgId && !input.correlationId) {
    throw new Error('queryTimeline requires at least one of: userId, orgId, correlationId');
  }

  const [audit, dlq, ledger] = await Promise.all([
    fetchAuditEvents(input),
    fetchDlqEvents(input),
    fetchCreditLedgerEvents(input),
  ]);

  return [...audit, ...dlq, ...ledger].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
}
