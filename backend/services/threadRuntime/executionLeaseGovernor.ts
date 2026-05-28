/**
 * Phase 4 — Execution lease governor.
 *
 * Single-writer enforcement for durable executions:
 *   - Only one worker owns an execution at a time (lease).
 *   - Leases expire if the owner stops sending heartbeats.
 *   - Stale leases are explicitly revoked so another worker can claim.
 *   - Concurrent claim attempts → exactly one wins.
 *
 * Split-brain suppression: a worker that wakes up holding a stale lease
 * MUST refuse to mutate state and call `claimWithTakeover()` to win
 * the new lease (or back off if another worker has).
 *
 * Pure / deterministic, store-backed.
 */

import type { ExecutionLease } from './threadRuntimeTypes';
import {
  getDefaultExecutionStore,
  type ExecutionStore,
} from './executionStore';

export type ClaimOutcome =
  | { ok: true; lease: ExecutionLease; tookOverFrom?: string }
  | { ok: false; reason: 'already_held' | 'execution_not_found'; currentOwner?: string };

export interface ExecutionLeaseGovernor {
  claim(input: { executionId: string; workerId: string; durationMs: number; nowMs?: number }): Promise<ClaimOutcome>;
  /** Forced claim. Revokes a stale lease whose expiresAt < now. */
  claimWithTakeover(input: { executionId: string; workerId: string; durationMs: number; nowMs?: number }): Promise<ClaimOutcome>;
  heartbeat(input: { leaseId: string; durationMs: number; nowMs?: number }): Promise<ExecutionLease | null>;
  release(leaseId: string): Promise<void>;
  /** Sweep: find all expired leases and revoke them. Returns IDs of revoked leases. */
  sweepExpired(input: { nowMs?: number; limit?: number }): Promise<string[]>;
  currentOwner(executionId: string): Promise<string | null>;
}

export interface ExecutionLeaseGovernorOptions {
  store?: ExecutionStore;
}

export function createExecutionLeaseGovernor(options?: ExecutionLeaseGovernorOptions): ExecutionLeaseGovernor {
  const store = options?.store ?? getDefaultExecutionStore();

  return {
    async claim(input) {
      const now = input.nowMs ?? Date.now();
      const cur = await store.currentLease(input.executionId);
      if (cur && !cur.released && Date.parse(cur.expiresAt) > now) {
        return { ok: false, reason: 'already_held', currentOwner: cur.ownerWorkerId };
      }
      const lease = await store.acquireLease({
        executionId: input.executionId,
        workerId: input.workerId,
        durationMs: input.durationMs,
        nowMs: now,
      });
      if (!lease) return { ok: false, reason: 'already_held' };
      return { ok: true, lease };
    },
    async claimWithTakeover(input) {
      const now = input.nowMs ?? Date.now();
      const cur = await store.currentLease(input.executionId);
      if (cur && !cur.released) {
        if (Date.parse(cur.expiresAt) > now) {
          // Still live; cannot take over.
          return { ok: false, reason: 'already_held', currentOwner: cur.ownerWorkerId };
        }
        // Stale: revoke explicitly.
        await store.releaseLease(cur.leaseId);
      }
      const lease = await store.acquireLease({
        executionId: input.executionId,
        workerId: input.workerId,
        durationMs: input.durationMs,
        nowMs: now,
      });
      if (!lease) return { ok: false, reason: 'already_held' };
      return { ok: true, lease, tookOverFrom: cur?.ownerWorkerId };
    },
    async heartbeat(input) {
      return store.renewLease({ leaseId: input.leaseId, durationMs: input.durationMs, nowMs: input.nowMs });
    },
    async release(leaseId) {
      await store.releaseLease(leaseId);
    },
    async sweepExpired(input) {
      const expired = await store.listExpiredLeases({ nowMs: input.nowMs ?? Date.now(), limit: input.limit });
      const revoked: string[] = [];
      for (const l of expired) {
        await store.releaseLease(l.leaseId);
        revoked.push(l.leaseId);
      }
      return revoked;
    },
    async currentOwner(executionId) {
      const cur = await store.currentLease(executionId);
      return cur?.released ? null : cur?.ownerWorkerId ?? null;
    },
  };
}

let _default: ExecutionLeaseGovernor | null = null;
export function getDefaultExecutionLeaseGovernor(): ExecutionLeaseGovernor {
  if (!_default) _default = createExecutionLeaseGovernor();
  return _default;
}
export function setDefaultExecutionLeaseGovernor(g: ExecutionLeaseGovernor): void {
  _default = g;
}
