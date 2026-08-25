/**
 * Deterministic COMPOSE — the sys-image-logo-only proof.
 *
 * WHY THIS EXISTS
 * ---------------
 * COMPOSE promises something CONDITION explicitly does not: the user's exact
 * pixels, where the template said to put them. Every way that promise can break
 * is silent — the render still succeeds and still looks like a picture:
 *
 *   • the logo lands somewhere nobody chose (placement clamped or defaulted),
 *   • it gets cropped (fit quietly switched from contain),
 *   • a private asset is fetched through a public URL to make it easy,
 *   • it reaches the provider and comes back reinterpreted,
 *   • it covers the headline (layer order changed).
 *
 * The coordinates below are an explicit product decision, not derived from the
 * codebase — the audit found no template carries geometry, and the only two
 * geometries that exist are brand-mark specific and disagree. Pinning them here
 * is what makes them a decision rather than a drift.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

/* ── storage + db doubles ──────────────────────────────────────────────────*/
const downloadCalls: Array<{ bucket: string; path: string }> = [];
const publicUrlCalls: string[] = [];
const signedUrlCalls: string[] = [];
const SOURCE_PNG = Buffer.from(
  // 1x1 transparent PNG — real bytes so sharp actually decodes them.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloadCalls.push({ bucket, path });
          return { data: { arrayBuffer: async () => SOURCE_PNG }, error: null };
        },
        getPublicUrl: (p: string) => { publicUrlCalls.push(p); return { data: { publicUrl: 'http://public/x' } }; },
        createSignedUrl: async (p: string) => { signedUrlCalls.push(p); return { data: { signedUrl: 'http://signed/x' }, error: null }; },
      }),
    },
  },
}));

