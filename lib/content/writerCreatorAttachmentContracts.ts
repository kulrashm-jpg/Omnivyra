import {
  getWriterAllowedAssetTypes as _getWriterAllowedAssetTypes,
  canAttachTo,
  resolveAttachmentGovernance,
} from '../../backend/services/creator/intelligence/canonical/creatorAssetRegistry';

export type AttachmentMode =
  | 'embedded_copy'
  | 'supporting_visual';

/**
 * Writer-side presentational subtype union. The literals MUST match the
 * union of `writer_attachment_subtypes` arrays in CREATOR_ASSET_REGISTRY.
 * Type cannot itself be derived (TS limitation), but
 * WRITER_CREATOR_ASSET_TYPES below is derived; a registry-only test
 * verifies the union stays in sync.
 */
export type WriterCreatorAssetType =
  | 'supporting_image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'brand_card';

export type SourceTextTransform =
  | 'none'
  | 'summarize'
  | 'extract_points'
  | 'quote'
  | 'framework'
  | 'support_visual_only';

export type AttachmentCopyPolicy = {
  allowHeadline: boolean;
  allowKeyInsight: boolean;
  allowCTA: boolean;
  sourceTextTransform: SourceTextTransform;
};

export type AssetCompositionIntent = {
  assetType: WriterCreatorAssetType;
  attachmentMode: AttachmentMode;
  copyPolicy?: AttachmentCopyPolicy;
  layoutSchemaVersion: string;
};

export type InfographicLayout =
  | 'stats'
  | 'timeline'
  | 'comparison'
  | 'process'
  | 'framework'
  | 'hierarchy';

export type CreatorContentAssetType =
  | 'image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'pdf'
  | 'slider';

export type LegacyCreatorRouteType =
  | 'image'
  | 'banner'
  | 'infographic'
  | 'carousel';

export type AttachmentValidationInput = {
  attachmentMode: AttachmentMode;
  assetType: WriterCreatorAssetType;
  copyPolicy?: AttachmentCopyPolicy;
  overlayText?: Record<string, unknown> | null;
  cta?: unknown;
  sourceText?: string | null;
  sourceType?: 'post' | 'thread' | null;
};

export type AttachmentValidationResult = {
  ok: boolean;
  errors: string[];
};

export const WRITER_CREATOR_LAYOUT_SCHEMA_VERSION = 'writer-creator-asset-v1';

/**
 * Derived from CREATOR_ASSET_REGISTRY (Phase 1 unification). Adding a
 * writer subtype on a canonical entry propagates here automatically.
 * No parallel hardcoded array.
 */
export const WRITER_CREATOR_ASSET_TYPES: readonly WriterCreatorAssetType[] =
  Object.freeze(_getWriterAllowedAssetTypes() as readonly WriterCreatorAssetType[]);

export const SOURCE_TEXT_TRANSFORMS: readonly SourceTextTransform[] = [
  'none',
  'summarize',
  'extract_points',
  'quote',
  'framework',
  'support_visual_only',
];

export const ATTACHMENT_MODES: readonly AttachmentMode[] = [
  'embedded_copy',
  'supporting_visual',
];

export const INFOGRAPHIC_LAYOUTS: readonly InfographicLayout[] = [
  'stats',
  'timeline',
  'comparison',
  'process',
  'framework',
  'hierarchy',
];

export const CREATOR_CONTENT_ASSET_TYPES: readonly CreatorContentAssetType[] = [
  'image',
  'banner',
  'infographic',
  'carousel',
  'pdf',
  'slider',
];

export const SUPPORTING_VISUAL_COPY_POLICY: AttachmentCopyPolicy = {
  allowHeadline: false,
  allowKeyInsight: false,
  allowCTA: false,
  sourceTextTransform: 'none',
};

export function embeddedCopyPolicy(sourceTextTransform: SourceTextTransform = 'summarize'): AttachmentCopyPolicy {
  return {
    allowHeadline: true,
    allowKeyInsight: true,
    allowCTA: false,
    sourceTextTransform,
  };
}

export function normalizeAttachmentMode(value: unknown, fallback: AttachmentMode = 'supporting_visual'): AttachmentMode {
  return value === 'embedded_copy' || value === 'supporting_visual' ? value : fallback;
}

