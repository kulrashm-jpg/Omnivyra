/**
 * CAMPAIGN-IMPL-005 — durable AI execution results, keyed by the SAME
 * idempotency key the billing runtime dedupes on.
 *
 * Storage: `billing_operations.metadata.ai_result` — the operations table
 * already carries a UNIQUE idempotency_key and a mutable metadata jsonb
 * (unlike the immutable ledger), so Resume needs NO schema change. The row
 * is created via the orchestrator's own openBillingOperation upsert when a
 * caller executed outside the orchestrator (M1 flows).
 *
 * Contract: best-effort on both sides. A failed save never fails the
 * request (the user still gets their in-memory result); a failed load just
 * means the runtime falls back to an uncharged re-run. Saves MERGE into
 * existing metadata (never clobber operational fields).
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { openBillingOperation } from '../billing/enterpriseBillingOrchestrator';

/** Results larger than this are not cached (metadata jsonb hygiene). */
const MAX_RESULT_JSON_CHARS = 100_000;

export interface StoredAiResult<T = unknown> {
  v: 1;
  action: string;
  saved_at: string;
  payload: T;
}

export async function loadAiExecutionResult<T = unknown>(
  idempotencyKey: string,
): Promise<StoredAiResult<T> | null> {
  try {
    const { data } = await supabase
      .from('billing_operations')
      .select('metadata')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    const stored = (data?.metadata as { ai_result?: StoredAiResult<T> } | null)?.ai_result;
    if (stored && stored.v === 1 && 'payload' in stored) return stored;
    return null;
  } catch {
    return null;
  }
}

export async function saveAiExecutionResult(args: {
  idempotencyKey: string;
  action: string;
  organizationId: string;
  actorUserId: string;
  module: string;
  payload: unknown;
}): Promise<boolean> {
  try {
    const envelope: StoredAiResult = {
      v: 1,
      action: args.action,
      saved_at: new Date().toISOString(),
      payload: args.payload,
    };
    if (JSON.stringify(envelope).length > MAX_RESULT_JSON_CHARS) return false;

    // Ensure the operation row exists (M1 callers never opened one). The
    // upsert is keyed on idempotency_key; on conflict it returns the
    // existing row's id without disturbing terminal status fields we care
    // about (we only merge metadata below).
    let existingMetadata: Record<string, unknown> = {};
    const { data: row } = await supabase
      .from('billing_operations')
      .select('id, metadata')
      .eq('idempotency_key', args.idempotencyKey)
      .maybeSingle();
    if (row?.id) {
      existingMetadata = (row.metadata as Record<string, unknown>) ?? {};
    } else {
      await openBillingOperation({
        correlationId: randomUUID(),
        module: args.module,
        action: args.action,
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        idempotencyKey: args.idempotencyKey,
        amountEstimated: null,
        metadata: {},
      });
    }

    const { error } = await supabase
      .from('billing_operations')
      .update({ metadata: { ...existingMetadata, ai_result: envelope } })
      .eq('idempotency_key', args.idempotencyKey);
    return !error;
  } catch {
    return false;
  }
}
