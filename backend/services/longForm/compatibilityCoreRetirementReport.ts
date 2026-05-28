/**
 * compatibilityCoreRetirementReport.ts
 *
 * Phase 4.7 — Quantitative readiness score for retiring the
 * compatibility-core fallback engine.
 *
 * Combines the stability-bucket snapshot (from
 * `plannedEngineStabilityTelemetry`) with operator-supplied tuning
 * thresholds into a single retirement-readiness score 0–100.
 *
 * The report is purely diagnostic — it does NOT actually retire anything.
 * Operators read it to decide when to flip
 * `STRICT_PLANNED_ENGINE_MODE=always`.
 */

import {
  getCompatibilityCoreUsageReport,
  type CompatibilityCoreUsageReport,
} from './plannedEngineStabilityTelemetry';

export type RetirementRisk = 'low' | 'moderate' | 'high' | 'critical';

export interface CompatibilityCoreRetirementReport {
  /** 0–100 — higher = safer to retire. */
  retirementReadinessScore: number;
  /** Failure categories currently blocking retirement. */
  blockingFailureCategories: Array<{ category: string; affected_types: string[]; total_count: number }>;
  /** Content types whose planned-engine fallback rate exceeds tolerance. */
  unstableContentTypes: Array<{ content_type: string; fallback_rate: number; attempts: number }>;
  /** Coarse risk label aligned to the score. */
  estimatedRetirementRisk: RetirementRisk;
  /** What to do next — actionable, not aspirational. */
  recommendedNextActions: string[];
  /** Per-content-type pass-rate breakdown. */
  perContentType: Array<{
    content_type: string;
    attempts: number;
    success_rate: number;
    fallback_rate: number;
    common_failure_reasons: Array<{ reason: string; count: number }>;
  }>;
  /** Raw counters used to compute the score. */
  snapshot: CompatibilityCoreUsageReport;
}

export interface ComputeRetirementReportOptions {
  /** Below this content-type pass rate, the type is "unstable". Default: 0.90. */
  contentTypePassRateThreshold?: number;
  /** Above this content-type fallback rate, the type blocks retirement. Default: 0.05. */
  contentTypeFallbackRateThreshold?: number;
  /** Minimum attempts before a content type's data is considered statistically meaningful. Default: 20. */
  minAttemptsPerType?: number;
  /** Optional override snapshot — defaults to the in-process counters. */
  snapshot?: CompatibilityCoreUsageReport;
}

const DEFAULT_PASS_THRESHOLD = 0.90;
const DEFAULT_FALLBACK_THRESHOLD = 0.05;
const DEFAULT_MIN_ATTEMPTS = 20;

