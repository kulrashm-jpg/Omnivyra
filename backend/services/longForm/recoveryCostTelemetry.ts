/**
 * recoveryCostTelemetry.ts
 *
 * Phase 5.8 — `LONGFORM_RECOVERY_COST` event emitter + per-process
 * aggregator. Lets operators see operational cost alongside quality
 * outcomes.
 *
 * Cost model (all in estimated tokens — translated to dollars by
 * downstream billing; we deliberately stay token-domain here):
 *
 *   - first-attempt tokens          baseline
 *   - retry tokens                  retries that landed
 *   - timeout-waste tokens          retries that timed out (compute spent, no output)
 *   - grounding overhead tokens     extra tokens spent fetching / encoding / matching
 *   - prompt-compression savings    tokens NOT spent due to compression
 *   - burn-in duplication tokens    compatibility-core shadow runs
 *
 * Aggregate output exposes total cost, avoidable cost (the bits we
 * could shave with better budget logic), and the retry amplification
 * factor (final attempt cost / first attempt cost).
 */

import type { BenchmarkEngine } from './qualityBenchmarkSuite';

// ── Per-section cost record (input) ──────────────────────────────────────────

export interface SectionRecoveryCostRecord {
  sectionIndex: number;
  attempts: number;
  /** Tokens spent on the first generation attempt. */
  firstAttemptTokens: number;
  /** Tokens spent on subsequent retries that produced an output. */
  retryProductiveTokens: number;
  /** Tokens spent on retries that timed out without producing usable output. */
  timeoutWasteTokens: number;
  /** Tokens shaved by prompt compression (positive value = savings). */
  compressionSavingsTokens: number;
  /** Extra prompt tokens spent on grounding context vs no-grounding baseline. */
  groundingOverheadTokens: number;
  /** True if minimal recovery was used. */
  minimalRecoveryUsed: boolean;
}

export interface RecordRecoveryCostInput {
  company_id: string | null;
  engine: BenchmarkEngine;
  content_type: string;
  topic: string;
  duration_ms: number;
  sections: SectionRecoveryCostRecord[];
  /** Burn-in shadow run cost in tokens, when burn-in fired. */
  burnInShadowTokens?: number;
}

// ── Public report shape ─────────────────────────────────────────────────────

export interface RecoveryCostReport {
  totalRecoveryCost: number;          // tokens
  avoidableRecoveryCost: number;      // tokens
  timeoutWasteCost: number;           // tokens
  retryAmplificationFactor: number;   // final / first (1.0 = no amplification)
  groundingOverhead: number;          // tokens
  compressionSavings: number;         // tokens
  burnInDuplicationCost: number;      // tokens
  perContentType: Array<{
    content_type: string;
    requests: number;
    average_total_cost: number;
    average_amplification: number;
  }>;
  reasoning: string[];
}

// ── In-process aggregator ───────────────────────────────────────────────────

interface AggregateBucket {
  requests: number;
  total: number;
  amplificationSum: number;
}

const buckets = new Map<string, AggregateBucket>();
let globalTotals = {
  totalRecoveryCost: 0,
  avoidableRecoveryCost: 0,
  timeoutWasteCost: 0,
  retryAmplificationSum: 0,
  retryAmplificationCount: 0,
  groundingOverhead: 0,
  compressionSavings: 0,
  burnInDuplicationCost: 0,
};

function bucketKey(contentType: string): string {
  return contentType;
}

// ── Recording ───────────────────────────────────────────────────────────────

