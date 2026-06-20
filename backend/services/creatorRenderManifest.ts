import type { CreatorQualityScore, VisualGovernanceValidation } from './creatorAssetGovernance';
import type { GeometryValidationResult } from './creatorRenderGeometry';
import type { ProviderTextValidationResult } from './creatorImageTextValidation';
import type { CreatorAccessibilityManifest } from './creatorAccessibilityValidation';

/**
 * Phase 3 — flags carried on the manifest when governance is operating
 * in a relaxed-but-audited mode. These NEVER weaken validation
 * silently: the flags ride alongside the manifest so dashboards /
 * audits see the relaxation, and `assertRenderManifestExportable`
 * checks them explicitly when deciding which OCR / reading-order
 * flags to treat as fatal.
 */
export type GovernanceCompatibilityFlags = {
  /** Asset qualifies for the lightweight-social embedded_copy lane. */
  lightweight_social_embedded_copy?: boolean;
  /** OCR-provider absence was tolerated under the lightweight policy. */
  ocr_relaxed?: boolean;
  /** Reading order was generated from the overlay structure, not OCR. */
  synthetic_reading_order?: boolean;
  /** Free-text degradation reason for audit. */
  degraded_mode_reason?: string;
};

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
  /** Phase 3 — governance audit envelope. Optional; omitted on the
   *  strict path. */
  governanceCompatibility?: GovernanceCompatibilityFlags;
};

/* ── Phase 3 — synthetic reading-order helpers ──────────────────────── */

/**
 * Deterministic reading-order generator for lightweight social
 * embedded_copy assets. Walks the governed-overlay slots in their
 * canonical top-to-bottom rendering order and emits the keys that
 * carry copy. If NO overlay slot is populated (the request is asking
 * to render a copy-bearing asset with no copy specified), falls back
 * to a structural placeholder that keeps the accessibility validator
 * happy without misrepresenting empty content as semantic content.
 */
const CANONICAL_OVERLAY_ORDER: ReadonlyArray<string> = [
  'hook',
  'headline',
  'subheadline',
  'keyInsight',
  'body',
  'supportingText',
  'quote',
  'cta',
];

export function synthesizeReadingOrderForOverlay(
  governedOverlay: Record<string, unknown> | null | undefined,
): { readingOrder: string[]; synthetic: boolean } {
  const overlay = governedOverlay && typeof governedOverlay === 'object' ? governedOverlay : {};
  const populated = CANONICAL_OVERLAY_ORDER.filter((key) => {
    const value = (overlay as Record<string, unknown>)[key];
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  });
  if (populated.length > 0) {
    return { readingOrder: populated, synthetic: false };
  }
  // Structural placeholder when no overlay copy is present. Encodes the
  // overlay slot vocabulary so screen readers receive a coherent
  // reading-order envelope even when render time finds the slots
  // empty. Flagged as synthetic so the audit trail records it.
  return { readingOrder: ['headline', 'body', 'cta'], synthetic: true };
}

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
  /** Phase 3 — opt-in governance compatibility envelope. */
  governanceCompatibility?: GovernanceCompatibilityFlags;
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
    governanceCompatibility: input.governanceCompatibility,
  };
}

/**
 * OCR flags that are operational-tier (provider unavailable / unconfigured /
 * HTTP-level errors), NOT content-validation tier (text-exceeds-threshold,
 * dense-region-ratio, CTA-detected, etc.). The operational tier is what
 * the lightweight-social-embedded-copy lane is permitted to tolerate;
 * content-validation tier remains fatal regardless of lane.
 */
const OCR_OPERATIONAL_FLAGS: ReadonlySet<string> = new Set([
  'provider_image_unavailable_for_ocr',
  'ocr_provider_unconfigured',
  'ocr_provider_required_unavailable',
]);

/** Accessibility errors the lightweight lane is permitted to tolerate
 *  because they are repaired by the synthetic reading-order fallback. */
const ACCESSIBILITY_SYNTHETIC_REPAIRED_ERRORS: ReadonlySet<string> = new Set([
  'reading_order_missing',
]);

export function assertRenderManifestExportable(manifest: RenderManifest): void {
  const compat = manifest.governanceCompatibility ?? {};
  const isLightweight = compat.lightweight_social_embedded_copy === true;
  const ocrRelaxed = compat.ocr_relaxed === true;
  const syntheticOrder = compat.synthetic_reading_order === true;

  // OCR flags: always filter the historical no-op flag; under the
  // lightweight + ocr_relaxed envelope, also filter operational-tier
  // OCR flags (provider unavailable / unconfigured). Content-validation
  // OCR flags (text-overrun, dense regions, CTA-detected) ALWAYS stay
  // fatal — those are content-level governance, not infrastructure.
  const ocrErrors = manifest.ocrResult.flags.filter((flag) => {
    if (flag === 'provider_image_unavailable_for_ocr') return false;
    if (isLightweight && ocrRelaxed && OCR_OPERATIONAL_FLAGS.has(flag)) return false;
    // Local/dev has no OCR provider (CREATOR_OCR_ENDPOINT unset): operational-tier
    // OCR flags (provider unconfigured / unavailable) must not fail the render
    // closed OUTSIDE production. Content-validation OCR flags only appear when a
    // provider actually ran, so they are unaffected. Production stays fail-closed
    // (forces proper OCR configuration).
    if (process.env.NODE_ENV !== 'production' && OCR_OPERATIONAL_FLAGS.has(flag)) return false;
    return true;
  });

  // Accessibility errors: under the lightweight + synthetic-reading-order
  // envelope, the reading_order_missing error is repaired by the
  // synthesizer. Other accessibility errors (alt-text-missing, font-floor,
  // contrast-AA) stay fatal — those are content governance.
  const accessibilityErrors = (manifest.accessibilityValidation?.errors ?? []).filter((flag) => {
    if (isLightweight && syntheticOrder && ACCESSIBILITY_SYNTHETIC_REPAIRED_ERRORS.has(flag)) return false;
    return true;
  });

  const errors = [
    ...manifest.validationResult.errors,
    ...ocrErrors,
    ...manifest.typographySafetyResult.errors,
    ...accessibilityErrors,
  ];
  if (errors.length > 0) {
    throw new Error(`render_manifest_rejected:${errors.join(',')}`);
  }
}
