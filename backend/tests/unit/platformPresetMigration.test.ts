/**
 * TEMPLATE-005 — platform preset + canvas externalization.
 *
 * Proves the per-platform overlay matrix (formerly inline in getOverlayPreset)
 * and per-platform canvas (formerly inline in resolveRenderSize) now resolve
 * from the canonical ImageStyleSchema, BYTE-IDENTICALLY:
 *
 *   1. an EXHAUSTIVE pure-function snapshot (every platform × file-kind ×
 *      density × subtype) hashes to the pre-migration digest, and
 *   2. real end-to-end composite renders across every platform (carousel —
 *      deterministic; image — provider-backed via a mocked provider) produce
 *      valid, correctly-sized assets through the style-driven path.
 */

import { createHash } from 'crypto';

// Provider-backed image render: a real PNG base layer (stashed in beforeAll),
// the overlay composited on top, then uploaded — the NON-fallback path.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

// Inject an OpenAI key so generateProviderImage takes the real provider path
// (resolveOpenAiImageKey reads config.OPENAI_API_KEY). Spread the real config
// so every other config consumer is unaffected.
jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return { ...actual, config: { ...actual.config, OPENAI_API_KEY: 'test-openai-key' } };
});

let captured: Buffer[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: {
  listBuckets: async () => ({ data: [{ name: 'creator-image-assets' }, { name: 'creator-documents' }], error: null }),
  updateBucket: async () => ({ error: null }), createBucket: async () => ({ error: null }),
  from: () => ({ upload: async (_p: string, b: Buffer) => { captured.push(b); return { error: null }; },
    getPublicUrl: () => ({ data: { publicUrl: 'http://l/x.png' } }), createSignedUrl: async () => ({ data: { signedUrl: 'http://l/x.png' }, error: null }) }) } } }));
jest.mock('../../services/creatorOcrProvider', () => ({ runCreatorOcr: async () => ({ ok: true, flags: [], confidence: 1, provider: 'm', text: '', regions: [], thresholds: { minConfidence: 0 } }), isLightweightSocialEmbeddedCopy: () => true }));
jest.mock('../../services/creatorRenderPersistence', () => ({ persistCreatorValidationManifest: async () => undefined }));
jest.mock('../../services/brand/brandRuntime', () => ({ resolveBrand: async () => null }));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({ captureImageProviderCost: async () => undefined }));
jest.mock('../../services/aiUsageCollector', () => ({ recordAssetCredits: () => undefined }));
// Provider mock — returns the real PNG stashed on globalThis (set in beforeAll).
jest.mock('openai', () => ({ __esModule: true, default: class { images = { generate: async () => ({ data: [{ b64_json: (globalThis as any).__providerPng }] }) }; } }));
jest.mock('../../services/creator/infographicCopyComposer', () => ({ composeInfographicCopy: async (i: any) => ({ ok: true, narrative: 'N.', cta: i.cta || 'Learn more',
  sections: (i.sectionTitles as string[]).map((title: string, k: number) => ({ title, lead: `Lead ${k}.`, bullets: ['One'], stat: null, example: null, take: null, impact: null, risk: null, generated: true })) }) }));

import sharp from 'sharp';
import { __test } from '../../services/creatorAssetRenderer';

const PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'twitter', 'threads', 'reddit', 'pinterest', 'unknownplat'];
const PREFIXES = ['image', 'banner', 'carousel', 'pdf', 'slider', 'infographic'];
const SHORT = { hook: 'Hook', headline: 'Head', keyInsight: 'Insight', cta: 'Go', supportingText: 'Sup' };
const LONG = { hook: 'A reasonably long hook line that pushes the text unit count up significantly past the dense threshold for sure', headline: 'A long headline that also adds many more characters to the overlay text budget here now', keyInsight: 'A long key insight that contributes a great deal of characters to the running overlay text total count', cta: 'Learn more now', supportingText: 'A supporting line with extra characters too' };
const SUBTYPES: Array<any> = [null,
  { subtypeId: 'quote-image', densityHint: 'minimal', promptLine: '' },
  { subtypeId: 'promotional-image', densityHint: 'balanced', promptLine: '' },
  { subtypeId: 'educational-image', densityHint: 'dense', promptLine: '' }];

