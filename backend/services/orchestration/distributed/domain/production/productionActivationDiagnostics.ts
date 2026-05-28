/**
 * Phase 27B.7 — Production Activation Diagnostics.
 *
 * Passive aggregator dedicated to Phase 27B activation signals. Sits
 * ALONGSIDE Phase 21H durableDistributedRuntimeDiagnostics (which it
 * does NOT mutate) and the Phase 22 forensic analyzer.
 *
 * TRACKS:
 *   - runtime_publish_gate_latency
 *   - duplicate publish suppressions
 *   - rollout stage transitions
 *   - provider activation changes
 *   - long-form operation collisions
 *   - replay-audit freezes
 *   - rollback-trigger frequency
 *
 * FORENSIC TIMELINES:
 *   - publish gate chain
 *   - rollout-stage chain
 *   - provider activation chain
 *   - long-form operation chain
 *
 * SCOPE: pure in-process aggregation. Bounded memory (SAMPLE_CAP=256,
 * TIMELINE_CAP=64). Snapshot consumed by /api endpoints + stress
 * harnesses + the CI activation gates.
 */

// ────────────────────────────────────────────────────────────────────
// Sample-list helpers (matches Phase 21H shape)
// ────────────────────────────────────────────────────────────────────

const SAMPLE_CAP = 256;
const TIMELINE_CAP = 64;

interface SampleList {
  samples: number[];
  lastMs: number | null;
}
function newSampleList(): SampleList { return { samples: [], lastMs: null }; }
function recordSample(list: SampleList, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  list.samples.push(ms);
  if (list.samples.length > SAMPLE_CAP) list.samples.shift();
  list.lastMs = ms;
}

export interface LatencyBucket {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}
function summarize(list: SampleList): LatencyBucket {
  if (list.samples.length === 0) return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const sorted = [...list.samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: list.samples.length, lastMs: list.lastMs,
    p50Ms: p(0.5), p95Ms: p(0.95), maxMs: sorted[sorted.length - 1],
  };
}

// ────────────────────────────────────────────────────────────────────
// Timeline helpers
// ────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  atIso: string;
  event: string;
  payload: Record<string, unknown>;
}

function pushTimeline(list: TimelineEvent[], event: string, payload: Record<string, unknown>): void {
  list.push({ atIso: new Date().toISOString(), event, payload });
  if (list.length > TIMELINE_CAP) list.shift();
}

// ────────────────────────────────────────────────────────────────────
// Snapshot
// ────────────────────────────────────────────────────────────────────

export interface ProductionActivationSnapshot {
  snapshotAtIso: string;
  publishGate: {
    latency: LatencyBucket;
    callsTotal: number;
    duplicateSuppressions: number;
    adapterCalls: number;
    failures: number;
  };
  rolloutStage: {
    transitionsForward: number;
    transitionsDowngrade: number;
    freezesRecommended: number;
    currentStage: string | null;
  };
  providerActivation: {
    allowed: number;
    refused: number;
    hardBlocked: number;
  };
  longFormOperation: {
    won: number;
    duplicate: number;
    collisions: number;
  };
  replayAudit: {
    freezesRecommended: number;
    promotionsBlocked: number;
    thresholdBreaches: number;
  };
  rollback: {
    triggered: number;
    recommended: number;
  };
  timelines: {
    publishGate: TimelineEvent[];
    rolloutStage: TimelineEvent[];
    providerActivation: TimelineEvent[];
    longFormOperation: TimelineEvent[];
  };
}

// ────────────────────────────────────────────────────────────────────
// Aggregator
// ────────────────────────────────────────────────────────────────────

class ProductionActivationDiagnostics {
  private publishGateLatency = newSampleList();
  private publishGateCallsTotal = 0;
  private publishGateDuplicates = 0;
  private publishGateAdapterCalls = 0;
  private publishGateFailures = 0;

  private rolloutTransitionsForward = 0;
  private rolloutTransitionsDowngrade = 0;
  private rolloutFreezesRecommended = 0;
  private currentRolloutStage: string | null = null;

  private providerAllowed = 0;
  private providerRefused = 0;
  private providerHardBlocked = 0;

  private longFormWon = 0;
  private longFormDuplicate = 0;
  private longFormCollisions = 0;

  private replayAuditFreezes = 0;
  private replayAuditPromotionsBlocked = 0;
  private replayAuditThresholdBreaches = 0;

  private rollbackTriggered = 0;
  private rollbackRecommended = 0;

  private publishGateTimeline: TimelineEvent[] = [];
  private rolloutStageTimeline: TimelineEvent[] = [];
  private providerActivationTimeline: TimelineEvent[] = [];
  private longFormOperationTimeline: TimelineEvent[] = [];

  // ── Publish gate signals ──
  recordPublishGate(event: string, payload: Record<string, unknown> & { latencyMs?: number }): void {
    pushTimeline(this.publishGateTimeline, event, payload);
    switch (event) {
      case 'runtime_publish_gate_started':
        this.publishGateCallsTotal += 1;
        break;
      case 'runtime_publish_gate_duplicate_suppressed':
        this.publishGateDuplicates += 1;
        break;
      case 'runtime_publish_gate_adapter_called':
        this.publishGateAdapterCalls += 1;
        break;
      case 'runtime_publish_gate_completed':
        if (typeof payload.latencyMs === 'number') {
          recordSample(this.publishGateLatency, payload.latencyMs);
        }
        break;
      case 'runtime_publish_gate_failed':
        this.publishGateFailures += 1;
        break;
    }
  }

