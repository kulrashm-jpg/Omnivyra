export type AttachmentMode =
  | 'embedded_copy'
  | 'supporting_visual';

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

export const WRITER_CREATOR_ASSET_TYPES: readonly WriterCreatorAssetType[] = [
  'supporting_image',
  'banner',
  'infographic',
  'carousel',
  'brand_card',
];

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
  return assetType;
}

export function assetLabel(assetType: WriterCreatorAssetType): string {
  const labels: Record<WriterCreatorAssetType, string> = {
    supporting_image: 'Supporting image',
    banner: 'Banner',
    infographic: 'Infographic',
    carousel: 'Carousel',
    brand_card: 'Brand card',
  };
  return labels[assetType];
}

export function attachmentModeLabel(mode: AttachmentMode): string {
  return mode === 'embedded_copy' ? 'Embed copy into asset' : 'Keep visual separate from post';
}

export function defaultAttachmentModeForAsset(assetType: WriterCreatorAssetType): AttachmentMode {
  return assetType === 'supporting_image' ? 'supporting_visual' : 'embedded_copy';
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

export function validateAttachmentPayload(input: AttachmentValidationInput): AttachmentValidationResult {
  const errors: string[] = [];
  const hasCta = typeof input.cta === 'string' && input.cta.trim().length > 0;
  const policy = input.copyPolicy;
  const sourceText = String(input.sourceText || '');
  const paragraphLike = /\S.{160,}\S/.test(sourceText) || sourceText.split(/\n{2,}/).some((part) => part.trim().length > 120);

  if (input.attachmentMode === 'supporting_visual') {
    if (hasOverlayText(input.overlayText)) errors.push('supporting_visual rejects overlay_text');
    if (hasCta) errors.push('supporting_visual forbids CTA');
    if (paragraphLike) errors.push('supporting_visual rejects paragraph overlays');
    if (input.sourceType === 'thread' && policy?.sourceTextTransform !== 'support_visual_only' && policy?.sourceTextTransform !== 'none') {
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

  if (input.sourceType === 'thread' && input.assetType === 'carousel') {
    const transform = policy?.sourceTextTransform ?? 'none';
    if (transform === 'none') errors.push('thread carousel requires transform policy');
  }

  return { ok: errors.length === 0, errors };
}
