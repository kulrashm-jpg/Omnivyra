/**
 * Composition asset RESOLUTION — the one place a reference becomes usable.
 *
 * Takes a composition, resolves its references to real canonical assets, and
 * routes them into the compose and condition lanes. Everything that can refuse
 * a reference refuses it here, with a reason, before any provider sees it.
 *
 * SECURITY INVARIANT
 * ------------------
 *   composition reference -> canonical_media_assets.id -> company_id ownership
 *
 * Every asset is fetched through `getCanonicalMediaAsset(companyId, id)`, which
 * filters on company_id, so an asset id alone is never sufficient. `created_by`
 * is never consulted — it is provenance, and making it an authorization input
 * would recreate the `media_files` trap the audit found (tenant == row owner,
 * which is what left /api/media/* cross-tenant reachable until MEDIA-SEC-001).
 *
 * The database enforces the same boundary independently: the reference table's
 * composite FK (company_id, asset_id) -> (company_id, id) means a cross-tenant
 * row cannot exist to be resolved in the first place.
 *
 * NOT WIRED INTO THE RENDERER. This produces the `ReferenceImage[]` that
 * `assembleMultimodalPayload({ additionalReferences })` already accepts; no
 * renderer, provider, model or generation behaviour is changed by this phase.
 */

import {
  listCompositionAssetReferences,
} from './compositionAssetReferenceService';
import { getCanonicalMediaAsset } from './canonicalMediaAssetService';
import { isUsableMediaAsset, type CanonicalMediaAsset } from '../../lib/content/canonicalMediaAsset';
import type { CompositionAssetReference } from '../../lib/content/compositionAssetReference';
import {
  routeCompositionReferences,
  toAdditionalReferences,
  type RoutedReference,
  type RoutingRejection,
  type RoutingResult,
  type TemplateAssetSlot,
} from '../../lib/content/compositionAssetRouting';
import type { ReferenceImage } from './creator/creatorPromptComposer';

/** Reasons resolution can refuse a reference before routing even runs. */
export type ResolutionRejectionReason = 'asset_not_found' | 'asset_not_ready';

export interface ResolvedCompositionAssets {
  routing: RoutingResult;
  /** Ready to hand to `assembleMultimodalPayload({ additionalReferences })`. */
  additionalReferences: ReferenceImage[];
  /** The branded carrier the renderer accepts. */
  renderer: ResolvedCompositionReferences;
  /** Refused during resolution (missing / not ready) plus every routing refusal. */
  rejected: Array<RoutingRejection | {
    referenceId: string;
    purpose: CompositionAssetReference['purpose'];
    mode: CompositionAssetReference['mode'];
    reason: ResolutionRejectionReason;
    detail: string;
  }>;
}

/**
 * The renderer-facing result — deliberately BRANDED.
 *
 * The renderer must never accept a hand-assembled `ReferenceImage[]`, because
 * doing so would bypass the company-scoped asset lookup, the lifecycle gate and
 * the compose/condition routing in one step, and nothing downstream would
 * notice. Requiring this brand means the only way to obtain a value the renderer
 * will take is to go through `resolveCompositionAssets`, which enforces all
 * three. The literal is constructed in exactly one place (below) and a mutation
 * guard asserts it stays that way.
 */
export const RESOLVED_REFERENCES_BRAND = 'phase45-resolved-composition-references' as const;

export interface ResolvedCompositionReferences {
  readonly brand: typeof RESOLVED_REFERENCES_BRAND;
  /** Condition lane only — already provider-capped and adapter-mapped. */
  additionalReferences: ReferenceImage[];
  /** True when the provider cannot take image bytes and these become text. */
  conditionDegradedToText: boolean;
  /**
   * COMPOSE lane, deferred.
   *
   * Everything needed to build deterministic layers EXCEPT the canvas size,
   * which only the renderer knows at render time — the same late binding
   * `defaultBrandPlacement` already relies on. Carried separately from
   * `additionalReferences` so the two lanes cannot be confused: nothing here
   * ever reaches a provider.
   */
  composePlan: {
    companyId: string;
    compose: RoutedReference[];
    templateSlots?: readonly TemplateAssetSlot[];
  };
}

export interface ResolveCompositionAssetsInput {
  companyId: string;
  compositionType: string;
  compositionId: string;
  /** Slots the target template declares. Undefined = the template accepts none. */
  templateSlots?: readonly TemplateAssetSlot[];
  provider: { acceptsReferenceImages: boolean; maxReferenceImages: number };
}

/**
 * Resolve the storage location of an asset's bytes.
 *
 * Deliberately NOT a public URL: it returns the bucket-qualified object path,
 * which the existing SSRF-hardened download path in `generateProviderImage`
 * (safeFetch + readCapped + content-type-matched `toFile`) is what ultimately
 * turns into bytes. Publishing assets to make provider integration easier would
 * trade a tenancy guarantee for convenience.
 */
function storageLocationOf(asset: CanonicalMediaAsset): string {
  return `${asset.storageBucket}/${asset.storagePath}`;
}

/**
 * Resolve and route every reference attached to one composition.
 *
 * Fails closed at each stage and returns typed rejections rather than dropping
 * anything: a user who attached an image must always be able to learn what
 * happened to it.
 */
export async function resolveCompositionAssets(
  input: ResolveCompositionAssetsInput,
): Promise<ResolvedCompositionAssets> {
  const rejected: ResolvedCompositionAssets['rejected'] = [];

  const references = await listCompositionAssetReferences(
    input.companyId,
    input.compositionType,
    input.compositionId,
  );

  const resolvable: Array<{ reference: CompositionAssetReference; sourceUrl: string }> = [];

  for (const reference of references) {
    // Tenant-scoped lookup. A foreign asset and a missing asset are
    // indistinguishable here, which is what stops this becoming an existence
    // oracle for another tenant's ids.
    const asset = await getCanonicalMediaAsset(input.companyId, reference.assetId);
    if (!asset) {
      rejected.push({
        referenceId: reference.id,
        purpose: reference.purpose,
        mode: reference.mode,
        reason: 'asset_not_found',
        detail: 'The referenced asset does not exist for this company.',
      });
      continue;
    }

    // A pending upload has unverified bytes and a failed one has none. Either
    // would reach the provider as a broken fetch, so both are refused up front.
    if (!isUsableMediaAsset(asset)) {
      rejected.push({
        referenceId: reference.id,
        purpose: reference.purpose,
        mode: reference.mode,
        reason: 'asset_not_ready',
        detail: `Asset lifecycle is "${asset.lifecycleState}"; only "ready" assets may be used.`,
      });
      continue;
    }

    resolvable.push({ reference, sourceUrl: storageLocationOf(asset) });
  }

  const routing = routeCompositionReferences({
    references: resolvable,
    templateSlots: input.templateSlots,
    provider: input.provider,
  });

  rejected.push(...routing.rejected);

  const additionalReferences = toAdditionalReferences(routing.condition);

  return {
    routing,
    additionalReferences,
    // The ONLY construction of the brand. Everything the renderer accepts has
    // therefore passed the company-scoped lookup, the lifecycle gate and
    // compose/condition routing above.
    renderer: {
      brand: RESOLVED_REFERENCES_BRAND,
      additionalReferences,
      conditionDegradedToText: routing.conditionDegradedToText,
      composePlan: {
        companyId: input.companyId,
        compose: routing.compose,
        templateSlots: input.templateSlots,
      },
    },
    rejected,
  };
}