export function recordRecoveryCost(input: RecordRecoveryCostInput): RecoveryCostReport {
  const sections = input.sections;
  const first = sections.reduce((s, x) => s + x.firstAttemptTokens, 0);
  const retry = sections.reduce((s, x) => s + x.retryProductiveTokens, 0);
  const wasted = sections.reduce((s, x) => s + x.timeoutWasteTokens, 0);
  const overhead = sections.reduce((s, x) => s + x.groundingOverheadTokens, 0);
  const compressionSav = sections.reduce((s, x) => s + x.compressionSavingsTokens, 0);
  const burnIn = input.burnInShadowTokens ?? 0;

  const total = first + retry + wasted + overhead + burnIn;
  const amplification = first > 0
    ? Number(((first + retry + wasted) / first).toFixed(3))
    : 1;

  // "Avoidable" cost = timeout waste + retries that didn't improve quality
  // (we don't have improvement signal at this layer, so this is a heuristic:
  // any retry beyond the first counts as 50% avoidable).
  const avoidable = wasted + Math.round(retry * 0.5);

  // Update global aggregator.
  globalTotals.totalRecoveryCost += total;
  globalTotals.avoidableRecoveryCost += avoidable;
  globalTotals.timeoutWasteCost += wasted;
  globalTotals.retryAmplificationSum += amplification;
  globalTotals.retryAmplificationCount += 1;
  globalTotals.groundingOverhead += overhead;
  globalTotals.compressionSavings += compressionSav;
  globalTotals.burnInDuplicationCost += burnIn;

  const key = bucketKey(input.content_type);
  const bucket = buckets.get(key) ?? { requests: 0, total: 0, amplificationSum: 0 };
  bucket.requests += 1;
  bucket.total += total;
  bucket.amplificationSum += amplification;
  buckets.set(key, bucket);

  const reasoning: string[] = [];
  if (wasted > 0) reasoning.push(`Timeout waste: ${wasted} tokens — invest in execution-strategy tuning.`);
  if (amplification > 1.8) reasoning.push(`High retry amplification (${amplification}×). Reduce retries by tightening alignment gate.`);
  if (compressionSav > 0) reasoning.push(`Prompt compression saved ${compressionSav} tokens.`);
  if (burnIn > 0) reasoning.push(`Burn-in shadow cost: ${burnIn} tokens — sample-rate controls this.`);

  const perContentType: RecoveryCostReport['perContentType'] = Array.from(buckets.entries()).map(([ct, b]) => ({
    content_type: ct,
    requests: b.requests,
    average_total_cost: Math.round(b.total / b.requests),
    average_amplification: Number((b.amplificationSum / b.requests).toFixed(3)),
  }));

  const report: RecoveryCostReport = {
    totalRecoveryCost: total,
    avoidableRecoveryCost: avoidable,
    timeoutWasteCost: wasted,
    retryAmplificationFactor: amplification,
    groundingOverhead: overhead,
    compressionSavings: compressionSav,
    burnInDuplicationCost: burnIn,
    perContentType,
    reasoning,
  };

  // Emit telemetry event.
  console.log(`[longform-cost] ${JSON.stringify({
    event: 'LONGFORM_RECOVERY_COST',
    company_id: input.company_id,
    engine: input.engine,
    content_type: input.content_type,
    topic: input.topic,
    duration_ms: input.duration_ms,
    ...report,
    timestamp: new Date().toISOString(),
  })}`);

  return report;
}

export interface AggregateRecoveryCostReport {
  totalRecoveryCost: number;
  avoidableRecoveryCost: number;
  timeoutWasteCost: number;
  averageRetryAmplification: number;
  groundingOverhead: number;
  compressionSavings: number;
  burnInDuplicationCost: number;
  perContentType: Array<{
    content_type: string;
    requests: number;
    average_total_cost: number;
    average_amplification: number;
  }>;
}

export function getAggregateRecoveryCostReport(): AggregateRecoveryCostReport {
  return {
    totalRecoveryCost: globalTotals.totalRecoveryCost,
    avoidableRecoveryCost: globalTotals.avoidableRecoveryCost,
    timeoutWasteCost: globalTotals.timeoutWasteCost,
    averageRetryAmplification: globalTotals.retryAmplificationCount > 0
      ? Number((globalTotals.retryAmplificationSum / globalTotals.retryAmplificationCount).toFixed(3))
      : 1,
    groundingOverhead: globalTotals.groundingOverhead,
    compressionSavings: globalTotals.compressionSavings,
    burnInDuplicationCost: globalTotals.burnInDuplicationCost,
    perContentType: Array.from(buckets.entries()).map(([ct, b]) => ({
      content_type: ct,
      requests: b.requests,
      average_total_cost: Math.round(b.total / b.requests),
      average_amplification: Number((b.amplificationSum / b.requests).toFixed(3)),
    })),
  };
}

export function __resetRecoveryCostAggregatorForTests(): void {
  buckets.clear();
  globalTotals = {
    totalRecoveryCost: 0,
    avoidableRecoveryCost: 0,
    timeoutWasteCost: 0,
    retryAmplificationSum: 0,
    retryAmplificationCount: 0,
    groundingOverhead: 0,
    compressionSavings: 0,
    burnInDuplicationCost: 0,
  };
}
