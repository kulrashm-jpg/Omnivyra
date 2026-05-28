/**
 * Phase 23 — Workflow execution shared types.
 *
 * Wire-stable schema for queue→workflow translation. Used by:
 *   - QueuePayloadHydrator      (validates + reconstructs)
 *   - ExecutionPayloadGovernor  (validates vs current execution state)
 *   - WorkflowStepRegistry      (dispatches to per-type builders)
 *   - QueueCheckpointContinuityCoordinator (cross-checks payload vs checkpoint)
 *
 * Pure types. No I/O.
 */

import type { ExecutionRecord, OrchestrationPhase } from '@/backend/services/threadRuntime/threadRuntimeTypes';
import type { QueueEntry } from './distributedTypes';
import type { ReplayableWorkflowStep } from '@/backend/services/orchestration/recovery/replayContinuationEngine';
import type { RestoredCheckpointState } from '@/backend/services/orchestration/recovery/recoveryTypes';

// ────────────────────────────────────────────────────────────────────
// Payload schema (queue entry payload_json shape)
// ────────────────────────────────────────────────────────────────────

export const QUEUE_PAYLOAD_SCHEMA_VERSION = 1 as const;
export type QueuePayloadSchemaVersion = typeof QUEUE_PAYLOAD_SCHEMA_VERSION;

/**
 * Workflow types. The original 4 are generic; the Phase 24 extension
 * adds 4 domain-specific types that the domain step builders register
 * against. Schema version is unchanged — this is additive.
 */
export type WorkflowType =
  // ── Generic (Phase 23 defaults) ──
  | 'content_generation'
  | 'recovery'
  | 'replay_continuation'
  | 'topology_mutation'
  // ── Phase 24 domain-specific ──
  | 'long_form_generation'
  | 'campaign_execution'
  | 'social_publish'
  | 'provider_reconciliation';

/** Phase 24 — subset of WorkflowType that represents real domain workflows. */
export type DomainWorkflowType =
  | 'long_form_generation'
  | 'campaign_execution'
  | 'social_publish'
  | 'provider_reconciliation';

export interface QueuePayloadV1 {
  /** Schema version. Bump when wire shape changes. */
  schemaVersion: QueuePayloadSchemaVersion;
  /** Workflow type — drives step builder dispatch. */
  workflowType: WorkflowType;
  /** Authoritative execution id (matches QueueEntry.executionId). */
  executionId: string;
  /** Optional runtime session id (informational). */
  runtimeSessionId?: string;
  /** Optional thread id (informational). */
  threadId?: string;
  /** Authoritative companyId (matches QueueEntry.companyId). */
  companyId: string;
  /** Optional explicit checkpoint reference for replay continuation. */
  checkpointReference?: { checkpointId: string };
  /** Optional replay metadata (caller-defined; opaque to substrate). */
  replayMetadata?: Record<string, unknown>;
  /**
   * Optional idempotency hints — caller-supplied stable identifiers that
   * step builders attach to ReplayableWorkflowStep.idempotency entries.
   */
  idempotencyHints?: Array<{
    stepId: string;
    cls: 'node_insert' | 'topology_mutation' | 'scheduling' | 'billing' | 'recovery_action' | 'unknown';
    semanticParts: Array<string | number | boolean | null | undefined>;
  }>;
  /**
   * Workflow-type-specific parameters. Each step builder is responsible
   * for interpreting this shape.
   */
  workflowParams?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Hydrated payload (post-validation)
// ────────────────────────────────────────────────────────────────────

export interface HydratedQueuePayload {
  /** Original validated payload. */
  payload: QueuePayloadV1;
  /** The queue entry that carried this payload. */
  queueEntry: QueueEntry;
  /** The current execution row (fetched at hydration time). */
  execution: ExecutionRecord;
  /** Restored checkpoint chain (may be empty). */
  restored: RestoredCheckpointState | null;
}

// ────────────────────────────────────────────────────────────────────
// Step builder contract (per workflow type)
// ────────────────────────────────────────────────────────────────────

export interface WorkflowStepBuilderInput<TCtx> {
  hydrated: HydratedQueuePayload;
}

export interface WorkflowStepBuilderOutput<TCtx> {
  steps: ReplayableWorkflowStep<TCtx>[];
  context: TCtx;
}

/**
 * A per-workflow-type step builder. Registered with WorkflowStepRegistry.
 * Idempotent: given the same hydrated payload, must produce the same step
 * shape so replay continuation is deterministic.
 */
export interface WorkflowStepBuilder<TCtx = unknown> {
  workflowType: WorkflowType;
  /** Caller-readable identifier for logs / diagnostics. */
  name: string;
  /** Build the workflow. */
  build(input: WorkflowStepBuilderInput<TCtx>): Promise<WorkflowStepBuilderOutput<TCtx>>;
}

// ────────────────────────────────────────────────────────────────────
// Validation outputs
// ────────────────────────────────────────────────────────────────────

export type PayloadValidationCode =
  | 'ok'
  | 'missing_payload'
  | 'invalid_schema'
  | 'unsupported_schema_version'
  | 'unknown_workflow_type'
  | 'execution_id_mismatch'
  | 'company_id_mismatch'
  | 'execution_missing'
  | 'stale_execution'
  | 'checkpoint_reference_missing'
  | 'idempotency_keys_invalid';

export interface PayloadValidationResult {
  ok: boolean;
  code: PayloadValidationCode;
  detail: string;
}

// ────────────────────────────────────────────────────────────────────
// Continuity outputs
// ────────────────────────────────────────────────────────────────────

export type ContinuityVerdictCode =
  | 'continuous'
  | 'stale_payload'
  | 'duplicate_replay'
  | 'checkpoint_divergence'
  | 'execution_completed'
  | 'execution_missing';

export interface ContinuityVerdict {
  ok: boolean;
  code: ContinuityVerdictCode;
  detail: string;
  /** Suggested action for the caller. */
  recommendedAction: 'proceed' | 'suppress' | 'fail';
}

// ────────────────────────────────────────────────────────────────────
// Re-exports
// ────────────────────────────────────────────────────────────────────

export type { OrchestrationPhase, ReplayableWorkflowStep };
