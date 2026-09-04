/**
 * B7.8-C — PLATFORM USAGE LEDGER.
 *
 * Records provider spend that belongs to NO customer. Narrow by design: it does
 * one thing and deliberately cannot do customer billing.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * usage_events.organization_id and unified_transactions.organization_id are
 * both NOT NULL (B7.8-A, schema-verified). Platform resources are tenant-less,
 * so there is no org to supply. blackHoleCostCapture already refuses to invent
 * one — `if (!input.organizationId) return; // no org → skip (no fake
 * attribution)` — which means today that spend is simply dropped. This service
 * records it instead, without fabricating a tenant and without relaxing a NOT
 * NULL invariant on a financial table.
 *
 * ── NO CREDIT CONVERSION, AND WHY THAT IS CORRECT ──────────────────────────
 * The existing pricing path splits cleanly (B7.8-B):
 *     fetchModelPricingRow(provider, model, kind, at)   ← org-free, provider USD
 *     fetchCreditRateUsd(orgId)                         ← the ONLY org dependency
 * The second converts USD into CUSTOMER CREDITS. Platform spend has no credits
 * — nobody is charged — so that conversion is not merely unavailable, it is
 * meaningless here. This service calls the first and never the second. No
 * pricing table, rate or formula is duplicated; only the credit step is skipped.
 *
 * ── CUSTOMER BILLING IS UNREACHABLE FROM HERE ──────────────────────────────
 * This module writes exactly one table: platform_usage_events. It never touches
 * usage_events, unified_transactions, credits, invoices or quotas, and the row
 * it writes carries no organization_id to join them by. Isolation is structural.
 */

import { createHash } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { estimateEmbeddingCostUsd } from '../pricingService';
import { logger } from '../logger';

const TABLE = 'platform_usage_events';

export interface RecordPlatformUsageInput {
  providerName: string;
  modelName: string;
  modelVersion?: string | null;
  /** Mirrors the unified_transactions vocabulary. */
  sourceType?: 'system' | 'embedding' | 'llm' | 'internal';
  sourceName: string;
  processType: string;
  /** What the spend was for — required for reconciliation (B7.8-B §8). */
  resourceType: string;
  resourceId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens: number;
  metadata?: Record<string, unknown>;
  /** Test seam only; defaults to now. Never supplied by production callers. */
  now?: Date;
}

export type PlatformUsageOutcome =
  | { ok: true; action: 'recorded' | 'already_recorded'; idempotencyKey: string; totalCost: number | null }
  | { ok: false; reason: string };

/**
 * Idempotency key.
 *
 * Mirrors the established repository convention (sha256 → hex → slice(0,32)),
 * used identically by billingIdempotencyService and boltScheduleIdempotency.
 * Their key BUILDERS are shaped for http/queue/webhook/cron and none fits a
 * platform resource, so the convention is followed rather than the function
 * reused — a deliberate choice, not an oversight.
 *
 * Granularity is per (resource, model, DAY): re-embedding the same topic with
 * the same model on the same day is the retry case and must not double-count.
 * A different day is genuinely new spend.
 */
export function buildPlatformUsageKey(parts: {
  resourceType: string; resourceId: string; modelName: string; day: string;
}): string {
  const canonical = `platform:${parts.resourceType}:${parts.resourceId}:${parts.modelName}:${parts.day}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Record one platform usage event.
 *
 * Non-throwing, per the accounting convention blackHoleCostCapture established
 * ("NEVER throws — a capture failure must not change the caller's behavior").
 * It returns a typed outcome so the CALLER can decide — which matters here,
 * because B7.8-C §7 requires that a ledger failure must NOT let embedding
 * persistence proceed as if accounting succeeded.
 */
export async function recordPlatformUsage(
  input: RecordPlatformUsageInput,
): Promise<PlatformUsageOutcome> {
  if (!input.providerName || !input.modelName) return { ok: false, reason: 'missing_provider_or_model' };
  if (!input.resourceType || !input.resourceId) return { ok: false, reason: 'missing_resource' };

  const now = input.now ?? new Date();
  const idempotencyKey = buildPlatformUsageKey({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    modelName: input.modelName,
    day: dayOf(now),
  });

  try {
    // ── provider USD, org-free ──────────────────────────────────────────
    let unitCost: number | null = null;
    let totalCost: number | null = null;
    let pricingSnapshot: Record<string, unknown> | null = null;

    try {
      // Org-free provider USD. estimateEmbeddingCostUsd reuses
      // fetchModelPricingRow internally, so no pricing value is duplicated and
      // fetchCreditRateUsd (the only org dependency) is never called.
      const priced = await estimateEmbeddingCostUsd(input.providerName, input.modelName, input.totalTokens, now);
      unitCost = Number.isFinite(priced.unitCostPer1k) ? priced.unitCostPer1k : null;
      totalCost = Number.isFinite(priced.totalUsd) ? Number(priced.totalUsd.toFixed(10)) : null;
      pricingSnapshot = { source: 'model_pricing', kind: 'embedding', resolved_at: now.toISOString(), row: priced.row };
    } catch (pricingError) {
      // Pricing missing is a REAL accounting gap — surfaced, not swallowed into
      // a fake zero cost. The row is still written so the spend is not lost.
      logger.warn?.('platform_usage_pricing_unresolved', {
        provider: input.providerName, model: input.modelName,
        reason: (pricingError as Error)?.message ?? 'unknown',
      });
      pricingSnapshot = { source: 'unresolved', resolved_at: now.toISOString() };
    }

    const { error } = await supabase.from(TABLE).insert({
      provider_name: input.providerName,
      model_name: input.modelName,
      model_version: input.modelVersion ?? null,
      source_type: input.sourceType ?? 'system',
      source_name: input.sourceName,
      process_type: input.processType,
      input_tokens: input.inputTokens ?? input.totalTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      total_tokens: input.totalTokens ?? null,
      unit_cost: unitCost,
      total_cost: totalCost,
      pricing_snapshot: pricingSnapshot,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      idempotency_key: idempotencyKey,
      metadata: input.metadata ?? {},
    });

    if (!error) return { ok: true, action: 'recorded', idempotencyKey, totalCost };

    // The UNIQUE index is the final serialization point: a duplicate means a
    // peer already recorded this exact spend, which is SUCCESS, not failure.
    const msg = String(error.message ?? '');
    if (/duplicate key|unique constraint|23505/i.test(msg)) {
      return { ok: true, action: 'already_recorded', idempotencyKey, totalCost };
    }
    return { ok: false, reason: `insert_failed:${msg}` };
  } catch (e) {
    return { ok: false, reason: `exception:${(e as Error)?.message ?? 'unknown'}` };
  }
}
