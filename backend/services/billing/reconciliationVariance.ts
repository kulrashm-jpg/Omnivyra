/**
 * Pure, deterministic provider-invoice reconciliation variance helper.
 *
 * Given an estimated vs actual USD pair, returns the variance, percent, and
 * severity band. NO I/O, NO side effects — same inputs → same output, fully
 * replay-safe. This is the deterministic kernel that an (operator-built,
 * provider-specific) ingestion adapter will consume to decide whether to
 * emit a `cost_anomalies` row and/or a `cost_reconciliation_adjustments`
 * entry.
 *
 * Thresholds are intentionally hardcoded compile-time constants (variance
 * banding is a financial-correctness policy, not an operational knob); if
 * future ops want to tune these, lift them into the billing_policy_config
 * resolver — that surface already exists.
 */

export type ReconciliationSeverity = 'none' | 'low' | 'medium' | 'high';

export interface VarianceResult {
  estimated_usd: number;
  actual_usd:    number;
  /** signed: positive = under-estimated (actual > estimated). */
  variance_usd:  number;
  /** Null when estimated_usd is zero (undefined ratio); use variance_usd directly. */
  variance_pct:  number | null;
  severity:      ReconciliationSeverity;
  /** True for medium/high — caller wires emission into cost_anomalies. */
  should_emit_anomaly: boolean;
}

const LOW_PCT    = 0.05;  // 5%
const MEDIUM_PCT = 0.15;  // 15%
const HIGH_PCT   = 0.30;  // 30%

/**
 * Pure variance computation. Negative inputs are treated as zero (callers
 * should already have prevented negative cost rows; defensive only).
 */
export function computeReconciliationVariance(input: {
  estimated_usd: number;
  actual_usd:    number;
}): VarianceResult {
  const estimated = Math.max(0, Number.isFinite(input.estimated_usd) ? input.estimated_usd : 0);
  const actual    = Math.max(0, Number.isFinite(input.actual_usd)    ? input.actual_usd    : 0);
  const variance_usd = actual - estimated;

  let variance_pct: number | null = null;
  if (estimated > 0) variance_pct = Math.abs(variance_usd) / estimated;

  let severity: ReconciliationSeverity = 'none';
  if (variance_pct === null) {
    // Estimated was zero. If actual is also zero → none. Otherwise the
    // absolute drift is unboundable as a ratio; bucket by absolute size.
    if (actual === 0)        severity = 'none';
    else if (actual < 0.01)  severity = 'low';
    else if (actual < 1)     severity = 'medium';
    else                     severity = 'high';
  } else if (variance_pct < LOW_PCT)    severity = 'none';
  else if (variance_pct < MEDIUM_PCT)   severity = 'low';
  else if (variance_pct < HIGH_PCT)     severity = 'medium';
  else                                   severity = 'high';

  return {
    estimated_usd: estimated,
    actual_usd:    actual,
    variance_usd,
    variance_pct,
    severity,
    should_emit_anomaly: severity === 'medium' || severity === 'high',
  };
}