export function computeCompatibilityCoreRetirementReport(
  options: ComputeRetirementReportOptions = {},
): CompatibilityCoreRetirementReport {
  const snapshot = options.snapshot ?? getCompatibilityCoreUsageReport();
  const passThreshold = options.contentTypePassRateThreshold ?? DEFAULT_PASS_THRESHOLD;
  const fallbackThreshold = options.contentTypeFallbackRateThreshold ?? DEFAULT_FALLBACK_THRESHOLD;
  const minAttempts = options.minAttemptsPerType ?? DEFAULT_MIN_ATTEMPTS;

  const perContentType = snapshot.per_content_type.map((entry) => ({
    content_type: entry.content_type,
    attempts: entry.attempts,
    success_rate: entry.attempts > 0 ? Number((entry.success / entry.attempts).toFixed(3)) : 0,
    fallback_rate: entry.fallback_rate,
    common_failure_reasons: entry.common_failure_reasons,
  }));

  // ── Identify unstable content types ────────────────────────────────────
  const unstableContentTypes: CompatibilityCoreRetirementReport['unstableContentTypes'] = [];
  for (const t of perContentType) {
    if (t.attempts < minAttempts) continue; // not enough data
    if (t.fallback_rate >= fallbackThreshold || t.success_rate < passThreshold) {
      unstableContentTypes.push({
        content_type: t.content_type,
        fallback_rate: t.fallback_rate,
        attempts: t.attempts,
      });
    }
  }

  // ── Cluster blocking failure categories across types ──────────────────
  const blockingMap = new Map<string, { types: Set<string>; total: number }>();
  for (const entry of snapshot.per_content_type) {
    for (const reason of entry.common_failure_reasons) {
      const category = classifyFailureReason(reason.reason);
      const bucket = blockingMap.get(category) ?? { types: new Set<string>(), total: 0 };
      bucket.types.add(entry.content_type);
      bucket.total += reason.count;
      blockingMap.set(category, bucket);
    }
  }
  const blockingFailureCategories: CompatibilityCoreRetirementReport['blockingFailureCategories'] = Array.from(blockingMap.entries())
    .map(([category, info]) => ({
      category,
      affected_types: Array.from(info.types).sort(),
      total_count: info.total,
    }))
    .sort((a, b) => b.total_count - a.total_count);

  // ── Readiness score ───────────────────────────────────────────────────
  // Weighted blend:
  //   - 50%: overall planned-engine success rate
  //   - 25%: inverse of overall fallback rate
  //   - 15%: stability across content types (penalty per unstable type)
  //   - 10%: traffic volume confidence (low attempts = lower score)
  const overallSuccess = snapshot.total_attempts_all_types > 0
    ? snapshot.total_planned_success / snapshot.total_attempts_all_types
    : 0;
  const overallFallbackRate = snapshot.total_attempts_all_types > 0
    ? snapshot.total_fallback_to_compatibility_core / snapshot.total_attempts_all_types
    : 0;
  const meaningfulTypes = perContentType.filter((t) => t.attempts >= minAttempts);
  const stableTypeShare = meaningfulTypes.length === 0
    ? 0
    : (meaningfulTypes.length - unstableContentTypes.length) / meaningfulTypes.length;
  const trafficConfidence = Math.min(1, snapshot.total_attempts_all_types / 200);

  const readiness =
      50 * overallSuccess
    + 25 * (1 - Math.min(1, overallFallbackRate / Math.max(fallbackThreshold * 2, 0.1)))
    + 15 * stableTypeShare
    + 10 * trafficConfidence;
  const retirementReadinessScore = Math.max(0, Math.min(100, Math.round(readiness)));

  // ── Risk band ─────────────────────────────────────────────────────────
  let estimatedRetirementRisk: RetirementRisk;
  if (retirementReadinessScore >= 88 && unstableContentTypes.length === 0) estimatedRetirementRisk = 'low';
  else if (retirementReadinessScore >= 75) estimatedRetirementRisk = 'moderate';
  else if (retirementReadinessScore >= 55) estimatedRetirementRisk = 'high';
  else estimatedRetirementRisk = 'critical';

  // ── Next actions ──────────────────────────────────────────────────────
  const actions: string[] = [];
  if (snapshot.total_attempts_all_types < minAttempts * 5) {
    actions.push(`Collect more traffic (current: ${snapshot.total_attempts_all_types} total attempts; recommended minimum: ${minAttempts * 5}).`);
  }
  if (unstableContentTypes.length > 0) {
    actions.push(`Investigate unstable content types: ${unstableContentTypes.map((t) => t.content_type).join(', ')}.`);
  }
  for (const cluster of blockingFailureCategories.slice(0, 3)) {
    actions.push(`Address dominant failure category "${cluster.category}" (${cluster.total_count} occurrences across ${cluster.affected_types.length} types).`);
  }
  if (overallFallbackRate >= fallbackThreshold) {
    actions.push(`Overall fallback rate ${(overallFallbackRate * 100).toFixed(1)}% exceeds ${(fallbackThreshold * 100).toFixed(1)}% threshold — keep STRICT_PLANNED_ENGINE_MODE=off until this clears.`);
  }
  if (estimatedRetirementRisk === 'low') {
    actions.push('Readiness is LOW risk. Suggested next step: flip STRICT_PLANNED_ENGINE_MODE=non_prod for two weeks; verify zero unexpected throws; then move to "always".');
  }

  return {
    retirementReadinessScore,
    blockingFailureCategories,
    unstableContentTypes,
    estimatedRetirementRisk,
    recommendedNextActions: actions,
    perContentType,
    snapshot,
  };
}

// ── Reason classifier ───────────────────────────────────────────────────────

function classifyFailureReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('timeout')) return 'timeout';
  if (r.includes('parse') || r.includes('json')) return 'output_format';
  if (r.includes('section') && r.includes('plan')) return 'planning';
  if (r.includes('plan returned 0 sections')) return 'planning';
  if (r.includes('budget exhausted') || r.includes('max retries')) return 'retry_exhaustion';
  if (r.includes('factual') || r.includes('hallucination')) return 'factual';
  if (r.includes('alignment') || r.includes('icp')) return 'alignment';
  if (r.includes('repetition')) return 'repetition';
  if (r.includes('quality')) return 'quality_validation';
  return 'other';
}
