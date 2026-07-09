/** Part 2/2 of durableDistributedRuntimeDiagnostics.ts — verbatim split (barrel preserved; importers unchanged). */
/**
 * Phase 21H — durableDistributedRuntimeDiagnostics
 *
 * Passive in-process aggregator dedicated to the DURABLE distributed
 * runtime. Sits ALONGSIDE the Phase 20H `distributedExecutionDiagnostics`
 * — both can coexist. This one focuses on signals unique to the
 * Supabase-backed runtime:
 *
 *   - queue persistence latency
 *   - atomic claim latency
 *   - visibility reclaim frequency
 *   - distributed heartbeat drift
 *   - queue replay frequency
 *   - worker failover frequency
 *   - dead-letter trends
 *   - queue compaction pressure
 *   - cross-instance ownership transfer frequency
 *
 * Plus forensic timelines for:
 *   - distributed queue lifecycle
 *   - ownership transfer chain
 *   - worker failover chain
 *   - replay reclamation chain
 *
 * SCOPE: pure aggregation. No I/O. Memory bounded (SAMPLE_CAP=256,
 * TIMELINE_CAP=64). Snapshot consumed by /api endpoints + stress harnesses.
 */

// ────────────────────────────────────────────────────────────────────
// Sample-list helpers (shared shape with other diagnostics modules)
// ────────────────────────────────────────────────────────────────────

import { TIMELINE_CAP, recordSample, summarize, type DurableDistributedRuntimeSnapshot, newState } from './durableDistributedRuntimeDiagnosticsModel';

let _state = newState();

export function push<T>(list: T[], entry: T): void {
  list.push(entry);
  while (list.length > TIMELINE_CAP) list.shift();
}

// ────────────────────────────────────────────────────────────────────
// Event ingestion
// ────────────────────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

