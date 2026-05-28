/**
 * burnInPerformanceAnalysis.ts
 *
 * Phase 6.9 — Expanded burn-in comparison analysis.
 *
 * Phase 4.9's `BurnInComparisonSnapshot` recorded duration + completion
 * deltas. This module adds:
 *   - quality delta
 *   - convergence delta
 *   - retry-amplification delta
 *   - grounding delta
 *   - timeout delta
 *   - operational cost delta
 *
 * And aggregates an in-process `BurnInPerformanceAnalysis` answering
 * "is the planned engine a net win vs compatibility-core, accounting
 * for runtime cost?"
 *
 * Records also flow through the burn-in aggregator from Phase 4.9 so
 * the existing snapshot endpoint stays compatible.
 */

import {
  recordBurnInComparison,
  accumulateBurnInComparison,
  getBurnInAggregateReport,
  type BurnInComparisonSnapshot,
  type BurnInEngineMetrics,
} from './plannedEngineBurnInMode';

// ── Extended snapshot ───────────────────────────────────────────────────────

export interface BurnInPerformanceSnapshot extends BurnInComparisonSnapshot {
  planned_extended: BurnInExtendedEngineMetrics;
  compatibility_extended: BurnInExtendedEngineMetrics;
  extended_deltas: {
    quality_score: number;
    convergence_score: number;
    retry_amplification: number;
    grounding_coverage: number;
    timeout_count: number;
    operational_cost_tokens: number;
  };
}

export interface BurnInExtendedEngineMetrics extends BurnInEngineMetrics {
  quality_score?: number;
  convergence_score?: number;
  retry_amplification?: number;
  grounding_coverage?: number;
  timeout_count?: number;
  operational_cost_tokens?: number;
}

// ── Performance analysis ────────────────────────────────────────────────────

export interface BurnInPerformanceAnalysis {
  net_quality_gain: number;          // planned − compatibility (avg)
  net_runtime_cost: number;          // planned − compatibility (avg ms)
  net_grounding_gain: number;
  net_alignment_gain: number;         // proxy: quality minus runtime penalty
  net_timeout_penalty: number;        // planned timeout count − compatibility (avg)
  retirement_projection:
    | 'planned_clearly_better'
    | 'planned_better_but_slower'
    | 'mixed'
    | 'compatibility_clearly_better';
  samples_analyzed: number;
  reasoning: string[];
}

// ── In-process aggregator (extends Phase 4.9 in-memory state) ────────────────

interface ExtendedAggregator {
  count: number;
  quality_delta_sum: number;
  convergence_delta_sum: number;
  retry_amp_delta_sum: number;
  grounding_delta_sum: number;
  timeout_delta_sum: number;
  cost_delta_sum: number;
  duration_delta_sum: number;
  net_alignment_delta_sum: number;
}

const extendedAggregator: ExtendedAggregator = {
  count: 0,
  quality_delta_sum: 0,
  convergence_delta_sum: 0,
  retry_amp_delta_sum: 0,
  grounding_delta_sum: 0,
  timeout_delta_sum: 0,
  cost_delta_sum: 0,
  duration_delta_sum: 0,
  net_alignment_delta_sum: 0,
};

// ── Public API ──────────────────────────────────────────────────────────────

export function recordBurnInPerformance(snapshot: BurnInPerformanceSnapshot): void {
  // Also flow through Phase 4.9 aggregator so the existing snapshot
  // endpoint stays compatible.
  recordBurnInComparison(snapshot);
  accumulateBurnInComparison(snapshot);

  // Update Phase 6.9 extended aggregator.
  extendedAggregator.count += 1;
  extendedAggregator.quality_delta_sum += snapshot.extended_deltas.quality_score;
  extendedAggregator.convergence_delta_sum += snapshot.extended_deltas.convergence_score;
  extendedAggregator.retry_amp_delta_sum += snapshot.extended_deltas.retry_amplification;
  extendedAggregator.grounding_delta_sum += snapshot.extended_deltas.grounding_coverage;
  extendedAggregator.timeout_delta_sum += snapshot.extended_deltas.timeout_count;
  extendedAggregator.cost_delta_sum += snapshot.extended_deltas.operational_cost_tokens;
  extendedAggregator.duration_delta_sum += snapshot.deltas.duration_ms;
  extendedAggregator.net_alignment_delta_sum += snapshot.extended_deltas.quality_score
    - Math.max(0, snapshot.extended_deltas.timeout_count * 5);
}

