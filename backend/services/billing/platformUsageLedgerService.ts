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
 *
 * METADATA IS NOT A TENANT LINK (e1, 039). metadata may carry trace ids for audit - call_id, provider response
 * id, reference_type / reference_id, campaign_id, user_id, and for rows moved by D-039b the original
 * moved_from_usage_event_id / original_organization_id. They exist to explain a row, never to attribute it: no
 * customer reader joins on them, and the table stays service-role only (RLS on, zero policies).
 */

import { createHash } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { estimateCompletionCostUsd, estimateEmbeddingCostUsd } from '../pricingService';
import { logger } from '../logger';

const TABLE = 'platform_usage_events';

/** resource_type of a row that belongs to no specific platform resource (039: resource_id is NULL exactly then). */
export const UNATTRIBUTED_RESOURCE = 'unattributed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordPlatformUsageInput {
  providerName: string;
  /** NULL only for source_type 'external_api' (039: external-API calls have no model). */
  modelName: string | null;
  modelVersion?: string | null;
  /** Mirrors the unified_transactions vocabulary (039 adds 'cache' and 'external_api'). */
  sourceType?: 'system' | 'embedding' | 'llm' | 'internal' | 'cache' | 'external_api';
  sourceName: string;
  processType: string;
  /** What the spend was for — required for reconciliation (B7.8-B §8). UNATTRIBUTED_RESOURCE when there is none. */
  resourceType: string;
  /** NULL exactly when resourceType is UNATTRIBUTED_RESOURCE (039 two-way CHECK). */
  resourceId: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens: number;
  metadata?: Record<string, unknown>;
  /**
   * Explicit idempotency key (039 writers: one key = one billed provider ATTEMPT - see buildPlatformCallKey).
   * When absent, the original embedding key (resource, model, day) is derived.
   */
  idempotencyKey?: string;
  /**
   * The caller already priced the call (probe static estimate, external API, cache hit). The pricing lookup is
   * then NOT called. totalCost must be NULL or a finite amount >= 0 (039 CHECK) - anything else is refused.
   */
  prePriced?: { totalCost: number | null; unitCost?: number | null; pricingSnapshot?: Record<string, unknown> | null };
  /** Which model_pricing kind prices an un-priced row. Default: 'completion' for llm, else 'embedding'. */
  pricingKind?: 'embedding' | 'completion';
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

/**
 * Identity of ONE billed provider attempt (039, e1 ruling). `callId` is minted ONCE per logical request at its
 * entry point - before any retry loop - and carried through every usage write of that request; `attempt` is the
 * PROVIDER attempt index (never a write-retry counter). Re-running the write for the same attempt therefore
 * yields the same key ('already_recorded'); a genuinely new provider attempt is new spend with a new key.
 * Never derived from now() or a per-write random value.
 */
export interface PlatformCallIdentity {
  writer: 'gateway' | 'probe' | 'external_api';
  callId: string;
  /** e.g. plan_limit | cache_hit | attempt_error | final | ok | error. */
  kind: string;
  attempt?: number;
  /** The provider's own response id, when it returned one - the most specific identity there is. */
  responseId?: string | null;
}

