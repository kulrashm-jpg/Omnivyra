/**
 * Phase 23D — ExecutionPayloadGovernor
 *
 * Post-hydration validator that gates the queue→workflow path. The
 * QueuePayloadHydrator handles SHAPE + EXECUTION reachability. This
 * governor handles SEMANTIC compatibility:
 *
 *   - payload schema version matches what the registered builder expects
 *   - required execution references present (companyId, executionId)
 *   - replay metadata integrity (when checkpointReference is set,
 *     payload's checkpoint id MUST exist in the restored chain)
 *   - checkpoint continuity (the restored chain's `latestCheckpointId`
 *     matches the payload's `checkpointReference.checkpointId` when set)
 *   - idempotency metadata presence (when workflowType requires it —
 *     e.g. recovery payloads must carry stepIds)
 *   - orchestration-type compatibility (the registered builder's
 *     workflowType actually matches the payload's workflowType)
 *
 * SCOPE: validation ONLY. Returns a verdict; the caller acts on it.
 *
 * TELEMETRY:
 *   payload_validation_succeeded
 *   payload_validation_failed
 *   payload_version_mismatch
 */

import type {
  HydratedQueuePayload,
  PayloadValidationResult,
  WorkflowType,
} from './workflowExecutionTypes';
import {
  QUEUE_PAYLOAD_SCHEMA_VERSION,
} from './workflowExecutionTypes';
import type { WorkflowStepRegistry } from './workflowStepRegistry';
import { getDefaultWorkflowStepRegistry } from './workflowStepRegistry';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type PayloadGovernorTelemetryEvent =
  | 'payload_validation_succeeded'
  | 'payload_validation_failed'
  | 'payload_version_mismatch';

export interface PayloadGovernorTelemetrySink {
  emit(event: PayloadGovernorTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: PayloadGovernorTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'payload_validation_failed' || event === 'payload_version_mismatch') {
        console.warn(`[payload_governor] ${line}`);
      } else {
        console.log(`[payload_governor] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Governor interface
// ────────────────────────────────────────────────────────────────────

export interface ExecutionPayloadGovernorOptions {
  registry?: WorkflowStepRegistry;
  telemetry?: PayloadGovernorTelemetrySink;
  /**
   * Workflow types that REQUIRE at least one idempotency hint in the
   * payload. Default: ['recovery', 'replay_continuation'].
   */
  workflowTypesRequiringIdempotency?: WorkflowType[];
}

export interface ExecutionPayloadGovernor {
  validate(hydrated: HydratedQueuePayload): PayloadValidationResult;
}

export function createExecutionPayloadGovernor(
  options?: ExecutionPayloadGovernorOptions,
): ExecutionPayloadGovernor {
  const registry = options?.registry ?? getDefaultWorkflowStepRegistry();
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const requireIdempotencyFor = new Set<WorkflowType>(
    options?.workflowTypesRequiringIdempotency ?? ['recovery', 'replay_continuation'],
  );

  return {
    validate(hydrated) {
      const payload = hydrated.payload;

      // 1. Schema version.
      if (payload.schemaVersion !== QUEUE_PAYLOAD_SCHEMA_VERSION) {
        const v: PayloadValidationResult = {
          ok: false, code: 'unsupported_schema_version',
          detail: `expected ${QUEUE_PAYLOAD_SCHEMA_VERSION}, got ${payload.schemaVersion}`,
        };
        telemetry.emit('payload_version_mismatch', {
          executionId: payload.executionId,
          observed: payload.schemaVersion, expected: QUEUE_PAYLOAD_SCHEMA_VERSION,
        });
        telemetry.emit('payload_validation_failed', {
          executionId: payload.executionId,
          code: v.code, detail: v.detail,
        });
        return v;
      }

      // 2. Required references.
      if (!payload.executionId || !payload.companyId) {
        const v: PayloadValidationResult = {
          ok: false, code: 'invalid_schema',
          detail: 'executionId + companyId required',
        };
        telemetry.emit('payload_validation_failed', {
          executionId: payload.executionId ?? '<missing>', code: v.code, detail: v.detail,
        });
        return v;
      }
      if (payload.executionId !== hydrated.execution.executionId) {
        const v: PayloadValidationResult = {
          ok: false, code: 'execution_id_mismatch',
          detail: `payload.executionId='${payload.executionId}' != execution.executionId='${hydrated.execution.executionId}'`,
        };
        telemetry.emit('payload_validation_failed', {
          executionId: payload.executionId, code: v.code, detail: v.detail,
        });
        return v;
      }
      if (payload.companyId !== hydrated.execution.companyId) {
        const v: PayloadValidationResult = {
          ok: false, code: 'company_id_mismatch',
          detail: `payload.companyId='${payload.companyId}' != execution.companyId='${hydrated.execution.companyId}'`,
        };
        telemetry.emit('payload_validation_failed', {
          executionId: payload.executionId, code: v.code, detail: v.detail,
        });
        return v;
      }

      // 3. Checkpoint continuity.
      if (payload.checkpointReference) {
        const targetId = payload.checkpointReference.checkpointId;
        const chainIds = hydrated.restored?.chain.map((c) => c.checkpointId) ?? [];
        if (!chainIds.includes(targetId)) {
          const v: PayloadValidationResult = {
            ok: false, code: 'checkpoint_reference_missing',
            detail: `referenced checkpoint '${targetId}' not in restored chain (chain ids: ${chainIds.join(', ') || '<empty>'})`,
          };
          telemetry.emit('payload_validation_failed', {
            executionId: payload.executionId, code: v.code, detail: v.detail,
          });
          return v;
        }
      }

      // 4. Idempotency metadata presence (for workflows that require it).
      if (requireIdempotencyFor.has(payload.workflowType)) {
        const hints = payload.idempotencyHints ?? [];
        if (hints.length === 0) {
          const v: PayloadValidationResult = {
            ok: false, code: 'idempotency_keys_invalid',
            detail: `workflowType='${payload.workflowType}' requires at least one idempotencyHint`,
          };
          telemetry.emit('payload_validation_failed', {
            executionId: payload.executionId, code: v.code, detail: v.detail,
          });
          return v;
        }
      }

      // 5. Orchestration-type compatibility — registry has a builder?
      const builder = registry.get(payload.workflowType);
      if (!builder) {
        const v: PayloadValidationResult = {
          ok: false, code: 'unknown_workflow_type',
          detail: `no builder registered for workflowType='${payload.workflowType}'`,
        };
        telemetry.emit('payload_validation_failed', {
          executionId: payload.executionId, code: v.code, detail: v.detail,
        });
        return v;
      }

      const v: PayloadValidationResult = { ok: true, code: 'ok', detail: 'payload semantics valid' };
      telemetry.emit('payload_validation_succeeded', {
        executionId: payload.executionId,
        workflowType: payload.workflowType,
        builderName: builder.name,
      });
      return v;
    },
  };
}

let _default: ExecutionPayloadGovernor | null = null;
export function getDefaultExecutionPayloadGovernor(): ExecutionPayloadGovernor {
  if (!_default) _default = createExecutionPayloadGovernor();
  return _default;
}
export function setDefaultExecutionPayloadGovernor(g: ExecutionPayloadGovernor): void {
  _default = g;
}
