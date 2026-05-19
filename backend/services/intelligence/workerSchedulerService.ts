/**
 * Autonomous worker scheduler coordination layer.
 *
 * Drives the existing atomic-leased `runOrchestratedWorkers` on a tick basis
 * with cross-instance cooldown + failure escalation telemetry. It does NOT
 * auto-register into the stable scheduler/cron (no refactor of stable
 * systems) — an external scheduler/cron (or the tick endpoint) invokes
 * `runSchedulerTick`. Distributed-safe (atomic lease inside
 * runOrchestratedWorkers + durable cooldown), idempotent, append-only
 * escalation lineage, rollback-safe (delegates to idempotent workers only).
 */
import { durableCooldownRemainingMs, recordOrchestrationEvent, newCorrelationId } from './durableOrchestrationStore';
import { runOrchestratedWorkers } from './workerOrchestrationService';
import { recordEscalationFailure, recordEscalationReset } from './escalationCoordinationService';
import { captureMaturitySnapshot, shouldCaptureSnapshot } from './maturitySnapshotService';

const TICK_COOLDOWN_MS = 2 * 60_000;
const ESCALATION_SCOPE = 'worker_scheduler';

export interface SchedulerTickResult {
  companyId: string;
  ranAt: string;
  status: 'ran' | 'cooldown' | 'lease_held';
  workersRun: number;
  failures: number;
  escalated: boolean;
  detail: string;
}

export async function runSchedulerTick(args: {
  companyId: string;
  actorUserId?: string | null;
  force?: boolean;
}): Promise<SchedulerTickResult> {
  const { companyId } = args;
  const correlationId = newCorrelationId();

  if (!args.force) {
    const remaining = await durableCooldownRemainingMs(companyId, 'self_heal_sweep', TICK_COOLDOWN_MS).catch(() => 0);
    if (remaining > 0) {
      return { companyId, ranAt: new Date().toISOString(), status: 'cooldown', workersRun: 0, failures: 0, escalated: false, detail: `cooldown ${Math.ceil(remaining / 1000)}s` };
    }
  }

  const result = await runOrchestratedWorkers({ companyId, actorUserId: args.actorUserId ?? null });
  if (!result.acquired) {
    return { companyId, ranAt: new Date().toISOString(), status: 'lease_held', workersRun: 0, failures: 0, escalated: false, detail: 'another instance holds the worker lease' };
  }

  const failures = result.outcomes.filter((o) => !o.ran).length;
  const ranCount = result.outcomes.filter((o) => o.ran).length;

  // Durable, distributed escalation chain (audit-substrate; survives restarts
  // & is consistent across instances). Decay/reset handled in the service.
  let escalated = false;
  if (failures > 0) {
    const state = await recordEscalationFailure(companyId, ESCALATION_SCOPE, {
      failedTick: true,
      outcomes: result.outcomes,
    });
    escalated = state.escalated;
  } else {
    await recordEscalationReset(companyId, ESCALATION_SCOPE).catch(() => undefined);
  }

  // Continuous maturity history: capture at most once per 6h (cooldown-gated
  // → no per-tick / per-request amplification), keeping the timeline
  // continuous without write storms.
  try {
    if (await shouldCaptureSnapshot(companyId)) {
      await captureMaturitySnapshot(companyId);
    }
  } catch {
    /* maturity capture is best-effort; never blocks the tick */
  }

  await recordOrchestrationEvent({
    companyId,
    kind: 'self_heal_sweep',
    correlationId,
    actorType: 'worker',
    detail: { scheduler: true, workersRun: ranCount, failures, escalated, outcomes: result.outcomes },
  }).catch(() => undefined);

  return {
    companyId,
    ranAt: new Date().toISOString(),
    status: 'ran',
    workersRun: ranCount,
    failures,
    escalated,
    detail: `ran ${ranCount} worker(s), ${failures} failure(s)${escalated ? ' — ESCALATED' : ''}`,
  };
}
