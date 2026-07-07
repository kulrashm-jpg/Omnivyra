import {
  autoCorrectVisualCopy,
  buildPreviewGovernanceWarnings,
  resolveAssetGovernanceProfile,
  resolvePlatformVisualProfile,
  scoreCreatorQuality,
  validateVisualGovernance,
} from '../../services/creatorAssetGovernance';
import { ThreadVisualTransformationEngine } from '../../../lib/content/writerCreatorThreadTransform';

describe('creator asset governance', () => {
  it('rejects dense overlays for supporting images', () => {
    const result = validateVisualGovernance({
      assetType: 'supporting_image',
      platform: 'linkedin',
      textBlocks: ['This visual should not contain visible overlay copy at all'],
      hasCTA: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'text_density_exceeds_profile',
      'visual_priority_rejects_text_overlay',
    ]));
  });

  it('enforces banner headline hierarchy without paragraph-heavy copy', () => {
    const profile = resolveAssetGovernanceProfile('banner');
    const result = validateVisualGovernance({
      assetType: 'banner',
      platform: 'linkedin',
      textBlocks: ['Enterprise launch readiness', 'This is a full sentence. This second sentence makes it read like a paragraph.'],
      hasCTA: false,
      paragraphCount: 1,
    });

    expect(profile.allowHeadline).toBe(true);
    expect(profile.allowParagraphs).toBe(false);
    expect(result.errors).toContain('paragraph_overlay_forbidden');
  });

  it('banner accepts a structured headline + subheadline + CTA, rejects genuinely dense copy', () => {
    // Text-inside-image promo copy (~24-26 words across headline/sub/CTA) must NOT fail closed.
    const promo = validateVisualGovernance({
      assetType: 'banner',
      platform: 'linkedin',
      textBlocks: [
        'Unlock 40% Off Omnivyra for Founding Members - Elevate Your Marketing',
        'Omnivyra will be available for founding members at 40% of its original price',
        'Learn more',
      ],
      hasCTA: true,
    });
    expect(promo.errors).not.toContain('text_density_exceeds_profile');
    // Genuinely dense copy (well over the budget) still fails closed.
    const dense = validateVisualGovernance({
      assetType: 'banner',
      platform: 'linkedin',
      textBlocks: [Array.from({ length: 44 }, (_, i) => `word${i}`).join(' ')],
      hasCTA: false,
    });
    expect(dense.errors).toContain('text_density_exceeds_profile');
  });

  it('enforces infographic density constraints', () => {
    const result = validateVisualGovernance({
      assetType: 'infographic',
      platform: 'linkedin',
      textBlocks: Array.from({ length: 9 }, (_, index) => `Section ${index + 1} ${'detail '.repeat(12)}`),
      hasCTA: false,
      textAreaPercent: 48,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'text_density_exceeds_profile',
      'text_area_exceeds_profile',
    ]));
  });

  it('prevents thread support visual duplication', () => {
    const result = validateVisualGovernance({
      assetType: 'supporting_image',
      platform: 'x',
      textBlocks: [],
      duplicateText: true,
    });

    expect(result.errors).toContain('thread_duplication_forbidden');
  });

  it('keeps platform rendering profiles distinct', () => {
    expect(resolvePlatformVisualProfile('linkedin')).toMatchObject({
      visualStyle: 'professional',
      carouselBehavior: 'framework',
    });
    expect(resolvePlatformVisualProfile('instagram')).toMatchObject({
      visualStyle: 'visual_first',
      preferredTypographyScale: 'large',
    });
    expect(resolvePlatformVisualProfile('linkedin')).not.toEqual(resolvePlatformVisualProfile('instagram'));
  });

  it('enforces minimal typography for brand cards', () => {
    const corrected = autoCorrectVisualCopy({
      assetType: 'brand_card',
      textBlocks: [`${'brand '.repeat(40)}book a demo`],
      allowCTA: false,
    });

    expect(corrected.textBlocks[0].split(/\s+/)).toHaveLength(22);
    expect(corrected.textBlocks[0]).not.toMatch(/book a demo/i);
    expect(corrected.corrections).toEqual(expect.arrayContaining(['removed_cta', 'reduced_text_density']));
  });

  it('detects clutter through quality scoring', () => {
    const score = scoreCreatorQuality({
      assetType: 'carousel',
      platform: 'instagram',
      textBlocks: ['dense '.repeat(80)],
      hasCTA: true,
      overlapRisk: true,
      tinyTextRisk: true,
    });

    expect(score.clutterRisk).toBeGreaterThanOrEqual(90);
    expect(score.typographySafety).toBeLessThan(20);
    expect(score.warnings).toEqual(expect.arrayContaining(['typography_overlap_risk', 'tiny_text_risk']));
  });

  it('auto-correction reduces overflow', () => {
    const corrected = autoCorrectVisualCopy({
      assetType: 'carousel',
      textBlocks: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one thirty-two thirty-three thirty-four thirty-five'],
    });

    expect(corrected.textBlocks[0].split(/\s+/).length).toBeLessThanOrEqual(34);
    expect(corrected.corrections).toContain('reduced_text_density');
  });

  it('rejects typography overlap and tiny text regions', () => {
    const result = validateVisualGovernance({
      assetType: 'banner',
      platform: 'linkedin',
      textBlocks: ['Launch'],
      overlapRisk: true,
      tinyTextRisk: true,
    });

    expect(result.errors).toEqual(expect.arrayContaining(['typography_overlap_risk', 'tiny_text_risk']));
  });

  it('exposes preview warnings from validation and scoring', () => {
    const validation = validateVisualGovernance({
      assetType: 'banner',
      platform: 'instagram',
      textBlocks: ['copy '.repeat(40)],
      textAreaPercent: 30,
    });
    const quality = scoreCreatorQuality({
      assetType: 'banner',
      platform: 'instagram',
      textBlocks: ['copy '.repeat(40)],
      overlapRisk: true,
    });

    expect(buildPreviewGovernanceWarnings({ validation, quality })).toEqual(expect.arrayContaining([
      'text_density_exceeds_profile',
      'typography_overlap_risk',
    ]));
  });

  it('creates structured framework transforms', () => {
    const engine = new ThreadVisualTransformationEngine();
    const result = engine.transform({
      transform: 'framework',
      sourceText: 'First, define the shift clearly. Second, show the mechanism. Third, prove the outcome.',
    });

    expect(result.complementaryOnly).toBe(false);
    expect(result.items[0]).toMatch(/^Context:/);
  });

  it('isolates bounded quote transforms only', () => {
    const engine = new ThreadVisualTransformationEngine();
    const result = engine.transform({
      transform: 'quote',
      sourceText: '"This is the strongest statement in the thread because it is precise, concrete, and useful without restating every supporting paragraph in the visual."',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].split(/\s+/).length).toBeLessThanOrEqual(22);
  });
});
