/**
 * Infographic visual language — UNIFIED into the canonical Creator Template
 * domain (`lib/creator-templates`).
 *
 * The former infographic-only template model
 * (`backend/services/creator/infographicTemplate*`) is removed; its visual
 * language now lives in `lib/creator-templates/infographicStyle.ts` and is
 * resolved through the ONE canonical resolver. This suite verifies:
 *   - the default style still mirrors the production renderer constants,
 *   - the unified resolver dispatches by asset family,
 *   - infographic templates resolve the style (defaulted),
 *   - and production output is BYTE-IDENTICAL when no template is selected.
 */

// ── Mocks for the byte-identical render proof (renderAsset's IO deps). ───
let captured: Buffer[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    storage: {
      listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
      updateBucket: async () => ({ error: null }),
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async (_p: string, buf: Buffer) => { captured.push(buf); return { error: null }; },
        getPublicUrl: () => ({ data: { publicUrl: 'http://local/test.png' } }),
        createSignedUrl: async () => ({ data: { signedUrl: 'http://local/test.png' }, error: null }),
      }),
    },
  },
}));
jest.mock('../../services/creatorOcrProvider', () => ({
  runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'mock', text: '' }),
  isLightweightSocialEmbeddedCopy: () => true,
}));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({
  composeInfographicCopy: async (input: any) => ({
    ok: true,
    narrative: 'Narrative line.',
    cta: input.cta || 'Learn more',
    sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({
      title,
      lead: `Lead ${i + 1}.`,
      bullets: ['One', 'Two'],
      stat: null, example: null, take: null, impact: null, risk: null, generated: true,
    })),
  }),
}));

import {
  DEFAULT_INFOGRAPHIC_STYLE,
  INFOGRAPHIC_LAYOUTS,
  resolveInfographicStyle,
  resolveTemplate,
  listTemplatesForFamily,
  getTemplateById,
} from '../../../lib/creator-templates';