export function normalizeSourceTextTransform(value: unknown, fallback: SourceTextTransform = 'none'): SourceTextTransform {
  return SOURCE_TEXT_TRANSFORMS.includes(value as SourceTextTransform)
    ? value as SourceTextTransform
    : fallback;
}

export function normalizeWriterCreatorAssetType(value: unknown, fallback: WriterCreatorAssetType = 'supporting_image'): WriterCreatorAssetType {
  if (value === 'image') return 'supporting_image';
  return WRITER_CREATOR_ASSET_TYPES.includes(value as WriterCreatorAssetType)
    ? value as WriterCreatorAssetType
    : fallback;
}

export function normalizeInfographicLayout(value: unknown, fallback: InfographicLayout = 'framework'): InfographicLayout {
  return INFOGRAPHIC_LAYOUTS.includes(value as InfographicLayout)
    ? value as InfographicLayout
    : fallback;
}

export function normalizeCreatorContentAssetType(value: unknown, fallback: CreatorContentAssetType = 'image'): CreatorContentAssetType {
  return CREATOR_CONTENT_ASSET_TYPES.includes(value as CreatorContentAssetType)
    ? value as CreatorContentAssetType
    : fallback;
}

export function creatorContentAssetFamily(assetType: CreatorContentAssetType): 'image' | 'carousel' {
  return assetType === 'carousel' || assetType === 'pdf' || assetType === 'slider' ? 'carousel' : 'image';
}

export function creatorRouteTypeForAsset(assetType: WriterCreatorAssetType): LegacyCreatorRouteType {
  if (assetType === 'supporting_image' || assetType === 'brand_card') return 'image';
  // Taxonomy consolidation — banner is now an Image layout (wide-banner).
  // Route the legacy banner writer-attach type to the consolidated image
  // workflow; the layout preset is applied via `creatorLayoutForAsset()`
  // below and absorbed by the page's URL `layout` query parameter.
  if (assetType === 'banner') return 'image';
  return assetType;
}

/**
 * Optional layout preset that the writer-creator launch flow should
 * pass to the consolidated workflow when the legacy assetType maps
 * to a different route type. Returns null when no layout override is
 * needed.
 *
 * Mapping:
 *   banner → image with layout=wide-banner
 *   (slider isn't in WriterCreatorAssetType, but pre-emptive entry
 *    documents the consolidation contract.)
 */
export function creatorLayoutForAsset(assetType: WriterCreatorAssetType): string | null {
  if (assetType === 'banner') return 'wide-banner';
  return null;
}

export function assetLabel(assetType: WriterCreatorAssetType): string {
  // Canonical creator taxonomy labels. `supporting_image` keeps its
  // legacy enum value for backward compatibility on persisted records
  // and route resolution, but the UI surface MUST render it as
  // `Image` — the supporting_image name leaks an old semantic that no
  // longer matches the canonical taxonomy.
  const labels: Record<WriterCreatorAssetType, string> = {
    supporting_image: 'Image',
    banner: 'Banner',
    infographic: 'Infographic',
    carousel: 'Carousel',
    brand_card: 'Brand Card',
  };
  return labels[assetType];
}

export function attachmentModeLabel(mode: AttachmentMode): string {
  return mode === 'embedded_copy' ? 'Embed copy into asset' : 'Keep visual separate from post';
}

export function defaultAttachmentModeForAsset(assetType: WriterCreatorAssetType): AttachmentMode {
  return assetType === 'supporting_image' ? 'supporting_visual' : 'embedded_copy';
}

/* ── Phase 4 — payload signal detection (deterministic heuristics) ──── */

/**
 * Asset types whose visual surface inherently carries typography
 * (headline / subtitle / body / slides). Requesting supporting_visual
 * on these is almost always a misclassification because the visual
 * itself bakes copy in at render time.
 */
const TYPOGRAPHY_BEARING_ASSET_TYPES: ReadonlySet<WriterCreatorAssetType> = new Set([
  'carousel',
  'infographic',
  'banner',
  'brand_card',
]);

/**
 * Keywords that, when present in user-supplied free-form intent fields
 * (visual_intent, constraints, tone, etc.), strongly indicate the
 * asset should embed copy rather than serve as background visual.
 * Lightweight — no NLP, just substring presence.
 */
