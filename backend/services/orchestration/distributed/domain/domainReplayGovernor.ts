/**
 * Phase 24E — DomainReplayGovernor
 *
 * Per-domain replay eligibility decisions. Sits alongside the Phase 23
 * QueueCheckpointContinuityCoordinator: that one handles GENERIC continuity
 * (execution status, checkpoint chain integrity). This one handles
 * DOMAIN-SPECIFIC rules:
 *
 *   - long_form_generation:
 *       - Regeneration eligible only when partial generation incomplete.
 *       - Duplicate generation suppressed (governor + step-level idempotency).
 *   - social_publish:
 *       - Publish step replay SUPPRESSED whenever the checkpoint already
 *         marks the publish step complete (defense in depth on top of the
 *         step's idempotency hint).
 *       - Same fingerprint → suppression (regardless of attempt count).
 *   - campaign_execution:
 *       - Per-post replay only when the post is not in completed_set.
 *       - Campaign-level scheduling decisions never re-fire.
 *   - provider_reconciliation:
 *       - Repeated reconcile on same (rowId, provider) within
 *         suppressionWindowMs is suppressed.
 *
 * SCOPE: replay decisions ONLY. Returns a verdict the caller acts on.
 * NEVER mutates state.
 *
 * Telemetry:
 *   domain_replay_validated
 *   domain_replay_suppressed
 *   domain_replay_failed
 */

import type {
  HydratedQueuePayload,
} from '../workflowExecutionTypes';
import type {
  DomainWorkflowType,
  SocialPlatform,
} from './domainWorkflowTypes';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type DomainReplayTelemetryEvent =
  | 'domain_replay_validated'
  | 'domain_replay_suppressed'
  | 'domain_replay_failed';

