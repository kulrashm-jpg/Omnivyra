/**
 * Phase 8 — Ingestion throughput control.
 *
 * Per-scope rolling-window counters. Callers consult `evaluateThroughput`
 * BEFORE consuming and call `recordIngestion` AFTER. The service merges
 * concurrent recordings via UPSERT on (org, scope, bucket, window_start).
 *
 * Bounds:
 *   • Windows snap to fixed buckets (default 1h) so counters stay
 *     deterministic and aggregatable across workers.
 *   • Caps are explicit: `policyCaps` from the caller wins; falls back to
 *     defaults from the type module.
 *   • Decision codes: `allow` | `throttle` | `deny`. Throttle = soft
 *     guidance the caller may honour or override; deny = hard block.
 *   • No autonomous throttler loop. The service is read-and-decide; the
 *     caller acts.
 *
 * Phase 8 hooks throughput evaluation into the listening execution path
 * as advisory (records the decision; uses Phase 7 governance to actually
 * deny). Future phases can tighten by adding hard-block to the caller.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  IngestionThroughputState,
  ThroughputScope,
} from '../types/ingestionThroughput';
import {
  DEFAULT_ORG_HOURLY_COUNT_CAP,
  DEFAULT_ORG_HOURLY_CREDIT_CAP,
  DEFAULT_THROUGHPUT_WINDOW_MS,
} from '../types/ingestionThroughput';

function bucketBoundary(now: number, windowMs: number): { start: string; end: string } {
  const aligned = Math.floor(now / windowMs) * windowMs;
  return {
    start: new Date(aligned).toISOString(),
    end: new Date(aligned + windowMs).toISOString(),
  };
}

export type EvaluateThroughputInput = {
  organizationId: string;
  scope: ThroughputScope;
  bucket: string;
  incrementCount?: number;
  incrementCredits?: number;
  policyCaps?: { count?: number | null; credits?: number | null; burst?: number | null };
  windowMs?: number;
};

export type ThroughputDecision = {
  decision: 'allow' | 'throttle' | 'deny';
  reasons: string[];
  state: IngestionThroughputState | null;
  caps: { count: number | null; credits: number | null; burst: number | null };
};

async function loadState(
  organizationId: string,
  scope: ThroughputScope,
  bucket: string,
  windowStart: string,
): Promise<IngestionThroughputState | null> {
  const { data } = await ownedDbTable('ingestion_throughput_state')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('scope', scope)
    .eq('bucket', bucket)
    .eq('window_start', windowStart)
    .maybeSingle();
  return (data as IngestionThroughputState | null) ?? null;
}

export async function evaluateThroughput(
  input: EvaluateThroughputInput,
): Promise<ThroughputDecision> {
  const windowMs = input.windowMs ?? DEFAULT_THROUGHPUT_WINDOW_MS;
  const { start, end } = bucketBoundary(Date.now(), windowMs);
  const state = await loadState(input.organizationId, input.scope, input.bucket, start);
  const reasons: string[] = [];

  const capCount = input.policyCaps?.count ?? (input.scope === 'org' ? DEFAULT_ORG_HOURLY_COUNT_CAP : null);
  const capCredits = input.policyCaps?.credits ?? (input.scope === 'org' ? DEFAULT_ORG_HOURLY_CREDIT_CAP : null);
  const burst = input.policyCaps?.burst ?? null;

  const consumedCount = state?.consumed_count ?? 0;
  const consumedCredits = state?.consumed_credits ?? 0;
  const projectedCount = consumedCount + (input.incrementCount ?? 1);
  const projectedCredits = consumedCredits + (input.incrementCredits ?? 0);

  let decision: ThroughputDecision['decision'] = 'allow';

  if (capCount != null && projectedCount > capCount) {
    reasons.push(`count_cap_exceeded:${projectedCount}>${capCount}`);
    decision = 'deny';
  } else if (capCount != null && projectedCount > capCount * 0.9) {
    reasons.push(`count_approaching_cap:${projectedCount}/${capCount}`);
    decision = 'throttle';
  }

  if (capCredits != null && projectedCredits > capCredits) {
    reasons.push(`credit_cap_exceeded:${projectedCredits}>${capCredits}`);
    decision = 'deny';
  } else if (capCredits != null && projectedCredits > capCredits * 0.9) {
    reasons.push(`credit_approaching_cap:${projectedCredits}/${capCredits}`);
    decision = decision === 'deny' ? 'deny' : 'throttle';
  }

  if (burst != null && (input.incrementCount ?? 0) > burst) {
    reasons.push(`burst_too_large:${input.incrementCount}>${burst}`);
    decision = 'deny';
  }

  return {
    decision,
    reasons,
    state,
    caps: { count: capCount ?? null, credits: capCredits ?? null, burst: burst ?? null },
  };
}

export type RecordIngestionInput = {
  organizationId: string;
  scope: ThroughputScope;
  bucket: string;
  count: number;
  credits?: number;
  caps?: { count?: number | null; credits?: number | null; burst?: number | null };
  metadata?: Record<string, unknown>;
  windowMs?: number;
};

export async function recordIngestion(input: RecordIngestionInput): Promise<IngestionThroughputState> {
  const windowMs = input.windowMs ?? DEFAULT_THROUGHPUT_WINDOW_MS;
  const { start, end } = bucketBoundary(Date.now(), windowMs);
  const existing = await loadState(input.organizationId, input.scope, input.bucket, start);
  if (existing) {
    const { data, error } = await ownedDbTable('ingestion_throughput_state')
      .update({
        consumed_count: existing.consumed_count + input.count,
        consumed_credits: existing.consumed_credits + (input.credits ?? 0),
        cap_count: input.caps?.count ?? existing.cap_count,
        cap_credits: input.caps?.credits ?? existing.cap_credits,
        burst_count: input.caps?.burst ?? existing.burst_count,
        metadata: { ...existing.metadata, ...input.metadata },
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`throughput_update_failed:${error?.message ?? 'unknown'}`);
    return data as IngestionThroughputState;
  }
  const { data, error } = await ownedDbTable('ingestion_throughput_state')
    .insert({
      organization_id: input.organizationId,
      scope: input.scope,
      bucket: input.bucket,
      window_start: start,
      window_end: end,
      consumed_count: input.count,
      consumed_credits: input.credits ?? 0,
      cap_count: input.caps?.count ?? null,
      cap_credits: input.caps?.credits ?? null,
      burst_count: input.caps?.burst ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      // Race — another caller just created the row. Re-fetch and update.
      const raced = await loadState(input.organizationId, input.scope, input.bucket, start);
      if (raced) {
        const { data: bumped } = await ownedDbTable('ingestion_throughput_state')
          .update({
            consumed_count: raced.consumed_count + input.count,
            consumed_credits: raced.consumed_credits + (input.credits ?? 0),
          })
          .eq('id', raced.id)
          .select('*')
          .single();
        if (bumped) return bumped as IngestionThroughputState;
      }
    }
    throw new Error(`throughput_insert_failed:${error?.message ?? 'unknown'}`);
  }
  return data as IngestionThroughputState;
}

export async function listThroughputState(
  organizationId: string,
  options?: { scope?: ThroughputScope; bucket?: string; limit?: number },
): Promise<IngestionThroughputState[]> {
  let q = ownedDbTable('ingestion_throughput_state')
    .select('*')
    .eq('organization_id', organizationId)
    .order('window_end', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 50)));
  if (options?.scope) q = q.eq('scope', options.scope);
  if (options?.bucket) q = q.eq('bucket', options.bucket);
  const { data, error } = await q;
  if (error) throw new Error(`throughput_list_failed:${error.message}`);
  return (data as IngestionThroughputState[]) ?? [];
}
