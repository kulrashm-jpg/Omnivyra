/**
 * THE single runtime entry into the composition-asset resolver.
 *
 * Phase 60E found the resolver had zero runtime callers: everything downstream
 * of it was built and validated, but nothing upstream ever invoked it, so a
 * user's attached reference reached generation and was silently ignored. This
 * closes that gap and is deliberately the ONLY place that closes it.
 *
 *   generate → orchestrator → HERE → resolveCompositionAssets
 *     → branded carrier → RenderOptions.compositionReferences
 *
 * It re-implements nothing. Tenant scoping, lifecycle gating, purpose/mode
 * routing, slot compatibility, provider capacity and byte retrieval all already
 * live in the resolver and the lanes beneath it; this supplies the identity
 * they need and hands the result on unchanged.
 */

import { resolveCompositionAssets, type ResolvedCompositionReferences } from '../compositionAssetResolutionService';
import { CREATOR_COMPOSITION_TYPE } from '../../../lib/content/creatorCompositionAsset';
import { resolveProviderCapabilities } from './creatorMultimodalReferences';
import { emitCreatorEvent, CREATOR_EVENTS } from '../creatorOperationalTelemetryService';

/**
 * Resolve a draft's attached assets for one render.
 *
 * Returns null when there is no draft identity, which is the ordinary case for
 * every caller that never attached anything — generation then proceeds exactly
 * as it did before this existed.
 *
 * `companyId` is the authenticated company and is the ONLY authorization input.
 * `compositionId` is a client-supplied lookup key: a token minted under another
 * tenant simply finds no rows, because the resolver reads through the
 * company-scoped accessor and the reference table's composite foreign key makes
 * a cross-tenant row impossible in the first place.
 */
export async function resolveCompositionReferencesForRender(input: {
  companyId: string | null | undefined;
  compositionId: string | null | undefined;
  /** Slots the chosen template declares. Undefined => the template accepts none. */
  templateSlots?: Parameters<typeof resolveCompositionAssets>[0]['templateSlots'];
}): Promise<ResolvedCompositionReferences | null> {
  const companyId = String(input.companyId || '').trim();
  const compositionId = String(input.compositionId || '').trim();
  if (!companyId || !compositionId) return null;

  const resolved = await resolveCompositionAssets({
    companyId,
    compositionType: CREATOR_COMPOSITION_TYPE,
    compositionId,
    templateSlots: input.templateSlots,
    // The condition lane is destined for images.edit, so capability must be
    // asked of THAT endpoint rather than of the model in the abstract.
    provider: resolveProviderCapabilities('openai-gpt-image-1', 'edit'),
  });

  /*
   * Nothing is dropped in silence — and "not silent" has to mean measurable.
   *
   * A `console.warn` made this visible only to whoever was reading logs, which
   * is why a defect that discarded almost every attached asset went unnoticed:
   * generation still succeeds, so the only symptom is a user's image not
   * appearing. One event per rejected reference makes the rate and the dominant
   * reason answerable.
   *
   * Structured fields ONLY. No storage path, no URL, no bytes, no filename, and
   * not the rejection's prose `detail` — the reason code already says what
   * happened, and free text is how identifying data leaks into telemetry.
   */
  for (const rejection of resolved.rejected) {
    emitCreatorEvent({
      event: CREATOR_EVENTS.REFERENCE_ROUTING_REJECTED,
      severity: 'warning',
      companyId,
      metadata: {
        stage: 'render_routing',
        composition_type: CREATOR_COMPOSITION_TYPE,
        composition_id: compositionId,
        reference_id: rejection.referenceId,
        purpose: rejection.purpose,
        mode: rejection.mode,
        reason: rejection.reason,
      },
    });
  }

  return resolved.renderer;
}
