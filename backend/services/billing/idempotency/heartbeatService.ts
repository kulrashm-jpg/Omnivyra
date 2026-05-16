/**
 * Heartbeat Service — Phase F
 *
 * Long-running operations (LLM calls, queue workers, multi-step orchestrator
 * scopes) periodically refresh their liveness signal so the expiry job knows
 * the operation is still active and should not be reclaimed.
 *
 * Implementation:
 *   - `job_execution_registry.last_seen_at` is the registry-side liveness signal
 *     (already present, written by `advance_job_execution` and `claim_job_execution`).
 *   - `billing_operations.started_at` is the operation start time; we add a
 *     `metadata.last_heartbeat_at` JSONB key for orchestrator-scope heartbeats
 *     (no schema change needed — metadata is freely writable on this table).
 *
 * Heartbeats are best-effort — they never block the underlying work and
 * never raise. A missed heartbeat just means the next expiry sweep may
 * reclaim the operation.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

const HEARTBEAT_THROTTLE_MS = 30_000; // suppress more than 1 heartbeat per 30s per id

const lastHeartbeatByOpId = new Map<string, number>();

export async function heartbeatBillingOperation(operationId: string): Promise<void> {
  const last = lastHeartbeatByOpId.get(operationId) ?? 0;
  const now = Date.now();
  if (now - last < HEARTBEAT_THROTTLE_MS) return;
  lastHeartbeatByOpId.set(operationId, now);

  try {
    // We don't UPDATE-touch the billing_operations row (it has rules around mutability of certain fields), so we instead append a heartbeat ledger entry in metadata.
    // The simplest no-schema-change path: set a recent heartbeat timestamp via merge on metadata.
    const { data, error: readErr } = await supabase
      .from('billing_operations')
      .select('metadata')
      .eq('id', operationId)
      .maybeSingle();
    if (readErr || !data) return;
    const existing = (data as { metadata?: Record<string, unknown> | null }).metadata ?? {};
    const merged = { ...existing, last_heartbeat_at: new Date(now).toISOString() };
    await supabase
      .from('billing_operations')
      .update({ metadata: merged })
      .eq('id', operationId);
  } catch (err) {
    logger.warn('heartbeat_billing_op_failed', { operationId, message: err instanceof Error ? err.message : String(err) });
  }
}

export async function heartbeatJobRegistry(executionHash: string): Promise<void> {
  const last = lastHeartbeatByOpId.get(executionHash) ?? 0;
  const now = Date.now();
  if (now - last < HEARTBEAT_THROTTLE_MS) return;
  lastHeartbeatByOpId.set(executionHash, now);

  try {
    // last_seen_at is a real column on job_execution_registry — direct update.
    await supabase
      .from('job_execution_registry')
      .update({ last_seen_at: new Date(now).toISOString() })
      .eq('execution_hash', executionHash);
  } catch (err) {
    logger.warn('heartbeat_job_registry_failed', { executionHash, message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Wrap an async function in a heartbeat loop. The interval is enforced via
 * `setInterval`; on completion (success OR throw) the interval is cleared
 * and the heartbeat tracker is cleaned up so concurrent unrelated ops with
 * the same id aren't suppressed.
 */
export async function withHeartbeat<T>(opts: {
  operationId?:    string;
  executionHash?:  string;
  intervalMs?:     number;
  body:            () => Promise<T>;
}): Promise<T> {
  const interval = opts.intervalMs ?? 60_000;
  const tick = () => {
    if (opts.operationId) void heartbeatBillingOperation(opts.operationId);
    if (opts.executionHash) void heartbeatJobRegistry(opts.executionHash);
  };
  const handle = setInterval(tick, interval);
  // Fire one immediate heartbeat so the tracker has a baseline
  tick();
  try {
    return await opts.body();
  } finally {
    clearInterval(handle);
    if (opts.operationId) lastHeartbeatByOpId.delete(opts.operationId);
    if (opts.executionHash) lastHeartbeatByOpId.delete(opts.executionHash);
  }
}

/** Test-only: reset internal throttle state. */
export function _resetHeartbeatStateForTests(): void {
  lastHeartbeatByOpId.clear();
}
