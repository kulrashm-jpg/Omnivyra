/**
 * Phase 3 (wiring) — Runtime replay contract validator.
 *
 * Enforces that every `node_create` event carries enough information to
 * reconstruct the topology from the trace alone — so any caller producing
 * a malformed trace gets a hard rejection at the boundary instead of
 * leaving the validator (Phase 6) to discover incomplete replay later.
 *
 * Contract for `node_create`:
 *   - childNodeIds: must contain exactly 1 id (the created node) — NOT empty.
 *   - parentNodeId: required unless the event is the very first node (root).
 *                   For root, parentNodeId === null is valid.
 *   - payload.position: required, must be a non-negative integer.
 *                       Position 0 is treated as the root indicator.
 *   - nodeGenerationMode: must be 'manual' or 'ai' (not 'mixed', which is
 *                         a session-level rollup, not a per-event mode).
 *
 * Other transition types have lighter contracts but still enforced here:
 *   - node_edit / node_reorder: must reference an existing node id.
 *   - persist_attempt / persist_success / persist_failure: latencyMs ≥ 0 if present.
 *   - join_attempt / success / failure: parent + at least one child id.
 *
 * Returns a `RecordTraceEventInput` that has been normalized (or throws
 * if the contract is violated). Caller-side instrumentation should call
 * `validateAndNormalize` before `traceRegistry.recordEvent`.
 */

import type {
  ThreadRuntimeTransitionType,
} from './threadRuntimeTypes';
import type { RecordTraceEventInput } from './threadRuntimeTraceRegistry';

export interface ReplayContractValidationError {
  field: string;
  reason: string;
}

export class ReplayContractViolation extends Error {
  errors: ReplayContractValidationError[];
  constructor(errors: ReplayContractValidationError[]) {
    super(`Replay contract violation: ${errors.map((e) => `${e.field}=${e.reason}`).join('; ')}`);
    this.name = 'ReplayContractViolation';
    this.errors = errors;
  }
}

export interface ReplayContractCheckResult {
  ok: boolean;
  errors: ReplayContractValidationError[];
  normalized: RecordTraceEventInput;
}

function isFiniteNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Math.floor(v) === v;
}

export function checkReplayContract(input: RecordTraceEventInput): ReplayContractCheckResult {
  const errors: ReplayContractValidationError[] = [];
  const normalized: RecordTraceEventInput = {
    ...input,
    childNodeIds: input.childNodeIds ? [...input.childNodeIds] : undefined,
  };

  // Universal: companyId + threadId + runtimeSessionId required.
  if (!input.companyId) errors.push({ field: 'companyId', reason: 'required' });
  if (!input.threadId) errors.push({ field: 'threadId', reason: 'required' });
  if (!input.runtimeSessionId) errors.push({ field: 'runtimeSessionId', reason: 'required' });

  const t = input.transitionType as ThreadRuntimeTransitionType;

  // Per-type contracts.
  switch (t) {
    case 'node_create': {
      const ids = input.childNodeIds ?? [];
      if (ids.length !== 1) errors.push({ field: 'childNodeIds', reason: 'node_create must contain exactly 1 created node id' });
      else if (!ids[0]) errors.push({ field: 'childNodeIds[0]', reason: 'created node id must be a non-empty string' });

      const pos = input.payload?.position;
      if (pos === undefined) errors.push({ field: 'payload.position', reason: 'required for node_create' });
      else if (!isFiniteNonNegativeInt(pos)) errors.push({ field: 'payload.position', reason: 'must be non-negative integer' });

      // Root check: position 0 may have parentNodeId === null; others must have a parent id.
      if (isFiniteNonNegativeInt(pos)) {
        if (pos === 0) {
          if (input.parentNodeId && input.parentNodeId !== null) {
            errors.push({ field: 'parentNodeId', reason: 'root (position=0) must have parentNodeId === null' });
          }
        } else if (!input.parentNodeId) {
          errors.push({ field: 'parentNodeId', reason: 'non-root node_create requires a parentNodeId' });
        }
      }

      const mode = input.nodeGenerationMode;
      if (mode && mode !== 'manual' && mode !== 'ai') {
        errors.push({ field: 'nodeGenerationMode', reason: 'must be "manual" or "ai" on per-event basis (no "mixed")' });
      }
      break;
    }

    case 'node_edit':
    case 'node_reorder': {
      const ids = input.childNodeIds ?? [];
      if (ids.length === 0) errors.push({ field: 'childNodeIds', reason: `${t} must reference at least one node id` });
      if (t === 'node_reorder') {
        const newPos = input.payload?.newPosition;
        if (newPos !== undefined && !isFiniteNonNegativeInt(newPos)) {
          errors.push({ field: 'payload.newPosition', reason: 'must be non-negative integer when present' });
        }
      }
      break;
    }

    case 'persist_attempt':
    case 'persist_success':
    case 'persist_failure': {
      if (input.latencyMs !== undefined && (typeof input.latencyMs !== 'number' || input.latencyMs < 0)) {
        errors.push({ field: 'latencyMs', reason: 'must be non-negative number when present' });
      }
      if (t === 'persist_failure' && !input.detail) {
        errors.push({ field: 'detail', reason: 'persist_failure must carry a detail explaining the failure' });
      }
      break;
    }

    case 'join_attempt':
    case 'join_success':
    case 'join_failure': {
      const ids = input.childNodeIds ?? [];
      if (!input.parentNodeId) errors.push({ field: 'parentNodeId', reason: `${t} must include parentNodeId` });
      if (ids.length === 0) errors.push({ field: 'childNodeIds', reason: `${t} must include at least one child id` });
      if (t === 'join_failure' && !input.detail) {
        errors.push({ field: 'detail', reason: 'join_failure must carry a detail' });
      }
      break;
    }

    case 'recovery_attempt':
    case 'recovery_success':
    case 'recovery_failure': {
      // Recoveries don't need node ids, but recovery_failure must explain itself.
      if (t === 'recovery_failure' && !input.detail) {
        errors.push({ field: 'detail', reason: 'recovery_failure must carry a detail' });
      }
      break;
    }

    case 'refresh_observed':
    case 'session_start':
    case 'session_end':
      // No additional per-field contract.
      break;

    default:
      errors.push({ field: 'transitionType', reason: `unknown transitionType "${t}"` });
  }

  return { ok: errors.length === 0, errors, normalized };
}

/**
 * Throws ReplayContractViolation if invalid; returns normalized input otherwise.
 * Use this at the boundary inside `threadRuntimeInstrumentation` so callers
 * cannot record partial / invalid events.
 */
export function validateAndNormalize(input: RecordTraceEventInput): RecordTraceEventInput {
  const result = checkReplayContract(input);
  if (!result.ok) throw new ReplayContractViolation(result.errors);
  return result.normalized;
}
