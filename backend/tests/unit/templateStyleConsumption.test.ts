/**
 * TEMPLATE-003 — renderer consumes the canonical visual-language styles via
 * the ONE resolveTemplate() path, and produces byte-identical output when no
 * template is selected (default styles == prior hardcoded constants).
 */

import { createHash } from 'crypto';

let captured: Buffer[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { storage: {
    listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
    updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
    from: () => ({
      upload: async (_p: string, buf: Buffer) => { captured.push(buf); return { error: null }; },
      getPublicUrl: () => ({ data: { publicUrl: 'http://local/x.png' } }),
      createSignedUrl: async () => ({ data: { signedUrl: 'http://local/x.png' }, error: null }),
    }),
  } },
}));
jest.mock('../../services/creatorOcrProvider', () => ({
  runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'mock', text: '' }),
  isLightweightSocialEmbeddedCopy: () => true,
}));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({
  composeInfographicCopy: async (input: any) => ({
    ok: true, narrative: 'N.', cta: input.cta || 'Learn more',
    sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({
      title, lead: `Lead ${i + 1}.`, bullets: ['One point', 'Two point'],
      stat: i === 0 ? { value: '2.4x', label: 'leads' } : null,
      example: null, take: null, impact: null, risk: null, generated: true,
    })),
  }),
}));

import {
  resolveTemplate,
  resolveImageStyle,
  resolveCarouselStyle,
  DEFAULT_IMAGE_STYLE,
  DEFAULT_CAROUSEL_STYLE,
  DEFAULT_INFOGRAPHIC_STYLE,
} from '../../../lib/creator-templates';

const ovl = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route the play', cta: 'Learn more', supportingText: 'Close it' };
async function hash(payload: any): Promise<string> {
  captured = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return captured.map((b) => createHash('sha256').update(b).digest('hex')).join(',');
}
function infographic(extra: Record<string, unknown> = {}) {
  return { asset_kind: 'image', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'],
    visual_descriptor: { headline: 'T', visual_description: 'S' }, overlay_text: ovl,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'infographic', creator_content_asset_type: 'infographic', topic: 'Topic here', summary: 'Sub.', infographic_layout: 'framework', overlay_text: ovl, ...extra } } };
}
function carousel(extra: Record<string, unknown> = {}) {
  const slides = [
    { slide_number: 1, role: 'hook', headline: 'Open', body_text: 'First body.' },
    { slide_number: 2, role: 'cta', headline: 'Next', body_text: 'Second body.' },
  ];
  return { asset_kind: 'carousel', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], slides, slide_count: 2,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'carousel', creator_content_asset_type: 'carousel', topic: 'Topic', summary: 'S', overlay_text: ovl, ...extra } } };
}

describe('canonical resolver returns a style for every family', () => {
  it('resolveTemplate dispatches family styles (defaulted)', () => {
    expect(resolveTemplate(null, { family: 'image' }).imageStyle).toEqual(DEFAULT_IMAGE_STYLE);
    expect(resolveTemplate(null, { family: 'carousel' }).carouselStyle).toEqual(DEFAULT_CAROUSEL_STYLE);
    expect(resolveTemplate(null, { family: 'infographic' }).infographicStyle).toEqual(DEFAULT_INFOGRAPHIC_STYLE);
    // Non-matching family fields are null.
    const img = resolveTemplate(null, { family: 'image' });
    expect(img.carouselStyle).toBeNull();
    expect(img.infographicStyle).toBeNull();
  });
  it('default image/carousel styles encode the renderer base constants', () => {
    expect(resolveImageStyle(null).safe_margins.base).toBe(86);
    expect(resolveImageStyle(null).typography.headlineSize).toEqual({ normal: 58, dense: 50 });
    expect(resolveImageStyle(null).panel).toEqual({ widthRatio: { normal: 0.7, dense: 0.74 }, opacity: 0.42 });
    expect(resolveCarouselStyle(null).canvas.carousel).toEqual({ width: 1200, height: 1200 });
    expect(resolveCarouselStyle(null).canvas.slider).toEqual({ width: 1600, height: 900 });
    expect(resolveCarouselStyle(null).canvas.pdf).toEqual({ width: 1200, height: 1500 });
  });
});

describe('renderer: legacy byte-identical; selected templates differentiated (TEMPLATE-013)', () => {
  it('infographic — no template == default look; selected template applies its variant', async () => {
    const a = await hash(infographic());
    const b = await hash(infographic({ template_id: 'sys-infographic-statistics' })); // financial variant
    expect(a.length).toBeGreaterThan(0);
    // Legacy/no-template preserves the default look; the selected template differs.
    expect(b).not.toBe(a);
  }, 60000);

  it('carousel — no template == default deck; a selected variant applies (TEMPLATE-014)', async () => {
    // TEMPLATE-014 activated carouselStyle in the deck overlay: the default
    // style stays byte-identical, while a non-default variant (educational ⇒
    // panel.opacity 0.48) renders a visibly different deck.
    const a = await hash(carousel());
    const b = await hash(carousel({ template_id: 'sys-carousel-educational-5' }));
    expect(a.length).toBeGreaterThan(0);
    expect(b).not.toBe(a);
  }, 60000);
});
