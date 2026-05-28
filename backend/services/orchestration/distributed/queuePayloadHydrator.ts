/**
 * Phase 23B — QueuePayloadHydrator
 *
 * Validates + reconstructs the wire-shaped queue payload into a
 * `HydratedQueuePayload` ready for the WorkflowStepRegistry.
 *
 * RESPONSIBILITIES (per spec):
 *   - validate queue payload schema (shape + version)
 *   - hydrate execution references (fetch ExecutionRecord)
 *   - hydrate checkpoint references (restore checkpoint chain)
 *   - hydrate replay metadata (preserve as-is on hydrated payload)
 *   - hydrate orchestration context (fold into the hydrated wrapper)
 *   - reject malformed payloads (with structured codes)
 *   - reject stale execution payloads (execution missing or terminal-status)
 *
 * SCOPE: read + validation ONLY. No mutations. The hydrator is pure
 * (modulo store reads).
 *
 * GUARANTEES:
 *   - Deterministic: same queue entry + same store state → same hydrated payload.
 *   - Replay-safe: never modifies the queue entry or the execution row.
 *   - Corruption detection: schema mismatches, version drift, id mismatches
 *     all surface as `PayloadValidationResult { ok: false, code: ... }`.
 *   - Version-aware: schemaVersion=1 supported; future versions get
 *     `unsupported_schema_version`.
 *
 * TELEMETRY:
 *   queue_payload_hydration_success
 *   queue_payload_hydration_failure
 */

import type { DurableExecutionCoordinator } from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import type { CheckpointRestorationEngine } from '@/backend/services/orchestration/recovery/checkpointRestorationEngine';
import {
  getDefaultDurableExecutionCoordinator,
} from '@/backend/services/threadRuntime/durableExecutionCoordinator';
import {
  getDefaultCheckpointRestorationEngine,
} from '@/backend/services/orchestration/recovery/checkpointRestorationEngine';
import type {
  HydratedQueuePayload,
  PayloadValidationCode,
  PayloadValidationResult,
  QueuePayloadV1,
  WorkflowType,
} from './workflowExecutionTypes';
import {
  QUEUE_PAYLOAD_SCHEMA_VERSION,
} from './workflowExecutionTypes';
import type { QueueEntry } from './distributedTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type PayloadHydrationTelemetryEvent =
  | 'queue_payload_hydration_success'
  | 'queue_payload_hydration_failure';