const TYPOGRAPHY_KEYWORD_PATTERNS: ReadonlyArray<string> = [
  'headline',
  'subtitle',
  'body copy',
  'cta',
  'call-to-action',
  'overlay',
  'quote',
  'include text',
  'include this text',
  'put this text',
  'put text',
  'typography',
  'title card',
  'title and',
  'caption on',
  'caption over',
  'embedded text',
  'embed text',
  'text on image',
  'text overlay',
  'with text',
  'branded copy',
];

/** Source-text transforms whose semantic intent IS to render text on the asset. */
const TEXT_BEARING_TRANSFORMS: ReadonlySet<SourceTextTransform> = new Set([
  'summarize',
  'extract_points',
  'quote',
  'framework',
]);

export type AttachmentModeSignal =
  | 'typography_bearing_asset_type'
  | 'overlay_text_present'
  | 'cta_present'
  | 'paragraph_like_source_text'
  | 'text_bearing_transform'
  | 'typography_keyword';

export type AttachmentIntentSignals = {
  assetType: WriterCreatorAssetType;
  /** The mode the caller requested, if any. Null/undefined ⇒ unknown. */
  requestedMode?: AttachmentMode | null;
  /** Raw source post / thread text the user is attaching an asset for. */
  sourceText?: string | null;
  /** Writer-side overlay_text object (hook/headline/keyInsight/cta/supportingText). */
  overlayText?: Record<string, unknown> | null;
  /** CTA string the user supplied for the asset. */
  cta?: unknown;
  /** Source text transform requested by the user. */
  sourceTextTransform?: SourceTextTransform | null;
  /** Free-form intent text — visual_intent, constraints, tone. */
  freeFormIntent?: ReadonlyArray<string | null | undefined>;
};

export type AttachmentModeResolution = {
  mode: AttachmentMode;
  /** True when the resolver overrode `requestedMode`. */
  coerced: boolean;
  /** Audit trail — signals that fired (for telemetry / dev logs). */
  signals: AttachmentModeSignal[];
};

/**
 * Phase 1 unification — resolve attachment_mode BEFORE validation by
 * inspecting payload signals. The validator stays strict; this helper
 * ensures the validator only ever sees payloads whose mode is
 * semantically aligned with their content.
 *
 * Rules:
 *   - Any signal indicating embedded copy (paragraph source, overlay
 *     text, CTA, text-bearing transform, typography keyword,
 *     typography-bearing asset type) → embedded_copy.
 *   - No embedded-copy signals AND requestedMode === 'supporting_visual'
 *     AND assetType is supporting_image → supporting_visual.
 *   - Otherwise (no signals, no explicit mode, or asset type that
 *     defaults to embedded_copy) → embedded_copy.
 *
 * Phase 5 safe-fallback policy is honored: when uncertain (no clear
 * supporting-visual signal AND no clear embedded-copy signal), prefer
 * embedded_copy because it is the permissive contract.
 */
