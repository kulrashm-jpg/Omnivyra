/**
 * Phase 7 — Runtime recovery traceability.
 *
 * Walks the trace for recovery_attempt → recovery_success / recovery_failure
 * pairs and emits structured `RecoveryTrace` records explaining what failed,
 * what recovered, how long it took, and a confidence score.
 *
 * Pure / deterministic. In-memory per-company registry of past traces.
 */

import type {
  RecoveryTrace,
  ThreadRuntimeTrace,
} from './threadRuntimeTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function summarizeWhatFailed(detail: string | undefined, fallback: string): string {
  if (detail && detail.trim()) return detail.trim();
  return fallback;
}

export interface ExtractRecoveryTracesInput {
  trace: ThreadRuntimeTrace;
}

export function extractRecoveryTraces(input: ExtractRecoveryTracesInput): RecoveryTrace[] {
  const events = input.trace.events;
  const out: RecoveryTrace[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (ev.transitionType !== 'recovery_attempt') continue;

    const startedAt = ev.timestamp;
    let completedAt: string | null = null;
    let recoveryStable = false;
    let whatRecovered = '(unknown — never resolved)';
    let recoveryDurationMs: number | null = null;

    // Look for the nearest subsequent recovery_success or recovery_failure for the same thread
    for (let j = i + 1; j < events.length; j += 1) {
      const next = events[j];
      if (next.threadId !== ev.threadId) continue;
      if (next.transitionType === 'recovery_success') {
        completedAt = next.timestamp;
        recoveryStable = true;
        whatRecovered = summarizeWhatFailed(next.detail, 'recovery completed');
        const delta = Date.parse(next.timestamp) - Date.parse(startedAt);
        recoveryDurationMs = Number.isFinite(delta) && delta >= 0 ? delta : null;
        break;
      }
      if (next.transitionType === 'recovery_failure') {
        completedAt = next.timestamp;
        recoveryStable = false;
        whatRecovered = summarizeWhatFailed(next.detail, 'recovery failed');
        const delta = Date.parse(next.timestamp) - Date.parse(startedAt);
        recoveryDurationMs = Number.isFinite(delta) && delta >= 0 ? delta : null;
        break;
      }
    }

    const whatFailed = summarizeWhatFailed(ev.detail, 'unspecified failure trigger');

    // Residual corruption risk:
    //  - 0 if stable + short duration
    //  - 40 if unstable
    //  - +10 if duration > 5s
    //  - +10 if subsequent persist_failure within the same session
    let residualCorruptionRisk = recoveryStable ? 5 : 40;
    if ((recoveryDurationMs ?? 0) > 5000) residualCorruptionRisk += 10;
    const subsequentFailureExists = events.some((e) =>
      e.orchestrationSequence > ev.orchestrationSequence
      && e.threadId === ev.threadId
      && (e.transitionType === 'persist_failure' || e.transitionType === 'join_failure'),
    );
    if (subsequentFailureExists) residualCorruptionRisk += 10;
    residualCorruptionRisk = clamp100(residualCorruptionRisk);

    // Confidence: high when stable + low residual risk + completedAt present
    let recoveryConfidenceScore = recoveryStable ? 80 : 20;
    recoveryConfidenceScore -= residualCorruptionRisk * 0.4;
    if (!completedAt) recoveryConfidenceScore -= 20;
    if ((recoveryDurationMs ?? 0) > 5000) recoveryConfidenceScore -= 10;
    recoveryConfidenceScore = clamp100(recoveryConfidenceScore);

    out.push({
      recoveryId: newId('rec'),
      threadId: ev.threadId,
      startedAt,
      completedAt,
      whatFailed,
      whatRecovered,
      recoveryDurationMs,
      recoveryStable,
      residualCorruptionRisk,
      recoveryConfidenceScore,
    });
  }

  return out;
}

// ── Per-company registry of past traces ───────────────────────────────

export interface RuntimeRecoveryTraceabilityRegistry {
  record(threadId: string, companyId: string, traces: RecoveryTrace[]): void;
  list(companyId?: string): RecoveryTrace[];
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export function createRuntimeRecoveryTraceabilityRegistry(options?: {
  maxTracesPerCompany?: number;
}): RuntimeRecoveryTraceabilityRegistry {
  const cap = Math.max(50, options?.maxTracesPerCompany ?? 1000);
  const buckets = new Map<string, RecoveryTrace[]>();

  function bucket(companyId: string): RecoveryTrace[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  return {
    record(_threadId, companyId, traces) {
      const b = bucket(companyId);
      b.push(...traces);
      while (b.length > cap) b.shift();
    },
    list(companyId) {
      if (companyId) return [...(buckets.get(companyId) ?? [])];
      const out: RecoveryTrace[] = [];
      buckets.forEach((b) => out.push(...b));
      return out;
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _default: RuntimeRecoveryTraceabilityRegistry | null = null;
export function getDefaultRuntimeRecoveryTraceabilityRegistry(): RuntimeRecoveryTraceabilityRegistry {
  if (!_default) _default = createRuntimeRecoveryTraceabilityRegistry();
  return _default;
}
export function setDefaultRuntimeRecoveryTraceabilityRegistry(r: RuntimeRecoveryTraceabilityRegistry): void {
  _default = r;
}
