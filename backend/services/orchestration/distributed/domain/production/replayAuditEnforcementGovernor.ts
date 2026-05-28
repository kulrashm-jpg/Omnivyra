/**
 * Phase 27B.5 — Replay Audit Enforcement Governor.
 *
 * Aggregates replay-safety signals emitted by the runtime gate, claim
 * helper, jobId parity tracker, and reconciliation pass — then enforces
 * thresholds. When any threshold is exceeded the governor:
 *
 *   - recommends a rollout freeze (consumed by the rollout governor);
 *   - refuses promotions to higher rollout stages;
 *   - emits a rollback recommendation with the offending metric.
 *
 * SCOPE: aggregation + threshold enforcement only. The governor does
 * NOT mutate the rollout governor, the runtime, or the queues — its
 * verdict is read by callers.
 *
 * METRICS:
 *   - gate_short_circuit_rate         (publish gate duplicate suppressions / total)
 *   - adapter_duplicate_detected      (count of cross-process adapter dupes)
 *   - enqueue_overlap_ratio           (path-divergence count / total enqueues)
 *   - reconciliation_unverifiable_rate (unverifiable / total reconciliations)
 *   - long_form_collision_rate        (claim losses / total claims)
 *
 * Thresholds are intentionally conservative defaults; operators tune
 * via constructor opts.
 */

// ────────────────────────────────────────────────────────────────────
// Metric inputs + thresholds
// ────────────────────────────────────────────────────────────────────

export interface ReplayAuditThresholds {
  /** Max acceptable rate of publish-gate short-circuits (0..1). */
  gate_short_circuit_rate: number;
  /** Max acceptable count of adapter-level duplicate detections. */
  adapter_duplicate_detected: number;
  /** Max acceptable ratio of enqueue-path divergences (0..1). */
  enqueue_overlap_ratio: number;
  /** Max acceptable rate of unverifiable reconciliations (0..1). */
  reconciliation_unverifiable_rate: number;
  /** Max acceptable long-form claim collision rate (0..1). */
  long_form_collision_rate: number;
}

export const DEFAULT_REPLAY_AUDIT_THRESHOLDS: ReplayAuditThresholds = {
  gate_short_circuit_rate: 0.05,             // > 5% suggests replay storm
  adapter_duplicate_detected: 0,             // zero tolerance
  enqueue_overlap_ratio: 0.01,               // > 1% suggests path divergence
  reconciliation_unverifiable_rate: 0.10,    // > 10% suggests provider drift
  long_form_collision_rate: 0.02,            // > 2% suggests redundant work
};