export function resolveAttachmentModeFromIntent(input: AttachmentIntentSignals): AttachmentModeResolution {
  const signals: AttachmentModeSignal[] = [];

  if (TYPOGRAPHY_BEARING_ASSET_TYPES.has(input.assetType)) {
    signals.push('typography_bearing_asset_type');
  }

  if (hasOverlayText(input.overlayText ?? null)) {
    signals.push('overlay_text_present');
  }

  if (typeof input.cta === 'string' && input.cta.trim().length > 0) {
    signals.push('cta_present');
  }

  if (typeof input.sourceText === 'string' && isParagraphLikeForSupportingVisual(input.sourceText)) {
    signals.push('paragraph_like_source_text');
  }

  if (input.sourceTextTransform && TEXT_BEARING_TRANSFORMS.has(input.sourceTextTransform)) {
    signals.push('text_bearing_transform');
  }

  if (Array.isArray(input.freeFormIntent) && input.freeFormIntent.length > 0) {
    const blob = input.freeFormIntent
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    if (blob && TYPOGRAPHY_KEYWORD_PATTERNS.some((kw) => blob.includes(kw))) {
      signals.push('typography_keyword');
    }
  }

  const requested: AttachmentMode | null = input.requestedMode === 'embedded_copy' || input.requestedMode === 'supporting_visual'
    ? input.requestedMode
    : null;

  // Hard taxonomy gate. `supporting_image` is the one writer asset type whose
  // governance profile is zero-text (maxWordsPerSlide 0, maxTextAreaPercent 0,
  // visualPriority 'visual', allowHeadline false — see ASSET_GOVERNANCE_PROFILES
  // in backend/services/creatorAssetGovernance). It can NEVER carry embedded
  // copy: coercing it to embedded_copy makes the renderer bake the post text
  // onto the image, which the publish validator then HARD-rejects at schedule
  // time with visual_priority_rejects_text_overlay / headline_overlay_forbidden
  // / text_density|area_exceeds_profile (the asset profile, not the platform,
  // drives this — so it fails on every destination). The asset-type default
  // (supporting_visual ONLY for supporting_image) is the source of truth; for
  // such assets we pin supporting_visual regardless of text signals or an
  // explicit embedded_copy request, so Add Asset → Image always produces a
  // schedulable, governance-clean visual.
  if (defaultAttachmentModeForAsset(input.assetType) === 'supporting_visual') {
    return {
      mode: 'supporting_visual',
      coerced: requested === 'embedded_copy' || signals.length > 0,
      signals,
    };
  }

  // Any embedded-copy signal → embedded_copy (coerce supporting_visual
  // requests, preserve the audit signals for telemetry).
  if (signals.length > 0) {
    return {
      mode: 'embedded_copy',
      coerced: requested === 'supporting_visual',
      signals,
    };
  }

  // No signals — honor the requested mode when explicit.
  if (requested) {
    return { mode: requested, coerced: false, signals };
  }

  // No signals + no explicit mode → fall back to asset-type default.
  // Phase 5 safe-fallback: this still defers to the per-asset default,
  // which is supporting_visual ONLY for supporting_image (the one asset
  // type without typography). All other writer types default to
  // embedded_copy, matching the "prefer embedded_copy when uncertain"
  // rule.
  return {
    mode: defaultAttachmentModeForAsset(input.assetType),
    coerced: false,
    signals,
  };
}

export function defaultTransformForAsset(assetType: WriterCreatorAssetType, mode: AttachmentMode): SourceTextTransform {
  if (mode === 'supporting_visual') return 'none';
  if (assetType === 'carousel') return 'summarize';
  if (assetType === 'infographic') return 'framework';
  if (assetType === 'brand_card') return 'quote';
  return 'summarize';
}

export function copyPolicyForIntent(input: {
  attachmentMode: AttachmentMode;
  sourceTextTransform?: SourceTextTransform;
  allowCTA?: boolean;
}): AttachmentCopyPolicy {
  if (input.attachmentMode === 'supporting_visual') return SUPPORTING_VISUAL_COPY_POLICY;
  return {
    ...embeddedCopyPolicy(input.sourceTextTransform ?? 'summarize'),
    allowCTA: input.allowCTA === true,
  };
}

export function buildAssetCompositionIntent(input: {
  assetType: WriterCreatorAssetType;
  attachmentMode?: AttachmentMode;
  sourceTextTransform?: SourceTextTransform;
  copyPolicy?: AttachmentCopyPolicy;
  layoutSchemaVersion?: string;
}): AssetCompositionIntent {
  const attachmentMode = input.attachmentMode ?? defaultAttachmentModeForAsset(input.assetType);
  const sourceTextTransform = input.sourceTextTransform ?? defaultTransformForAsset(input.assetType, attachmentMode);
  return {
    assetType: input.assetType,
    attachmentMode,
    copyPolicy: input.copyPolicy ?? copyPolicyForIntent({ attachmentMode, sourceTextTransform }),
    layoutSchemaVersion: input.layoutSchemaVersion ?? WRITER_CREATOR_LAYOUT_SCHEMA_VERSION,
  };
}

export function attachmentModeToRendererTextPolicy(mode: AttachmentMode): 'background_only' | 'deterministic_typography' {
  return mode === 'supporting_visual' ? 'background_only' : 'deterministic_typography';
}

export function hasOverlayText(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  return ['hook', 'headline', 'keyInsight', 'cta', 'supportingText']
    .some((key) => typeof value[key] === 'string' && String(value[key]).trim().length > 0);
}

/**
 * Phase A — shared paragraphLike heuristic.
 *
 * Mirrors the regex used inside `validateAttachmentPayload` (rule #3). Exported
 * so the client-side composer can predict the server's verdict and surface a
 * proactive warning BEFORE the user submits — avoiding the round-trip 400.
 *
 * Semantics:
 *   - Returns true when the text is too dense to render as a visual overlay
 *   - Two triggers (matches server rule):
 *     1. A single-run of 160+ non-whitespace characters
 *     2. A paragraph break (\n\n+) where any part is > 120 chars
 */
