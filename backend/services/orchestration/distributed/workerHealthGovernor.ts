/**
 * Phase 20G — WorkerHealthGovernor
 *
 * Periodic per-worker health assessment. Composes:
 *   - DistributedWorkerCoordinator  (registry + heartbeat data)
 *   - Recent recovery success/failure trends (caller-supplied)
 *
 * CAPABILITIES (per spec):
 *   - worker quarantine
 *   - execution draining
 *   - degraded-mode signaling
 *   - unhealthy worker suppression
 *
 * DETECTION (per spec):
 *   - stale workers                    → flag 'stale_heartbeat'
 *   - heartbeat drift                  → flag 'heartbeat_drift'
 *   - execution starvation             → flag 'execution_starvation'
 *   - worker overload                  → flag 'worker_overload'
 *   - repeated recovery failures       → flag 'repeated_recovery_failures'
 *   - unhealthy reclaim frequency      → flag 'unhealthy_reclaim_frequency'
 *
 * Each finding gets a health score (0..100) and a recommended action
 * (no_action | quarantine | drain | mark_offline).
 *
 * SCOPE: assessment + recommendation. Apply step is opt-in via apply().
 * The governor does NOT autonomously kill workers; it surfaces findings
 * and the caller decides.
 */

import {
  getDefaultDistributedWorkerCoordinator,
  type DistributedWorkerCoordinator,
} from './distributedWorkerCoordinator';
import type {
  WorkerHealthFinding,
  WorkerHealthFlag,
  WorkerRecord,
} from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type WorkerHealthTelemetryEvent =
  | 'worker_health_assessed'
  | 'worker_quarantined'
  | 'worker_drain_recommended'
  | 'worker_offline_recommended';

