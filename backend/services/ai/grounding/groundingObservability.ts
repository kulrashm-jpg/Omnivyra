/**
 * WAVE-2-001 — Grounding observability (AI-CONTRACT-000 §X1). Reuses the HARDEN-001
 * registry; fail-safe. Emits one decision trace per grounding execution.
 */
import { recordRawCounter, recordRawHistogram } from '../../../observability';
import { newReasoningId } from '../safety';
import type { GroundingDecision } from './groundingPolicy';

export interface GroundingTraceCtx {
  surface: string;              // workflow label (e.g. 'writer.post', 'campaign.plan')
  correlationId?: string;
  reasoningId?: string;
  retrievalLatencyMs?: number;
  cacheUsed?: boolean;
}

/**
 * Record a grounding decision (§8 metrics): retrieval latency, source/evidence
 * counts, effective confidence, freshness status, fallback reason, cache usage.
 * Returns the reasoningId for artifact↔grounding correlation. Never throws.
 */
export function recordGroundingDecision(decision: GroundingDecision, ctx: GroundingTraceCtx): string {
  const reasoningId = ctx.reasoningId ?? newReasoningId();
  try {
    recordRawCounter('ai.grounding.decision', 1, {
      surface: ctx.surface,
      grounded: String(decision.grounded),
      freshness: decision.freshnessStatus,
      fallback: decision.fallbackReason ?? 'none',
      correlation: ctx.correlationId ?? 'na',
    });
    recordRawHistogram('ai.grounding.confidence', Math.round(decision.effectiveConfidence * 100), { surface: ctx.surface });
    recordRawHistogram('ai.grounding.source_count', decision.sourceCount, { surface: ctx.surface });
    if (typeof ctx.retrievalLatencyMs === 'number') {
      recordRawHistogram('ai.grounding.retrieval_latency_ms', Math.max(0, ctx.retrievalLatencyMs), { surface: ctx.surface });
    }
    if (decision.floorBreached) recordRawCounter('ai.grounding.floor_breached', 1, { surface: ctx.surface, reason: decision.fallbackReason ?? 'unknown' });
    if (decision.isStale) recordRawCounter('ai.grounding.stale', 1, { surface: ctx.surface });
    if (ctx.cacheUsed) recordRawCounter('ai.grounding.cache_hit', 1, { surface: ctx.surface });
  } catch { /* observability is fail-safe */ }
  return reasoningId;
}
