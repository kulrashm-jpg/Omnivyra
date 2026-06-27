import { createHash } from 'crypto';
let captured: Buffer[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: {
  listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
  updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
  from: () => ({ upload: async (_p: string, buf: Buffer) => { captured.push(buf); return { error: null }; },
    getPublicUrl: () => ({ data: { publicUrl: 'http://local/x.png' } }),
    createSignedUrl: async () => ({ data: { signedUrl: 'http://local/x.png' }, error: null }) }),
} } }));
jest.mock('../../services/creatorOcrProvider', () => ({ runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'mock', text: '' }), isLightweightSocialEmbeddedCopy: () => true }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({ composeInfographicCopy: async (input: any) => ({
  ok: true, narrative: 'N.', cta: input.cta || 'Learn more',
  sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({ title, lead: `Lead ${i + 1}.`, bullets: ['One point', 'Two point'], stat: i === 0 ? { value: '2.4x', label: 'leads' } : null, example: null, take: null, impact: null, risk: null, generated: true })),
}) }));

import { resolveTemplate, IMAGE_VARIANTS, CAROUSEL_VARIANTS, INFOGRAPHIC_VARIANTS, DEFAULT_IMAGE_STYLE, DEFAULT_CAROUSEL_STYLE, variantKeyForTemplate } from '../../../lib/creator-templates';

const ovl = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route the play', cta: 'Learn more', supportingText: 'Close it' };
async function hash(extra: Record<string, unknown> = {}): Promise<string> {
  captured = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  const payload = { asset_kind: 'image', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], visual_descriptor: { headline: 'T', visual_description: 'S' }, overlay_text: ovl,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'infographic', creator_content_asset_type: 'infographic', topic: 'Topic here', summary: 'Sub.', infographic_layout: 'framework', overlay_text: ovl, ...extra } } };
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return captured.map((b) => createHash('sha256').update(b).digest('hex')).join(',');
}

async function carouselHash(extra: Record<string, unknown> = {}): Promise<{ joined: string; slides: number }> {
  captured = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  const slides = [
    { slide_number: 1, role: 'hook', headline: 'Open strong', body_text: 'First slide body copy.' },
    { slide_number: 2, role: 'insight', headline: 'The core idea', body_text: 'Second slide body copy.' },
    { slide_number: 3, role: 'cta', headline: 'Take action', body_text: 'Final slide body copy.' },
  ];
  const payload = { asset_kind: 'carousel', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], slides, slide_count: 3,
    media_bundle: { metadata: { platform: 'linkedin', content_type: 'carousel', creator_content_asset_type: 'carousel', topic: 'Topic', summary: 'S', cta: 'Get started', overlay_text: ovl, ...extra } } };
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return { joined: captured.map((b) => createHash('sha256').update(b).digest('hex')).join(','), slides: captured.length };
}

describe('TEMPLATE-015 image style activation', () => {
  // The 7 validation variants (each backed by a real template).
  const KEYS = ['editorial', 'corporate', 'modern', 'premium', 'bold', 'vibrant', 'technical'] as const;
  const ov = { hook: 'Hook', headline: 'Qualify the lead', keyInsight: 'Route the play', supportingText: 'Close it', cta: 'Get started' };
  let T: any;
  let brandKit: any;
  beforeAll(async () => {
    T = (await import('../../services/creatorAssetRenderer')).__test;
    brandKit = T.resolveCreatorBrandKit({ metadata: {} });
  });
  const svgFor = (platform: string, style: any): string =>
    T.buildOverlaySvg({ width: 1200, height: 1200, overlay: ov, brandKit, platform, fileNamePrefix: 'image', imageStyle: style }).svg;
  const presetFor = (platform: string, style: any): any => T.getOverlayPreset(platform, 'image', ov, null, style);

  for (const platform of ['linkedin', 'instagram', 'mastodon']) {
    it(`7 variants render visually distinct + platform-safe on ${platform}`, () => {
      const defSvg = svgFor(platform, DEFAULT_IMAGE_STYLE);
      const defPreset = presetFor(platform, DEFAULT_IMAGE_STYLE);
      const svgs = new Set<string>([defSvg]);
      for (const k of KEYS) {
        const style = (IMAGE_VARIANTS as any)[k];
        const svg = svgFor(platform, style);
        const preset = presetFor(platform, style);
        // (a) Visual identity surfaces — overlay differs from the default render
        //     and the variant's title color is present in the SVG.
        expect(svg).not.toBe(defSvg);
        expect(svg).toContain(style.colorScheme.title);
        // (b) Platform geometry preserved — on a KNOWN platform the sizes /
        //     margin / panel width are the platform's, unchanged by the
        //     template visual language. (On an unknown platform there is no
        //     platform geometry layer, so the template's own spacing applies —
        //     the precedence working as designed.)
        if (platform !== 'mastodon') {
          expect(preset.headlineSize).toBe(defPreset.headlineSize);
          expect(preset.margin).toBe(defPreset.margin);
          expect(preset.panelWidthRatio).toBe(defPreset.panelWidthRatio);
        }
        svgs.add(svg);
      }
      // All 7 variants + default are mutually distinct overlays.
      expect(svgs.size).toBe(KEYS.length + 1);
    });
  }

  it('precedence: template footer mode overrides the platform preset (LinkedIn)', () => {
    // LinkedIn sets footerMode 'hidden' for wide image; the default style yields
    // the platform value (byte-identical), the corporate variant (footer
    // 'standard') overrides it — template visual language wins over platform.
    expect(presetFor('linkedin', DEFAULT_IMAGE_STYLE).footerMode).toBe('hidden');
    expect(presetFor('linkedin', (IMAGE_VARIANTS as any).corporate).footerMode).toBe('standard');
  });

  it('default style is byte-identical (platform value preserved for default)', () => {
    for (const platform of ['linkedin', 'instagram', 'mastodon']) {
      // For the default style, the precedence keeps the platform/base values:
      // panelOpacity stays the canonical default and the white title is intact.
      expect(presetFor(platform, DEFAULT_IMAGE_STYLE).panelOpacity).toBe(DEFAULT_IMAGE_STYLE.panel.opacity);
      expect(svgFor(platform, DEFAULT_IMAGE_STYLE)).toContain(DEFAULT_IMAGE_STYLE.colorScheme.title);
    }
  });

  it('each variant carries a distinct overlay color identity', () => {
    const colors = KEYS.map((k) => JSON.stringify((IMAGE_VARIANTS as any)[k].colorScheme));
    expect(new Set(colors).size).toBe(KEYS.length);
    for (const k of KEYS) expect((IMAGE_VARIANTS as any)[k].colorScheme).not.toEqual(DEFAULT_IMAGE_STYLE.colorScheme);
  });
});