export interface WorkerHealthTelemetrySink {
  emit(event: WorkerHealthTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: WorkerHealthTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'worker_quarantined' || event === 'worker_offline_recommended') {
        console.warn(`[worker_health] ${line}`);
      } else {
        console.log(`[worker_health] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Input data from callers
// ────────────────────────────────────────────────────────────────────

export interface WorkerRecoverySignal {
  workerId: string;
  /** Recoveries this worker attempted in the recent window. */
  recoveryAttempts: number;
  /** Recoveries that failed in the recent window. */
  recoveryFailures: number;
  /** Reclaims (took over from another worker). */
  reclaims: number;
  /** ISO of the window start. */
  windowStartIso: string;
}

export interface AssessAllInput {
  /** Optional per-worker recovery signals (provided by the diagnostics aggregator). */
  recoverySignals?: WorkerRecoverySignal[];
  nowMs?: number;
  /** Stale heartbeat threshold (ms). Default 90_000. */
  heartbeatStaleMs?: number;
  /** Maximum active executions before flagging overload. Default 32. */
  overloadActiveThreshold?: number;
  /** Min recoveries before "repeated failures" applies. Default 5. */
  recoveryFailureMinSample?: number;
  /** Failure ratio threshold (0..1). Default 0.5. */
  recoveryFailureRatio?: number;
  /** Reclaim count threshold per window. Default 10. */
  unhealthyReclaimThreshold?: number;
}

// ────────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────────

export interface WorkerHealthGovernor {
  assessAll(input?: AssessAllInput): Promise<WorkerHealthFinding[]>;
  assess(input: { workerId: string; recoverySignal?: WorkerRecoverySignal; nowMs?: number; opts?: AssessAllInput }): Promise<WorkerHealthFinding | null>;
  /** Apply the recommended action. Idempotent. */
  apply(finding: WorkerHealthFinding): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface WorkerHealthGovernorOptions {
  workerCoordinator?: DistributedWorkerCoordinator;
  telemetry?: WorkerHealthTelemetrySink;
}

function clamp100(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

export function createWorkerHealthGovernor(options?: WorkerHealthGovernorOptions): WorkerHealthGovernor {
  const workerCoord = options?.workerCoordinator ?? getDefaultDistributedWorkerCoordinator();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;

  function buildFinding(args: {
    rec: WorkerRecord;
    signal?: WorkerRecoverySignal;
    nowMs: number;
    opts: Required<Omit<AssessAllInput, 'recoverySignals' | 'nowMs'>>;
  }): WorkerHealthFinding {
    const { rec, signal, nowMs, opts } = args;
    const flags: WorkerHealthFlag[] = [];
    const notes: string[] = [];
    let score = 100;

    const lastHeartbeatIso = rec.heartbeatAtIso;
    const staleAgeMs = lastHeartbeatIso
      ? Math.max(0, nowMs - Date.parse(lastHeartbeatIso))
      : Number.POSITIVE_INFINITY;

    // 1. Stale heartbeat / drift.
    if (rec.status === 'stale' || (lastHeartbeatIso && staleAgeMs > opts.heartbeatStaleMs)) {
      flags.push('stale_heartbeat');
      score -= 35;
      notes.push(`stale heartbeat (age ${staleAgeMs}ms > ${opts.heartbeatStaleMs})`);
    } else if (lastHeartbeatIso && staleAgeMs > opts.heartbeatStaleMs / 2) {
      flags.push('heartbeat_drift');
      score -= 12;
      notes.push(`heartbeat drift (age ${staleAgeMs}ms approaching ${opts.heartbeatStaleMs})`);
    }

    // 2. Overload.
    if (rec.activeExecutionCount >= opts.overloadActiveThreshold) {
      flags.push('worker_overload');
      score -= 20;
      notes.push(`active=${rec.activeExecutionCount} >= ${opts.overloadActiveThreshold}`);
    }

    // 3. Execution starvation: worker is active but has zero active executions
    //    AND no recovery work in the window. Mildly suspicious — but only worth
    //    flagging if there are recovery signals available.
    if (signal && signal.recoveryAttempts === 0 && rec.activeExecutionCount === 0 &&
        rec.status === 'active' && rec.recoveryLoad === 0) {
      flags.push('execution_starvation');
      score -= 5;
      notes.push('no active or recovery work in window');
    }

    // 4. Repeated recovery failures.
    if (signal && signal.recoveryAttempts >= opts.recoveryFailureMinSample) {
      const ratio = signal.recoveryFailures / signal.recoveryAttempts;
      if (ratio >= opts.recoveryFailureRatio) {
        flags.push('repeated_recovery_failures');
        score -= 30;
        notes.push(`failure ratio ${ratio.toFixed(2)} >= ${opts.recoveryFailureRatio} over ${signal.recoveryAttempts} attempts`);
      }
    }

    // 5. Unhealthy reclaim frequency.
    if (signal && signal.reclaims >= opts.unhealthyReclaimThreshold) {
      flags.push('unhealthy_reclaim_frequency');
      score -= 15;
      notes.push(`reclaims=${signal.reclaims} >= ${opts.unhealthyReclaimThreshold}`);
    }

    // Determine recommended action.
    let recommended: WorkerHealthFinding['recommendedAction'] = 'no_action';
    if (flags.includes('stale_heartbeat')) recommended = 'mark_offline';
    else if (flags.includes('repeated_recovery_failures') || flags.includes('unhealthy_reclaim_frequency')) {
      recommended = 'quarantine';
    } else if (flags.includes('worker_overload')) {
      recommended = 'drain';
    }

    return {
      workerId: rec.workerId,
      workerStatus: rec.status,
      flags,
      healthScore: clamp100(score),
      lastHeartbeatIso,
      staleAgeMs: Number.isFinite(staleAgeMs) ? staleAgeMs : 0,
      activeExecutions: rec.activeExecutionCount,
      recommendedAction: recommended,
      notes,
    };
  }

  return {
    async assessAll(input) {
      const nowMs = input?.nowMs ?? Date.now();
      const opts = {
        heartbeatStaleMs: input?.heartbeatStaleMs ?? 90_000,
        overloadActiveThreshold: input?.overloadActiveThreshold ?? 32,
        recoveryFailureMinSample: input?.recoveryFailureMinSample ?? 5,
        recoveryFailureRatio: input?.recoveryFailureRatio ?? 0.5,
        unhealthyReclaimThreshold: input?.unhealthyReclaimThreshold ?? 10,
      };
      const workers = await workerCoord.list();
      const signalsById = new Map<string, WorkerRecoverySignal>();
      for (const s of input?.recoverySignals ?? []) signalsById.set(s.workerId, s);
      const findings: WorkerHealthFinding[] = [];
      for (const rec of workers) {
        if (rec.status === 'offline') continue;
        const signal = signalsById.get(rec.workerId);
        const finding = buildFinding({ rec, signal, nowMs, opts });
        findings.push(finding);
        telemetry.emit('worker_health_assessed', {
          workerId: rec.workerId,
          healthScore: finding.healthScore,
          flags: finding.flags,
          recommendedAction: finding.recommendedAction,
        });
      }
      return findings;
    },

    async assess({ workerId, recoverySignal, nowMs, opts }) {
      const rec = await workerCoord.get(workerId);
      if (!rec || rec.status === 'offline') return null;
      const all = await this.assessAll({
        recoverySignals: recoverySignal ? [recoverySignal] : undefined,
        nowMs, ...opts,
      });
      return all.find((f) => f.workerId === workerId) ?? null;
    },

    async apply(finding) {
      switch (finding.recommendedAction) {
        case 'no_action':
          return;
        case 'quarantine':
          // Quarantine = drain + suppress new claims (drain is the closest builtin).
          await workerCoord.drain(finding.workerId);
          telemetry.emit('worker_quarantined', {
            workerId: finding.workerId, flags: finding.flags,
            score: finding.healthScore,
          });
          return;
        case 'drain':
          await workerCoord.drain(finding.workerId);
          telemetry.emit('worker_drain_recommended', {
            workerId: finding.workerId, score: finding.healthScore,
            activeExecutions: finding.activeExecutions,
          });
          return;
        case 'mark_offline':
          await workerCoord.offline(finding.workerId);
          telemetry.emit('worker_offline_recommended', {
            workerId: finding.workerId, score: finding.healthScore,
            flags: finding.flags,
          });
          return;
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: WorkerHealthGovernor | null = null;
export function getDefaultWorkerHealthGovernor(): WorkerHealthGovernor {
  if (!_default) _default = createWorkerHealthGovernor();
  return _default;
}
export function setDefaultWorkerHealthGovernor(g: WorkerHealthGovernor): void {
  _default = g;
}
