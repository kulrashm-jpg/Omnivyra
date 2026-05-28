/**
 * Phase 27B.8 — Production Rollback Governor.
 *
 * Trigger-rules engine for automatic rollback recommendations. Sits
 * ABOVE the replay audit governor (which produces metric breaches) and
 * the rollout governor (which applies stage transitions). The rollback
 * governor watches for ANY of:
 *
 *   - adapter_duplicate_detected > 0
 *   - enqueue_overlap_ratio > 1%
 *   - long_form_collision_rate > 0
 *   - replay divergence spike (replay-audit threshold breach count)
 *   - irreversible mutation anomaly (publish gate UPDATE_LOST events)
 *
 * When ANY trigger fires the governor:
 *   - recommends a rollback,
 *   - freezes the rollout promotion,
 *   - force-downgrades to `publish_disabled` (if not already lower),
 *   - emits a critical alert.
 *
 * GUARANTEE:
 *   The governor NEVER auto-deletes or mutates runtime history. It
 *   only:
 *     - reads metric signals
 *     - calls rolloutGovernor.freeze(...)
 *     - calls rolloutGovernor.applyTransition('publish_disabled')
 *     - emits alerts
 *
 * SCOPE: read + decision + emit. No persistence side-effects.
 */

import type { ReplayAuditEnforcementGovernor } from './replayAuditEnforcementGovernor';
import type {
  ProductionRolloutStage,
  ProductionRuntimeRolloutGovernor,
} from './productionRuntimeRolloutGovernor';

// ────────────────────────────────────────────────────────────────────
// Trigger taxonomy
// ────────────────────────────────────────────────────────────────────

export type RollbackTriggerKind =
  | 'adapter_duplicate_detected'
  | 'enqueue_overlap_ratio'
  | 'long_form_collision_rate'
  | 'replay_divergence_spike'
  | 'irreversible_mutation_anomaly';

export interface RollbackTrigger {
  kind: RollbackTriggerKind;
  detail: string;
  observedValue?: number;
  threshold?: number;
}

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type RollbackGovernorTelemetryEvent =
  | 'rollback_trigger_detected'
  | 'rollback_recommended'
  | 'rollback_freeze_applied'
  | 'rollback_force_downgrade_applied'
  | 'rollback_critical_alert';

