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

  // Nothing is dropped in silence: a reference that could not be used is
  // reported here so the attempt is visible even when generation continues.
  if (resolved.rejected.length > 0) {
    console.warn('[creator-composition-references][rejected]', {
      compositionId,
      rejected: resolved.rejected,
    });
  }

  return resolved.renderer;
}
