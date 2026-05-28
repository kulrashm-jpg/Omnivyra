/**
 * Phase 23E — QueueCheckpointContinuityCoordinator
 *
 * Determines whether the proposed queue-driven workflow execution is
 * CONTINUOUS with the durable checkpoint state, or whether it should
 * be suppressed / rejected.
 *
 * GUARANTEES (per spec):
 *   - queue execution resumes from latest durable checkpoint
 *   - latest replay-safe continuation state
 *   - latest idempotency continuity state
 *
 * CAPABILITIES:
 *   - reconcile queue payload vs checkpoint  → continuity verdict
 *   - suppress stale queue replay              → returns 'stale_payload'
 *   - suppress duplicate replay continuation   → returns 'duplicate_replay'
 *   - validate execution continuity chain      → returns 'checkpoint_divergence'
 *
 * SCOPE: verdict generation ONLY. The caller (distributed runner) acts
 * on it: 'continuous' → proceed, 'suppress' → ack as completed without
 * re-running side effects, 'fail' → ack as failed for the retry policy.
 */

import type {
  ContinuityVerdict,
  ContinuityVerdictCode,
  HydratedQueuePayload,
} from './workflowExecutionTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ContinuityTelemetryEvent =
  | 'queue_checkpoint_continuity_validated'
  | 'queue_checkpoint_continuity_suppressed'
  | 'queue_checkpoint_continuity_failed';