export interface DomainReplayTelemetrySink {
  emit(event: DomainReplayTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: DomainReplayTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'domain_replay_failed') console.warn(`[domain_replay] ${line}`);
      else console.log(`[domain_replay] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Verdict shape
// ────────────────────────────────────────────────────────────────────

export type DomainReplayVerdictCode =
  | 'eligible'
  | 'duplicate_long_form_generation'
  | 'duplicate_publish'
  | 'duplicate_campaign_post'
  | 'reconciliation_within_window'
  | 'unsupported_domain'
  | 'missing_required_field';

export interface DomainReplayVerdict {
  ok: boolean;
  code: DomainReplayVerdictCode;
  detail: string;
  recommendedAction: 'proceed' | 'suppress' | 'fail';
}

// ────────────────────────────────────────────────────────────────────
// Governor
// ────────────────────────────────────────────────────────────────────

export interface DomainReplayGovernorOptions {
  telemetry?: DomainReplayTelemetrySink;
  /** Reconciliation suppression window in ms. Default 60_000. */
  reconciliationSuppressionMs?: number;
}

export interface DomainReplayGovernor {
  validate(hydrated: HydratedQueuePayload): DomainReplayVerdict;
  /** Test helper: clear cached suppression history. */
  _reset(): void;
}

function verdict(
  code: DomainReplayVerdictCode,
  detail: string,
  recommendedAction: 'proceed' | 'suppress' | 'fail',
): DomainReplayVerdict {
  return { ok: code === 'eligible', code, detail, recommendedAction };
}

function isDomainType(t: string): t is DomainWorkflowType {
  return t === 'long_form_generation' || t === 'campaign_execution' ||
    t === 'social_publish' || t === 'provider_reconciliation';
}

export function createDomainReplayGovernor(
  options?: DomainReplayGovernorOptions,
): DomainReplayGovernor {
  const telemetry = options?.telemetry ?? defaultTelemetrySink;
  const reconciliationMs = Math.max(0, options?.reconciliationSuppressionMs ?? 60_000);
  // (rowId, provider) → last reconcile timestamp
  const recHistory = new Map<string, number>();

  return {
    validate(hydrated) {
      const wf = hydrated.payload.workflowType;
      if (!isDomainType(wf)) {
        // Generic workflow types pass through — not our concern.
        const v = verdict('eligible', `generic workflow '${wf}' not gated by domain governor`, 'proceed');
        telemetry.emit('domain_replay_validated', {
          executionId: hydrated.payload.executionId, code: v.code, wf,
        });
        return v;
      }

      const params = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
      const restored = hydrated.restored;
      const completedSet = new Set<string>(restored?.completedNodeOperationIds ?? []);

      switch (wf) {
        case 'long_form_generation': {
          const generationId = typeof params.generationId === 'string'
            ? params.generationId : hydrated.payload.executionId;
          // If all section gen + finalize already in completed_set, suppress.
          const sectionIds = Array.isArray(params.sectionIds)
            ? (params.sectionIds as unknown[]).filter((v): v is string => typeof v === 'string')
            : [];
          const allDone = sectionIds.length > 0 &&
            sectionIds.every((id) => completedSet.has(`lf_gen_${id}`)) &&
            completedSet.has('lf_finalize');
          if (allDone) {
            const v = verdict('duplicate_long_form_generation',
              `generation ${generationId} fully completed; suppressing replay`,
              'suppress');
            telemetry.emit('domain_replay_suppressed', {
              executionId: hydrated.payload.executionId, code: v.code, generationId,
            });
            return v;
          }
          const v = verdict('eligible', `partial generation continues (${completedSet.size} done)`, 'proceed');
          telemetry.emit('domain_replay_validated', {
            executionId: hydrated.payload.executionId, code: v.code, generationId,
          });
          return v;
        }

        case 'social_publish': {
          const provider = typeof params.provider === 'string' ? params.provider : '';
          const fingerprint = typeof params.contentFingerprint === 'string'
            ? params.contentFingerprint : '';
          if (!provider || !fingerprint) {
            const v = verdict('missing_required_field',
              'social_publish requires provider + contentFingerprint',
              'fail');
            telemetry.emit('domain_replay_failed', {
              executionId: hydrated.payload.executionId, code: v.code,
            });
            return v;
          }
          const publishStepId = `sp_publish_${provider}_${fingerprint}`;
          if (completedSet.has(publishStepId)) {
            const v = verdict('duplicate_publish',
              `publish step '${publishStepId}' already in completed set; suppressing`,
              'suppress');
            telemetry.emit('domain_replay_suppressed', {
              executionId: hydrated.payload.executionId, code: v.code,
              provider, fingerprint,
            });
            return v;
          }
          const v = verdict('eligible', 'publish step not yet completed', 'proceed');
          telemetry.emit('domain_replay_validated', {
            executionId: hydrated.payload.executionId, code: v.code,
            provider: provider as SocialPlatform,
          });
          return v;
        }

        case 'campaign_execution': {
          const campaignId = typeof params.campaignId === 'string'
            ? params.campaignId : hydrated.payload.executionId;
          const postsRaw = Array.isArray(params.posts) ? params.posts : [];
          const allPostIds: string[] = [];
          for (const p of postsRaw) {
            if (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).postId === 'string') {
              allPostIds.push((p as Record<string, unknown>).postId as string);
            }
          }
          if (allPostIds.length === 0) {
            const v = verdict('eligible', 'campaign has no posts; proceeding to no-op finalize', 'proceed');
            telemetry.emit('domain_replay_validated', { executionId: hydrated.payload.executionId, code: v.code });
            return v;
          }
          const allDone = allPostIds.every((id) => completedSet.has(`camp_post_${id}`)) &&
            completedSet.has('camp_finalize');
          if (allDone) {
            const v = verdict('duplicate_campaign_post',
              `campaign ${campaignId} fully completed`, 'suppress');
            telemetry.emit('domain_replay_suppressed', {
              executionId: hydrated.payload.executionId, code: v.code, campaignId,
            });
            return v;
          }
          const v = verdict('eligible',
            `campaign ${campaignId} has pending posts`, 'proceed');
          telemetry.emit('domain_replay_validated', {
            executionId: hydrated.payload.executionId, code: v.code, campaignId,
          });
          return v;
        }

        case 'provider_reconciliation': {
          const rowId = typeof params.rowId === 'string' ? params.rowId : '';
          const provider = typeof params.provider === 'string' ? params.provider : '';
          if (!rowId || !provider) {
            const v = verdict('missing_required_field',
              'provider_reconciliation requires rowId + provider', 'fail');
            telemetry.emit('domain_replay_failed', {
              executionId: hydrated.payload.executionId, code: v.code,
            });
            return v;
          }
          const key = `${provider}:${rowId}`;
          const last = recHistory.get(key);
          const now = Date.now();
          if (typeof last === 'number' && now - last < reconciliationMs) {
            const v = verdict('reconciliation_within_window',
              `reconcile on (${provider},${rowId}) within ${reconciliationMs}ms; suppressing`,
              'suppress');
            telemetry.emit('domain_replay_suppressed', {
              executionId: hydrated.payload.executionId, code: v.code,
              provider, rowId, ageMs: now - last,
            });
            return v;
          }
          recHistory.set(key, now);
          const v = verdict('eligible', `reconcile on (${provider},${rowId}) outside suppression window`, 'proceed');
          telemetry.emit('domain_replay_validated', {
            executionId: hydrated.payload.executionId, code: v.code,
            provider, rowId,
          });
          return v;
        }
      }
    },

    _reset() {
      recHistory.clear();
    },
  };
}

let _default: DomainReplayGovernor | null = null;
export function getDefaultDomainReplayGovernor(): DomainReplayGovernor {
  if (!_default) _default = createDomainReplayGovernor();
  return _default;
}
export function setDefaultDomainReplayGovernor(g: DomainReplayGovernor): void {
  _default = g;
}