export interface ReplayAuditMetricSnapshot {
  gate_short_circuit_rate: number;
  adapter_duplicate_detected: number;
  enqueue_overlap_ratio: number;
  reconciliation_unverifiable_rate: number;
  long_form_collision_rate: number;
  totals: {
    gateCalls: number;
    gateShortCircuits: number;
    adapterDuplicates: number;
    enqueueCalls: number;
    enqueueDivergences: number;
    reconciliationCalls: number;
    reconciliationUnverifiable: number;
    longFormClaims: number;
    longFormCollisions: number;
  };
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ReplayAuditTelemetryEvent =
  | 'replay_audit_metric_recorded'
  | 'replay_audit_threshold_breached'
  | 'replay_audit_rollout_freeze_recommended'
  | 'replay_audit_promotion_blocked';

export interface ReplayAuditTelemetrySink {
  emit(event: ReplayAuditTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ReplayAuditTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event !== 'replay_audit_metric_recorded') console.warn(`[replay_audit] ${line}`);
      else console.log(`[replay_audit] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Governor
// ────────────────────────────────────────────────────────────────────

export interface ReplayAuditGovernorOpts {
  thresholds?: Partial<ReplayAuditThresholds>;
  telemetry?: ReplayAuditTelemetrySink;
}

interface InternalCounters {
  gateCalls: number;
  gateShortCircuits: number;
  adapterDuplicates: number;
  enqueueCalls: number;
  enqueueDivergences: number;
  reconciliationCalls: number;
  reconciliationUnverifiable: number;
  longFormClaims: number;
  longFormCollisions: number;
}

function newCounters(): InternalCounters {
  return {
    gateCalls: 0, gateShortCircuits: 0, adapterDuplicates: 0,
    enqueueCalls: 0, enqueueDivergences: 0,
    reconciliationCalls: 0, reconciliationUnverifiable: 0,
    longFormClaims: 0, longFormCollisions: 0,
  };
}

export class ReplayAuditEnforcementGovernor {
  private readonly thresholds: ReplayAuditThresholds;
  private readonly telemetry: ReplayAuditTelemetrySink;
  private counters: InternalCounters = newCounters();
  private freezeRecommended = false;
  private freezeReason: string | null = null;

  constructor(opts?: ReplayAuditGovernorOpts) {
    this.thresholds = { ...DEFAULT_REPLAY_AUDIT_THRESHOLDS, ...(opts?.thresholds ?? {}) };
    this.telemetry = opts?.telemetry ?? defaultTelemetrySink;
  }

  // ── Signal recorders ──

  recordGateCall(opts: { shortCircuited: boolean }): void {
    this.counters.gateCalls += 1;
    if (opts.shortCircuited) this.counters.gateShortCircuits += 1;
    this.telemetry.emit('replay_audit_metric_recorded', { kind: 'gate_call', ...opts });
    this.checkThresholds();
  }

  recordAdapterDuplicate(opts: { provider: string; scheduledPostId: string }): void {
    this.counters.adapterDuplicates += 1;
    this.telemetry.emit('replay_audit_metric_recorded', { kind: 'adapter_duplicate', ...opts });
    this.checkThresholds();
  }

  recordEnqueue(opts: { divergent: boolean }): void {
    this.counters.enqueueCalls += 1;
    if (opts.divergent) this.counters.enqueueDivergences += 1;
    this.telemetry.emit('replay_audit_metric_recorded', { kind: 'enqueue', ...opts });
    this.checkThresholds();
  }

  recordReconciliation(opts: { unverifiable: boolean }): void {
    this.counters.reconciliationCalls += 1;
    if (opts.unverifiable) this.counters.reconciliationUnverifiable += 1;
    this.telemetry.emit('replay_audit_metric_recorded', { kind: 'reconciliation', ...opts });
    this.checkThresholds();
  }

  recordLongFormClaim(opts: { collision: boolean }): void {
    this.counters.longFormClaims += 1;
    if (opts.collision) this.counters.longFormCollisions += 1;
    this.telemetry.emit('replay_audit_metric_recorded', { kind: 'long_form_claim', ...opts });
    this.checkThresholds();
  }

  // ── Verdicts ──

  /**
   * Snapshot the current metric state.
   */
  snapshot(): ReplayAuditMetricSnapshot {
    const c = this.counters;
    return {
      gate_short_circuit_rate: safeDiv(c.gateShortCircuits, c.gateCalls),
      adapter_duplicate_detected: c.adapterDuplicates,
      enqueue_overlap_ratio: safeDiv(c.enqueueDivergences, c.enqueueCalls),
      reconciliation_unverifiable_rate: safeDiv(c.reconciliationUnverifiable, c.reconciliationCalls),
      long_form_collision_rate: safeDiv(c.longFormCollisions, c.longFormClaims),
      totals: { ...c },
    };
  }

  /**
   * Recommended freeze state. Read by the rollout governor before
   * applying a forward transition.
   */
  isFreezeRecommended(): { frozen: boolean; reason: string | null; breaches: string[] } {
    const breaches = this.breachedMetrics();
    return { frozen: this.freezeRecommended, reason: this.freezeReason, breaches };
  }

  /**
   * Block a promotion attempt if any threshold is breached. Returns
   * { allowed: false, ... } when promotion must be refused.
   */
  evaluatePromotion(): { allowed: boolean; reason: string; breaches: string[] } {
    const breaches = this.breachedMetrics();
    if (breaches.length > 0) {
      const reason = `promotion blocked: thresholds exceeded — ${breaches.join(', ')}`;
      this.telemetry.emit('replay_audit_promotion_blocked', { reason, breaches });
      return { allowed: false, reason, breaches };
    }
    return { allowed: true, reason: 'no threshold breached', breaches: [] };
  }

  /**
   * Rollback recommendation. Returned when ANY breach is present.
   */
  generateRollbackRecommendation(): {
    recommended: boolean;
    reasons: string[];
    suggestedAction: 'freeze' | 'downgrade' | 'none';
  } {
    const breaches = this.breachedMetrics();
    if (breaches.length === 0) {
      return { recommended: false, reasons: [], suggestedAction: 'none' };
    }
    // Zero-tolerance breach (adapter duplicate) → downgrade.
    const includesAdapterDup = breaches.includes('adapter_duplicate_detected');
    const action = includesAdapterDup ? 'downgrade' : 'freeze';
    return { recommended: true, reasons: breaches, suggestedAction: action };
  }

  /**
   * Reset counters. Used by tests + periodic flush.
   */
  reset(): void {
    this.counters = newCounters();
    this.freezeRecommended = false;
    this.freezeReason = null;
  }

  // ── Internals ──

  private breachedMetrics(): string[] {
    const snap = this.snapshot();
    const t = this.thresholds;
    const out: string[] = [];
    if (snap.gate_short_circuit_rate > t.gate_short_circuit_rate) out.push('gate_short_circuit_rate');
    if (snap.adapter_duplicate_detected > t.adapter_duplicate_detected) out.push('adapter_duplicate_detected');
    if (snap.enqueue_overlap_ratio > t.enqueue_overlap_ratio) out.push('enqueue_overlap_ratio');
    if (snap.reconciliation_unverifiable_rate > t.reconciliation_unverifiable_rate) out.push('reconciliation_unverifiable_rate');
    if (snap.long_form_collision_rate > t.long_form_collision_rate) out.push('long_form_collision_rate');
    return out;
  }

  private checkThresholds(): void {
    const breaches = this.breachedMetrics();
    if (breaches.length === 0) return;
    if (!this.freezeRecommended) {
      this.freezeRecommended = true;
      this.freezeReason = `thresholds exceeded: ${breaches.join(', ')}`;
      this.telemetry.emit('replay_audit_threshold_breached', { breaches });
      this.telemetry.emit('replay_audit_rollout_freeze_recommended', {
        breaches, reason: this.freezeReason,
      });
    }
  }
}

function safeDiv(num: number, den: number): number {
  if (den <= 0) return 0;
  return num / den;
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let defaultGovernor: ReplayAuditEnforcementGovernor | null = null;

export function getDefaultReplayAuditGovernor(): ReplayAuditEnforcementGovernor {
  if (!defaultGovernor) defaultGovernor = new ReplayAuditEnforcementGovernor();
  return defaultGovernor;
}

export function setDefaultReplayAuditGovernor(g: ReplayAuditEnforcementGovernor | null): void {
  defaultGovernor = g;
}