export interface ContinuityTelemetrySink {
  emit(event: ContinuityTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ContinuityTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'queue_checkpoint_continuity_failed') {
        console.warn(`[continuity_coord] ${line}`);
      } else {
        console.log(`[continuity_coord] ${line}`);
      }
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Phase 24F — Domain continuity rule
// ────────────────────────────────────────────────────────────────────

/**
 * Pluggable per-domain continuity rule. Operators can register additional
 * rules to handle workflow types beyond the generic ones. The first rule
 * that returns a non-null verdict short-circuits.
 */
export interface DomainContinuityRule {
  /** The WorkflowType this rule applies to. */
  workflowType: string;
  /** Identifier for telemetry / forensics. */
  name: string;
  /**
   * Evaluate the rule. Return null to defer to the next rule (or the
   * generic coordinator path); return a ContinuityVerdict to short-circuit.
   */
  evaluate(hydrated: HydratedQueuePayload): ContinuityVerdict | null;
}

// ────────────────────────────────────────────────────────────────────
// Coordinator
// ────────────────────────────────────────────────────────────────────

export interface QueueCheckpointContinuityCoordinatorOptions {
  telemetry?: ContinuityTelemetrySink;
  /** Phase 24F — optional per-domain continuity rules evaluated FIRST. */
  domainRules?: DomainContinuityRule[];
}

export interface QueueCheckpointContinuityCoordinator {
  validate(hydrated: HydratedQueuePayload): ContinuityVerdict;
}

function verdict(
  code: ContinuityVerdictCode,
  detail: string,
  recommendedAction: 'proceed' | 'suppress' | 'fail',
): ContinuityVerdict {
  return { ok: code === 'continuous', code, detail, recommendedAction };
}

export function createQueueCheckpointContinuityCoordinator(
  options?: QueueCheckpointContinuityCoordinatorOptions,
): QueueCheckpointContinuityCoordinator {
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const domainRules = options?.domainRules ?? [];
  const rulesByType = new Map<string, DomainContinuityRule[]>();
  for (const rule of domainRules) {
    const list = rulesByType.get(rule.workflowType) ?? [];
    list.push(rule);
    rulesByType.set(rule.workflowType, list);
  }

  return {
    validate(hydrated) {
      const { payload, execution, restored, queueEntry } = hydrated;

      // Phase 24F — domain rules evaluated FIRST. First rule to return a
      // non-null verdict short-circuits the generic path.
      const matching = rulesByType.get(payload.workflowType);
      if (matching && matching.length > 0) {
        for (const rule of matching) {
          let domainV: ContinuityVerdict | null = null;
          try {
            domainV = rule.evaluate(hydrated);
          } catch (err) {
            // Rule errors are non-fatal — log and continue to next rule.
            telemetry.emit('queue_checkpoint_continuity_failed', {
              executionId: execution.executionId,
              queueEntryId: queueEntry.queueEntryId,
              code: 'rule_error', detail: `${rule.name}: ${(err as Error)?.message ?? String(err)}`,
            });
          }
          if (domainV) {
            if (domainV.recommendedAction === 'suppress') {
              telemetry.emit('queue_checkpoint_continuity_suppressed', {
                executionId: execution.executionId,
                queueEntryId: queueEntry.queueEntryId,
                code: domainV.code, ruleName: rule.name,
              });
            } else if (domainV.recommendedAction === 'fail') {
              telemetry.emit('queue_checkpoint_continuity_failed', {
                executionId: execution.executionId,
                queueEntryId: queueEntry.queueEntryId,
                code: domainV.code, ruleName: rule.name,
              });
            } else {
              telemetry.emit('queue_checkpoint_continuity_validated', {
                executionId: execution.executionId,
                queueEntryId: queueEntry.queueEntryId,
                code: domainV.code, ruleName: rule.name,
              });
            }
            return domainV;
          }
        }
      }

      // 1. Execution-terminal short-circuit.
      if (execution.executionStatus === 'completed') {
        const v = verdict(
          'execution_completed',
          `execution ${execution.executionId} already completed; suppressing queue replay`,
          'suppress',
        );
        telemetry.emit('queue_checkpoint_continuity_suppressed', {
          executionId: execution.executionId, code: v.code,
          queueEntryId: queueEntry.queueEntryId,
        });
        return v;
      }
      if (execution.executionStatus === 'failed') {
        const v = verdict(
          'execution_missing',
          `execution ${execution.executionId} is failed (non-recoverable); refusing replay`,
          'fail',
        );
        telemetry.emit('queue_checkpoint_continuity_failed', {
          executionId: execution.executionId, code: v.code,
          queueEntryId: queueEntry.queueEntryId,
        });
        return v;
      }

      // 2. Stale payload check — the payload references a checkpoint that
      // has been SUPERSEDED by a newer one in the restored chain.
      if (payload.checkpointReference && restored && restored.chain.length > 0) {
        const referenced = payload.checkpointReference.checkpointId;
        const idx = restored.chain.findIndex((c) => c.checkpointId === referenced);
        if (idx === -1) {
          // Referenced checkpoint not in chain at all — payload corruption
          // (we shouldn't get here because the ExecutionPayloadGovernor
          // would have caught it; defensive double-check).
          const v = verdict(
            'checkpoint_divergence',
            `payload references checkpoint '${referenced}' that is absent from the restored chain`,
            'fail',
          );
          telemetry.emit('queue_checkpoint_continuity_failed', {
            executionId: execution.executionId, code: v.code,
            queueEntryId: queueEntry.queueEntryId,
          });
          return v;
        }
        // The chain is sorted ASC by taken_at. If the referenced checkpoint
        // is NOT the latest one, the queue payload is stale.
        if (idx !== restored.chain.length - 1) {
          const v = verdict(
            'stale_payload',
            `referenced checkpoint at index ${idx} of ${restored.chain.length}; latest is '${restored.latestCheckpointId}'`,
            'suppress',
          );
          telemetry.emit('queue_checkpoint_continuity_suppressed', {
            executionId: execution.executionId, code: v.code,
            queueEntryId: queueEntry.queueEntryId,
          });
          return v;
        }
      }

      // 3. Duplicate replay check — for replay_continuation payloads,
      // an empty pending-set means the workflow is already done.
      if (payload.workflowType === 'replay_continuation' && restored) {
        if (restored.completedNodeOperationIds.length > 0 &&
            restored.pendingNodeOperationIds.length === 0) {
          const v = verdict(
            'duplicate_replay',
            `replay continuation requested but checkpoint shows no pending operations`,
            'suppress',
          );
          telemetry.emit('queue_checkpoint_continuity_suppressed', {
            executionId: execution.executionId, code: v.code,
            queueEntryId: queueEntry.queueEntryId,
          });
          return v;
        }
      }

      // 4. Checkpoint integrity check (forwarded from Phase 19B).
      if (restored && restored.integrity.status === 'corrupted') {
        const v = verdict(
          'checkpoint_divergence',
          `checkpoint chain is corrupted (integrity=0): ${restored.integrity.issues.join('; ')}`,
          'fail',
        );
        telemetry.emit('queue_checkpoint_continuity_failed', {
          executionId: execution.executionId, code: v.code,
          queueEntryId: queueEntry.queueEntryId,
        });
        return v;
      }

      const v = verdict(
        'continuous',
        'queue payload continuous with checkpoint chain',
        'proceed',
      );
      telemetry.emit('queue_checkpoint_continuity_validated', {
        executionId: execution.executionId, code: v.code,
        queueEntryId: queueEntry.queueEntryId,
        chainLength: restored?.chain.length ?? 0,
      });
      return v;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Default singleton
// ────────────────────────────────────────────────────────────────────

let _default: QueueCheckpointContinuityCoordinator | null = null;
export function getDefaultQueueCheckpointContinuityCoordinator(): QueueCheckpointContinuityCoordinator {
  if (!_default) _default = createQueueCheckpointContinuityCoordinator();
  return _default;
}
export function setDefaultQueueCheckpointContinuityCoordinator(c: QueueCheckpointContinuityCoordinator): void {
  _default = c;
}