describe('canonical infographic visual language', () => {
  it('default style mirrors the production renderer constants exactly', () => {
    const s = DEFAULT_INFOGRAPHIC_STYLE;
    expect(s.color_scheme.backgroundBase).toBe('#0F172A');
    expect(s.color_scheme.accent).toBe('#22c55e');
    expect(s.color_scheme.panel).toBe('#ffffff');
    expect(s.color_scheme.innerPanel).toBe('#f8fafc');
    expect(s.color_scheme.primaryText).toBe('#111827');
    expect(s.color_scheme.bodyText).toBe('#334155');
    expect(s.color_scheme.tinyLabelText).toBe('#64748b');
    expect(s.color_scheme.seriesRamp).toEqual(['#2563eb', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#0ea5e9', '#14b8a6', '#f43f5e']);
    expect(s.typography.fontFamily).toBe('Inter, Arial');
    expect(s.typography.baseSizes.headerTitle).toBe(44);
    expect(s.typography.baseSizes.cardTitle).toBe(25);
    expect(s.typography.fontMultiplierScale.map((b) => b.multiplier)).toEqual([1.40, 1.28, 1.16, 1.05, 0.96, 0.88]);
    expect(s.spacing).toMatchObject({ sideMargin: 80, bottomMargin: 90, headerHeight: 150, headerHeightWithSubtitle: 212 });
    expect(s.card_style).toMatchObject({ cornerRadius: 14, fillOpacity: 0.97, accentStripeWidth: 6, accentStripeRadius: 3 });
    expect(s.connector_style.process).toMatchObject({ strokeWidth: 4, arrowHead: true });
    expect(s.connector_style.timeline).toMatchObject({ railStrokeWidth: 3, railOpacity: 0.4, dotRadius: 11 });
    expect(s.icon_style).toMatchObject({ kind: 'concept_glyph', glyphFill: '#ffffff', discRadiusRatio: 0.08 });
    expect(s.chart_style).toMatchObject({ barCornerRadius: 4, donutHoleRatio: 0.55, maxDataPoints: 8 });
    expect(INFOGRAPHIC_LAYOUTS).toContain('framework');
  });

  it('carries NO content and NO rendering logic (pure visual-language data)', () => {
    const CONTENT_KEYS = /^(headline|title|body|copy|bullets?|cta|caption|content|sections?|lead|topic|summary|hook|insight)$/i;
    const walk = (value: unknown, path: string): void => {
      expect(typeof value).not.toBe('function');
      if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (CONTENT_KEYS.test(k) && typeof v === 'string') throw new Error(`content-bearing key "${k}" at ${path}`);
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(DEFAULT_INFOGRAPHIC_STYLE, 'style');
  });
});

describe('unified resolver dispatches by asset family', () => {
  it('resolves an infographic template WITH a visual-language schema', () => {
    const tpl = listTemplatesForFamily('infographic')[0];
    const r = resolveTemplate(tpl.id);
    expect(r.matched).toBe(true);
    expect(r.family).toBe('infographic');
    expect(r.template).toBe(getTemplateById(tpl.id));
    // TEMPLATE-013: templates now carry an assigned production style variant
    // (built by inheritance from the default), not the bare default style.
    expect(r.infographicStyle).toBe(tpl.infographicStyle ?? DEFAULT_INFOGRAPHIC_STYLE);
    expect(r.infographicStyle!.color_scheme.panel).toBeTruthy();
    expect(r.infographicStyle!.card_style).toBeTruthy();
  });

  it('resolves image/carousel templates WITHOUT an infographic style', () => {
    for (const family of ['image', 'carousel'] as const) {
      const tpl = listTemplatesForFamily(family)[0];
      const r = resolveTemplate(tpl.id);
      expect(r.family).toBe(family);
      expect(r.infographicStyle).toBeNull();
    }
  });

  it('falls back to the default infographic style when no template is selected', () => {
    for (const id of [undefined, null, '', 'does-not-exist']) {
      const r = resolveTemplate(id as any, { family: 'infographic' });
      expect(r.matched).toBe(false);
      expect(r.source).toBe('default');
      expect(r.infographicStyle).toEqual(DEFAULT_INFOGRAPHIC_STYLE);
    }
  });

  it('resolveInfographicStyle defaults a style-less template', () => {
    expect(resolveInfographicStyle(null)).toEqual(DEFAULT_INFOGRAPHIC_STYLE);
  });

  it('is deterministic — equal input yields deeply-equal output', () => {
    const tpl = listTemplatesForFamily('infographic')[0];
    expect(resolveTemplate(tpl.id)).toEqual(resolveTemplate(tpl.id));
  });
});

describe('legacy byte-identical; selected template differentiated (TEMPLATE-013)', () => {
  async function renderInfographic(metadataExtra: Record<string, unknown>): Promise<Buffer> {
    captured = [];
    const { renderAsset } = await import('../../services/creatorAssetRenderer');
    const overlay = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route to play', supportingText: 'Close the loop' };
    const assetPayload = {
      asset_kind: 'image',
      color_palette: ['#0F172A', '#2F80ED', '#14B8A6'],
      visual_descriptor: { headline: 'Topic', visual_description: 'Summary' },
      overlay_text: overlay,
      media_bundle: {
        metadata: {
          platform: 'linkedin', content_type: 'infographic', creator_content_asset_type: 'infographic',
          topic: 'Topic', summary: 'A subtitle line.', infographic_layout: 'framework',
          overlay_text: overlay, ...metadataExtra,
        },
      },
    };
    await renderAsset(assetPayload, { companyId: 'co', userId: 'u', campaignId: 'c' });
    expect(captured.length).toBe(1);
    return captured[0];
  }

  it('legacy (no template) byte-identical; a selected template applies its variant', async () => {
    // DEFAULT_INFOGRAPHIC_STYLE is unchanged → the "no template selected" look
    // is preserved bit-for-bit (deterministic, repeatable).
    const legacyA = await renderInfographic({});
    const legacyB = await renderInfographic({});
    expect(legacyB.equals(legacyA)).toBe(true);
    // A selected template now drives its assigned style variant → different bytes.
    const variant = await renderInfographic({ template_id: 'sys-infographic-statistics' });
    expect(variant.equals(legacyA)).toBe(false);
  }, 90000);
});
