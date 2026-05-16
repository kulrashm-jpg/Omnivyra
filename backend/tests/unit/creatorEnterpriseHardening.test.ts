import fs from 'fs';
import path from 'path';
import { detectTextRegions, validateProviderImageTextSafety } from '../../services/creatorImageTextValidation';
import { validateLayoutGeometry } from '../../services/creatorRenderGeometry';
import { createRenderManifest, assertRenderManifestExportable } from '../../services/creatorRenderManifest';
import { detectSemanticThreadDuplication } from '../../services/creatorSemanticDuplication';
import { enqueueRenderJob } from '../../services/creatorRenderQueue';
import { getCreatorRendererRegistration, listRegisteredCreatorRenderers } from '../../services/creatorRendererRegistry';
import {
  resolvePlatformVisualProfile,
  resolveAssetGovernanceProfile,
  scoreCreatorQuality,
  validateVisualGovernance,
} from '../../services/creatorAssetGovernance';

const rendererSource = fs.readFileSync(path.join(process.cwd(), 'backend/services/creatorAssetRenderer.ts'), 'utf8');

describe('enterprise creator hardening', () => {
  it('keeps renderer registrations independent for every governed asset type', () => {
    expect(listRegisteredCreatorRenderers().map((entry) => entry.assetType).sort()).toEqual([
      'banner',
      'brand_card',
      'carousel',
      'infographic',
      'pdf',
      'slider',
      'supporting_image',
    ]);
    expect(getCreatorRendererRegistration('pdf').rendererId).not.toBe(getCreatorRendererRegistration('slider').rendererId);
    expect(getCreatorRendererRegistration('supporting_image').rendererId).not.toBe(getCreatorRendererRegistration('banner').rendererId);
  });

  it('removes the legacy collapsed renderer entry points', () => {
    expect(rendererSource).not.toContain('renderImageLikeAsset');
    expect(rendererSource).not.toContain('renderCarouselLikeAsset');
    expect(rendererSource).not.toContain('resolveRetiredVisualMode');
  });

  it('blocks export through hard governance manifest gates', () => {
    const validation = validateVisualGovernance({
      assetType: 'banner',
      platform: 'instagram',
      textBlocks: ['dense '.repeat(80)],
      textAreaPercent: 70,
      overlapRisk: true,
    });
    const quality = scoreCreatorQuality({
      assetType: 'banner',
      platform: 'instagram',
      textBlocks: ['dense '.repeat(80)],
      overlapRisk: true,
    });
    const geometry = validateLayoutGeometry({
      width: 400,
      height: 400,
      boxes: [
        { id: 'a', x: 20, y: 20, width: 250, height: 120, fontSize: 12 },
        { id: 'b', x: 100, y: 80, width: 250, height: 120, fontSize: 12 },
      ],
      foreground: '#777777',
      background: '#777777',
    });
    const manifest = createRenderManifest({
      rendererId: 'banner-renderer',
      platformProfile: resolvePlatformVisualProfile('instagram') as unknown as Record<string, unknown>,
      governanceProfile: resolveAssetGovernanceProfile('banner') as unknown as Record<string, unknown>,
      qualityScore: quality,
      validationResult: validation,
      ocrResult: { ok: true, flags: [], mode: 'embedded_copy' },
      typographySafetyResult: geometry,
      altText: 'Blocked banner',
      readingOrder: ['a', 'b'],
    });

    expect(() => assertRenderManifestExportable(manifest)).toThrow(/render_manifest_rejected/);
  });

  it('rejects provider-generated visible text for supporting visuals', () => {
    const result = validateProviderImageTextSafety({
      mode: 'supporting_visual',
      providerReturnedImage: true,
      prompt: 'Strictly avoid all visible text: no words, letters, numbers.',
      ocrText: 'BOOK A DEMO',
      regionCount: 3,
      maxRegionDensity: 0.2,
    });

    expect(result.ok).toBe(false);
    expect(result.flags).toEqual(expect.arrayContaining([
      'provider_visible_text_detected',
      'provider_cta_text_detected',
      'supporting_visual_provider_text_rejected',
    ]));
  });

  it('proves platform profiles materially differ', () => {
    expect(resolvePlatformVisualProfile('linkedin')).toMatchObject({
      visualStyle: 'professional',
      carouselBehavior: 'framework',
      ctaTolerance: 'low',
    });
    expect(resolvePlatformVisualProfile('x')).toMatchObject({
      preferredTypographyScale: 'compact',
      carouselBehavior: 'concise',
    });
    expect(resolvePlatformVisualProfile('instagram')).toMatchObject({
      preferredTypographyScale: 'large',
      visualStyle: 'visual_first',
    });
    expect(resolvePlatformVisualProfile('facebook')).toMatchObject({
      visualStyle: 'social_balanced',
      preferredDensity: 'medium',
    });
  });

  it('catches overlap through geometry validation', () => {
    const geometry = validateLayoutGeometry({
      width: 1000,
      height: 1000,
      boxes: [
        { id: 'headline', x: 100, y: 100, width: 400, height: 180, fontSize: 32 },
        { id: 'body', x: 150, y: 180, width: 400, height: 180, fontSize: 16 },
      ],
    });

    expect(geometry.ok).toBe(false);
    expect(geometry.errors).toEqual(expect.arrayContaining(['collision:headline:body', 'tiny_typography:body']));
  });

  it('detects semantic and paraphrase-like thread duplication', () => {
    const result = detectSemanticThreadDuplication({
      transform: 'support_visual_only',
      rawSourceText: 'Revenue teams lose momentum when every follow-up is rebuilt from scratch. The operating system has to preserve context.',
      visualItems: ['Preserve context so revenue teams stop rebuilding follow-up momentum from scratch.'],
    });

    expect(result.ok).toBe(false);
    expect(result.maxSimilarity).toBeGreaterThan(0.22);
  });

  it('preserves render manifest accessibility and localization fields', () => {
    const geometry = validateLayoutGeometry({ width: 1200, height: 1200, boxes: [], foreground: '#111111', background: '#ffffff' });
    const validation = validateVisualGovernance({ assetType: 'brand_card', platform: 'linkedin', textBlocks: ['Clear point of view'] });
    const quality = scoreCreatorQuality({ assetType: 'brand_card', platform: 'linkedin', textBlocks: ['Clear point of view'] });
    const manifest = createRenderManifest({
      rendererId: 'brand-card-renderer',
      platformProfile: resolvePlatformVisualProfile('linkedin') as unknown as Record<string, unknown>,
      governanceProfile: resolveAssetGovernanceProfile('brand_card') as unknown as Record<string, unknown>,
      qualityScore: quality,
      validationResult: validation,
      ocrResult: detectTextRegions({ ocrText: '' }),
      typographySafetyResult: geometry,
      altText: 'Brand card quote',
      readingOrder: ['quote', 'brand'],
      localizationPolicy: 'multilingual-safe',
    });

    expect(manifest.accessibility).toMatchObject({
      altText: 'Brand card quote',
      readingOrder: ['quote', 'brand'],
      localizationPolicy: 'multilingual-safe',
    });
  });

  it('runs render jobs idempotently with retry status', async () => {
    const first = await enqueueRenderJob({
      idempotencyKey: 'enterprise-render-test',
      run: async () => ({ ok: true }),
    });
    const second = await enqueueRenderJob({
      idempotencyKey: 'enterprise-render-test',
      run: async () => ({ ok: false }),
    });

    expect(first.status).toBe('completed');
    expect(second.result).toEqual({ ok: true });
  });
});
