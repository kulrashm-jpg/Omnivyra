/**
 * Phase 22E — extended diagnostics events (activation + reclaim).
 */

import {
  recordEvent,
  getDurableDistributedRuntimeSnapshot,
  _resetDurableDistributedRuntimeDiagnostics,
} from '../../../services/orchestration/distributed/durableDistributedRuntimeDiagnostics';

beforeEach(() => { _resetDurableDistributedRuntimeDiagnostics(); });

describe('durableDistributedRuntimeDiagnostics — activation events', () => {
  test('activation_started → succeeded records latency + counter', async () => {
    recordEvent('distributed_runtime_activation_started', {});
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('distributed_runtime_activation_succeeded', { durationMs: 12 });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.runtimeActivationsStarted).toBe(1);
    expect(s.runtimeActivationsSucceeded).toBe(1);
    expect(s.runtimeActivationLatency.count).toBe(1);
  });

  test('activation_failed increments failure counter', () => {
    recordEvent('distributed_runtime_activation_started', {});
    recordEvent('distributed_runtime_activation_failed', {
      failedValidator: 'queue_connectivity', durationMs: 7,
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.runtimeActivationsFailed).toBe(1);
    expect(s.runtimeActivationChain[s.runtimeActivationChain.length - 1].failedValidator).toBe('queue_connectivity');
  });

  test('watchdog timeout counted separately', () => {
    recordEvent('distributed_runtime_activation_started', {});
    recordEvent('distributed_runtime_activation_failed', {
      failedValidator: 'watchdog', durationMs: 5000,
    });
    expect(getDurableDistributedRuntimeSnapshot().activationWatchdogTrips).toBe(1);
  });

  test('validator pass + fail feed startupValidationChain', () => {
    recordEvent('distributed_runtime_activation_validator_passed', {
      name: 'queue_connectivity', detail: 'ok',
    });
    recordEvent('distributed_runtime_activation_validator_failed', {
      name: 'worker_registry_write_capability', detail: 'permission denied',
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.startupValidationChain.length).toBe(2);
    expect(s.startupValidationChain[0].ok).toBe(true);
    expect(s.startupValidationChain[1].ok).toBe(false);
    expect(s.activationValidationFailures).toBe(1);
  });
});

describe('durableDistributedRuntimeDiagnostics — reclaim events', () => {
  test('reclaim_validation_started → succeeded records latency', async () => {
    recordEvent('reclaim_validation_started', { queueEntryId: 'qe', targetWorkerId: 'w' });
    await new Promise((r) => setTimeout(r, 5));
    recordEvent('reclaim_validation_succeeded', { queueEntryId: 'qe', targetWorkerId: 'w' });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.reclaimLatency.count).toBe(1);
  });

  test('reclaim_validation_failed (within_suppression_window) counts suppression', () => {
    recordEvent('reclaim_validation_failed', {
      queueEntryId: 'qe', targetWorkerId: 'w',
      reason: 'reclaim_within_suppression_window',
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.reclaimSuppressionEvents).toBe(1);
    expect(s.reclaimValidationFailures).toBe(1);
  });

  test('reclaim_split_brain_prevented counted separately', () => {
    recordEvent('reclaim_split_brain_prevented', {
      queueEntryId: 'qe', targetWorkerId: 'w',
      reason: 'queue_entry_not_owned_by_target',
    });
    expect(getDurableDistributedRuntimeSnapshot().reclaimSplitBrainPreventions).toBe(1);
  });

  test('queue_replay_reclaim with dead_worker_reclaim → targetedReclaim counter', () => {
    recordEvent('queue_replay_reclaim', {
      reason: 'dead_worker_reclaim',
      workerId: 'w', queueEntryId: 'qe', executionId: 'e',
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.targetedReclaimEvents).toBe(1);
    expect(s.staleWorkerReclaimSuccesses).toBe(1);
    expect(s.reclaimOwnershipChain.length).toBe(1);
    expect(s.reclaimOwnershipChain[0].outcome).toBe('reclaimed');
  });

  test('queue_replay_reclaim with visibility_expired does NOT bump targeted counter', () => {
    recordEvent('queue_replay_reclaim', {
      reason: 'visibility_expired', count: 3,
    });
    const s = getDurableDistributedRuntimeSnapshot();
    expect(s.targetedReclaimEvents).toBe(0);
    expect(s.visibilityReclaimEvents).toBe(3);
  });
});
