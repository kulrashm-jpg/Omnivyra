import type { CreatorQualityScore, VisualGovernanceValidation } from './creatorAssetGovernance';
import type { GeometryValidationResult } from './creatorRenderGeometry';
import type { ProviderTextValidationResult } from './creatorImageTextValidation';
import type { CreatorAccessibilityManifest } from './creatorAccessibilityValidation';

export type RenderManifest = {
  manifestVersion: 'creator-render-manifest-v1';
  rendererId: string;
  rendererVersion: string;
  platformProfile: Record<string, unknown>;
  governanceProfile: Record<string, unknown>;
  qualityScore: CreatorQualityScore;
  validationResult: VisualGovernanceValidation;
  ocrResult: ProviderTextValidationResult;
  typographySafetyResult: GeometryValidationResult;
  transformIntent: string | null;
  exportMetadata: Record<string, unknown>;
  accessibility: {
    altText: string;
    readingOrder: string[];
    contrastRatio?: number;
    minReadableFont: number;
    localizationPolicy: 'ascii-safe' | 'multilingual-safe';
  };
  accessibilityValidation?: CreatorAccessibilityManifest;
};

export function createRenderManifest(input: {
  rendererId: string;
  platformProfile: Record<string, unknown>;
  governanceProfile: Record<string, unknown>;
  qualityScore: CreatorQualityScore;
  validationResult: VisualGovernanceValidation;
  ocrResult: ProviderTextValidationResult;
  typographySafetyResult: GeometryValidationResult;
  transformIntent?: string | null;
  exportMetadata?: Record<string, unknown>;
  altText: string;
  readingOrder: string[];
  localizationPolicy?: 'ascii-safe' | 'multilingual-safe';
  accessibilityValidation?: CreatorAccessibilityManifest;
}): RenderManifest {
  return {
    manifestVersion: 'creator-render-manifest-v1',
    rendererId: input.rendererId,
    rendererVersion: 'enterprise-renderer-v1',
    platformProfile: input.platformProfile,
    governanceProfile: input.governanceProfile,
    qualityScore: input.qualityScore,
    validationResult: input.validationResult,
    ocrResult: input.ocrResult,
    typographySafetyResult: input.typographySafetyResult,
    transformIntent: input.transformIntent ?? null,
    exportMetadata: input.exportMetadata ?? {},
    accessibility: {
      altText: input.altText,
      readingOrder: input.readingOrder,
      contrastRatio: input.typographySafetyResult.contrastRatio,
      minReadableFont: 18,
      localizationPolicy: input.localizationPolicy ?? 'ascii-safe',
    },
    accessibilityValidation: input.accessibilityValidation,
  };
}

export function assertRenderManifestExportable(manifest: RenderManifest): void {
  const errors = [
    ...manifest.validationResult.errors,
    ...manifest.ocrResult.flags.filter((flag) => flag !== 'provider_image_unavailable_for_ocr'),
    ...manifest.typographySafetyResult.errors,
    ...(manifest.accessibilityValidation?.errors ?? []),
  ];
  if (errors.length > 0) {
    throw new Error(`render_manifest_rejected:${errors.join(',')}`);
  }
}
