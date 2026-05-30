/**
 * Variant Experiment Lifecycle Helpers (P3-1 + P3-2 + Final Corrective Pass).
 *
 * Server-side adapters that downstream pipelines call to advance
 * the experiment tracker through `generated`, `published`, and
 * `engaged` states.
 *
 *   - notifyExperimentAssetGenerated — invoked from the generation
 *     success path when a tracked variant asset is actually produced.
 *     Transitions matching tracker assets to 'generated'.
 *
 *   - notifyExperimentAssetPublished — invoked from the publish path
 *     when a scheduled_post that carries a variant attribution
 *     actually publishes. Transitions matching tracker assets to
 *     'published'.
 *
 *   - notifyExperimentAssetEngaged — invoked from the
 *     engagement-event runtime when a strategy event with a
 *     variantId AND non-zero weight arrives. Transitions matching
 *     tracker assets to 'engaged'. Idempotent — already-engaged
 *     assets are no-ops.
 *
 * All helpers are best-effort: they swallow errors so the
 * generation / publish / engagement path is never blocked. No new
 * endpoint is created; the existing in-memory tracker is used.
 */

import {
  listExperiments,
  transitionExperimentAsset,
  type ExperimentRecord,
} from './variantExperimentTracker';

/* ── Lookup ────────────────────────────────────────────────────── */

function findExperimentsForVariant(
  companyId: string,
  variantId: string,
): ExperimentRecord[] {
  try {
    return listExperiments({ companyId }).filter((exp) =>
      exp.assets.some((a) => a.variant_id === variantId),
    );
  } catch {
    return [];
  }
}

/* ── PHASE: generated (Final Corrective Pass — P2-1) ───────────── */

/**
 * Notify the tracker that an experiment-tracked variant asset just
 * finished generation. Looks up experiments containing the matching
 * `variantId` for the company and transitions the asset entry to
 * `generated`. No-op when:
 *
 *   - companyId or variantId missing
 *   - no experiment in scope references the variantId
 *   - the asset is already at 'generated' or beyond (tracker
 *     transitions are monotonic, so this is enforced downstream too)
 *
 * Wired into the creator orchestrator's successful generation path
 * so the lifecycle progresses created → generated → published →
 * engaged → completed instead of jumping straight to published.
 */
export function notifyExperimentAssetGenerated(input: {
  companyId: string;
  variantId: string;
  assetId?: string | null;
}): void {
  try {
    if (!input.companyId || !input.variantId) return;
    const experiments = findExperimentsForVariant(input.companyId, input.variantId);
    for (const exp of experiments) {
      transitionExperimentAsset({
        companyId: input.companyId,
        experimentId: exp.experiment_id,
        variantId: input.variantId,
        state: 'generated',
        assetId: input.assetId ?? null,
      });
    }
  } catch {
    // Best-effort.
  }
}

/* ── PHASE: published (P3-1) ───────────────────────────────────── */

/**
 * Notify the tracker that an experiment-tracked variant asset just
 * published. Looks up experiments containing the matching `variantId`
 * for the company and transitions the asset entry. No-op when:
 *
 *   - companyId or variantId missing
 *   - no experiment in scope references the variantId
 *   - the asset is already at 'published' or beyond (tracker
 *     transitions are monotonic, so this is enforced downstream too)
 */
export function notifyExperimentAssetPublished(input: {
  companyId: string;
  variantId: string;
  scheduledPostId?: string | null;
  assetId?: string | null;
}): void {
  try {
    if (!input.companyId || !input.variantId) return;
    const experiments = findExperimentsForVariant(input.companyId, input.variantId);
    for (const exp of experiments) {
      transitionExperimentAsset({
        companyId: input.companyId,
        experimentId: exp.experiment_id,
        variantId: input.variantId,
        state: 'published',
        scheduledPostId: input.scheduledPostId ?? null,
        assetId: input.assetId ?? null,
      });
    }
  } catch {
    // Best-effort.
  }
}

/* ── PHASE: engaged (P3-2) ─────────────────────────────────────── */

/**
 * Notify the tracker that engagement signal landed against an
 * experiment-tracked variant. The strategyAnalyticsRuntime calls
 * this from its emit path when it sees an event with a non-null
 * variantId. Same monotonic transition guarantees — already-engaged
 * or completed assets are no-ops.
 */
export function notifyExperimentAssetEngaged(input: {
  companyId: string;
  variantId: string;
  scheduledPostId?: string | null;
}): void {
  try {
    if (!input.companyId || !input.variantId) return;
    const experiments = findExperimentsForVariant(input.companyId, input.variantId);
    for (const exp of experiments) {
      transitionExperimentAsset({
        companyId: input.companyId,
        experimentId: exp.experiment_id,
        variantId: input.variantId,
        state: 'engaged',
        scheduledPostId: input.scheduledPostId ?? null,
      });
    }
  } catch {
    // Best-effort.
  }
}