export interface PayloadHydrationTelemetrySink {
  emit(event: PayloadHydrationTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: PayloadHydrationTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'queue_payload_hydration_failure') console.warn(`[queue_payload] ${line}`);
      else console.log(`[queue_payload] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class QueuePayloadHydrationError extends Error {
  constructor(
    public readonly code: PayloadValidationCode,
    message: string,
    public readonly queueEntryId: string,
  ) {
    super(`[QueuePayloadHydrator] ${code} for ${queueEntryId}: ${message}`);
    this.name = 'QueuePayloadHydrationError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Schema validation
// ────────────────────────────────────────────────────────────────────

const VALID_WORKFLOW_TYPES = new Set<WorkflowType>([
  // Phase 23 generic types
  'content_generation', 'recovery', 'replay_continuation', 'topology_mutation',
  // Phase 24 domain types
  'long_form_generation', 'campaign_execution', 'social_publish', 'provider_reconciliation',
]);

const VALID_IDEMPOTENCY_CLASSES = new Set([
  'node_insert', 'topology_mutation', 'scheduling', 'billing', 'recovery_action', 'unknown',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure shape check on the payload value coming off a QueueEntry. Returns
 * a structured validation result instead of throwing so callers can
 * branch on the code.
 */
export function validateQueuePayloadShape(payload: unknown): PayloadValidationResult {
  if (!isObject(payload)) {
    return { ok: false, code: 'missing_payload', detail: 'payload is missing or not an object' };
  }
  const p = payload as Record<string, unknown>;
  const v = p.schemaVersion;
  if (typeof v !== 'number') {
    return { ok: false, code: 'invalid_schema', detail: 'schemaVersion missing or not a number' };
  }
  if (v !== QUEUE_PAYLOAD_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported_schema_version', detail: `expected ${QUEUE_PAYLOAD_SCHEMA_VERSION}, got ${v}` };
  }
  if (typeof p.workflowType !== 'string' || !VALID_WORKFLOW_TYPES.has(p.workflowType as WorkflowType)) {
    return { ok: false, code: 'unknown_workflow_type', detail: `workflowType='${String(p.workflowType)}'` };
  }
  if (typeof p.executionId !== 'string' || p.executionId.length === 0) {
    return { ok: false, code: 'invalid_schema', detail: 'executionId required (non-empty string)' };
  }
  if (typeof p.companyId !== 'string' || p.companyId.length === 0) {
    return { ok: false, code: 'invalid_schema', detail: 'companyId required (non-empty string)' };
  }
  // Idempotency hints, when present, must be a well-formed array.
  if (p.idempotencyHints !== undefined) {
    if (!Array.isArray(p.idempotencyHints)) {
      return { ok: false, code: 'idempotency_keys_invalid', detail: 'idempotencyHints must be an array when present' };
    }
    for (const hint of p.idempotencyHints) {
      if (!isObject(hint)) return { ok: false, code: 'idempotency_keys_invalid', detail: 'idempotencyHint not an object' };
      if (typeof hint.stepId !== 'string') return { ok: false, code: 'idempotency_keys_invalid', detail: 'idempotencyHint.stepId not a string' };
      if (typeof hint.cls !== 'string' || !VALID_IDEMPOTENCY_CLASSES.has(hint.cls)) {
        return { ok: false, code: 'idempotency_keys_invalid', detail: `idempotencyHint.cls invalid: '${String(hint.cls)}'` };
      }
      if (!Array.isArray(hint.semanticParts)) {
        return { ok: false, code: 'idempotency_keys_invalid', detail: 'idempotencyHint.semanticParts not an array' };
      }
    }
  }
  // checkpointReference, when present, must be a well-formed object.
  if (p.checkpointReference !== undefined) {
    if (!isObject(p.checkpointReference)) {
      return { ok: false, code: 'invalid_schema', detail: 'checkpointReference must be object when present' };
    }
    if (typeof (p.checkpointReference as Record<string, unknown>).checkpointId !== 'string') {
      return { ok: false, code: 'checkpoint_reference_missing', detail: 'checkpointReference.checkpointId required' };
    }
  }
  return { ok: true, code: 'ok', detail: 'shape ok' };
}

// ────────────────────────────────────────────────────────────────────
// Hydrator interface
// ────────────────────────────────────────────────────────────────────

export interface QueuePayloadHydrator {
  hydrate(queueEntry: QueueEntry): Promise<HydratedQueuePayload>;
  /** Variant that returns null on validation failure instead of throwing. */
  hydrateOrNull(queueEntry: QueueEntry): Promise<{ hydrated: HydratedQueuePayload | null; validation: PayloadValidationResult }>;
}

// ────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────

export interface QueuePayloadHydratorOptions {
  durableExecution?: DurableExecutionCoordinator;
  checkpointRestoration?: CheckpointRestorationEngine;
  telemetry?: PayloadHydrationTelemetrySink;
  /** When true, restore the checkpoint chain on every hydrate (default true). */
  restoreCheckpointChain?: boolean;
}

export function createQueuePayloadHydrator(
  options?: QueuePayloadHydratorOptions,
): QueuePayloadHydrator {
  const durable = options?.durableExecution ?? getDefaultDurableExecutionCoordinator();
  const restoration = options?.checkpointRestoration ?? getDefaultCheckpointRestorationEngine();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const restoreChain = options?.restoreCheckpointChain ?? true;

  return {
    async hydrate(queueEntry) {
      const { hydrated, validation } = await this.hydrateOrNull(queueEntry);
      if (!hydrated) {
        throw new QueuePayloadHydrationError(validation.code, validation.detail, queueEntry.queueEntryId);
      }
      return hydrated;
    },

    async hydrateOrNull(queueEntry) {
      // 1. Shape validation.
      const shape = validateQueuePayloadShape(queueEntry.payload);
      if (!shape.ok) {
        telemetry.emit('queue_payload_hydration_failure', {
          queueEntryId: queueEntry.queueEntryId,
          executionId: queueEntry.executionId,
          code: shape.code, detail: shape.detail,
        });
        return { hydrated: null, validation: shape };
      }
      const payload = queueEntry.payload as unknown as QueuePayloadV1;

      // 2. ID cross-check — payload + queue entry must agree.
      if (payload.executionId !== queueEntry.executionId) {
        const v: PayloadValidationResult = {
          ok: false, code: 'execution_id_mismatch',
          detail: `payload.executionId='${payload.executionId}' != queueEntry.executionId='${queueEntry.executionId}'`,
        };
        telemetry.emit('queue_payload_hydration_failure', {
          queueEntryId: queueEntry.queueEntryId, code: v.code, detail: v.detail,
        });
        return { hydrated: null, validation: v };
      }
      if (payload.companyId !== queueEntry.companyId) {
        const v: PayloadValidationResult = {
          ok: false, code: 'company_id_mismatch',
          detail: `payload.companyId='${payload.companyId}' != queueEntry.companyId='${queueEntry.companyId}'`,
        };
        telemetry.emit('queue_payload_hydration_failure', {
          queueEntryId: queueEntry.queueEntryId, code: v.code, detail: v.detail,
        });
        return { hydrated: null, validation: v };
      }

      // 3. Execution lookup.
      const execution = await durable.get(payload.executionId);
      if (!execution) {
        const v: PayloadValidationResult = {
          ok: false, code: 'execution_missing',
          detail: `executionId='${payload.executionId}' not found in store`,
        };
        telemetry.emit('queue_payload_hydration_failure', {
          queueEntryId: queueEntry.queueEntryId, code: v.code, detail: v.detail,
        });
        return { hydrated: null, validation: v };
      }

      // 4. Stale-execution check — refuse to hydrate terminal executions
      // (completed / abandoned). The runner's recovery path handles
      // already-completed via a short-circuit; payload hydration should
      // refuse to build a workflow for a known-terminal execution.
      if (execution.executionStatus === 'completed' || execution.executionStatus === 'failed') {
        const v: PayloadValidationResult = {
          ok: false, code: 'stale_execution',
          detail: `executionStatus='${execution.executionStatus}'`,
        };
        telemetry.emit('queue_payload_hydration_failure', {
          queueEntryId: queueEntry.queueEntryId, code: v.code, detail: v.detail,
        });
        return { hydrated: null, validation: v };
      }

      // 5. Checkpoint restoration (when requested).
      let restored = null;
      if (restoreChain) {
        try {
          restored = await restoration.restore(payload.executionId);
        } catch (err) {
          // Restoration corruption shouldn't fail hydration — surface it via
          // restored=null and let the QueueCheckpointContinuityCoordinator
          // make the call.
          telemetry.emit('queue_payload_hydration_failure', {
            queueEntryId: queueEntry.queueEntryId,
            executionId: payload.executionId,
            code: 'invalid_schema',
            detail: `checkpoint restoration error: ${(err as Error)?.message ?? String(err)}`,
            recovered: true,
          });
        }
      }

      const hydrated: HydratedQueuePayload = {
        payload, queueEntry, execution, restored,
      };
      telemetry.emit('queue_payload_hydration_success', {
        queueEntryId: queueEntry.queueEntryId,
        executionId: payload.executionId,
        workflowType: payload.workflowType,
        chainLength: restored?.chain.length ?? 0,
      });
      return { hydrated, validation: { ok: true, code: 'ok', detail: 'hydrated' } };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: QueuePayloadHydrator | null = null;
export function getDefaultQueuePayloadHydrator(): QueuePayloadHydrator {
  if (!_default) _default = createQueuePayloadHydrator();
  return _default;
}
export function setDefaultQueuePayloadHydrator(h: QueuePayloadHydrator): void {
  _default = h;
}
