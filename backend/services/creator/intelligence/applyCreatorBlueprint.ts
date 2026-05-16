/**
 * applyCreatorBlueprint — Step 4 feature-flagged runtime cutover.
 * ──────────────────────────────────────────────────────────────────────────
 * FIRST runtime-connected step. This is the SINGLE place the Step-3
 * adapters touch the live payload-generation flow. Both the main
 * generation loop AND the auto-optimize-distribution branch in
 * `pages/api/campaigns/generate-weekly-structure.ts` route through this
 * one helper — no duplicate inline adapter wiring — which is what
 * structurally prevents the prior branch-drift regression.
 *
 * SCOPE GUARD (hard):
 *   - Only acts when the feature flag is ON.
 *   - Only acts for asset_type ∈ { image, carousel }.
 *   - Returns `false` for every other case so the caller runs its
 *     EXISTING legacy inline path completely unchanged. Flag OFF ⇒
 *     byte-identical legacy behavior (the function returns before
 *     resolving a context or building a blueprint).
 *   - reel/video/post_with_asset/thread_with_asset are deliberately
 *     untouched (return false → legacy).
 *
 * PACKAGING PRECEDENCE (spec):
 *     finalPackaging = { ...derivedPackaging, ...existingNonEmpty }
 *   Existing non-empty fields ALWAYS win over derived — richer
 *   downstream/generated copy (from the creator-asset-generation stage)
 *   is never downgraded. Opaque extra keys already on the packaging are
 *   preserved (CreatorPackaging carries an index signature for exactly
 *   this).
 *
 * Purity note: the helper mutates the `enriched` object in place (same
 * contract the legacy inline block already had — callers pass the row's
 * content object and expect it stamped). It performs no DB / scheduler /
 * queue access of its own; `resolveCreatorContext` + the adapters are
 * pure (proven by the Step-2/Step-3 unit suites).
 */

import { resolveCreatorContext } from './creatorIntelligenceEngine';
import type { ResolveCreatorContextInput } from './creatorIntelligenceEngine';
import { creatorAdapterRegistry } from './adapters/creatorAdapterRegistry';
import type { CreatorPackaging } from './packagingTypes';

/** Asset types this step is allowed to cut over. Reel/video et al. are
 *  intentionally excluded — later step, not this one. */
const ADAPTER_ASSET_TYPES = new Set(['image', 'carousel']);

/**
 * Feature flag. OFF unless explicitly enabled. Accepts '1' / 'true'
 * (case-insensitive) so it can be flipped from any env layer.
 */
export function isCreatorBlueprintAdapterEnabled(): boolean {
  const raw = String(process.env.ENABLE_CREATOR_BLUEPRINT_ADAPTERS ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Build `{ ...derived, ...existingNonEmpty }`. "Non-empty" is
 * type-aware: strings must be non-blank, arrays must be length > 0,
 * objects must have keys; anything else non-null counts as present.
 * Every key from the existing packaging that qualifies (including
 * opaque extras) overrides the derived value.
 */
function mergePackagingPrecedence(
  derived: CreatorPackaging,
  existing: Record<string, unknown>,
): CreatorPackaging {
  const existingNonEmpty: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    const keep =
      typeof v === 'string'
        ? v.trim().length > 0
        : Array.isArray(v)
          ? v.length > 0
          : isPlainObject(v)
            ? Object.keys(v).length > 0
            : v !== null && v !== undefined;
    if (keep) existingNonEmpty[k] = v;
  }
  return { ...derived, ...existingNonEmpty } as CreatorPackaging;
}

export interface ApplyCreatorBlueprintParams {
  /** The row content object to stamp in place (the legacy `e`). */
  enriched: Record<string, unknown>;
  /** Resolved creator asset_type for this row. */
  assetType: string | null | undefined;
  /** Pure seeds for resolveCreatorContext (topic/objective/etc). */
  context: ResolveCreatorContextInput;
  /** Normalized platform key — drives per-platform adaptation notes so
   *  unique-content / platform variation is preserved across branches. */
  platform?: string;
}

/**
 * Returns `true` iff the adapter path handled the row (flag ON +
 * image/carousel + an adapter exists). On `true`, `enriched` has been
 * stamped with intent_type/asset_type/packaging/asset_payload/
 * asset_instruction. On `false`, `enriched` is untouched and the caller
 * MUST run its existing legacy inline path.
 */
export function applyCreatorBlueprint(params: ApplyCreatorBlueprintParams): boolean {
  const { enriched, assetType, context, platform } = params;

  if (!isCreatorBlueprintAdapterEnabled()) return false;
  const at = typeof assetType === 'string' ? assetType.trim().toLowerCase() : '';
  if (!ADAPTER_ASSET_TYPES.has(at)) return false;

  const adapter = creatorAdapterRegistry.get(at);
  if (!adapter) return false;

  // Pure: no DB / scheduler. Continuity + brand grounding are whatever
  // the caller passed in `context` (never fetched here).
  const ctx = resolveCreatorContext(context);
  const blueprint = adapter.build(ctx, platform ? { platform } : undefined);

  // ── Packaging: derived baseline, existing non-empty wins ────────────
  const existingPackaging = isPlainObject(enriched.packaging)
    ? (enriched.packaging as Record<string, unknown>)
    : {};
  enriched.packaging = mergePackagingPrecedence(blueprint.packaging, existingPackaging);

  // ── asset_payload: keep richer existing required shape if present ────
  const existingPayload = isPlainObject(enriched.asset_payload)
    ? (enriched.asset_payload as Record<string, unknown>)
    : {};
  if (at === 'carousel') {
    const apSlides = (blueprint.asset_payload as { slides: unknown[] }).slides;
    enriched.asset_payload = {
      ...blueprint.asset_payload,
      ...existingPayload,
      slides: isNonEmptyArray(existingPayload.slides)
        ? existingPayload.slides
        : apSlides,
    };
  } else {
    // image
    const apVd = (blueprint.asset_payload as { visual_descriptor: object })
      .visual_descriptor;
    enriched.asset_payload = {
      ...blueprint.asset_payload,
      ...existingPayload,
      visual_descriptor:
        isPlainObject(existingPayload.visual_descriptor) &&
        Object.keys(existingPayload.visual_descriptor).length > 0
          ? existingPayload.visual_descriptor
          : apVd,
    };
  }

  // ── asset_instruction: existing non-empty object wins ───────────────
  enriched.asset_instruction =
    isPlainObject(enriched.asset_instruction) &&
    Object.keys(enriched.asset_instruction as Record<string, unknown>).length > 0
      ? enriched.asset_instruction
      : blueprint.asset_instruction;

  enriched.intent_type = 'creator';
  enriched.asset_type = at;

  // Diagnostic breadcrumb (object key, not a log) so a row's provenance
  // is auditable without changing observable scheduling behavior.
  enriched.creator_blueprint_source = {
    via: 'applyCreatorBlueprint',
    asset_family: blueprint.asset_family,
    blueprint_id: blueprint.blueprint_id,
    blueprint_version: blueprint.blueprint_version,
  };

  return true;
}

export default applyCreatorBlueprint;
