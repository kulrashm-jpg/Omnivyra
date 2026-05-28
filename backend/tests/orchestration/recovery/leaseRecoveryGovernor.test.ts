/**
 * Phase 19F — LeaseRecoveryGovernor unit tests.
 */

import {
  createLeaseRecoveryGovernor,
  type LeaseRecoveryTelemetrySink,
} from '../../../services/orchestration/recovery/leaseRecoveryGovernor';
import {
  createInMemoryExecutionStore,
} from '../../../services/threadRuntime/executionStore';
import {
  createExecutionLeaseGovernor,
} from '../../../services/threadRuntime/executionLeaseGovernor';

function sink(): { sink: LeaseRecoveryTelemetrySink; events: Array<{ event: string; payload: Record<string, unknown> }> } {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  return { events, sink: { emit(event, payload) { events.push({ event, payload }); } } };
}

async function seedExec(store: ReturnType<typeof createInMemoryExecutionStore>, id = 'exec_1') {
  await store.createExecution({
    executionId: id,
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
    orchestrationPhase: 'precheck',
    executionStatus: 'pending',
    executionOwner: null, retryCount: 0,
    recoveryState: 'idle',
    startedAt: '2026-05-26T00:00:00.000Z',
    heartbeatAt: null, completedAt: null,
    failureReason: null, replayCheckpointId: null,
  });
}

describe('LeaseRecoveryGovernor — eligibility', () => {
  test('no lease → eligible_no_lease', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.assessRecoveryEligibility({ executionId: 'exec_1' });
    expect(r.eligibility).toBe('eligible_no_lease');
  });

  test('live lease → ineligible_live_lease', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.acquireLease({ executionId: 'exec_1', workerId: 'w', durationMs: 60_000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.assessRecoveryEligibility({ executionId: 'exec_1' });
    expect(r.eligibility).toBe('ineligible_live_lease');
    expect(r.currentOwnerWorkerId).toBe('w');
  });

  test('expired lease → eligible_expired_lease', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.acquireLease({ executionId: 'exec_1', workerId: 'w', durationMs: 50, nowMs: 1000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.assessRecoveryEligibility({ executionId: 'exec_1', nowMs: 2000 });
    expect(r.eligibility).toBe('eligible_expired_lease');
    expect(r.staleAgeMs).toBeGreaterThan(0);
  });

  test('missing execution → ineligible_execution_missing', async () => {
    const store = createInMemoryExecutionStore();
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.assessRecoveryEligibility({ executionId: 'nope' });
    expect(r.eligibility).toBe('ineligible_execution_missing');
  });
});

describe('LeaseRecoveryGovernor — takeover', () => {
  test('takeover against live lease is refused', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.acquireLease({ executionId: 'exec_1', workerId: 'w_orig', durationMs: 60_000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.takeoverForRecovery({ executionId: 'exec_1', workerId: 'w_new' });
    expect(r.action).toBe('takeover_refused');
    expect(r.newLeaseId).toBeNull();
  });

  test('takeover against expired lease succeeds with action took_over', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    await store.acquireLease({ executionId: 'exec_1', workerId: 'w_dead', durationMs: 50, nowMs: 1000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.takeoverForRecovery({ executionId: 'exec_1', workerId: 'w_new', nowMs: 5000 });
    expect(r.action).toBe('took_over');
    expect(r.takeoverWorkerId).toBe('w_new');
    expect(r.newLeaseId).toBeTruthy();
    expect(r.reason).toContain('w_dead');
  });

  test('takeover with no prior lease yields cleaned_expired action', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.takeoverForRecovery({ executionId: 'exec_1', workerId: 'w_first' });
    expect(r.action).toBe('cleaned_expired');
    expect(r.takeoverWorkerId).toBe('w_first');
  });

  test('takeover on missing execution returns action=failed', async () => {
    const store = createInMemoryExecutionStore();
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.takeoverForRecovery({ executionId: 'nope', workerId: 'w' });
    expect(r.action).toBe('failed');
  });
});

describe('LeaseRecoveryGovernor — sweep + release', () => {
  test('sweep releases expired leases', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store, 'exec_a');
    await seedExec(store, 'exec_b');
    await store.acquireLease({ executionId: 'exec_a', workerId: 'wa', durationMs: 50, nowMs: 1000 });
    await store.acquireLease({ executionId: 'exec_b', workerId: 'wb', durationMs: 100_000, nowMs: 1000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    const r = await g.sweepExpiredLeases({ nowMs: 5000 });
    expect(r.releasedLeaseIds.length).toBeGreaterThanOrEqual(1);
  });

  test('releaseLease releases a specific lease id', async () => {
    const store = createInMemoryExecutionStore();
    await seedExec(store);
    const lease = await store.acquireLease({ executionId: 'exec_1', workerId: 'w', durationMs: 60_000 });
    const leaseGovernor = createExecutionLeaseGovernor({ store });
    const g = createLeaseRecoveryGovernor({ store, leaseGovernor, telemetry: sink().sink });
    await g.releaseLease(lease!.leaseId);
    const cur = await store.currentLease('exec_1');
    expect(cur?.released ?? true).toBe(true);
  });
});
