/**
 * Phase 26F — Pre-registered domain continuity rules.
 *
 * Provides ready-to-register `DomainContinuityRule` implementations for
 * the QueueCheckpointContinuityCoordinator (Phase 23E + Phase 24F):
 *
 *   - long-form partial-generation continuation
 *   - publish replay suppression
 *   - campaign replay continuation
 *   - reconciliation replay suppression
 *
 * These rules ALSO live in the `DomainReplayGovernor` (Phase 24E), but
 * registering them at the continuity-coordinator level catches
 * suppression EARLIER in the bridge pipeline (before the registry's
 * builder is even dispatched), saving work + emitting more accurate
 * forensic chain entries.
 *
 * Defense in depth: rules in BOTH coordinators is intentional. A
 * suppressed publish here AND in the governor produces identical
 * outcomes — neither path mutates state.
 */

import type { DomainContinuityRule } from '../../queueCheckpointContinuityCoordinator';
import type {
  ContinuityVerdict,
  HydratedQueuePayload,
} from '../../workflowExecutionTypes';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function verdict(
  code: ContinuityVerdict['code'],
  detail: string,
  action: ContinuityVerdict['recommendedAction'],
): ContinuityVerdict {
  return { ok: code === 'continuous', code, detail, recommendedAction: action };
}

function completedSet(hydrated: HydratedQueuePayload): Set<string> {
  return new Set<string>(hydrated.restored?.completedNodeOperationIds ?? []);
}

// ────────────────────────────────────────────────────────────────────
// Long-form continuity rule
// ────────────────────────────────────────────────────────────────────

/**
 * If ALL sections + finalize already in completed_set, suppress the
 * replay — there's nothing left to do. Partial completion proceeds.
 */
export const longFormPartialGenerationContinuationRule: DomainContinuityRule = {
  workflowType: 'long_form_generation',
  name: 'long_form_partial_generation_continuation',
  evaluate(hydrated) {
    const params = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
    const sectionIds = Array.isArray(params.sectionIds)
      ? (params.sectionIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    if (sectionIds.length === 0) return null; // defer to generic coordinator
    const done = completedSet(hydrated);
    const allDone = sectionIds.every((id) => done.has(`lf_gen_${id}`)) && done.has('lf_finalize');
    if (allDone) {
      return verdict(
        'duplicate_replay',
        `long-form generation fully completed (${sectionIds.length} sections + finalize)`,
        'suppress',
      );
    }
    // Partial — explicit "continuous" verdict (rather than null) so the
    // generic coordinator's checkpoint-divergence checks still run.
    return null;
  },
};

// ────────────────────────────────────────────────────────────────────
// Publish replay suppression rule
// ────────────────────────────────────────────────────────────────────

export const publishReplaySuppressionRule: DomainContinuityRule = {
  workflowType: 'social_publish',
  name: 'publish_replay_suppression',
  evaluate(hydrated) {
    const params = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
    const provider = typeof params.provider === 'string' ? params.provider : null;
    const fp = typeof params.contentFingerprint === 'string' ? params.contentFingerprint : null;
    if (!provider || !fp) return null;
    const stepId = `sp_publish_${provider}_${fp}`;
    if (completedSet(hydrated).has(stepId)) {
      return verdict(
        'duplicate_replay',
        `publish step '${stepId}' already in completed set`,
        'suppress',
      );
    }
    return null;
  },
};

// ────────────────────────────────────────────────────────────────────
// Campaign continuation rule
// ────────────────────────────────────────────────────────────────────

export const campaignReplayContinuationRule: DomainContinuityRule = {
  workflowType: 'campaign_execution',
  name: 'campaign_replay_continuation',
  evaluate(hydrated) {
    const params = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
    const postsRaw = Array.isArray(params.posts) ? params.posts : [];
    const postIds: string[] = [];
    for (const p of postsRaw) {
      if (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).postId === 'string') {
        postIds.push((p as Record<string, unknown>).postId as string);
      }
    }
    if (postIds.length === 0) return null;
    const done = completedSet(hydrated);
    const allDone = postIds.every((id) => done.has(`camp_post_${id}`)) && done.has('camp_finalize');
    if (allDone) {
      return verdict(
        'duplicate_replay',
        `campaign fully completed (${postIds.length} posts + finalize)`,
        'suppress',
      );
    }
    return null;
  },
};

// ────────────────────────────────────────────────────────────────────
// Reconciliation suppression rule
// ────────────────────────────────────────────────────────────────────

/**
 * If the reconcile-apply step is already in the completed set, suppress.
 * Note: time-window suppression remains in the DomainReplayGovernor
 * because that requires history beyond the checkpoint chain.
 */
export const reconciliationReplaySuppressionRule: DomainContinuityRule = {
  workflowType: 'provider_reconciliation',
  name: 'reconciliation_replay_suppression',
  evaluate(hydrated) {
    const params = (hydrated.payload.workflowParams ?? {}) as Record<string, unknown>;
    const rowId = typeof params.rowId === 'string' ? params.rowId : null;
    if (!rowId) return null;
    const applyStepId = `rec_apply_${rowId}`;
    if (completedSet(hydrated).has(applyStepId)) {
      return verdict(
        'duplicate_replay',
        `reconcile step '${applyStepId}' already in completed set`,
        'suppress',
      );
    }
    return null;
  },
};

// ────────────────────────────────────────────────────────────────────
// Convenience: full set
// ────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical list of all four domain continuity rules in
 * registration order. The boot wiring passes this into the continuity
 * coordinator constructor.
 */
export function getAllDomainContinuityRules(): DomainContinuityRule[] {
  return [
    longFormPartialGenerationContinuationRule,
    publishReplaySuppressionRule,
    campaignReplayContinuationRule,
    reconciliationReplaySuppressionRule,
  ];
}
