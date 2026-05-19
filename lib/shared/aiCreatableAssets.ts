/**
 * AI-asset-first workflow classification (Step 17 — Step 1/2/6).
 *
 * Pure + additive. Establishes the canonical AI-creatable asset taxonomy,
 * the workflow-mode resolver, and the asset-provenance model. It does NOT
 * itself change runtime behavior — the resolver is gated by callers on
 * BOTH a feature flag AND the rendering capability so it can never
 * produce a "generated/READY" state when no asset was actually rendered
 * (which would break orchestration continuity / cause empty publishes).
 *
 * VIDEO is intentionally absent → always manual/hybrid (unchanged).
 */

/** Canonical AI-creatable asset types (Step 1). Video excluded by design. */
export const AI_CREATABLE_ASSET_TYPES = [
  'IMAGE',
  'CAROUSEL',
  'BANNER',
  'INFOGRAPHIC',
  'PDF',
  'SLIDER',
] as const;
export type AiCreatableAssetType = (typeof AI_CREATABLE_ASSET_TYPES)[number];

const _AI_SET = new Set<string>(AI_CREATABLE_ASSET_TYPES);
// Lowercase/alias map onto the canonical set (matches content_type values
// used by the planner: image/carousel/banner/infographic/pdf/slider, plus
// the 'slides'→SLIDER alias seen in the wild).
const _ALIAS: Record<string, AiCreatableAssetType> = {
  image: 'IMAGE', img: 'IMAGE', photo: 'IMAGE',
  carousel: 'CAROUSEL', slides: 'SLIDER', slider: 'SLIDER', slide: 'SLIDER', deck: 'SLIDER',
  banner: 'BANNER',
  infographic: 'INFOGRAPHIC',
  pdf: 'PDF',
};

export function isAiCreatableAssetType(t: string | null | undefined): boolean {
  const v = String(t ?? '').trim();
  if (!v) return false;
  if (_AI_SET.has(v.toUpperCase())) return true;
  return !!_ALIAS[v.toLowerCase()];
}

export function normalizeAiCreatableAssetType(
  t: string | null | undefined,
): AiCreatableAssetType | null {
  const v = String(t ?? '').trim();
  if (!v) return null;
  if (_AI_SET.has(v.toUpperCase())) return v.toUpperCase() as AiCreatableAssetType;
  return _ALIAS[v.toLowerCase()] ?? null;
}

/** Workflow mode for an asset card (Step 2). */
export type AiAssetWorkflowMode = 'AI_GENERATED' | 'UPLOAD_REQUIRED';

/** Asset provenance (Step 6). Tracked inside execution content JSON
 *  (no DB migration — mirrors the creator_lifecycle pattern). */
export type AssetProvenance =
  | 'AI_GENERATED'
  | 'USER_REPLACED'
  | 'USER_UPLOADED'
  | 'HYBRID';

export interface AssetWorkflowState {
  mode: AiAssetWorkflowMode;
  /** true → an AI asset is genuinely available; false → fallback to upload. */
  generatedAssetReady: boolean;
  assetOrigin: AssetProvenance | null;
  uploadFallbackAvailable: boolean;
}

/**
 * Resolve the default workflow mode for a content type (Step 2/3).
 *
 * SAFE-BY-CONSTRUCTION: AI_GENERATED is returned ONLY when the type is
 * AI-creatable AND the caller passes `aiAssetFirstEnabled` (feature flag)
 * AND `renderingEnabled` (capability). If rendering is off, returning
 * AI_GENERATED would assert a non-existent asset → we deliberately fall
 * back to UPLOAD_REQUIRED so orchestration continuity is preserved.
 *
 * Video / non-AI-creatable types ALWAYS resolve to UPLOAD_REQUIRED here
 * (their existing manual/hybrid placeholder flow is untouched elsewhere).
 *
 * Pure: gates are passed in (no backend import → no layering/cycle).
 */
export function resolveAssetWorkflowMode(params: {
  contentType: string | null | undefined;
  aiAssetFirstEnabled: boolean;
  renderingEnabled: boolean;
}): AssetWorkflowState {
  const aiCreatable = isAiCreatableAssetType(params.contentType);
  const canDefaultAi =
    aiCreatable && params.aiAssetFirstEnabled && params.renderingEnabled;

  if (canDefaultAi) {
    return {
      mode: 'AI_GENERATED',
      generatedAssetReady: true,
      assetOrigin: 'AI_GENERATED',
      uploadFallbackAvailable: true,
    };
  }
  return {
    mode: 'UPLOAD_REQUIRED',
    generatedAssetReady: false,
    assetOrigin: null,
    uploadFallbackAvailable: true,
  };
}

/** Feature flag accessor (default OFF → byte-identical legacy behavior). */
export function isAiAssetFirstEnabled(): boolean {
  return String(process.env.AI_ASSET_FIRST ?? '0') === '1';
}
