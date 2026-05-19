/**
 * Billing Metrics — Phase F
 *
 * In-process counters that match the audit prompt's required metrics list.
 * Resets per-process (serverless) but accumulates over the lifetime of
 * long-running workers. A separate ops dashboard scrapes /api/metrics
 * periodically (the existing metricsCollector pattern).
 *
 * Tracked:
 *   billing_operations_total
 *   deduction_failures_total
 *   duplicate_prevention_hits_total
 *   reservation_expiry_total
 *   reconciliation_failures_total
 *   admin_adjustments_total
 *   approval_rejections_total
 *
 * Each counter increments via a function exported from this module. The
 * orchestrator and approval service invoke these on relevant control-flow
 * branches.
 */

const counters: Record<string, number> = {
  billing_operations_total:        0,
  billing_operations_confirmed:    0,
  billing_operations_released:     0,
  billing_operations_insufficient: 0,
  billing_operations_errored:      0,
  deduction_failures_total:        0,
  duplicate_prevention_hits_total: 0,
  reservation_expiry_total:        0,
  reconciliation_failures_total:   0,
  admin_adjustments_total:         0,
  admin_grants_total:              0,
  admin_refunds_total:             0,
  approval_proposals_total:        0,
  approval_signatures_total:       0,
  approval_rejections_total:       0,
  approval_executions_total:       0,
  approval_expirations_total:      0,
  approval_self_signature_blocks:  0,
  queue_replay_blocked_total:      0,
  untracked_ai_call_blocked_total: 0,
  // Phase Idempotency-Remediation I — lifecycle counters
  idempotency_in_progress_total:   0,
  idempotency_expired_total:       0,
  idempotency_failed_total:        0,
  stale_operation_recovered_total: 0,
  replay_suppression_total:        0,
  recovery_action_total:           0,
  // Phase Self-Healing-Finalization G — recovery telemetry
  stale_operation_auto_recovered_total: 0,
  manual_recovery_actions_total:        0,
  recovery_retry_total:                 0,
  reconciliation_after_recovery_total:  0,
  heartbeat_timeout_total:              0,
  // Phase 2 — canary enforcement gate telemetry
  phase2_gate_enforce_total:            0,
  phase2_gate_shadow_total:             0,
  phase2_gate_off_total:                0,
  phase2_gate_killswitch_total:         0,
  phase2_shadow_would_block_total:      0,
  // Phase 3.1 — black-hole cost-capture failure (was logs-only).
  black_hole_cost_capture_failed_total: 0,
  // Task 5H — pre-HOLD 80% executable-balance safety gate blocked an execution.
  credit_safety_gate_blocked_total:     0,
};

export type BillingCounter = keyof typeof counters;

export function incrCounter(name: BillingCounter, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function getCounter(name: BillingCounter): number {
  return counters[name] ?? 0;
}

export function snapshotBillingMetrics(): Record<string, number> {
  return { ...counters };
}

/** Reset — test-only. Production callers should never invoke this. */
export function _resetBillingMetricsForTests(): void {
  for (const k of Object.keys(counters)) counters[k as BillingCounter] = 0;
}