  // ── Rollout stage signals ──
  recordRolloutStage(event: string, payload: Record<string, unknown>): void {
    pushTimeline(this.rolloutStageTimeline, event, payload);
    switch (event) {
      case 'rollout_stage_set':
        if (typeof payload.stage === 'string') this.currentRolloutStage = payload.stage;
        break;
      case 'rollout_stage_transition_allowed':
        this.rolloutTransitionsForward += 1;
        if (typeof payload.toStage === 'string') this.currentRolloutStage = payload.toStage;
        break;
      case 'rollout_stage_downgrade':
        this.rolloutTransitionsDowngrade += 1;
        if (typeof payload.toStage === 'string') this.currentRolloutStage = payload.toStage;
        break;
      case 'rollout_stage_freeze_recommended':
        this.rolloutFreezesRecommended += 1;
        break;
    }
  }

  // ── Provider activation signals ──
  recordProviderActivation(event: string, payload: Record<string, unknown>): void {
    pushTimeline(this.providerActivationTimeline, event, payload);
    switch (event) {
      case 'provider_activation_allowed':
      case 'domain_activation_allowed':
        this.providerAllowed += 1;
        break;
      case 'provider_activation_refused':
      case 'domain_activation_refused':
        this.providerRefused += 1;
        break;
      case 'provider_activation_hard_blocked':
        this.providerHardBlocked += 1;
        break;
    }
  }

  // ── Long-form operation signals ──
  recordLongFormOperation(event: string, payload: Record<string, unknown>): void {
    pushTimeline(this.longFormOperationTimeline, event, payload);
    switch (event) {
      case 'long_form_claim_won':
        this.longFormWon += 1;
        break;
      case 'long_form_claim_lost_duplicate':
        this.longFormDuplicate += 1;
        break;
      case 'long_form_claim_collision_detected':
        this.longFormCollisions += 1;
        break;
    }
  }

  // ── Replay audit signals ──
  recordReplayAudit(event: string, _payload: Record<string, unknown>): void {
    switch (event) {
      case 'replay_audit_rollout_freeze_recommended':
        this.replayAuditFreezes += 1;
        break;
      case 'replay_audit_promotion_blocked':
        this.replayAuditPromotionsBlocked += 1;
        break;
      case 'replay_audit_threshold_breached':
        this.replayAuditThresholdBreaches += 1;
        break;
    }
  }

  // ── Rollback signals ──
  recordRollbackTriggered(): void { this.rollbackTriggered += 1; }
  recordRollbackRecommended(): void { this.rollbackRecommended += 1; }

  // ── Snapshot ──
  snapshot(): ProductionActivationSnapshot {
    return {
      snapshotAtIso: new Date().toISOString(),
      publishGate: {
        latency: summarize(this.publishGateLatency),
        callsTotal: this.publishGateCallsTotal,
        duplicateSuppressions: this.publishGateDuplicates,
        adapterCalls: this.publishGateAdapterCalls,
        failures: this.publishGateFailures,
      },
      rolloutStage: {
        transitionsForward: this.rolloutTransitionsForward,
        transitionsDowngrade: this.rolloutTransitionsDowngrade,
        freezesRecommended: this.rolloutFreezesRecommended,
        currentStage: this.currentRolloutStage,
      },
      providerActivation: {
        allowed: this.providerAllowed,
        refused: this.providerRefused,
        hardBlocked: this.providerHardBlocked,
      },
      longFormOperation: {
        won: this.longFormWon,
        duplicate: this.longFormDuplicate,
        collisions: this.longFormCollisions,
      },
      replayAudit: {
        freezesRecommended: this.replayAuditFreezes,
        promotionsBlocked: this.replayAuditPromotionsBlocked,
        thresholdBreaches: this.replayAuditThresholdBreaches,
      },
      rollback: {
        triggered: this.rollbackTriggered,
        recommended: this.rollbackRecommended,
      },
      timelines: {
        publishGate: this.publishGateTimeline.slice(),
        rolloutStage: this.rolloutStageTimeline.slice(),
        providerActivation: this.providerActivationTimeline.slice(),
        longFormOperation: this.longFormOperationTimeline.slice(),
      },
    };
  }

  /** Test-only: reset everything. */
  reset(): void {
    this.publishGateLatency = newSampleList();
    this.publishGateCallsTotal = 0;
    this.publishGateDuplicates = 0;
    this.publishGateAdapterCalls = 0;
    this.publishGateFailures = 0;
    this.rolloutTransitionsForward = 0;
    this.rolloutTransitionsDowngrade = 0;
    this.rolloutFreezesRecommended = 0;
    this.currentRolloutStage = null;
    this.providerAllowed = 0;
    this.providerRefused = 0;
    this.providerHardBlocked = 0;
    this.longFormWon = 0;
    this.longFormDuplicate = 0;
    this.longFormCollisions = 0;
    this.replayAuditFreezes = 0;
    this.replayAuditPromotionsBlocked = 0;
    this.replayAuditThresholdBreaches = 0;
    this.rollbackTriggered = 0;
    this.rollbackRecommended = 0;
    this.publishGateTimeline = [];
    this.rolloutStageTimeline = [];
    this.providerActivationTimeline = [];
    this.longFormOperationTimeline = [];
  }
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let defaultDiagnostics: ProductionActivationDiagnostics | null = null;

export function getDefaultProductionActivationDiagnostics(): ProductionActivationDiagnostics {
  if (!defaultDiagnostics) defaultDiagnostics = new ProductionActivationDiagnostics();
  return defaultDiagnostics;
}

export function setDefaultProductionActivationDiagnostics(
  d: ProductionActivationDiagnostics | null,
): void {
  defaultDiagnostics = d;
}

export { ProductionActivationDiagnostics };