export function isParagraphLikeForSupportingVisual(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  if (!t) return false;
  if (/\S.{160,}\S/.test(t)) return true;
  return t.split(/\n{2,}/).some((part) => part.trim().length > 120);
}

export function validateAttachmentPayload(input: AttachmentValidationInput): AttachmentValidationResult {
  const errors: string[] = [];
  const hasCta = typeof input.cta === 'string' && input.cta.trim().length > 0;
  const policy = input.copyPolicy;
  const sourceText = String(input.sourceText || '');
  // Shared with the client via isParagraphLikeForSupportingVisual above —
  // any change to this heuristic MUST update the exported helper too.
  const paragraphLike = isParagraphLikeForSupportingVisual(sourceText);

  // GENERIC, CONTRACT-DRIVEN VALIDATION. The validator never tests asset types:
  // eligibility comes from `canAttachTo` and all content governance from the
  // canonical `attachmentGovernance` contract. A new/changed asset adjusts
  // registry metadata only — this function does not change.
  const eligible = canAttachTo(input.sourceType, input.assetType);
  const gov = resolveAttachmentGovernance(input.assetType);
  const transform = policy?.sourceTextTransform ?? 'none';

  if (!eligible) {
    errors.push(`${input.sourceType} flow does not support ${input.assetType} asset type`);
  }

  // Mode must be one this asset's governance accepts.
  if (input.attachmentMode && !gov.supportedAttachmentModes.includes(input.attachmentMode)) {
    errors.push(`${input.assetType} does not support ${input.attachmentMode} attachment`);
  }
  // Transform must be within the asset's allowed set (when constrained).
  if (policy?.sourceTextTransform && gov.allowedSourceTextTransforms !== 'all' && !gov.allowedSourceTextTransforms.includes(transform)) {
    errors.push(`${input.assetType} does not allow the ${transform} transform`);
  }

  if (input.attachmentMode === 'supporting_visual') {
    if (!gov.allowsSupportingVisual) errors.push(`${input.assetType} does not support supporting_visual attachment`);
    // Supporting-visual is textless by contract: no overlay, no CTA, no embedded copy.
    if (hasOverlayText(input.overlayText)) errors.push('supporting_visual rejects overlay_text');
    if (hasCta) errors.push('supporting_visual forbids CTA');
    // The paragraph rejection only applies when the source text would actually be
    // transformed into overlay copy. With transform 'none' the snippet is
    // conceptual context for a textless background and is never rendered.
    if (paragraphLike && policy?.sourceTextTransform && policy.sourceTextTransform !== 'none') {
      errors.push('supporting_visual rejects paragraph overlays');
    }
    // Duplicate-text governance: forbid raw source duplication into the visual.
    if (gov.duplicateTextPolicy === 'forbid_raw_duplication'
      && input.sourceType === 'thread'
      && policy?.sourceTextTransform !== 'support_visual_only' && policy?.sourceTextTransform !== 'none') {
      errors.push('supporting_visual rejects thread duplication transforms');
    }
    if (policy?.allowCTA) errors.push('supporting_visual copy policy cannot allow CTA');
    if (policy?.allowHeadline || policy?.allowKeyInsight) errors.push('supporting_visual cannot allow embedded copy');
  }

  if (input.attachmentMode === 'embedded_copy' && !policy) {
    errors.push('embedded_copy requires explicit copy_policy');
  }
  if (input.attachmentMode === 'embedded_copy' && hasCta && !policy?.allowCTA) {
    errors.push('embedded_copy CTA requires explicit copy policy allowCTA');
  }

  // Transform-required governance (was the thread+carousel special case): when an
  // asset's contract forbids raw duplication via `requiresTransformForEmbeddedCopy`,
  // embedded_copy must carry a non-'none' transform so source content is
  // re-presented, not duplicated verbatim. Gated by eligibility so an ineligible
  // combo (already rejected above) does not accrue a second, misleading error —
  // preserving the prior thread-scoped behavior exactly.
  if (eligible
    && gov.requiresTransformForEmbeddedCopy
    && input.attachmentMode !== 'supporting_visual'
    && transform === 'none') {
    errors.push('thread carousel requires transform policy');
  }

  return { ok: errors.length === 0, errors };
}