describe('TEMPLATE-005 byte-identical preset + canvas migration', () => {
  it('exhaustive overlay-preset + canvas snapshot is byte-identical to pre-migration', () => {
    const rows: string[] = [];
    for (const platform of PLATFORMS) for (const prefix of PREFIXES) {
      rows.push(`CANVAS|${platform}|${prefix}|` + JSON.stringify(__test.resolveRenderSize(platform, prefix)));
      for (const [d, ov] of [['short', SHORT], ['long', LONG]] as const) for (const sub of SUBTYPES) {
        rows.push(`PRESET|${platform}|${prefix}|${d}|${sub?.subtypeId ?? 'none'}|` + JSON.stringify(__test.getOverlayPreset(platform, prefix, ov, sub)));
      }
    }
    const digest = createHash('sha256').update(rows.join('\n')).digest('hex');
    expect(rows.length).toBe(486);
    // Locked pre-migration digest — any drift in a platform preset or canvas fails here.
    expect(digest).toBe('064dcdc7b790e8b011aa9120f301cb53facea189d7a1cd1e7039a8aec8ced248');
  });
});

const ovl = { hook: 'Capture intent', headline: 'Qualify the lead', keyInsight: 'Route play', cta: 'Learn more', supportingText: 'Close it' };
async function render(payload: any): Promise<Buffer | null> {
  captured = [];
  const { renderAsset } = await import('../../services/creatorAssetRenderer');
  await renderAsset(payload, { companyId: 'co', userId: 'u', campaignId: 'c' });
  return captured[0] ?? null;
}
function carousel(platform: string) {
  const slides = [{ slide_number: 1, role: 'hook', headline: 'Open', body_text: 'First.' }, { slide_number: 2, role: 'cta', headline: 'Next', body_text: 'Second.' }];
  return { asset_kind: 'carousel', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], slides, slide_count: 2, media_bundle: { metadata: { platform, content_type: 'carousel', creator_content_asset_type: 'carousel', topic: 'T', summary: 'S', overlay_text: ovl } } };
}
function image(platform: string) {
  return { asset_kind: 'image', color_palette: ['#0F172A', '#2F80ED', '#14B8A6'], visual_descriptor: { headline: 'A clear product headline for the asset', visual_description: 'desc' }, overlay_text: ovl,
    media_bundle: { metadata: { platform, content_type: 'image', creator_content_asset_type: 'image', topic: 'Topic', summary: 'Sum', overlay_text: ovl } } };
}

describe('TEMPLATE-005 real end-to-end renders across platforms (non-fallback)', () => {
  beforeAll(async () => {
    (globalThis as any).__providerPng = (await sharp({ create: { width: 64, height: 64, channels: 3, background: '#334155' } }).png().toBuffer()).toString('base64');
  });

  it('carousel renders (deterministic composite) for every platform', async () => {
    for (const p of ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'reddit', 'pinterest']) {
      const buf = await render(carousel(p));
      expect(buf && buf.length > 1000).toBe(true);
    }
  }, 120000);

  it('provider-backed image renders at the externalized per-platform canvas', async () => {
    const expected: Record<string, { width: number; height: number }> = {
      linkedin: { width: 1200, height: 675 }, x: { width: 1200, height: 675 }, reddit: { width: 1200, height: 675 },
      instagram: { width: 1080, height: 1350 }, facebook: { width: 1080, height: 1350 }, threads: { width: 1080, height: 1350 },
      pinterest: { width: 1000, height: 1500 },
    };
    for (const [p, dim] of Object.entries(expected)) {
      const buf = await render(image(p));
      expect(buf && buf.length > 1000).toBe(true); // real composite, not the fallback URL
      const meta = await sharp(buf as Buffer).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual(dim);
    }
  }, 120000);
});
