/**
 * Phase 1 + 2 + 6 (wiring) — Thread runtime instrumentation helper.
 *
 * SAFE wiring surface for production code. Live execution paths
 * (pages/api/scheduler/schedule.ts, lib/thread/threadNodePersistence.ts,
 * multi-platform-scheduler.tsx) call into this module to emit canonical
 * trace events and capture topology snapshots. EVERY call here is wrapped
 * in try/catch so a tracer failure can NEVER throw into the caller's
 * execution path. Trace failures degrade to a console.warn — never to a
 * propagated exception.
 *
 * This module is also the only place callers should touch the trace
 * registry / snapshot engine — the replay contract validator gates every
 * event so partial/invalid emissions are rejected before they pollute the
 * registry.
 *
 * Pure side-effect interface; no DB, no HTTP.
 */

import type {
  ThreadNodeGenerationMode,
  ThreadNodeShape,
  ThreadRuntimeTransitionType,
  ThreadSnapshotPhase,
} from './threadRuntimeTypes';
import {
  getDefaultThreadRuntimeTraceRegistry,
  type ThreadRuntimeTraceRegistry,
  type RecordTraceEventInput,
} from './threadRuntimeTraceRegistry';
import {
  getDefaultThreadTopologySnapshotEngine,
  type ThreadTopologySnapshotEngine,
} from './threadTopologySnapshotEngine';
import { validateAndNormalize, ReplayContractViolation } from './runtimeReplayContractValidator';

// ── Environment gate ──────────────────────────────────────────────────
// Default: enabled. Production callers can disable per-deployment without
// removing the instrumentation calls via THREAD_RUNTIME_OBSERVABILITY=off.

function isEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  const v = process.env?.THREAD_RUNTIME_OBSERVABILITY;
  if (!v) return true;
  return v.toLowerCase() !== 'off';
}

// ── Safe wrapper: never throw, never block caller ─────────────────────

function safeCall<T>(label: string, fn: () => T): T | null {
  if (!isEnabled()) return null;
  try {
    return fn();
  } catch (err) {
    if (err instanceof ReplayContractViolation) {
      console.warn(`[threadRuntime.instrumentation] replay-contract violation in ${label}: ${err.message}`);
    } else {
      console.warn(`[threadRuntime.instrumentation] ${label} swallowed error: ${(err as Error).message}`);
    }
    return null;
  }
}

// ── Identifier helpers ────────────────────────────────────────────────

export function newRuntimeSessionId(threadId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `rs_${threadId.slice(0, 12)}_${ts}_${rand}`;
}

// ── Public tracer factory ─────────────────────────────────────────────

export interface ThreadRuntimeInstrumentationOptions {
  registry?: ThreadRuntimeTraceRegistry;
  snapshotEngine?: ThreadTopologySnapshotEngine;
}

export interface ThreadRuntimeTracer {
  readonly runtimeSessionId: string;
  readonly threadId: string;
  readonly companyId: string;

  // ── Phase 1 — canonical trace emission ─────────────────────────────
  recordNodeCreate(input: { nodeId: string; parentNodeId: string | null; position: number; mode: ThreadNodeGenerationMode; latencyMs?: number; detail?: string }): void;
  recordNodeEdit(input: { nodeId: string; detail?: string; latencyMs?: number }): void;
  recordNodeReorder(input: { nodeId: string; newPosition: number; latencyMs?: number; detail?: string }): void;
  recordPersistAttempt(input?: { detail?: string; payload?: Record<string, unknown> }): void;
  recordPersistSuccess(input?: { latencyMs?: number; detail?: string }): void;
  recordPersistFailure(input: { detail: string; latencyMs?: number; payload?: Record<string, unknown> }): void;
  recordJoinAttempt(input: { parentNodeId: string; childNodeIds: string[]; detail?: string }): void;
  recordJoinSuccess(input: { parentNodeId: string; childNodeIds: string[]; latencyMs?: number; detail?: string }): void;
  recordJoinFailure(input: { parentNodeId: string; childNodeIds: string[]; detail: string }): void;
  recordRefreshObserved(input?: { detail?: string }): void;
  recordRecoveryAttempt(input: { detail: string }): void;
  recordRecoverySuccess(input?: { detail?: string; latencyMs?: number }): void;
  recordRecoveryFailure(input: { detail: string }): void;
  endSession(): void;

  // ── Phase 6 — recovery instrumentation guarantees ──────────────────
  /**
   * Wraps a recovery operation: emits attempt, runs `op`, and emits
   * success or failure with timing. Returns whatever `op` returned. If
   * `op` throws, the failure is recorded and the error is re-thrown so
   * the caller keeps its normal error path.
   */
  withRecovery<T>(detail: string, op: () => Promise<T>): Promise<T>;

  // ── Phase 2 — automatic snapshot capture ────────────────────────────
  captureSnapshot(input: { phase: ThreadSnapshotPhase; nodes: ThreadNodeShape[]; rootNodeId?: string | null }): void;
}

/**
 * Open (or resume) a runtime session for a thread. Repeated calls with
 * the same `runtimeSessionId` are idempotent (registry will not duplicate
 * the session). The returned tracer is the only API callers need to use.
 */
