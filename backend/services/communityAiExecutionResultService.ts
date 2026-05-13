import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

type ExecutionMode = 'api' | 'rpa' | 'browser' | 'manual';
type ResultStatus = 'executed' | 'sent_unverified' | 'dispatched' | 'failed' | 'skipped' | 'blocked';
type MetricEventType =
  | 'execution_started'
  | 'execution_success'
  | 'execution_failed'
  | 'fallback_triggered'
  | 'lease_expired'
  | 'ack_received';

export type LightweightExecutionResult = {
  ok: boolean;
  status: ResultStatus;
  error?: string | Record<string, unknown>;
  reason?: string;
  platform_id?: string | null;
  response?: unknown;
  execution_mode?: ExecutionMode;
  correlation_id?: string;
  auto_executed?: boolean;
  automation_decision_log_id?: string | null;
  deduplicated?: boolean;
  prior_action_id?: string | null;
};

export type CommandChainStep = {
  action_type: string;
  payload?: Record<string, unknown>;
};

const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;
const TERMINAL_ROW_STATUSES = new Set(['executed', 'sent_unverified', 'failed', 'skipped', 'blocked']);

const metricFailureCounters = {
  metric_insert_failed: 0,
  dlq_insert_failed: 0,
};

function deriveAutoIdempotencyKey(input: {
  organization_id: string;
  platform: string | null;
  action_type: string | null;
  target_id?: string | null;
  nowMs?: number;
}): string {
  const bucket = Math.floor((input.nowMs ?? Date.now()) / IDEMPOTENCY_BUCKET_MS);
  const basis = [
    input.organization_id,
    input.platform || '',
    input.action_type || '',
    input.target_id || '',
    String(bucket),
  ].join(':');
  return 'auto:' + createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

export function getMetricFailureCounters(): Readonly<typeof metricFailureCounters> {
  return { ...metricFailureCounters };
}

export async function recordExecutionMetric(input: {
  organization_id: string;
  action_id?: string | null;
  correlation_id?: string | null;
  event_type: MetricEventType;
  platform?: string | null;
  action_type?: string | null;
  execution_mode?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const row = {
    organization_id: input.organization_id,
    action_id: input.action_id ?? null,
    correlation_id: input.correlation_id ?? null,
    event_type: input.event_type,
    platform: input.platform ?? null,
    action_type: input.action_type ?? null,
    execution_mode: input.execution_mode ?? null,
    metadata: input.metadata ?? null,
  };

  try {
    const { error } = await ownedDbTable('community_ai_execution_metric_events').insert(row);
    if (!error) return;
    throw error;
  } catch (primaryErr: unknown) {
    metricFailureCounters.metric_insert_failed += 1;
    try {
      const { error: dlqError } = await ownedDbTable('community_ai_metric_dlq').insert({
        ...row,
        last_error: String((primaryErr as Error)?.message || primaryErr).slice(0, 500),
      });
      if (dlqError) throw dlqError;
    } catch (dlqErr: unknown) {
      metricFailureCounters.dlq_insert_failed += 1;
      console.error(
        'COMMUNITY_AI_METRIC_DLQ_INSERT_FAILED',
        (dlqErr as Error)?.message || dlqErr,
        'event=',
        row.event_type,
        'action_id=',
        row.action_id,
      );
    }
  }
}

export async function persistExecutionResult(input: {
  actionId: string;
  organizationId: string;
  result: LightweightExecutionResult;
  correlationId: string;
  idempotencyKey?: string | null;
  leaseGuard?: { expectedLeaseId: string; expectedHolderId: string };
  expectedFromStatuses?: string[];
  rowHint?: { platform?: string | null; action_type?: string | null; target_id?: string | null };
  final_text?: string | null;
  command_chain?: CommandChainStep[];
}): Promise<{ ok: boolean; current_status?: string; error?: string; deduplicated?: boolean; prior_action_id?: string | null }> {
  const result = input.result;
  const finalStatus = result.status === 'dispatched' ? 'pending' : result.status;
  const effectiveMode = result.execution_mode || null;

  const update: Record<string, unknown> = {
    status: finalStatus,
    execution_correlation_id: input.correlationId,
    execution_result: {
      ...result,
      execution_mode: effectiveMode,
      final_text: input.final_text ?? undefined,
      source: (result.response as { source?: string } | undefined)?.source || 'executor',
    },
    updated_at: new Date().toISOString(),
  };
  if (effectiveMode) update.execution_mode = effectiveMode;
  if (input.final_text != null) update.final_text = input.final_text;
  if (Array.isArray(input.command_chain) && input.command_chain.length > 0) {
    update.command_chain = input.command_chain;
    update.command_chain_index = 0;
  }

  if (TERMINAL_ROW_STATUSES.has(finalStatus)) {
    update.dispatch_lease_id = null;
    update.dispatch_lease_expires_at = null;
    update.dispatch_lease_holder_id = null;
    update.dispatch_acknowledged_at = null;
    if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
      update.executed_at = new Date().toISOString();
    }
  }

  if (input.idempotencyKey?.trim()) {
    update.idempotency_key = input.idempotencyKey.trim();
  } else if (input.rowHint) {
    update.idempotency_key = deriveAutoIdempotencyKey({
      organization_id: input.organizationId,
      platform: input.rowHint.platform ?? null,
      action_type: input.rowHint.action_type ?? null,
      target_id: input.rowHint.target_id ?? null,
    });
  }

  let q = ownedDbTable('community_ai_actions').update(update).eq('id', input.actionId);
  if (input.expectedFromStatuses?.length) q = q.in('status', input.expectedFromStatuses);
  if (input.leaseGuard) {
    q = q.eq('dispatch_lease_id', input.leaseGuard.expectedLeaseId)
      .eq('dispatch_lease_holder_id', input.leaseGuard.expectedHolderId);
  }

  const { data: updated, error: updateError } = await q.select('id, status').maybeSingle();
  if (updateError) {
    if (update.idempotency_key) {
      const { data: prior } = await ownedDbTable('community_ai_actions')
        .select('id, status')
        .eq('organization_id', input.organizationId)
        .eq('idempotency_key', String(update.idempotency_key))
        .maybeSingle();
      if (prior?.id) {
        return {
          ok: true,
          current_status: prior.status || finalStatus,
          deduplicated: true,
          prior_action_id: prior.id,
        };
      }
    }
    return { ok: false, error: updateError.message };
  }
  if (!updated) {
    const { data: latest } = await ownedDbTable('community_ai_actions')
      .select('status')
      .eq('id', input.actionId)
      .maybeSingle();
    return { ok: false, current_status: latest?.status ?? undefined, error: 'STATE_MISMATCH' };
  }

  if (finalStatus === 'executed' || finalStatus === 'sent_unverified') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_success',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        platform_id: result.platform_id ?? null,
      },
    });
  } else if (finalStatus === 'failed' || finalStatus === 'blocked' || finalStatus === 'skipped') {
    await recordExecutionMetric({
      organization_id: input.organizationId,
      action_id: input.actionId,
      correlation_id: input.correlationId,
      event_type: 'execution_failed',
      platform: input.rowHint?.platform ?? null,
      action_type: input.rowHint?.action_type ?? null,
      execution_mode: effectiveMode,
      metadata: {
        status: finalStatus,
        error: typeof result.error === 'string' ? result.error : result.error ?? null,
        reason: result.reason ?? null,
      },
    });
  }

  return { ok: true, current_status: updated.status };
}

export async function flushMetricDlq(opts?: { alertThreshold?: number }): Promise<{
  claimed: number;
  flushed: number;
  remaining: number;
  alert?: boolean;
  error?: string;
}> {
  const threshold = opts?.alertThreshold ?? 500;
  try {
    const { data, error } = await supabase.rpc('flush_community_ai_metric_dlq');
    if (error) return { claimed: 0, flushed: 0, remaining: 0, error: error.message };
    const counters = (data || {}) as { claimed?: number; flushed?: number; remaining?: number };
    const remaining = counters.remaining ?? 0;
    return {
      claimed: counters.claimed ?? 0,
      flushed: counters.flushed ?? 0,
      remaining,
      alert: remaining > threshold,
    };
  } catch (err: unknown) {
    return { claimed: 0, flushed: 0, remaining: 0, error: (err as Error)?.message || String(err) };
  }
}
