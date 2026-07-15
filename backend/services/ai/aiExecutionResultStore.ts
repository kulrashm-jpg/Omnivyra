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
// W3-7: gzip-before-cap so the LARGEST outputs (full campaign plans,
// long-form articles — exactly the ones RESUME exists for) fit under the
// jsonb-hygiene cap instead of being silently excluded from resume.
import { compressIfLarge, decompressIfNeeded } from '../../../lib/platform/cacheCore';
import { defineRolloutFlag, resolveRolloutSync } from '../../../lib/platform/rollout';

const RESULT_STORE_COMPRESSION_FLAG = defineRolloutFlag({
  key: 'result-store-compression',
  description: 'W3-7: gzip large AI results before the resume-store size cap (audit B-63)',
});

/** Results larger than this are not cached (metadata jsonb hygiene). */
const MAX_RESULT_JSON_CHARS = 100_000;

export interface StoredAiResult<T = unknown> {
  v: 1;
  action: string;
  saved_at: string;
  payload: T;
}

/** W3-7 envelope: payload stored as a gzip+base64 JSON string. */
interface StoredAiResultV2 {
  v: 2;
  action: string;
  saved_at: string;
  payload_gz: string;
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
    const stored = (data?.metadata as { ai_result?: StoredAiResult<T> | StoredAiResultV2 } | null)?.ai_result;
    if (stored && stored.v === 1 && 'payload' in stored) return stored;
    // W3-7: v2 (compressed) entries are ALWAYS readable regardless of the
    // flag — rolling the flag back must never orphan saved results.
    if (stored && (stored as StoredAiResultV2).v === 2 && 'payload_gz' in (stored as StoredAiResultV2)) {
      const v2 = stored as StoredAiResultV2;
      const json = await decompressIfNeeded(v2.payload_gz);
      return { v: 1, action: v2.action, saved_at: v2.saved_at, payload: JSON.parse(json) as T };
    }
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
    let envelope: StoredAiResult | StoredAiResultV2 = {
      v: 1,
      action: args.action,
      saved_at: new Date().toISOString(),
      payload: args.payload,
    };
    if (JSON.stringify(envelope).length > MAX_RESULT_JSON_CHARS) {
      // W3-7: with the flag on, compress the payload and re-check the cap —
      // large plans/articles typically compress 5–10× and become resumable.
      // Flag off (default): reject exactly as before.
      if (resolveRolloutSync(RESULT_STORE_COMPRESSION_FLAG).mode === 'off') return false;
      const payloadGz = await compressIfLarge(JSON.stringify(args.payload));
      envelope = {
        v: 2,
        action: args.action,
        saved_at: envelope.saved_at,
        payload_gz: payloadGz,
      };
      if (JSON.stringify(envelope).length > MAX_RESULT_JSON_CHARS) return false;
    }

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
