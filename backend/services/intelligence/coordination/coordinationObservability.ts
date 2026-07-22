/**
 * Coordination Intelligence Layer — observability (fail-safe, new namespace).
 *
 * Uses the frozen observability seam (`recordRawCounter` / `recordRawHistogram`)
 * under a NEW, non-colliding `ai.coordination.*` namespace. Per OMNIVYRA-PMO-001
 * the `ai.gateway.*` / `ai.grounding.*` metric names are Shared Contracts owned
 * by Platform (P) — this layer must not emit into them.
 *
 * Every emitter is wrapped in try/catch: observability is best-effort and can
 * never affect coordination behaviour.
 */
import { recordRawCounter, recordRawHistogram } from '../../../observability';
import type {
  CommunicationRecord,
  DuplicateIntentVerdict,
} from './coordinationContracts';

interface CoordinationObsCtx {
  surface?: string;
  correlationId?: string;
}

export function recordCoordinationRegister(record: CommunicationRecord, ctx: CoordinationObsCtx = {}): void {
  try {
    recordRawCounter('ai.coordination.register', 1, {
      source_module: record.sourceModule,
      intent: record.communicationIntent,
      status: record.publicationStatus,
      has_embedding: record.embedding?.vector ? 'true' : 'false',
      surface: ctx.surface ?? 'unknown',
    });
  } catch { /* observability is fail-safe */ }
}

export function recordDuplicateIntentDecision(verdict: DuplicateIntentVerdict, ctx: CoordinationObsCtx = {}): void {
  try {
    recordRawCounter('ai.coordination.duplicate_decision', 1, {
      decision: verdict.decision,
      basis: verdict.basis,
      surface: ctx.surface ?? 'unknown',
    });
    if (typeof verdict.maxSimilarity === 'number') {
      recordRawHistogram('ai.coordination.similarity', verdict.maxSimilarity, {
        decision: verdict.decision,
        basis: verdict.basis,
      });
    }
    recordRawHistogram('ai.coordination.candidates', verdict.candidatesConsidered, {
      decision: verdict.decision,
    });
  } catch { /* observability is fail-safe */ }
}

export function recordCoordinationDegrade(op: string, reason: string, ctx: CoordinationObsCtx = {}): void {
  try {
    recordRawCounter('ai.coordination.degrade', 1, {
      op,
      reason,
      surface: ctx.surface ?? 'unknown',
    });
  } catch { /* observability is fail-safe */ }
}
