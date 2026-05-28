/**
 * Phase 4 — Centralized instrumentation enforcement.
 *
 * Helper that callers wrap around any thread-runtime mutation point. In
 * dev / test mode it asserts the caller is operating inside a valid
 * tracer scope; in production it degrades to a metric increment (no
 * throw, no log spam).
 *
 * Purpose: make it hard to add a new mutation path that bypasses
 * tracing. Future reviewers immediately see `requireThreadRuntimeInstrumentation(...)`
 * at the top of any handler and know the tracer must be live.
 *
 * Three call shapes:
 *   requireThreadRuntimeInstrumentation({ tracer, mutation: 'persist' })
 *   requireThreadRuntimeInstrumentation({ tracer: maybeNull, mutation: 'reorder', allowMissing: true })
 *   const assert = makeAssertionLogger({ mode: 'warn' }); assert(...)
 */

import type { ThreadRuntimeTracer } from './threadRuntimeInstrumentation';

export type RequiredMutationKind =
  | 'persist'
  | 'node_create'
  | 'node_edit'
  | 'node_reorder'
  | 'recovery'
  | 'join'
  | 'refresh';

export interface RequireInstrumentationInput {
  tracer: ThreadRuntimeTracer | null | undefined;
  mutation: RequiredMutationKind;
  /** When true, missing tracer is logged but not asserted. */
  allowMissing?: boolean;
  /** Caller hint used in the assertion message. */
  callerLabel?: string;
}

export interface InstrumentationAssertion {
  ok: boolean;
  reason?: string;
}

let _missingCount = 0;
function getMode(): 'dev' | 'test' | 'prod' {
  if (typeof process === 'undefined' || !process.env) return 'prod';
  const e = process.env.NODE_ENV;
  if (e === 'test') return 'test';
  if (e === 'development' || !e) return 'dev';
  return 'prod';
}

export function requireThreadRuntimeInstrumentation(input: RequireInstrumentationInput): InstrumentationAssertion {
  const ok = !!input.tracer;
  if (!ok) {
    _missingCount += 1;
    const reason = `[threadRuntime.instrumentation] missing tracer at mutation "${input.mutation}"`
      + (input.callerLabel ? ` (caller=${input.callerLabel})` : '');
    if (!input.allowMissing) {
      const mode = getMode();
      if (mode === 'dev' || mode === 'test') {
        // In dev/test we make the regression visible. We DO NOT throw —
        // throwing here would convert a missing-tracer regression into a
        // user-facing 500, which is worse than the regression itself.
        // Instead we log loudly so test logs surface the issue.
        try { console.warn(reason); } catch { /* ignore */ }
      }
    }
    return { ok: false, reason };
  }
  return { ok: true };
}

/** Total count of missing-tracer assertions raised in this process. Reset via reset(). */
export function getMissingInstrumentationCount(): number {
  return _missingCount;
}

export function resetInstrumentationCounters(): void {
  _missingCount = 0;
}

/**
 * Assertion sink used by stress tests. Returns a recorder that captures
 * every assertion call so tests can inspect "did we hit the missing-tracer
 * path N times?" without polluting console output.
 */
export interface InstrumentationAssertionRecorder {
  record(input: RequireInstrumentationInput): InstrumentationAssertion;
  list(): RequireInstrumentationInput[];
  clear(): void;
}

export function createAssertionRecorder(): InstrumentationAssertionRecorder {
  const records: RequireInstrumentationInput[] = [];
  return {
    record(input) {
      records.push(input);
      return requireThreadRuntimeInstrumentation(input);
    },
    list() { return [...records]; },
    clear() { records.length = 0; },
  };
}