export function analyzeBurnInPerformance(): BurnInPerformanceAnalysis {
  const a = extendedAggregator;
  if (a.count === 0) {
    return {
      net_quality_gain: 0,
      net_runtime_cost: 0,
      net_grounding_gain: 0,
      net_alignment_gain: 0,
      net_timeout_penalty: 0,
      retirement_projection: 'mixed',
      samples_analyzed: 0,
      reasoning: ['No burn-in samples available.'],
    };
  }
  const net_quality_gain = Number((a.quality_delta_sum / a.count).toFixed(2));
  const net_runtime_cost = Math.round(a.duration_delta_sum / a.count);
  const net_grounding_gain = Number((a.grounding_delta_sum / a.count).toFixed(2));
  const net_alignment_gain = Number((a.net_alignment_delta_sum / a.count).toFixed(2));
  const net_timeout_penalty = Number((a.timeout_delta_sum / a.count).toFixed(2));

  const reasoning: string[] = [];
  reasoning.push(`Quality delta avg ${net_quality_gain} across ${a.count} samples.`);
  if (net_runtime_cost > 0) reasoning.push(`Runtime cost: planned avg ${net_runtime_cost}ms slower than compatibility.`);
  if (net_grounding_gain > 0) reasoning.push(`Grounding gain: planned avg ${net_grounding_gain} points higher coverage.`);
  if (net_timeout_penalty > 0) reasoning.push(`Timeout penalty: planned averages ${net_timeout_penalty} more timeout(s) per article.`);

  // Verdict heuristics.
  let projection: BurnInPerformanceAnalysis['retirement_projection'];
  if (net_quality_gain >= 10 && net_timeout_penalty <= 0.5) {
    projection = 'planned_clearly_better';
    reasoning.push(`Planned clearly better: ≥10 quality points lead with ≤0.5 timeout penalty.`);
  } else if (net_quality_gain >= 5 && net_runtime_cost > 10_000) {
    projection = 'planned_better_but_slower';
    reasoning.push(`Planned better but slower (>10s runtime penalty). Consider whether speed matters more than quality.`);
  } else if (net_quality_gain <= -5) {
    projection = 'compatibility_clearly_better';
    reasoning.push(`Compatibility-core is the better engine on quality — DO NOT retire it.`);
  } else {
    projection = 'mixed';
    reasoning.push(`Mixed result; no clear winner.`);
  }

  return {
    net_quality_gain,
    net_runtime_cost,
    net_grounding_gain,
    net_alignment_gain,
    net_timeout_penalty,
    retirement_projection: projection,
    samples_analyzed: a.count,
    reasoning,
  };
}

export function __resetBurnInPerformanceAggregatorForTests(): void {
  extendedAggregator.count = 0;
  extendedAggregator.quality_delta_sum = 0;
  extendedAggregator.convergence_delta_sum = 0;
  extendedAggregator.retry_amp_delta_sum = 0;
  extendedAggregator.grounding_delta_sum = 0;
  extendedAggregator.timeout_delta_sum = 0;
  extendedAggregator.cost_delta_sum = 0;
  extendedAggregator.duration_delta_sum = 0;
  extendedAggregator.net_alignment_delta_sum = 0;
}

// Re-export Phase 4.9 aggregate getter so callers can read both views from one module.
export { getBurnInAggregateReport };