export function recordEvent(event: string, payload: Payload): void {
  const atIso = new Date().toISOString();
  const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
  const executionId = typeof payload.executionId === 'string' ? payload.executionId : 'unknown';
  const workerId = typeof payload.workerId === 'string' ? payload.workerId : 'unknown';

  switch (event) {
    case 'execution_enqueued': {
      _state.enqueueStartTimes.set(queueEntryId, Date.now());
      push(_state.queueLifecycle, {
        atIso, queueEntryId, executionId, event: 'enqueued', detail: null,
      });
      return;
    }
    case 'execution_claimed': {
      const t0 = _state.enqueueStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.queuePersistence, Date.now() - t0);
        _state.enqueueStartTimes.delete(queueEntryId);
      }
      _state.claimStartTimes.set(queueEntryId, Date.now());
      push(_state.queueLifecycle, {
        atIso, queueEntryId, executionId, event: 'claimed', detail: workerId,
      });
      return;
    }
    case 'execution_visibility_reclaimed': {
      _state.visibilityReclaims += 1;
      push(_state.replayChain, {
        atIso, queueEntryId, executionId, reason: 'visibility_expired',
      });
      return;
    }
    case 'execution_completed': {
      const t0 = _state.claimStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.atomicClaim, Date.now() - t0);
        _state.claimStartTimes.delete(queueEntryId);
      }
      push(_state.queueLifecycle, {
        atIso, queueEntryId, executionId, event: 'completed', detail: workerId,
      });
      return;
    }
    case 'execution_dead_lettered': {
      _state.deadLetters += 1;
      push(_state.queueLifecycle, {
        atIso, queueEntryId, executionId, event: 'dead_lettered',
        detail: typeof payload.reason === 'string' ? payload.reason : null,
      });
      return;
    }
    case 'ownership_transfer_succeeded': {
      _state.crossInstanceTransfers += 1;
      push(_state.ownershipChain, {
        atIso, executionId,
        fromWorkerId: typeof payload.previousOwnerId === 'string' ? payload.previousOwnerId : null,
        toWorkerId: typeof payload.newOwnerId === 'string' ? payload.newOwnerId : workerId,
        reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
      });
      return;
    }
    case 'worker_marked_stale':
    case 'worker_offline': {
      _state.workerFailovers += 1;
      push(_state.failoverChain, {
        atIso, workerId,
        fromStatus: typeof payload.previous === 'string' ? payload.previous : null,
        toStatus: event === 'worker_marked_stale' ? 'stale' : 'offline',
        reason: typeof payload.reason === 'string' ? payload.reason : event,
      });
      return;
    }
    case 'worker_status_changed': {
      const current = typeof payload.current === 'string' ? payload.current : null;
      if (current === 'stale' || current === 'offline') {
        _state.workerFailovers += 1;
        push(_state.failoverChain, {
          atIso, workerId,
          fromStatus: typeof payload.previous === 'string' ? payload.previous : null,
          toStatus: current,
          reason: typeof payload.reason === 'string' ? payload.reason : 'status_changed',
        });
      }
      return;
    }
    case 'worker_heartbeat': {
      // No-op for drift counting; drift is detected via worker_marked_stale.
      return;
    }
    case 'queue_replay_completed':
    case 'queue_replay_started': {
      if (event === 'queue_replay_completed') {
        _state.queueReplaySweeps += 1;
      }
      return;
    }
    case 'queue_replay_reclaim': {
      const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown';
      if (reason === 'dead_worker_reclaim') {
        // Phase 22E — targeted reclaim path.
        _state.targetedReclaimEvents += 1;
        _state.staleWorkerReclaimSuccesses += 1;
        const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
        const workerId = typeof payload.workerId === 'string' ? payload.workerId : 'unknown';
        push(_state.reclaimOwnershipChain, {
          atIso, queueEntryId, workerId,
          outcome: 'reclaimed', reason,
        });
      } else {
        // Visibility-expired path (Phase 21).
        _state.visibilityReclaims += (typeof payload.count === 'number' ? payload.count : 1);
      }
      return;
    }
    case 'compaction_completed': {
      // Only increment the compaction event counter here. Per-target totals
      // are populated by `compaction_archive_summary` to avoid double-counting.
      _state.queueCompactions += 1;
      return;
    }
    case 'compaction_archive_summary': {
      const deleted = typeof payload.deleted === 'number' ? payload.deleted : 0;
      const target = typeof payload.target === 'string' ? payload.target : null;
      if (target === 'queue') _state.queueArchivedTotal += deleted;
      if (target === 'workers') _state.workerArchivedTotal += deleted;
      if (target === 'checkpoints') _state.checkpointArchivedTotal += deleted;
      return;
    }
    // ── Phase 22E — activation events ──
    case 'distributed_runtime_activation_started': {
      _state.runtimeActivationsStarted += 1;
      _state.activationStartedAtMs = Date.now();
      push(_state.runtimeActivationChain, {
        atIso, event: 'started', durationMs: null,
        failedValidator: null, detail: null,
      });
      return;
    }
    case 'distributed_runtime_activation_succeeded': {
      _state.runtimeActivationsSucceeded += 1;
      const dur = typeof payload.durationMs === 'number'
        ? payload.durationMs
        : (typeof _state.activationStartedAtMs === 'number' ? Date.now() - _state.activationStartedAtMs : null);
      _state.activationStartedAtMs = null;
      if (dur !== null) recordSample(_state.runtimeActivationLatency, dur);
      push(_state.runtimeActivationChain, {
        atIso, event: 'succeeded', durationMs: dur,
        failedValidator: null, detail: null,
      });
      return;
    }
    case 'distributed_runtime_activation_failed': {
      _state.runtimeActivationsFailed += 1;
      const dur = typeof payload.durationMs === 'number'
        ? payload.durationMs
        : (typeof _state.activationStartedAtMs === 'number' ? Date.now() - _state.activationStartedAtMs : null);
      _state.activationStartedAtMs = null;
      if (dur !== null) recordSample(_state.runtimeActivationLatency, dur);
      const failedValidator = typeof payload.failedValidator === 'string' ? payload.failedValidator : null;
      if (failedValidator === 'watchdog') _state.activationWatchdogTrips += 1;
      push(_state.runtimeActivationChain, {
        atIso, event: 'failed', durationMs: dur,
        failedValidator,
        detail: typeof payload.reason === 'string' ? payload.reason : null,
      });
      return;
    }
    case 'distributed_runtime_activation_validator_passed': {
      const name = typeof payload.name === 'string' ? payload.name : 'unknown';
      const detail = typeof payload.detail === 'string' ? payload.detail : '';
      push(_state.startupValidationChain, { atIso, validator: name, ok: true, detail });
      return;
    }
    case 'distributed_runtime_activation_validator_failed': {
      _state.activationValidationFailures += 1;
      const name = typeof payload.name === 'string' ? payload.name : 'unknown';
      const detail = typeof payload.detail === 'string' ? payload.detail : '';
      push(_state.startupValidationChain, { atIso, validator: name, ok: false, detail });
      return;
    }
    // ── Phase 22E — reclaim events ──
    case 'reclaim_validation_started': {
      const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
      _state.reclaimStartTimes.set(queueEntryId, Date.now());
      return;
    }
    case 'reclaim_validation_succeeded': {
      const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
      const t0 = _state.reclaimStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.reclaimLatency, Date.now() - t0);
        _state.reclaimStartTimes.delete(queueEntryId);
      }
      return;
    }
    case 'reclaim_validation_failed': {
      _state.reclaimValidationFailures += 1;
      const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
      _state.reclaimStartTimes.delete(queueEntryId);
      const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown';
      if (reason === 'reclaim_within_suppression_window') _state.reclaimSuppressionEvents += 1;
      const workerId = typeof payload.targetWorkerId === 'string' ? payload.targetWorkerId : 'unknown';
      push(_state.reclaimOwnershipChain, {
        atIso, queueEntryId, workerId,
        outcome: 'refused', reason,
      });
      return;
    }
    case 'reclaim_split_brain_prevented': {
      _state.reclaimSplitBrainPreventions += 1;
      const queueEntryId = typeof payload.queueEntryId === 'string' ? payload.queueEntryId : 'unknown';
      const workerId = typeof payload.targetWorkerId === 'string' ? payload.targetWorkerId : 'unknown';
      const reason = typeof payload.reason === 'string' ? payload.reason : 'split_brain';
      push(_state.reclaimOwnershipChain, {
        atIso, queueEntryId, workerId,
        outcome: 'refused', reason,
      });
      return;
    }
    // ── Phase 23G — workflow execution events ──
    case 'queue_payload_hydration_success': {
      // Latency derived from inflight if caller marked start.
      const t0 = _state.hydrationStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.queuePayloadHydrationLatency, Date.now() - t0);
        _state.hydrationStartTimes.delete(queueEntryId);
      }
      const wf = typeof payload.workflowType === 'string' ? payload.workflowType : 'unknown';
      const cl = typeof payload.chainLength === 'number' ? payload.chainLength : 0;
      push(_state.queuePayloadChain, {
        atIso, queueEntryId, executionId,
        outcome: 'hydrated', code: 'ok', detail: `wf=${wf} chain=${cl}`,
      });
      if (cl > 0) {
        _state.checkpointResumeEvents += 1;
        push(_state.checkpointResumeChain, {
          atIso, queueEntryId, executionId,
          chainLength: cl, verdict: 'hydrated',
        });
      }
      return;
    }
    case 'queue_payload_hydration_failure': {
      _state.payloadRejectionEvents += 1;
      _state.hydrationStartTimes.delete(queueEntryId);
      const code = typeof payload.code === 'string' ? payload.code : 'unknown';
      const detail = typeof payload.detail === 'string' ? payload.detail : null;
      push(_state.queuePayloadChain, {
        atIso, queueEntryId, executionId,
        outcome: 'rejected', code, detail,
      });
      return;
    }
    case 'payload_validation_succeeded': {
      // Optional — increments would duplicate hydration_success; do nothing.
      return;
    }
    case 'payload_validation_failed': {
      _state.payloadRejectionEvents += 1;
      const code = typeof payload.code === 'string' ? payload.code : 'unknown';
      push(_state.queuePayloadChain, {
        atIso, queueEntryId: 'unknown', executionId,
        outcome: 'rejected', code,
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      });
      return;
    }
    case 'payload_version_mismatch': {
      _state.payloadRejectionEvents += 1;
      _state.workflowReplayDivergenceEvents += 1;
      return;
    }
    case 'queue_checkpoint_continuity_validated': {
      const cl = typeof payload.chainLength === 'number' ? payload.chainLength : 0;
      if (cl > 0) {
        push(_state.checkpointResumeChain, {
          atIso, queueEntryId, executionId,
          chainLength: cl, verdict: 'continuous',
        });
      }
      return;
    }
    case 'queue_checkpoint_continuity_suppressed': {
      _state.replaySuppressionEvents += 1;
      return;
    }
    case 'queue_checkpoint_continuity_failed': {
      _state.workflowReplayDivergenceEvents += 1;
      return;
    }
    case 'workflow_execution_bridge_dispatch': {
      _state.workflowDispatchStartTimes.set(queueEntryId, Date.now());
      const wf = typeof payload.workflowType === 'string' ? payload.workflowType : 'unknown';
      const sc = typeof payload.stepCount === 'number' ? payload.stepCount : 0;
      push(_state.workflowExecutionChain, {
        atIso, queueEntryId, executionId,
        workflowType: wf, stepCount: sc, durationMs: null,
        outcome: 'dispatched', detail: null,
      });
      return;
    }
    case 'workflow_execution_bridge_suppressed': {
      _state.replaySuppressionEvents += 1;
      push(_state.workflowExecutionChain, {
        atIso, queueEntryId, executionId,
        workflowType: 'unknown', stepCount: 0, durationMs: null,
        outcome: 'suppressed',
        detail: typeof payload.code === 'string' ? payload.code : null,
      });
      return;
    }
    case 'workflow_execution_bridge_refused': {
      _state.payloadRejectionEvents += 1;
      push(_state.workflowExecutionChain, {
        atIso, queueEntryId, executionId,
        workflowType: 'unknown', stepCount: 0, durationMs: null,
        outcome: 'refused',
        detail: typeof payload.code === 'string' ? payload.code : null,
      });
      return;
    }
    case 'workflow_execution_bridge_failed': {
      const t0 = _state.workflowDispatchStartTimes.get(queueEntryId);
      const dur = typeof t0 === 'number' ? Date.now() - t0 : null;
      if (dur !== null) {
        recordSample(_state.workflowExecutionLatency, dur);
        _state.workflowDispatchStartTimes.delete(queueEntryId);
      }
      push(_state.workflowExecutionChain, {
        atIso, queueEntryId, executionId,
        workflowType: 'unknown', stepCount: 0, durationMs: dur,
        outcome: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'workflow_builder_dispatch_started': {
      _state.workflowDispatchStartTimes.set(queueEntryId, Date.now());
      return;
    }
    case 'workflow_builder_dispatch_succeeded': {
      const t0 = _state.workflowDispatchStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.workflowBuildLatency, Date.now() - t0);
        _state.workflowDispatchStartTimes.delete(queueEntryId);
      }
      return;
    }
    case 'workflow_builder_dispatch_failed':
    case 'workflow_builder_missing': {
      const t0 = _state.workflowDispatchStartTimes.get(queueEntryId);
      if (typeof t0 === 'number') {
        recordSample(_state.workflowBuildLatency, Date.now() - t0);
        _state.workflowDispatchStartTimes.delete(queueEntryId);
      }
      _state.workflowReplayDivergenceEvents += 1;
      return;
    }
    // ── Phase 24G — domain execution events ──
    case 'domain_long_form_started': {
      _state.longFormDispatchStartTimes.set(executionId, Date.now());
      const generationId = typeof payload.generationId === 'string' ? payload.generationId : 'unknown';
      push(_state.longFormExecutionChain, {
        atIso, executionId, generationId,
        event: 'started', detail: null,
      });
      return;
    }
    case 'domain_long_form_section_completed': {
      const generationId = typeof payload.generationId === 'string' ? payload.generationId : 'unknown';
      const sectionId = typeof payload.sectionId === 'string' ? payload.sectionId : null;
      push(_state.longFormExecutionChain, {
        atIso, executionId, generationId,
        event: 'section_completed', detail: sectionId,
      });
      return;
    }
    case 'domain_long_form_finalized': {
      const t0 = _state.longFormDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.longFormExecutionLatency, Date.now() - t0);
        _state.longFormDispatchStartTimes.delete(executionId);
      }
      const generationId = typeof payload.generationId === 'string' ? payload.generationId : 'unknown';
      push(_state.longFormExecutionChain, {
        atIso, executionId, generationId,
        event: 'finalized', detail: null,
      });
      return;
    }
    case 'domain_long_form_regeneration_suppressed': {
      _state.regenerationReplayFrequency += 1;
      const generationId = typeof payload.generationId === 'string' ? payload.generationId : 'unknown';
      push(_state.longFormExecutionChain, {
        atIso, executionId, generationId,
        event: 'suppressed',
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      });
      return;
    }
    case 'domain_publish_started': {
      _state.publishDispatchStartTimes.set(executionId, Date.now());
      push(_state.providerPublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        event: 'started', detail: null,
      });
      return;
    }
    case 'domain_publish_completed': {
      const t0 = _state.publishDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.publishExecutionLatency, Date.now() - t0);
        _state.publishDispatchStartTimes.delete(executionId);
      }
      push(_state.providerPublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        event: 'completed', detail: null,
      });
      return;
    }
    case 'domain_publish_suppressed': {
      _state.duplicatePublishSuppressionFrequency += 1;
      push(_state.providerPublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        event: 'suppressed',
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      });
      return;
    }
    case 'domain_publish_failed': {
      const t0 = _state.publishDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.publishExecutionLatency, Date.now() - t0);
        _state.publishDispatchStartTimes.delete(executionId);
      }
      push(_state.providerPublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        event: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'domain_campaign_started': {
      _state.campaignDispatchStartTimes.set(executionId, Date.now());
      const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown';
      push(_state.campaignProgressionChain, {
        atIso, executionId, campaignId, postId: null,
        event: 'started', detail: null,
      });
      return;
    }
    case 'domain_campaign_post_completed': {
      const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown';
      const postId = typeof payload.postId === 'string' ? payload.postId : null;
      push(_state.campaignProgressionChain, {
        atIso, executionId, campaignId, postId,
        event: 'post_completed', detail: null,
      });
      return;
    }
    case 'domain_campaign_finalized': {
      const t0 = _state.campaignDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.campaignExecutionLatency, Date.now() - t0);
        _state.campaignDispatchStartTimes.delete(executionId);
      }
      const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown';
      push(_state.campaignProgressionChain, {
        atIso, executionId, campaignId, postId: null,
        event: 'finalized', detail: null,
      });
      return;
    }
    case 'domain_campaign_diverged': {
      _state.campaignReplayDivergence += 1;
      const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown';
      push(_state.campaignProgressionChain, {
        atIso, executionId, campaignId, postId: null,
        event: 'diverged',
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      });
      return;
    }
    case 'domain_reconciliation_started': {
      _state.reconciliationDispatchStartTimes.set(executionId, Date.now());
      push(_state.reconciliationChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        event: 'started', detail: null,
      });
      return;
    }
    case 'domain_reconciliation_reconciled': {
      const t0 = _state.reconciliationDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.reconciliationExecutionLatency, Date.now() - t0);
        _state.reconciliationDispatchStartTimes.delete(executionId);
      }
      push(_state.reconciliationChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        event: 'reconciled', detail: null,
      });
      return;
    }
    case 'domain_reconciliation_suppressed': {
      _state.reconciliationReplaySuppression += 1;
      push(_state.reconciliationChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        event: 'suppressed',
        detail: typeof payload.detail === 'string' ? payload.detail : null,
      });
      return;
    }
    case 'domain_reconciliation_failed': {
      const t0 = _state.reconciliationDispatchStartTimes.get(executionId);
      if (typeof t0 === 'number') {
        recordSample(_state.reconciliationExecutionLatency, Date.now() - t0);
        _state.reconciliationDispatchStartTimes.delete(executionId);
      }
      push(_state.reconciliationChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        event: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    // ── Phase 26H — production live-execution events ──
    case 'domain_long_form_live_execution_started': {
      _state.liveLongFormExecutionFrequency += 1;
      push(_state.liveLongFormChain, {
        atIso, executionId,
        generationId: typeof payload.generationId === 'string' ? payload.generationId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'started', detail: null,
      });
      return;
    }
    case 'domain_long_form_live_execution_completed': {
      push(_state.liveLongFormChain, {
        atIso, executionId,
        generationId: typeof payload.generationId === 'string' ? payload.generationId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'completed', detail: null,
      });
      return;
    }
    case 'domain_long_form_live_execution_failed': {
      push(_state.liveLongFormChain, {
        atIso, executionId,
        generationId: typeof payload.generationId === 'string' ? payload.generationId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'domain_publish_live_execution_started': {
      _state.liveProviderPublishFrequency += 1;
      push(_state.livePublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'started', detail: null,
      });
      return;
    }
    case 'domain_publish_live_execution_completed': {
      push(_state.livePublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'completed', detail: null,
      });
      return;
    }
    case 'domain_publish_live_execution_failed': {
      push(_state.livePublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'domain_publish_live_execution_suppressed': {
      _state.replaySafePublishSuppressions += 1;
      push(_state.livePublishChain, {
        atIso, executionId,
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        contentFingerprint: typeof payload.contentFingerprint === 'string' ? payload.contentFingerprint : 'unknown',
        op: 'publish',
        outcome: 'suppressed',
        detail: typeof payload.reason === 'string' ? payload.reason : null,
      });
      return;
    }
    case 'domain_campaign_live_execution_started': {
      _state.campaignReplayRecoveries += 1;
      push(_state.campaignReplayChain, {
        atIso, executionId,
        campaignId: typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'started', detail: null,
      });
      return;
    }
    case 'domain_campaign_live_execution_completed': {
      push(_state.campaignReplayChain, {
        atIso, executionId,
        campaignId: typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'completed', detail: null,
      });
      return;
    }
    case 'domain_campaign_live_execution_failed': {
      push(_state.campaignReplayChain, {
        atIso, executionId,
        campaignId: typeof payload.campaignId === 'string' ? payload.campaignId : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'domain_reconciliation_live_execution_started': {
      _state.reconciliationReplayRecoveries += 1;
      push(_state.reconciliationReplayChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'started', detail: null,
      });
      return;
    }
    case 'domain_reconciliation_live_execution_completed': {
      push(_state.reconciliationReplayChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'completed', detail: null,
      });
      return;
    }
    case 'domain_reconciliation_live_execution_failed': {
      push(_state.reconciliationReplayChain, {
        atIso, executionId,
        rowId: typeof payload.rowId === 'string' ? payload.rowId : 'unknown',
        provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
        op: typeof payload.op === 'string' ? payload.op : 'unknown',
        outcome: 'failed',
        detail: typeof payload.error === 'string' ? payload.error : null,
      });
      return;
    }
    case 'cross_run_forensic_divergence_detected': {
      _state.crossRunForensicDivergenceFrequency += 1;
      return;
    }
    default:
      return;
  }
}

/**
 * Phase 23G — caller-side helper to mark the start of a payload
 * hydration. The aggregator computes latency on the matching
 * `queue_payload_hydration_success` event.
 */
export function markHydrationStart(queueEntryId: string): void {
  _state.hydrationStartTimes.set(queueEntryId, Date.now());
}

/** Telemetry sink that forwards events into the aggregator. */
export const durableDistributedRuntimeTelemetrySink = {
  emit(event: string, payload: Payload): void { recordEvent(event, payload); },
};

// ────────────────────────────────────────────────────────────────────
// Snapshot
// ────────────────────────────────────────────────────────────────────

export function getDurableDistributedRuntimeSnapshot(): DurableDistributedRuntimeSnapshot {
  return {
    snapshotAtIso: new Date().toISOString(),
    queuePersistenceLatency: summarize(_state.queuePersistence),
    atomicClaimLatency: summarize(_state.atomicClaim),
    visibilityReclaimEvents: _state.visibilityReclaims,
    queueReplaySweeps: _state.queueReplaySweeps,
    workerFailoverEvents: _state.workerFailovers,
    deadLetterEvents: _state.deadLetters,
    crossInstanceOwnershipTransfers: _state.crossInstanceTransfers,
    heartbeatDriftEvents: _state.heartbeatDrifts,
    queueCompactionEvents: _state.queueCompactions,
    queueArchivedTotal: _state.queueArchivedTotal,
    workerArchivedTotal: _state.workerArchivedTotal,
    checkpointArchivedTotal: _state.checkpointArchivedTotal,
    // Phase 22E — activation + reclaim aggregates
    runtimeActivationsStarted: _state.runtimeActivationsStarted,
    runtimeActivationsSucceeded: _state.runtimeActivationsSucceeded,
    runtimeActivationsFailed: _state.runtimeActivationsFailed,
    runtimeActivationLatency: summarize(_state.runtimeActivationLatency),
    activationValidationFailures: _state.activationValidationFailures,
    activationWatchdogTrips: _state.activationWatchdogTrips,
    targetedReclaimEvents: _state.targetedReclaimEvents,
    reclaimSuppressionEvents: _state.reclaimSuppressionEvents,
    reclaimValidationFailures: _state.reclaimValidationFailures,
    reclaimSplitBrainPreventions: _state.reclaimSplitBrainPreventions,
    staleWorkerReclaimSuccesses: _state.staleWorkerReclaimSuccesses,
    reclaimLatency: summarize(_state.reclaimLatency),
    distributedQueueLifecycle: [..._state.queueLifecycle],
    ownershipTransferChain: [..._state.ownershipChain],
    workerFailoverChain: [..._state.failoverChain],
    replayReclamationChain: [..._state.replayChain],
    runtimeActivationChain: [..._state.runtimeActivationChain],
    reclaimOwnershipChain: [..._state.reclaimOwnershipChain],
    startupValidationChain: [..._state.startupValidationChain],
    // Phase 23G workflow execution
    queuePayloadHydrationLatency: summarize(_state.queuePayloadHydrationLatency),
    workflowBuildLatency: summarize(_state.workflowBuildLatency),
    workflowExecutionLatency: summarize(_state.workflowExecutionLatency),
    payloadRejectionEvents: _state.payloadRejectionEvents,
    replaySuppressionEvents: _state.replaySuppressionEvents,
    checkpointResumeEvents: _state.checkpointResumeEvents,
    workflowReplayDivergenceEvents: _state.workflowReplayDivergenceEvents,
    queuePayloadChain: [..._state.queuePayloadChain],
    workflowExecutionChain: [..._state.workflowExecutionChain],
    checkpointResumeChain: [..._state.checkpointResumeChain],
    // Phase 24G
    longFormExecutionLatency: summarize(_state.longFormExecutionLatency),
    publishExecutionLatency: summarize(_state.publishExecutionLatency),
    campaignExecutionLatency: summarize(_state.campaignExecutionLatency),
    reconciliationExecutionLatency: summarize(_state.reconciliationExecutionLatency),
    regenerationReplayFrequency: _state.regenerationReplayFrequency,
    duplicatePublishSuppressionFrequency: _state.duplicatePublishSuppressionFrequency,
    campaignReplayDivergence: _state.campaignReplayDivergence,
    reconciliationReplaySuppression: _state.reconciliationReplaySuppression,
    longFormExecutionChain: [..._state.longFormExecutionChain],
    providerPublishChain: [..._state.providerPublishChain],
    campaignProgressionChain: [..._state.campaignProgressionChain],
    reconciliationChain: [..._state.reconciliationChain],
    // Phase 26H
    liveLongFormExecutionFrequency: _state.liveLongFormExecutionFrequency,
    liveProviderPublishFrequency: _state.liveProviderPublishFrequency,
    replaySafePublishSuppressions: _state.replaySafePublishSuppressions,
    campaignReplayRecoveries: _state.campaignReplayRecoveries,
    reconciliationReplayRecoveries: _state.reconciliationReplayRecoveries,
    crossRunForensicDivergenceFrequency: _state.crossRunForensicDivergenceFrequency,
    liveLongFormChain: [..._state.liveLongFormChain],
    livePublishChain: [..._state.livePublishChain],
    campaignReplayChain: [..._state.campaignReplayChain],
    reconciliationReplayChain: [..._state.reconciliationReplayChain],
  };
}

/** Test helper: zero the aggregator. */
export function _resetDurableDistributedRuntimeDiagnostics(): void { _state = newState(); }