export function buildPlatformCallKey(provider: string, id: PlatformCallIdentity): string {
  const canonical = id.responseId
    ? `${id.writer}:${provider}:response:${id.responseId}`
    : `${id.writer}:${id.callId}:${id.kind}:${id.attempt ?? 1}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

const isValidAmount = (n: unknown): boolean => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0);

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
  const sourceType = input.sourceType ?? 'system';
  if (!input.providerName) return { ok: false, reason: 'missing_provider_or_model' };
  if (!input.modelName && sourceType !== 'external_api') return { ok: false, reason: 'missing_provider_or_model' };
  if (!input.resourceType) return { ok: false, reason: 'missing_resource' };
  if (input.resourceType === UNATTRIBUTED_RESOURCE) {
    if (input.resourceId) return { ok: false, reason: 'unattributed_with_resource_id' };
  } else if (!input.resourceId) {
    return { ok: false, reason: 'missing_resource' };
  }
  if (input.prePriced && !isValidAmount(input.prePriced.totalCost)) return { ok: false, reason: 'invalid_pre_priced_cost' };

  const now = input.now ?? new Date();
  const idempotencyKey = input.idempotencyKey ?? buildPlatformUsageKey({
    resourceType: input.resourceType,
    resourceId: String(input.resourceId),
    modelName: String(input.modelName),
    day: dayOf(now),
  });

  try {
    // ── provider USD, org-free ──────────────────────────────────────────
    let unitCost: number | null = null;
    let totalCost: number | null = null;
    let pricingSnapshot: Record<string, unknown> | null = null;

    if (input.prePriced) {
      // The caller priced it; the pricing lookup is deliberately NOT called (e1).
      totalCost = input.prePriced.totalCost === null ? null : Number(input.prePriced.totalCost.toFixed(10));
      unitCost = input.prePriced.unitCost ?? null;
      pricingSnapshot = input.prePriced.pricingSnapshot ?? { source: 'pre_priced', resolved_at: now.toISOString() };
    } else {
      const kind = input.pricingKind ?? (sourceType === 'llm' ? 'completion' : 'embedding');
      try {
        // Org-free provider USD. Both estimators reuse fetchModelPricingRow, so no pricing value is duplicated
        // and fetchCreditRateUsd (the only org dependency) is never called.
        if (kind === 'completion') {
          const priced = await estimateCompletionCostUsd(input.providerName, String(input.modelName),
            input.inputTokens ?? 0, input.outputTokens ?? 0, now);
          totalCost = Number.isFinite(priced.totalUsd) ? Number(priced.totalUsd.toFixed(10)) : null;
          unitCost = totalCost !== null && input.totalTokens > 0 ? totalCost / input.totalTokens : null;
          pricingSnapshot = { source: 'model_pricing', kind: 'completion', resolved_at: now.toISOString(), row: priced.row };
        } else {
          const priced = await estimateEmbeddingCostUsd(input.providerName, String(input.modelName), input.totalTokens, now);
          unitCost = Number.isFinite(priced.unitCostPer1k) ? priced.unitCostPer1k : null;
          totalCost = Number.isFinite(priced.totalUsd) ? Number(priced.totalUsd.toFixed(10)) : null;
          pricingSnapshot = { source: 'model_pricing', kind: 'embedding', resolved_at: now.toISOString(), row: priced.row };
        }
      } catch (pricingError) {
        // Pricing missing is a REAL accounting gap — surfaced, not swallowed into
        // a fake zero cost. The row is still written so the spend is not lost.
        logger.warn?.('platform_usage_pricing_unresolved', {
          provider: input.providerName, model: input.modelName, kind,
          reason: (pricingError as Error)?.message ?? 'unknown',
        });
        pricingSnapshot = { source: 'unresolved', resolved_at: now.toISOString() };
      }
    }

    const { error } = await supabase.from(TABLE).insert({
      provider_name: input.providerName,
      model_name: input.modelName,
      model_version: input.modelVersion ?? null,
      source_type: sourceType,
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
    if ((error as { code?: string }).code === '23505' || /duplicate key|unique constraint|23505/i.test(msg)) {
      return { ok: true, action: 'already_recorded', idempotencyKey, totalCost };
    }
    return { ok: false, reason: `insert_failed:${msg}` };
  } catch (e) {
    return { ok: false, reason: `exception:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/** Maps a caller-supplied reference to a platform resource: a uuid reference is the resource; anything else is unattributed (e1). */
export function platformResourceOf(referenceType: string | null | undefined, referenceId: string | null | undefined):
  { resourceType: string; resourceId: string | null } {
  if (referenceType && referenceId && UUID_RE.test(referenceId) && referenceType !== UNATTRIBUTED_RESOURCE) {
    return { resourceType: referenceType, resourceId: referenceId };
  }
  return { resourceType: UNATTRIBUTED_RESOURCE, resourceId: null };
}