const assets: Record<string, unknown>[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq(c: string, v: unknown) { filters[c] = v; return b; },
      maybeSingle: () => Promise.resolve({
        data: assets.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
        error: null,
      }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (res: (r: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(res({ data: assets.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null })),
    };
    return b;
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  validateTemplateAssetPlacement,
  routeCompositionReferences,
  type TemplateAssetSlot,
} from '../../../lib/content/compositionAssetRouting';
import { buildComposeLayers } from '../../services/compositionAssetComposeService';
import type { CompositionAssetReference } from '../../../lib/content/compositionAssetReference';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';

/** The decided geometry. Changing any number here must fail a test. */
const DECIDED = { top: 0.35, left: 0.35, maxWidth: 0.30, maxHeight: 0.30, fit: 'contain' as const };
const LOGO_SLOT: TemplateAssetSlot = { purpose: 'logo', mode: 'compose', max: 1, placement: DECIDED };

let seq = 0;
function seedAsset(companyId: string, id: string, lifecycle = 'ready') {
  assets.push({
    id, company_id: companyId, storage_bucket: 'media-uploads',
    storage_path: `${companyId}/${id}.png`, mime_type: 'image/png', origin: 'upload',
    lifecycle_state: lifecycle, metadata: {}, created_at: 'T0', updated_at: 'T0',
    created_by: 'user-1', byte_size: 1, width: 1, height: 1,
    checksum_sha256: null, original_filename: null, source_url: null,
  });
}
function ref(assetId: string, over: Partial<CompositionAssetReference> = {}): CompositionAssetReference {
  seq += 1;
  return {
    id: `ref-${seq}`, companyId: COMPANY_A, compositionType: 'creator_card', compositionId: 'c1',
    assetId, purpose: 'logo', mode: 'compose', ordinal: seq, metadata: {},
    createdAt: `T${seq}`, updatedAt: `T${seq}`, ...over,
  };
}
const routed = (r: CompositionAssetReference) => ({ reference: r, sourceUrl: `media-uploads/${r.assetId}.png` });

beforeEach(() => {
  assets.length = 0; downloadCalls.length = 0;
  publicUrlCalls.length = 0; signedUrlCalls.length = 0; seq = 0;
});

describe('A — template declaration', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../lib/creator-templates/systemTemplates.ts'), 'utf8');

  it('sys-image-logo-only declares exactly one logo compose slot', () => {
    const block = SRC.slice(SRC.indexOf("id: 'sys-image-logo-only'"), SRC.indexOf("id: 'sys-image-logo-only'") + 3000);
    expect(block).toContain('assetSlots:');
    expect(block).toMatch(/purpose: 'logo', mode: 'compose', max: 1/);
  });

  it('MUTATION GUARD: the decided coordinates are exactly as specified', () => {
    // These are a product decision. Drift here is silent — the render succeeds
    // and the logo simply sits somewhere else.
    expect(SRC).toContain("placement: { top: 0.35, left: 0.35, maxWidth: 0.30, maxHeight: 0.30, fit: 'contain' }");
  });

  it('MUTATION GUARD: no other template was opted into COMPOSE', () => {
    // Phase 61A added a second opt-in — a CONDITION slot on
    // sys-image-product-highlight. Bumping this to "2 assetSlots" would make
    // the guard blind to exactly what it exists to catch, so it now pins the
    // COMPOSE lane specifically: one compose slot, and it is the logo.
    expect(SRC.split("mode: 'compose'").length - 1).toBe(1);
    expect(SRC).toContain("purpose: 'logo', mode: 'compose', max: 1");
  });
});

describe('B — placement contract', () => {
  it('accepts the decided placement', () => {
    expect(validateTemplateAssetPlacement(DECIDED).ok).toBe(true);
  });

  it.each([
    ['top above range', { ...DECIDED, top: 1.2 }],
    ['top negative', { ...DECIDED, top: -0.1 }],
    ['left above range', { ...DECIDED, left: 2 }],
    ['zero width', { ...DECIDED, maxWidth: 0 }],
    ['width above range', { ...DECIDED, maxWidth: 1.5 }],
    ['zero height', { ...DECIDED, maxHeight: 0 }],
    ['unknown fit', { ...DECIDED, fit: 'stretch' }],
  ])('rejects %s', (_label, bad) => {
    expect(validateTemplateAssetPlacement(bad as never).ok).toBe(false);
  });

  it('MUTATION GUARD: rejects rather than clamps', () => {
    // A clamped value would report success while placing the asset somewhere
    // the template author never chose.
    const r = validateTemplateAssetPlacement({ ...DECIDED, top: 1.2 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/top/);
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetRouting.ts'), 'utf8');
    expect(SRC).not.toMatch(/Math\.(min|max)\([^)]*placement/);
  });

  it('a compose reference whose slot has no placement is refused', () => {
    const r = routeCompositionReferences({
      references: [routed(ref('a1'))],
      templateSlots: [{ purpose: 'logo', mode: 'compose' }], // no placement
      provider: { acceptsReferenceImages: true, maxReferenceImages: 4 },
    });
    expect(r.compose).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('slot_missing_placement');
  });

  it('a slot with invalid placement is refused, not corrected', () => {
    const r = routeCompositionReferences({
      references: [routed(ref('a1'))],
      templateSlots: [{ purpose: 'logo', mode: 'compose', placement: { ...DECIDED, maxWidth: 0 } }],
      provider: { acceptsReferenceImages: true, maxReferenceImages: 4 },
    });
    expect(r.rejected[0].reason).toBe('slot_placement_invalid');
  });
});

describe('C — storage: private bytes, never a URL', () => {
  it('bytes are fetched with bucket + path', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('a1'))],
      templateSlots: [LOGO_SLOT], width: 1000, height: 1000,
    });
    expect(out.layers).toHaveLength(1);
    expect(downloadCalls).toEqual([{ bucket: 'media-uploads', path: 'company-aaaa/a1.png' }]);
  });

  it('CRITICAL: no public or signed URL is ever constructed', async () => {
    seedAsset(COMPANY_A, 'a1');
    await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('a1'))],
      templateSlots: [LOGO_SLOT], width: 1000, height: 1000,
    });
    expect(publicUrlCalls).toEqual([]);
    expect(signedUrlCalls).toEqual([]);
  });

  it('MUTATION GUARD: the compose path contains no URL construction', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetComposeService.ts'), 'utf8');
    const FETCH = fs.readFileSync(
      path.resolve(__dirname, '../../services/creator/creatorReferenceImageFetch.ts'), 'utf8');
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(strip(SRC)).not.toMatch(/getPublicUrl|createSignedUrl|https?:\/\//);
    // The download moved into the ONE shared reader that both lanes now use, so
    // the guard follows the architecture rather than the moved literal: what it
    // protects is "private bytes, never a locator".
    expect(strip(SRC)).toContain('readCanonicalAssetBytes(');
    expect(strip(FETCH)).not.toMatch(/getPublicUrl|createSignedUrl|https?:\/\//);
    expect(strip(FETCH)).toContain('.download(path)');
  });
});

describe('D — tenancy and lifecycle', () => {
  it('CRITICAL: another company\'s asset is refused', async () => {
    seedAsset(COMPANY_B, 'b1');
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('b1'))],
      templateSlots: [LOGO_SLOT], width: 1000, height: 1000,
    });
    expect(out.layers).toHaveLength(0);
    expect(out.rejected[0].reason).toBe('asset_not_found');
    expect(downloadCalls).toEqual([]); // never even fetched
  });

  it('CRITICAL: pending and failed assets are refused', async () => {
    seedAsset(COMPANY_A, 'p1', 'pending');
    seedAsset(COMPANY_A, 'f1', 'failed');
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('p1')), routed(ref('f1'))],
      templateSlots: [LOGO_SLOT], width: 1000, height: 1000,
    });
    expect(out.layers).toHaveLength(0);
    expect(out.rejected.every((r) => r.reason === 'asset_not_ready')).toBe(true);
    expect(downloadCalls).toEqual([]);
  });

  it('MUTATION GUARD: resolution goes through the company-scoped accessor', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetComposeService.ts'), 'utf8');
    expect(SRC).toContain('getCanonicalMediaAsset(input.companyId, reference.assetId)');
    expect(SRC).toContain('isUsableMediaAsset(asset)');
  });
});