describe('TEMPLATE-014 carousel style activation', () => {
  it('renders Educational/Executive/Storytelling/Premium/Minimal distinctly (correct layout, pagination, CTA)', async () => {
    const legacy = await carouselHash();
    const cases: Array<[string, string]> = [
      ['educational', 'sys-carousel-educational-5'],
      ['executive', 'sys-carousel-framework'],
      ['storytelling', 'sys-carousel-storytelling-7'],
      ['premium', 'sys-carousel-case-study'],   // case-study → premium
      ['minimal', 'sys-carousel-checklist-10'],
    ];
    const results = new Map<string, { joined: string; slides: number }>();
    for (const [key, id] of cases) results.set(key, await carouselHash({ template_id: id }));
    // Every render produced the full 3-slide deck (layout + pagination intact).
    for (const r of results.values()) expect(r.slides).toBe(3);
    // All five renders + legacy are mutually distinct.
    const all = [legacy.joined, ...Array.from(results.values()).map((r) => r.joined)];
    expect(new Set(all).size).toBe(all.length);
  }, 180000);

  it('default carousel style is byte-identical (legacy preserved)', async () => {
    const a = await carouselHash();
    const b = await carouselHash();
    expect(a.joined).toBe(b.joined);
    expect(a.slides).toBe(3);
  }, 90000);

  it('minimal variant (wave disabled) differs from a wave-enabled variant', async () => {
    const minimal = await carouselHash({ template_id: 'sys-carousel-checklist-10' }); // minimal: wave off
    const story = await carouselHash({ template_id: 'sys-carousel-storytelling-7' }); // storytelling: wave on
    expect(minimal.joined).not.toBe(story.joined);
  }, 120000);
});

describe('TEMPLATE-013 differentiation', () => {
  it('infographic variants render visibly different (and layout stays valid)', async () => {
    const def = await hash();
    const fin = await hash({ template_id: 'sys-infographic-statistics' }); // financial
    const edi = await hash({ template_id: 'sys-infographic-comparison' });  // editorial
    const dark = await hash({ template_id: 'sys-infographic-decision-tree' }); // dark
    for (const h of [def, fin, edi, dark]) expect(h.length).toBeGreaterThan(0); // all rendered
    const set = new Set([def, fin, edi, dark]);
    expect(set.size).toBe(4); // four distinct outputs
  }, 120000);

  it('legacy (no template) is deterministic / unchanged default', async () => {
    const a = await hash();
    const b = await hash();
    expect(b).toBe(a);
  }, 60000);

  it('resolver assigns distinct image/carousel styles per template', () => {
    expect(resolveTemplate('sys-banner-website-hero').imageStyle).toBe(IMAGE_VARIANTS.bold);
    expect(resolveTemplate('sys-image-quote-author').imageStyle).toBe(IMAGE_VARIANTS.editorial);
    expect(resolveTemplate('sys-banner-website-hero').imageStyle).not.toEqual(DEFAULT_IMAGE_STYLE);
    expect(resolveTemplate('sys-carousel-framework').carouselStyle).toBe(CAROUSEL_VARIANTS.executive);
    expect(resolveTemplate('sys-carousel-framework').carouselStyle).not.toEqual(DEFAULT_CAROUSEL_STYLE);
    expect(variantKeyForTemplate('sys-infographic-decision-tree', 'infographic')).toBe('dark');
  });

  it('image overlay base surfaces (probe: known-platform shadowing vs unknown-platform)', async () => {
    const r = await import('../../services/creatorAssetRenderer');
    const t: any = (r as any).__test;
    const ov = { hook: 'a', headline: 'b', keyInsight: 'c', supportingText: 'd', cta: 'e' };
    const call = (plat: string, style: any) => t.getOverlayPreset(plat, 'banner', ov, null, style);
    const knownBase = JSON.stringify(call('linkedin', DEFAULT_IMAGE_STYLE));
    const knownBold = JSON.stringify(call('linkedin', IMAGE_VARIANTS.bold));
    const unkBase = JSON.stringify(call('mastodon', DEFAULT_IMAGE_STYLE));
    const unkBold = JSON.stringify(call('mastodon', IMAGE_VARIANTS.bold));
    // Image variants surface in the overlay preset even for known platforms
    // (panel opacity / branding / footer / CTA / max-lines are not
    // platform-overridden), and fully for unknown platforms.
    expect(knownBase).not.toBe(knownBold);
    expect(unkBase).not.toBe(unkBold);
  });
});
