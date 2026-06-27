import {
  buildWriterCreatorPrefill,
  POST_CREATOR_ASSET_TYPES,
  THREAD_CREATOR_ASSET_TYPES,
} from '../../../lib/content/writerCreatorAssetLaunch';
import {
  buildAssetCompositionIntent,
  creatorContentAssetFamily,
  CREATOR_CONTENT_ASSET_TYPES,
  validateAttachmentPayload,
  resolveAttachmentModeFromIntent,
} from '../../../lib/content/writerCreatorAttachmentContracts';
import { mediaTypesFromCreatorAttachments, mediaUrlsFromCreatorAttachments } from '../../../lib/content/schedulerAttachmentSemantics';
import { containsDirectThreadDuplication, transformThreadForVisual } from '../../../lib/content/writerCreatorThreadTransform';
import fs from 'fs';
import path from 'path';

describe('text-bearing template wins over supporting_image session (crisp overlay regression)', () => {
  // A user-selected Headline+Sub+CTA template is a `banner`: overlay text present
  // → embedded_copy → the renderer composites the deterministic crisp overlay.
  it('banner + overlay text resolves to embedded_copy (deterministic overlay applies)', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'banner',
      requestedMode: 'supporting_visual', // even if the writer session asked for supporting_visual
      overlayText: { headline: 'Boost activation by 92%', cta: 'Start free' },
    });
    expect(r.mode).toBe('embedded_copy');
  });

  // The hard zero-text pin for genuine supporting_image (logo-only) is preserved:
  // a clean visual never bakes text, so the publish validator never rejects it.
  it('supporting_image stays pinned to supporting_visual (zero-text governance preserved)', () => {
    const r = resolveAttachmentModeFromIntent({
      assetType: 'supporting_image',
      requestedMode: 'embedded_copy',
      overlayText: { headline: 'Some text' },
    });
    expect(r.mode).toBe('supporting_visual');
  });
});

