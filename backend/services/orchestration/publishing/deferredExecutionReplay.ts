/**
 * deferredExecutionReplay — Phase-2 Step-34 (PREPARATION ONLY).
 *
 * Discovers deferred executions that have since become canonical-ready and
 * produces a replay summary. NO autonomous cron / no enqueue side-effects
 * here — this is the read-only preparation layer a future scheduler/cron
 * (or a manual requeue endpoint) will consume. Fail-soft, never throws.
 */

import { resolveAuthoritativePublishing } from './authoritativePublishingResolver';
import type { SchedulerStatus } from './publishingEligibilityProjection';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export interface DeferredExecutionRecord {
  campaign_id: string;
  execution_id: string;
  canonical_scheduler_state: SchedulerStatus | 'UNKNOWN';
  /** Now enqueueable again ⇒ a real replay candidate. */
  replay_eligible: boolean;
  retry_reason: string;
  orchestration_version: string;
}

export interface DeferredReplaySummary {
  campaign_id: string;
  scheduler_mode: string;
  evaluated_count: number;
  replay_candidate_count: number;
  still_deferred_count: number;
  records: DeferredExecutionRecord[];
}

const READY: Array<SchedulerStatus | 'UNKNOWN'> = ['PUBLISH_READY', 'AI_READY', 'SCHEDULABLE'];

/**
 * Re-evaluate previously-deferred executions. `deferredIds` is the
 * ExecutionPruningSummary.deferred_requeue_candidates set.
 */
export async function prepareDeferredReplay(
  campaignId: string,
  deferredIds: string[],
): Promise<DeferredReplaySummary> {
  const summary: DeferredReplaySummary = {
    campaign_id: campaignId,
    scheduler_mode: 'SHADOW',
    evaluated_count: 0,
    replay_candidate_count: 0,
    still_deferred_count: 0,
    records: [],
  };
  if (!campaignId || !Array.isArray(deferredIds) || deferredIds.length === 0) return summary;

  try {
    for (const executionId of deferredIds) {
      const r = await resolveAuthoritativePublishing(campaignId, executionId).catch(() => null);
      summary.evaluated_count += 1;
      const status = (r?.projection?.scheduler_status ?? 'UNKNOWN') as SchedulerStatus | 'UNKNOWN';
      summary.scheduler_mode = r?.mode ?? summary.scheduler_mode;
      const replayEligible = READY.includes(status);
      const record: DeferredExecutionRecord = {
        campaign_id: campaignId,
        execution_id: executionId,
        canonical_scheduler_state: status,
        replay_eligible: replayEligible,
        retry_reason: replayEligible ? 'became_ready' : `still_${String(status).toLowerCase()}`,
        orchestration_version: r?.projection?.orchestration_version ?? 'unknown',
      };
      summary.records.push(record);
      if (replayEligible) {
        summary.replay_candidate_count += 1;
        LOG('DEFERRED_REQUEUE_READY', {
          campaign_id: campaignId,
          execution_id: executionId,
          canonical_scheduler_state: status,
          replay_eligible: true,
          scheduler_mode: record.orchestration_version ? summary.scheduler_mode : 'SHADOW',
        });
      } else {
        summary.still_deferred_count += 1;
      }
    }
    LOG('PRUNING_SUMMARY', {
      campaign_id: campaignId,
      replay_preparation: true,
      evaluated: summary.evaluated_count,
      replay_candidates: summary.replay_candidate_count,
      still_deferred: summary.still_deferred_count,
      scheduler_mode: summary.scheduler_mode,
    });
    return summary;
  } catch (e) {
    LOG('PRUNING_FALLBACK', {
      campaign_id: campaignId,
      reason: `replay_prep_exception:${(e as Error)?.message ?? 'unknown'}`,
      fallback_active: true,
    });
    return summary;
  }
}

/**
 * Phase-2 Step-35: state-aware replay scan. Re-resolves each deferred
 * execution's canonical state and partitions it for the coordinator:
 *
 *   PUBLISH_READY / AI_READY / SCHEDULABLE → replay_ready (auto-replayable)
 *   WAITING_UPLOAD   → still_deferred (replay only once upload satisfied)
 *   WAITING_GENERATION → still_deferred (replay after AI generation)
 *   WAITING_APPROVAL → still_deferred (replay after approval)
 *   BLOCKED          → permanently_blocked (NEVER auto-replay; operator
 *                      / manual visibility only)
 *
 * Eligibility derives ONLY from the canonical projection. Fail-soft.
 */
export interface ReplayScanResult {
  campaign_id: string;
  scheduler_mode: string;
  replay_ready: string[];
  still_deferred: string[];
  permanently_blocked: string[];
  records: DeferredExecutionRecord[];
}

const WAITING: Array<SchedulerStatus | 'UNKNOWN'> = [
  'WAITING_UPLOAD',
  'WAITING_GENERATION',
  'WAITING_APPROVAL',
];

export async function scanReplayCandidates(
  campaignId: string,
  deferredIds: string[],
): Promise<ReplayScanResult> {
  const out: ReplayScanResult = {
    campaign_id: campaignId,
    scheduler_mode: 'SHADOW',
    replay_ready: [],
    still_deferred: [],
    permanently_blocked: [],
    records: [],
  };
  if (!campaignId || !Array.isArray(deferredIds) || deferredIds.length === 0) return out;

  try {
    for (const executionId of deferredIds) {
      const r = await resolveAuthoritativePublishing(campaignId, executionId).catch(() => null);
      const status = (r?.projection?.scheduler_status ?? 'UNKNOWN') as SchedulerStatus | 'UNKNOWN';
      out.scheduler_mode = r?.mode ?? out.scheduler_mode;
      const ready = READY.includes(status);
      const blocked = status === 'BLOCKED';
      const record: DeferredExecutionRecord = {
        campaign_id: campaignId,
        execution_id: executionId,
        canonical_scheduler_state: status,
        replay_eligible: ready,
        retry_reason: ready
          ? 'became_ready'
          : blocked
            ? 'permanently_blocked'
            : `still_${String(status).toLowerCase()}`,
        orchestration_version: r?.projection?.orchestration_version ?? 'unknown',
      };
      out.records.push(record);
      if (ready) out.replay_ready.push(executionId);
      else if (blocked) out.permanently_blocked.push(executionId);
      else if (WAITING.includes(status) || status === 'UNKNOWN') out.still_deferred.push(executionId);
      else out.still_deferred.push(executionId);
    }
    LOG('DEFERRED_REPLAY', {
      campaign_id: campaignId,
      scheduler_mode: out.scheduler_mode,
      replay_ready: out.replay_ready.length,
      still_deferred: out.still_deferred.length,
      permanently_blocked: out.permanently_blocked.length,
    });
    return out;
  } catch (e) {
    LOG('PRUNING_FALLBACK', {
      campaign_id: campaignId,
      reason: `replay_scan_exception:${(e as Error)?.message ?? 'unknown'}`,
      fallback_active: true,
    });
    return out;
  }
}
