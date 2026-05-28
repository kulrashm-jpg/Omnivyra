/**
 * Phase 7 — Execution idempotency governor.
 *
 * Tracks mutation fingerprints so a replayed execution can skip operations
 * that already had their side-effect. Each mutation site computes a stable
 * `fingerprintKey` from (executionId, mutationClass, semanticPayload) and
 * calls `guard()`. If the fingerprint exists, the mutation is suppressed
 * (returns 'suppressed') so the caller skips the actual side-effect.
 *
 * Pure / in-memory by default; pluggable backend mirrors the executionStore
 * pattern so a Supabase-backed implementation can drop in later.
 */

import type {
  IdempotencyClass,
  IdempotencyFingerprint,
} from './threadRuntimeTypes';

export type GuardOutcome = 'first_seen' | 'suppressed';

export interface IdempotencyBackend {
  get(fingerprintKey: string): Promise<IdempotencyFingerprint | null>;
  record(input: { fingerprintKey: string; cls: IdempotencyClass; executionId: string | null }): Promise<{ outcome: GuardOutcome; record: IdempotencyFingerprint }>;
  listForExecution(executionId: string): Promise<IdempotencyFingerprint[]>;
  totalSuppressionCount(): Promise<number>;
}

export function createInMemoryIdempotencyBackend(options?: { maxEntries?: number }): IdempotencyBackend {
  const cap = Math.max(1000, options?.maxEntries ?? 50_000);
  const map = new Map<string, IdempotencyFingerprint>();
  let totalSuppressions = 0;

  function prune(): void {
    while (map.size > cap) {
      const first = map.keys().next().value as string | undefined;
      if (!first) break;
      map.delete(first);
    }
  }

  return {
    async get(key) { return map.get(key) ?? null; },
    async record({ fingerprintKey, cls, executionId }) {
      const existing = map.get(fingerprintKey);
      if (existing) {
        existing.suppressedCount += 1;
        totalSuppressions += 1;
        return { outcome: 'suppressed', record: { ...existing } };
      }
      const rec: IdempotencyFingerprint = {
        fingerprintKey,
        cls,
        executionId,
        firstSeenAt: new Date().toISOString(),
        suppressedCount: 0,
      };
      map.set(fingerprintKey, rec);
      prune();
      return { outcome: 'first_seen', record: { ...rec } };
    },
    async listForExecution(executionId) {
      const out: IdempotencyFingerprint[] = [];
      map.forEach((v) => { if (v.executionId === executionId) out.push({ ...v }); });
      return out;
    },
    async totalSuppressionCount() { return totalSuppressions; },
  };
}

export interface FingerprintArgs {
  executionId: string | null;
  cls: IdempotencyClass;
  /** Semantic payload identifying the mutation (e.g. node id + position + content hash). */
  semanticParts: Array<string | number | boolean | null | undefined>;
}

function djbx33a(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export function computeFingerprintKey(input: FingerprintArgs): string {
  const parts = input.semanticParts.map((p) => (p === null || p === undefined ? '~' : String(p))).join('|');
  return `fp_${input.cls}_${djbx33a(`${input.executionId ?? '~'}|${parts}`)}`;
}

export interface ExecutionIdempotencyGovernor {
  /** Returns 'first_seen' (caller should perform the mutation) or
   *  'suppressed' (caller should skip — already done). */
  guard(args: FingerprintArgs): Promise<GuardOutcome>;
  /** Convenience: wrap an async mutation in the guard. */
  exec<T>(args: FingerprintArgs, fn: () => Promise<T>): Promise<{ outcome: GuardOutcome; value: T | null }>;
  listForExecution(executionId: string): Promise<IdempotencyFingerprint[]>;
  totalSuppressionCount(): Promise<number>;
}

export interface ExecutionIdempotencyGovernorOptions {
  backend?: IdempotencyBackend;
}

export function createExecutionIdempotencyGovernor(options?: ExecutionIdempotencyGovernorOptions): ExecutionIdempotencyGovernor {
  const backend = options?.backend ?? createInMemoryIdempotencyBackend();

  return {
    async guard(args) {
      const key = computeFingerprintKey(args);
      const r = await backend.record({ fingerprintKey: key, cls: args.cls, executionId: args.executionId });
      return r.outcome;
    },
    async exec(args, fn) {
      const outcome = await this.guard(args);
      if (outcome === 'suppressed') return { outcome, value: null };
      const value = await fn();
      return { outcome, value };
    },
    async listForExecution(executionId) {
      return backend.listForExecution(executionId);
    },
    async totalSuppressionCount() {
      return backend.totalSuppressionCount();
    },
  };
}

let _default: ExecutionIdempotencyGovernor | null = null;
export function getDefaultExecutionIdempotencyGovernor(): ExecutionIdempotencyGovernor {
  if (!_default) _default = createExecutionIdempotencyGovernor();
  return _default;
}
export function setDefaultExecutionIdempotencyGovernor(g: ExecutionIdempotencyGovernor): void {
  _default = g;
}