describe('Writer -> Creator attachment contracts', () => {
  it('exposes first-class post/thread asset catalogs aligned with canonical creator taxonomy', () => {
    // Carousel is a sequence-oriented asset and is exposed only on the
    // thread surface. Post flow is single-attachment by contract.
    expect(POST_CREATOR_ASSET_TYPES).toEqual([
      'supporting_image',
      'banner',
      'brand_card',
      'infographic',
    ]);
    expect(THREAD_CREATOR_ASSET_TYPES).toEqual([
      'supporting_image',
      'banner',
      'brand_card',
      'carousel',
      'infographic',
    ]);
  });

  it('post flow rejects carousel asset type at the payload validator', () => {
    const result = validateAttachmentPayload({
      attachmentMode: 'embedded_copy',
      assetType: 'carousel',
      copyPolicy: {
        allowHeadline: true,
        allowKeyInsight: true,
        allowCTA: false,
        sourceTextTransform: 'summarize',
      },
      overlayText: null,
      sourceType: 'post',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('post flow does not support carousel asset type');
  });

  it('exposes the six standalone Creator asset routes as first-class content asset types', () => {
    expect(CREATOR_CONTENT_ASSET_TYPES).toEqual([
      'image',
      'banner',
      'infographic',
      'carousel',
      'pdf',
      'slider',
    ]);
    expect(creatorContentAssetFamily('image')).toBe('image');
    expect(creatorContentAssetFamily('banner')).toBe('image');
    expect(creatorContentAssetFamily('infographic')).toBe('image');
    expect(creatorContentAssetFamily('carousel')).toBe('carousel');
    expect(creatorContentAssetFamily('pdf')).toBe('carousel');
    expect(creatorContentAssetFamily('slider')).toBe('carousel');
  });

  it('builds text-only Writer prefill with composition intent and no overlay payload', () => {
    const out = buildWriterCreatorPrefill({
      sourceType: 'post',
      sourceId: 'p1',
      assetType: 'infographic',
      attachmentMode: 'embedded_copy',
      sourceTextTransform: 'framework',
      title: 'Launch plan',
      body: 'A post about launch planning.',
    });

    expect(out.compositionIntent).toMatchObject({
      assetType: 'infographic',
      attachmentMode: 'embedded_copy',
      layoutSchemaVersion: 'writer-creator-asset-v1',
    });
    expect(out.compositionIntent.copyPolicy?.sourceTextTransform).toBe('framework');
    expect(out).not.toHaveProperty('overlayText');
    expect(out).not.toHaveProperty('threadSegments');
    expect(out).not.toHaveProperty('legacyVisualMode');
  });

  it('Writer launch utility never branches on retired visual mode metadata', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/content/writerCreatorAssetLaunch.ts'), 'utf8');
    expect(source).not.toContain('retired_visual_mode');
    expect(source).not.toContain('attachmentModeToRetiredVisualMode');
    expect(source).toContain('compositionIntent');
  });

  it('supporting_visual rejects overlay_text and CTA leakage', () => {
    const result = validateAttachmentPayload({
      attachmentMode: 'supporting_visual',
      assetType: 'supporting_image',
      copyPolicy: buildAssetCompositionIntent({
        assetType: 'supporting_image',
        attachmentMode: 'supporting_visual',
      }).copyPolicy,
      overlayText: { headline: 'Do not render this' },
      cta: 'Book a demo',
      sourceType: 'post',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'supporting_visual rejects overlay_text',
      'supporting_visual forbids CTA',
    ]));
  });

  it('supporting_visual rejects paragraph overlays and thread duplication transforms', () => {
    const result = validateAttachmentPayload({
      attachmentMode: 'supporting_visual',
      assetType: 'supporting_image',
      copyPolicy: {
        allowHeadline: false,
        allowKeyInsight: false,
        allowCTA: false,
        sourceTextTransform: 'summarize',
      },
      sourceText: 'This is a long paragraph that should not become visual overlay copy. '.repeat(5),
      sourceType: 'thread',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'supporting_visual rejects paragraph overlays',
      'supporting_visual rejects thread duplication transforms',
    ]));
  });

  it('embedded_copy requires explicit copy_policy', () => {
    const result = validateAttachmentPayload({
      attachmentMode: 'embedded_copy',
      assetType: 'banner',
      overlayText: null,
      sourceType: 'post',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('embedded_copy requires explicit copy_policy');
  });

  it('thread carousel requires an explicit transform policy', () => {
    const result = validateAttachmentPayload({
      attachmentMode: 'embedded_copy',
      assetType: 'carousel',
      copyPolicy: {
        allowHeadline: true,
        allowKeyInsight: true,
        allowCTA: false,
        sourceTextTransform: 'none',
      },
      overlayText: null,
      sourceType: 'thread',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('thread carousel requires transform policy');
  });

  it('thread transform middleware blocks raw segment duplication', () => {
    const raw = [
      'The exact original thread sentence should not become a slide',
      'A second point provides context for the sequence',
    ].join('\n\n');
    expect(transformThreadForVisual({ sourceText: raw, transform: 'support_visual_only' })).toMatchObject({
      items: [],
      complementaryOnly: true,
    });
    expect(containsDirectThreadDuplication({
      rawSourceText: raw,
      visualItems: ['The exact original thread sentence should not become a slide'],
    })).toBe(true);
  });

  it('scheduler preserves semantic attachment metadata outside media_urls', () => {
    const mediaUrls = mediaUrlsFromCreatorAttachments([
      {
        id: 'a1',
        creatorType: 'infographic',
        title: 'Infographic',
        url: 'https://cdn.test/info.png',
        attachmentMode: 'embedded_copy',
        compositionIntent: buildAssetCompositionIntent({
          assetType: 'infographic',
          attachmentMode: 'embedded_copy',
          sourceTextTransform: 'framework',
        }),
        createdAt: new Date(0).toISOString(),
      },
    ]);
    expect(mediaUrls).toEqual(['https://cdn.test/info.png']);
    expect(mediaTypesFromCreatorAttachments({ mediaUrls, attachedAssets: [
      {
        id: 'a1',
        creatorType: 'infographic',
        title: 'Infographic',
        url: 'https://cdn.test/info.png',
        attachmentMode: 'embedded_copy',
        compositionIntent: buildAssetCompositionIntent({
          assetType: 'infographic',
          attachmentMode: 'embedded_copy',
          sourceTextTransform: 'framework',
        }),
        createdAt: new Date(0).toISOString(),
      },
    ] })).toEqual(['creator:infographic:embedded_copy:framework']);
  });
});