export function openThreadRuntimeTracer(input: {
  runtimeSessionId?: string;
  threadId: string;
  companyId: string;
  options?: ThreadRuntimeInstrumentationOptions;
}): ThreadRuntimeTracer {
  const registry = input.options?.registry ?? getDefaultThreadRuntimeTraceRegistry();
  const snapshotEngine = input.options?.snapshotEngine ?? getDefaultThreadTopologySnapshotEngine();
  const runtimeSessionId = input.runtimeSessionId ?? newRuntimeSessionId(input.threadId);

  // Idempotent start.
  safeCall('startSession', () => {
    if (!registry.getTrace(runtimeSessionId)) {
      registry.startSession({ runtimeSessionId, threadId: input.threadId, companyId: input.companyId });
    }
  });

  function record(transition: ThreadRuntimeTransitionType, extra: Partial<RecordTraceEventInput> = {}) {
    safeCall(`record(${transition})`, () => {
      const payload: RecordTraceEventInput = {
        runtimeSessionId,
        threadId: input.threadId,
        companyId: input.companyId,
        transitionType: transition,
        ...extra,
      };
      const normalized = validateAndNormalize(payload);
      registry.recordEvent(normalized);
    });
  }

  return {
    runtimeSessionId,
    threadId: input.threadId,
    companyId: input.companyId,

    recordNodeCreate({ nodeId, parentNodeId, position, mode, latencyMs, detail }) {
      record('node_create', {
        parentNodeId, childNodeIds: [nodeId],
        nodeGenerationMode: mode, latencyMs, detail,
        payload: { position },
      });
    },
    recordNodeEdit({ nodeId, detail, latencyMs }) {
      record('node_edit', { childNodeIds: [nodeId], detail, latencyMs });
    },
    recordNodeReorder({ nodeId, newPosition, latencyMs, detail }) {
      record('node_reorder', { childNodeIds: [nodeId], latencyMs, detail, payload: { newPosition } });
    },
    recordPersistAttempt(arg) {
      record('persist_attempt', { detail: arg?.detail, payload: arg?.payload });
    },
    recordPersistSuccess(arg) {
      record('persist_success', { detail: arg?.detail, latencyMs: arg?.latencyMs });
    },
    recordPersistFailure({ detail, latencyMs, payload }) {
      record('persist_failure', { detail, latencyMs, payload });
    },
    recordJoinAttempt({ parentNodeId, childNodeIds, detail }) {
      record('join_attempt', { parentNodeId, childNodeIds, detail });
    },
    recordJoinSuccess({ parentNodeId, childNodeIds, latencyMs, detail }) {
      record('join_success', { parentNodeId, childNodeIds, latencyMs, detail });
    },
    recordJoinFailure({ parentNodeId, childNodeIds, detail }) {
      record('join_failure', { parentNodeId, childNodeIds, detail });
    },
    recordRefreshObserved(arg) {
      record('refresh_observed', { detail: arg?.detail });
    },
    recordRecoveryAttempt({ detail }) {
      record('recovery_attempt', { detail });
    },
    recordRecoverySuccess(arg) {
      record('recovery_success', { detail: arg?.detail, latencyMs: arg?.latencyMs });
    },
    recordRecoveryFailure({ detail }) {
      record('recovery_failure', { detail });
    },
    endSession() {
      safeCall('endSession', () => registry.endSession(runtimeSessionId));
    },

    async withRecovery<T>(detail: string, op: () => Promise<T>): Promise<T> {
      const startMs = Date.now();
      record('recovery_attempt', { detail });
      try {
        const result = await op();
        record('recovery_success', { detail: `${detail} (ok)`, latencyMs: Date.now() - startMs });
        return result;
      } catch (err) {
        record('recovery_failure', { detail: `${detail}: ${(err as Error).message}` });
        throw err;
      }
    },

    captureSnapshot({ phase, nodes, rootNodeId }) {
      safeCall(`captureSnapshot(${phase})`, () => {
        snapshotEngine.capture({
          threadId: input.threadId, companyId: input.companyId, phase, nodes, rootNodeId,
        });
      });
    },
  };
}

// ── Automatic snapshot helper ─────────────────────────────────────────
//
// Many call sites want the pattern: capture pre-state → run op → capture
// post-state. This helper handles the boilerplate.

export async function withAutoSnapshot<T>(input: {
  tracer: ThreadRuntimeTracer;
  prePhase: ThreadSnapshotPhase;
  postPhase: ThreadSnapshotPhase;
  preNodes: ThreadNodeShape[];
  rootNodeId?: string | null;
  op: () => Promise<{ nodes: ThreadNodeShape[]; rootNodeId?: string | null; result: T }>;
}): Promise<T> {
  input.tracer.captureSnapshot({ phase: input.prePhase, nodes: input.preNodes, rootNodeId: input.rootNodeId ?? null });
  const out = await input.op();
  input.tracer.captureSnapshot({ phase: input.postPhase, nodes: out.nodes, rootNodeId: out.rootNodeId ?? null });
  return out.result;
}
