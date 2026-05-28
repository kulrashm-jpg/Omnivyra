/**
 * Phase 8 — Distributed execution adapter.
 *
 * Abstracts the worker-coordination concerns so the orchestration logic
 * can run unchanged across:
 *   - in-process workers (default)
 *   - BullMQ workers
 *   - future Temporal / Trigger.dev / cloud-queue workers
 *
 * The adapter is intentionally minimal:
 *   - `claimNext()`: claim the next ready-to-run execution for this worker.
 *   - `submit()`: enqueue work for some worker to claim.
 *   - `shutdown()`: release any held leases.
 *
 * Two implementations ship: an in-process adapter (default) that uses the
 * existing ExecutionStore + LeaseGovernor, and a stub for future
 * distributed queue backends.
 */

import type {
  ExecutionRecord,
  OrchestrationPhase,
} from './threadRuntimeTypes';
import {
  getDefaultDurableExecutionCoordinator,
  type DurableExecutionCoordinator,
} from './durableExecutionCoordinator';
import {
  getDefaultExecutionLeaseGovernor,
  type ExecutionLeaseGovernor,
} from './executionLeaseGovernor';
import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from './executionStore';

export interface ClaimedWork {
  execution: ExecutionRecord;
  leaseId: string;
}

export interface DistributedExecutionAdapter {
  /** Submit a new execution to whatever queue this adapter fronts. */
  submit(input: {
    runtimeSessionId: string;
    threadId: string;
    companyId: string;
    phase?: OrchestrationPhase;
  }): Promise<ExecutionRecord>;
  /** Claim the next ready-to-run execution for this worker. Returns null
   *  if nothing is ready. */
  claimNext(input: { workerId: string; leaseDurationMs?: number; companyIdFilter?: string }): Promise<ClaimedWork | null>;
  /** Release a held lease (signals "worker done with this execution"). */
  release(leaseId: string): Promise<void>;
  /** Best-effort shutdown: release everything this worker holds. */
  shutdown(workerId: string): Promise<{ released: number }>;
}

export interface InProcessAdapterOptions {
  coordinator?: DurableExecutionCoordinator;
  leaseGovernor?: ExecutionLeaseGovernor;
  store?: ExecutionStore;
  defaultLeaseDurationMs?: number;
}

export function createInProcessExecutionAdapter(options?: InProcessAdapterOptions): DistributedExecutionAdapter {
  const coordinator = options?.coordinator ?? getDefaultDurableExecutionCoordinator();
  const leaseGovernor = options?.leaseGovernor ?? getDefaultExecutionLeaseGovernor();
  const store = options?.store ?? getDefaultExecutionStore();
  const leaseDur = options?.defaultLeaseDurationMs ?? 60_000;

  // Per-worker → set of held leases.
  const heldLeases = new Map<string, Set<string>>();
  function track(workerId: string, leaseId: string) {
    const set = heldLeases.get(workerId) ?? new Set();
    set.add(leaseId);
    heldLeases.set(workerId, set);
  }
  function untrack(leaseId: string) {
    heldLeases.forEach((set) => set.delete(leaseId));
  }

  return {
    async submit(input) {
      return coordinator.start({
        runtimeSessionId: input.runtimeSessionId,
        threadId: input.threadId,
        companyId: input.companyId,
        phase: input.phase,
      });
    },
    async claimNext(input) {
      const dur = input.leaseDurationMs ?? leaseDur;
      // Eligible executions: status in {pending, waiting, recovering, abandoned}
      // (abandoned executions can be revived by a fresh claim).
      const pending = await store.listExecutions({
        companyId: input.companyIdFilter,
        status: ['pending', 'waiting', 'recovering', 'abandoned'],
        limit: 50,
      });
      // Try each candidate in turn; the first one we can claim wins.
      for (const exec of pending) {
        const claim = await leaseGovernor.claim({
          executionId: exec.executionId,
          workerId: input.workerId,
          durationMs: dur,
        });
        if (claim.ok) {
          track(input.workerId, claim.lease.leaseId);
          // Transition into running (or recovering for abandoned).
          if (exec.executionStatus === 'pending' || exec.executionStatus === 'waiting') {
            await coordinator.transition({ executionId: exec.executionId, to: 'running' });
          } else if (exec.executionStatus === 'abandoned') {
            await coordinator.transition({ executionId: exec.executionId, to: 'recovering' });
          }
          const refreshed = await coordinator.get(exec.executionId);
          return { execution: refreshed!, leaseId: claim.lease.leaseId };
        }
      }
      return null;
    },
    async release(leaseId) {
      await leaseGovernor.release(leaseId);
      untrack(leaseId);
    },
    async shutdown(workerId) {
      const set = heldLeases.get(workerId);
      if (!set || set.size === 0) return { released: 0 };
      let released = 0;
      for (const leaseId of set) {
        await leaseGovernor.release(leaseId);
        released += 1;
      }
      heldLeases.delete(workerId);
      return { released };
    },
  };
}

let _default: DistributedExecutionAdapter | null = null;
export function getDefaultDistributedExecutionAdapter(): DistributedExecutionAdapter {
  if (!_default) _default = createInProcessExecutionAdapter();
  return _default;
}
export function setDefaultDistributedExecutionAdapter(a: DistributedExecutionAdapter): void {
  _default = a;
}