export interface RollbackGovernorTelemetrySink {
  emit(event: RollbackGovernorTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: RollbackGovernorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      console.warn(`[rollback_governor] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Governor
// ────────────────────────────────────────────────────────────────────

export interface ProductionRollbackGovernorOpts {
  rolloutGovernor: ProductionRuntimeRolloutGovernor;
  replayAuditGovernor: ReplayAuditEnforcementGovernor;
  telemetry?: RollbackGovernorTelemetrySink;
  /** Threshold for replay divergence spike (count). Default 1. */
  replayDivergenceSpikeThreshold?: number;
  /**
   * When true, the governor applies the downgrade immediately on
   * trigger. When false (the default), it only recommends — operators
   * apply via separate playbook. Tests can set true to verify the
   * downgrade path.
   */
  autoApplyDowngrade?: boolean;
}

export class ProductionRollbackGovernor {
  private readonly rolloutGovernor: ProductionRuntimeRolloutGovernor;
  private readonly replayAuditGovernor: ReplayAuditEnforcementGovernor;
  private readonly telemetry: RollbackGovernorTelemetrySink;
  private readonly replayDivergenceSpikeThreshold: number;
  private readonly autoApplyDowngrade: boolean;
  private irreversibleAnomalyCount = 0;
  private replayDivergenceCount = 0;
  private readonly triggers: RollbackTrigger[] = [];

  constructor(opts: ProductionRollbackGovernorOpts) {
    this.rolloutGovernor = opts.rolloutGovernor;
    this.replayAuditGovernor = opts.replayAuditGovernor;
    this.telemetry = opts.telemetry ?? defaultTelemetrySink;
    this.replayDivergenceSpikeThreshold = opts.replayDivergenceSpikeThreshold ?? 1;
    this.autoApplyDowngrade = opts.autoApplyDowngrade ?? false;
  }

  /**
   * Signal an irreversible mutation anomaly — publish-gate UPDATE_LOST,
   * platform_post_id overwrite, etc.
   */
  recordIrreversibleAnomaly(detail: string): void {
    this.irreversibleAnomalyCount += 1;
    this.evaluateAndAct({
      kind: 'irreversible_mutation_anomaly',
      detail,
      observedValue: this.irreversibleAnomalyCount,
      threshold: 0,
    });
  }

  /**
   * Signal a replay divergence spike — e.g. forensic analyzer cross-run
   * comparison flagged the same domain key across multiple runs.
   */
  recordReplayDivergenceSpike(detail: string): void {
    this.replayDivergenceCount += 1;
    if (this.replayDivergenceCount >= this.replayDivergenceSpikeThreshold) {
      this.evaluateAndAct({
        kind: 'replay_divergence_spike',
        detail,
        observedValue: this.replayDivergenceCount,
        threshold: this.replayDivergenceSpikeThreshold,
      });
    }
  }

  /**
   * Evaluate the replay audit governor for breach-based triggers. Call
   * periodically (or after recording a metric) to fold the audit
   * signals into the rollback decision.
   */
  evaluateAuditSignals(): { triggered: boolean; triggers: RollbackTrigger[] } {
    const snap = this.replayAuditGovernor.snapshot();
    const fired: RollbackTrigger[] = [];

    if (snap.adapter_duplicate_detected > 0) {
      fired.push({
        kind: 'adapter_duplicate_detected',
        detail: `${snap.adapter_duplicate_detected} adapter duplicate(s) detected`,
        observedValue: snap.adapter_duplicate_detected,
        threshold: 0,
      });
    }
    if (snap.enqueue_overlap_ratio > 0.01) {
      fired.push({
        kind: 'enqueue_overlap_ratio',
        detail: `enqueue overlap ratio ${snap.enqueue_overlap_ratio.toFixed(4)} exceeds 0.01`,
        observedValue: snap.enqueue_overlap_ratio,
        threshold: 0.01,
      });
    }
    if (snap.long_form_collision_rate > 0) {
      fired.push({
        kind: 'long_form_collision_rate',
        detail: `long-form collision rate ${snap.long_form_collision_rate.toFixed(4)} > 0`,
        observedValue: snap.long_form_collision_rate,
        threshold: 0,
      });
    }
    for (const trig of fired) {
      this.evaluateAndAct(trig);
    }
    return { triggered: fired.length > 0, triggers: fired };
  }

  /**
   * Read the current rollback recommendation state.
   */
  snapshot(): {
    triggersFired: RollbackTrigger[];
    rollbackRecommended: boolean;
    suggestedAction: 'freeze' | 'downgrade' | 'none';
    currentStage: ProductionRolloutStage;
    rolloutFrozen: boolean;
  } {
    const recommended = this.triggers.length > 0;
    const includesIrreversible = this.triggers.some(
      (t) =>
        t.kind === 'irreversible_mutation_anomaly' ||
        t.kind === 'adapter_duplicate_detected' ||
        t.kind === 'long_form_collision_rate',
    );
    const suggestedAction: 'freeze' | 'downgrade' | 'none' = recommended
      ? includesIrreversible
        ? 'downgrade'
        : 'freeze'
      : 'none';
    return {
      triggersFired: this.triggers.slice(),
      rollbackRecommended: recommended,
      suggestedAction,
      currentStage: this.rolloutGovernor.getStage(),
      rolloutFrozen: this.rolloutGovernor.isFrozen().frozen,
    };
  }

  /** Test-only reset. */
  reset(): void {
    this.irreversibleAnomalyCount = 0;
    this.replayDivergenceCount = 0;
    this.triggers.length = 0;
  }

  // ── Internals ──

  private evaluateAndAct(trigger: RollbackTrigger): void {
    this.triggers.push(trigger);
    this.telemetry.emit('rollback_trigger_detected', { ...trigger });

    // Apply freeze on first trigger of any kind.
    if (this.triggers.length === 1) {
      this.rolloutGovernor.freeze(`rollback trigger: ${trigger.kind} — ${trigger.detail}`);
      this.telemetry.emit('rollback_freeze_applied', { trigger });
    }

    // Critical alert for the trigger.
    this.telemetry.emit('rollback_critical_alert', {
      severity: 'critical',
      kind: trigger.kind,
      detail: trigger.detail,
    });
    this.telemetry.emit('rollback_recommended', { trigger });

    // Force-downgrade for zero-tolerance triggers (irreversible + adapter
    // dup + long-form collision). Skip if already at publish_disabled or
    // lower, and only when autoApplyDowngrade is enabled.
    const zeroToleranceKinds: RollbackTriggerKind[] = [
      'irreversible_mutation_anomaly',
      'adapter_duplicate_detected',
      'long_form_collision_rate',
    ];
    if (this.autoApplyDowngrade && zeroToleranceKinds.includes(trigger.kind)) {
      const target: ProductionRolloutStage = 'publish_disabled';
      const verdict = this.rolloutGovernor.validateTransition(target);
      // Only force-apply a downgrade (not a no-op forward attempt).
      if (verdict.allowed && verdict.direction === 'downgrade') {
        try {
          this.rolloutGovernor.applyTransition(target);
          this.telemetry.emit('rollback_force_downgrade_applied', {
            trigger, target,
          });
        } catch (err) {
          this.telemetry.emit('rollback_force_downgrade_applied', {
            trigger, target, failed: true,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }
    }
  }
}