describe('E — geometry resolves against the canvas', () => {
  it('the decided fractions become exact pixels', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('a1'))],
      templateSlots: [LOGO_SLOT], width: 1000, height: 800,
    });
    // 0.35 * 1000 = 350 ; 0.35 * 800 = 280
    expect(out.layers[0].left).toBe(350);
    expect(out.layers[0].top).toBe(280);
  });

  it('the same template scales to another platform size', async () => {
    seedAsset(COMPANY_A, 'a1');
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(ref('a1'))],
      templateSlots: [LOGO_SLOT], width: 200, height: 200,
    });
    expect(out.layers[0].left).toBe(70);  // 0.35 * 200
    expect(out.layers[0].top).toBe(70);
  });

  it('MUTATION GUARD: fit is passed through as declared, never substituted', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../services/compositionAssetComposeService.ts'), 'utf8');
    // contain preserves every source pixel; cover crops. Hardcoding either
    // would silently change whether the logo survives intact.
    expect(SRC).toContain("fit: placement.fit ?? 'contain'");
    expect(SRC).not.toMatch(/fit:\s*'cover'/);
  });

  it('ordinal order is preserved', async () => {
    seedAsset(COMPANY_A, 'a1'); seedAsset(COMPANY_A, 'a2');
    const first = ref('a1', { ordinal: 0 });
    const second = ref('a2', { ordinal: 1 });
    const out = await buildComposeLayers({
      companyId: COMPANY_A, compose: [routed(first), routed(second)],
      templateSlots: [{ ...LOGO_SLOT, max: 2 }], width: 1000, height: 1000,
    });
    expect(out.layers.map((l) => l.assetId)).toEqual(['a1', 'a2']);
  });
});

describe('F — COMPOSE never touches the provider', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../../services/compositionAssetComposeService.ts'), 'utf8');
  const body = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('MUTATION GUARD: no provider import or invocation', () => {
    expect(body).not.toMatch(/generateProviderImage|assembleMultimodalPayload|images\.(edit|generate)|openai/i);
  });

  it('MUTATION GUARD: CONDITION cannot enter this path', () => {
    // buildComposeLayers takes the compose lane explicitly; wiring the condition
    // lane in would hand exact-pixel semantics to a generative path.
    expect(SRC).toContain('compose: readonly RoutedReference[]');
    const RENDERER = fs.readFileSync(
      path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');
    expect(RENDERER).toContain('compose: composePlan.compose');
    expect(RENDERER).not.toMatch(/compose:\s*[^,\n]*additionalReferences/);
  });
});

describe('G — existing rendering is unchanged', () => {
  const RENDERER = fs.readFileSync(
    path.resolve(__dirname, '../../services/creatorAssetRendererImage.ts'), 'utf8');

  it('MUTATION GUARD: brandKit path untouched', () => {
    expect(RENDERER).toContain('const brandMark = await loadBrandMark({ brandKit, placement: brandPlacement });');
    expect(RENDERER).toContain('composites.push({ input: brandMark, top: brandPlacement.top, left: brandPlacement.left });');
    expect(RENDERER).toContain('defaultBrandPlacement(');
  });

  it('MUTATION GUARD: compose is an ADDITIONAL top layer, after overlay and brand mark', () => {
    // Appended last so neither the headline nor the brand mark is covered, and
    // the background buffer is not reordered.
    const overlayAt = RENDERER.indexOf('composites.push({ input: Buffer.from(overlayRender.svg)');
    const brandAt = RENDERER.indexOf('composites.push({ input: brandMark');
    const composeAt = RENDERER.indexOf('const composePlan = options.compositionReferences?.composePlan;');
    expect(overlayAt).toBeGreaterThan(-1);
    expect(brandAt).toBeGreaterThan(overlayAt);
    expect(composeAt).toBeGreaterThan(brandAt);
  });

  it('MUTATION GUARD: background construction is not altered', () => {
    expect(RENDERER).toContain('const composed = sharp(background.buffer);');
  });

  it('absent compose plan changes nothing', () => {
    expect(RENDERER).toContain('if (composePlan && composePlan.compose.length > 0)');
  });
});
