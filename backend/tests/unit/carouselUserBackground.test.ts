/**
 * Phase 66A — one photograph, behind the whole deck.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * A carousel is N independently rendered slides, each with its own base layer
 * and its own per-slide variant hash. That makes exactly one question worth
 * guarding: when a user attaches ONE background, does every slide actually get
 * it — the same bytes, not a different picture per frame, and not only slide 1?
 *
 * The locked product decision is whole-deck. So these tests assert the
 * RENDERER'S EFFECTIVE BACKGROUND INPUT for every slide, rather than that a
 * reference object exists somewhere. A test that only checked the reference
 * would pass while slides 2..N quietly fell back to the gradient.
 *
 * The second thing guarded is that `ordinal` was not quietly redefined. It
 * still means ordering within a purpose; nothing here reads it as a slide
 * index, because per-slide targeting would need a contract this table does not
 * have and inventing one silently is what was ruled out.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const mockGetAsset = jest.fn();
const mockReadBytes = jest.fn();

jest.mock('../../services/canonicalMediaAssetService', () => ({
  getCanonicalMediaAsset: (...a: unknown[]) => mockGetAsset(...a),
}));
jest.mock('../../services/creator/creatorReferenceImageFetch', () => ({
  readCanonicalAssetBytes: (...a: unknown[]) => mockReadBytes(...a),
}));

import * as fs from 'fs';
import * as path from 'path';

import {
  resolveUserBackgroundBytes,
  carouselUserBackgroundEnabled,
  MAX_USER_BACKGROUND_BYTES,
} from '../../services/creator/userBackgroundReference';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
const CAROUSEL = read('backend/services/creatorAssetRendererCarousel.ts');

const FLAG = 'CREATOR_CAROUSEL_USER_BACKGROUND_ENABLED';
const asset = (over: Record<string, unknown> = {}) => ({
  id: 'asset-1', companyId: 'co-A', lifecycleState: 'ready', mimeType: 'image/png',
  byteSize: 2048, storageBucket: 'media', storagePath: 'co-A/a.png', ...over,
});
const routed = (purpose: string, assetId = 'asset-1', ordinal = 0) => ([{
  reference: { id: `ref-${purpose}-${ordinal}`, assetId, purpose, mode: 'condition', ordinal },
  sourceUrl: 'storage://media/a.png',
}] as never);

let original: string | undefined;
beforeEach(() => {
  original = process.env[FLAG];
  process.env[FLAG] = 'true';
  mockGetAsset.mockReset().mockResolvedValue(asset());
  mockReadBytes.mockReset().mockResolvedValue(Buffer.from('CAROUSELPNG'));
});
afterEach(() => {
  if (original === undefined) delete process.env[FLAG]; else process.env[FLAG] = original;
});

/* ── A. WHOLE-DECK: the property this phase exists for ──────────────────────*/

describe('A — one reference, every slide', () => {
  it('CRITICAL: the background is resolved ONCE at deck level, not per slide', () => {
    // Resolution sits in composeStructuredDeckAsset, before the slide loop.
    const resolveAt = CAROUSEL.indexOf('const deckBackground = await');
    const loopAt = CAROUSEL.indexOf('for (let index = 0; index < renderItems.length');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(loopAt);
    // Exactly one resolve call in the whole module.
    expect((CAROUSEL.match(/resolveUserBackgroundBytes\(/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: the SAME buffer is handed to every slide', () => {
    // One variable, passed into the per-slide render inside the loop.
    expect(CAROUSEL).toMatch(/renderStructuredSlidePng\(\{[\s\S]{0,400}deckBackground,/);
    // …and the slide uses it as its base layer.
    expect(CAROUSEL).toContain('const background = input.deckBackground ?? await renderBackgroundPng({');
  });

  it('CRITICAL: with no reference, every slide falls back to the brand gradient', () => {
    // `?? await renderBackgroundPng(...)` is the untouched previous behaviour.
    expect(CAROUSEL).toContain('input.deckBackground ?? await renderBackgroundPng({');
    // The per-slide variant hash is still computed, so decks stay distinct.
    expect(CAROUSEL).toContain('variantId: `${input.brandKit.layoutVariantId}:${input.index}');
  });

  it('CRITICAL: slide index is never used to select a reference', () => {
    const block = CAROUSEL.slice(
      CAROUSEL.indexOf('const deckBackground = await'),
      CAROUSEL.indexOf('for (let index = 0; index < renderItems.length'),
    );
    expect(block).not.toContain('index');
    expect(block).not.toContain('ordinal');
    expect(block).not.toContain('slide');
  });

  it('CRITICAL: ordinal keeps its meaning — the FIRST background wins, whatever its ordinal', async () => {
    // Two background references. The resolver takes the first match in routed
    // order; it does NOT treat ordinal 0/1 as slide 0/1.
    const two = [
      ...(routed('background', 'asset-first', 0) as unknown as unknown[]),
      ...(routed('background', 'asset-second', 1) as unknown as unknown[]),
    ] as never;
    await resolveUserBackgroundBytes({
      companyId: 'co-A', condition: two, width: 1080, height: 1080,
      enabled: true, namespace: 'carousel-bg:user',
    });
    expect(mockGetAsset).toHaveBeenCalledTimes(1);
    expect(mockGetAsset).toHaveBeenCalledWith('co-A', 'asset-first');
  });
});

/* ── B. Only background ─────────────────────────────────────────────────────*/

describe('B — no other purpose is honoured', () => {
  it.each(['subject', 'style_reference', 'supporting', 'logo'])(
    'CRITICAL: %s is never treated as a background', async (purpose) => {
      const out = await resolveUserBackgroundBytes({
        companyId: 'co-A', condition: routed(purpose), width: 1080, height: 1080,
        enabled: true, namespace: 'carousel-bg:user',
      });
      expect(out.bytes).toBeNull();
      expect(mockReadBytes).not.toHaveBeenCalled();
    });

  it('nothing attached is not a rejection', async () => {
    const out = await resolveUserBackgroundBytes({
      companyId: 'co-A', condition: [], width: 1080, height: 1080,
      enabled: true, namespace: 'carousel-bg:user',
    });
    expect(out.bytes).toBeNull();
    expect(out.reason).toBeNull();
  });
});

/* ── C. The gate ────────────────────────────────────────────────────────────*/

describe('C — fail-closed, and its own switch', () => {
  it('CRITICAL: absent means disabled', () => {
    delete process.env[FLAG];
    expect(carouselUserBackgroundEnabled()).toBe(false);
  });

  it('CRITICAL: only the exact value enables it', () => {
    for (const v of ['', 'false', 'TRUE', 'True', 'true ', '1']) {
      process.env[FLAG] = v;
      expect(carouselUserBackgroundEnabled()).toBe(false);
    }
    process.env[FLAG] = 'true';
    expect(carouselUserBackgroundEnabled()).toBe(true);
  });

  it('CRITICAL: disabled reads no asset and no bytes', async () => {
    const out = await resolveUserBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1080,
      enabled: false, namespace: 'carousel-bg:user',
    });
    expect(out.reason).toBe('capability_disabled');
    expect(mockGetAsset).not.toHaveBeenCalled();
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('it is a SEPARATE flag from the infographic one', () => {
    const src = read('backend/services/creator/userBackgroundReference.ts');
    expect(src).toContain('CREATOR_CAROUSEL_USER_BACKGROUND_ENABLED');
    expect(src).not.toContain('CREATOR_INFOGRAPHIC_USER_BACKGROUND_ENABLED');
  });
});

/* ── D. Tenancy and cache ───────────────────────────────────────────────────*/

describe('D — company is the boundary, and the cache respects it', () => {
  const keyFor = async (companyId: string, assetId = 'asset-1', w = 1080, h = 1080) => {
    mockGetAsset.mockResolvedValue(asset({ id: assetId, companyId }));
    const out = await resolveUserBackgroundBytes({
      companyId, condition: routed('background', assetId), width: w, height: h,
      enabled: true, namespace: 'carousel-bg:user',
    });
    return out.cacheKey;
  };

  it('CRITICAL: a foreign asset resolves to nothing and is never read', async () => {
    mockGetAsset.mockResolvedValue(null);   // company-scoped lookup misses
    const out = await resolveUserBackgroundBytes({
      companyId: 'co-B', condition: routed('background'), width: 1080, height: 1080,
      enabled: true, namespace: 'carousel-bg:user',
    });
    expect(out.reason).toBe('asset_not_found');
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('CRITICAL: tenants never share a cache key for the same asset id', async () => {
    const a = await keyFor('co-A', 'same');
    const b = await keyFor('co-B', 'same');
    expect(a).not.toEqual(b);
    expect(a).toContain('co-A');
    expect(b).toContain('co-B');
  });

  it('CRITICAL: the key carries namespace, company, asset and canvas', async () => {
    expect(await keyFor('co-A', 'asset-9', 1080, 1350))
      .toBe('carousel-bg:user:co-A:asset-9:1080x1350');
  });

  it('CRITICAL: carousel and infographic never collide on one key', async () => {
    mockGetAsset.mockResolvedValue(asset({ id: 'shared' }));
    const common = {
      companyId: 'co-A', condition: routed('background', 'shared'),
      width: 1080, height: 1080, enabled: true,
    };
    const car = await resolveUserBackgroundBytes({ ...common, namespace: 'carousel-bg:user' });
    const info = await resolveUserBackgroundBytes({ ...common, namespace: 'infographic-bg:user' });
    expect(car.cacheKey).not.toEqual(info.cacheKey);
  });

  it('the key is never asset identity alone', async () => {
    expect(await keyFor('co-A', 'asset-9')).not.toBe('asset-9');
  });
});

/* ── E. Bounds and failure ──────────────────────────────────────────────────*/

describe('E — an unusable asset never costs the user the deck', () => {
  const call = () => resolveUserBackgroundBytes({
    companyId: 'co-A', condition: routed('background'), width: 1080, height: 1080,
    enabled: true, namespace: 'carousel-bg:user',
  });

  it('CRITICAL: oversized is refused BEFORE download', async () => {
    mockGetAsset.mockResolvedValue(asset({ byteSize: MAX_USER_BACKGROUND_BYTES + 1 }));
    expect((await call()).reason).toBe('asset_too_large');
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('CRITICAL: oversized BYTES are refused even if the record lied', async () => {
    mockGetAsset.mockResolvedValue(asset({ byteSize: 10 }));
    mockReadBytes.mockResolvedValue(Buffer.alloc(MAX_USER_BACKGROUND_BYTES + 1));
    expect((await call()).reason).toBe('asset_too_large');
  });

  it('a not-ready asset is refused', async () => {
    mockGetAsset.mockResolvedValue(asset({ lifecycleState: 'pending' }));
    expect((await call()).reason).toBe('asset_not_ready');
  });

  it('an undecodable format is refused', async () => {
    for (const mimeType of ['image/gif', 'image/svg+xml', '']) {
      mockGetAsset.mockResolvedValue(asset({ mimeType }));
      expect((await call()).reason).toBe('unsupported_mime_type');
    }
  });

  it('unreadable bytes are a typed refusal, not a throw', async () => {
    mockReadBytes.mockResolvedValue(null);
    expect((await call()).reason).toBe('bytes_unavailable');
  });

  it('CRITICAL: a decode failure in the renderer falls back to the gradient', () => {
    const block = CAROUSEL.slice(
      CAROUSEL.indexOf('const deckBackground = await'),
      CAROUSEL.indexOf('for (let index = 0; index < renderItems.length'),
    );
    expect(block).toContain('catch');
    expect(block).toContain('return null');
  });
});

/* ── F. Deterministic: no provider, no URL ──────────────────────────────────*/

describe('F — carousel stays deterministic', () => {
  const shared = read('backend/services/creator/userBackgroundReference.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('CRITICAL: no provider is introduced into the carousel path', () => {
    for (const bad of ['images.edit', 'images.generate', 'generateProviderImage', 'openai', 'referenceImages']) {
      expect(CAROUSEL).not.toContain(bad);
      expect(shared).not.toContain(bad);
    }
  });

  it('CRITICAL: no provider billing is introduced', () => {
    // The deck-background block must not record credits or provider cost.
    const block = CAROUSEL.slice(
      CAROUSEL.indexOf('const deckBackground = await'),
      CAROUSEL.indexOf('for (let index = 0; index < renderItems.length'),
    );
    expect(block).not.toContain('recordAssetCredits');
    expect(block).not.toContain('captureImageProviderCost');
    expect(shared).not.toContain('recordAssetCredits');
  });

  it('CRITICAL: the private asset never becomes a URL', () => {
    for (const bad of ['getPublicUrl', 'createSignedUrl', 'signedUrl', 'bufferFromRemoteImage']) {
      expect(shared).not.toContain(bad);
    }
  });

  it('bytes come from THE shared reader, not a second one', () => {
    expect(shared).toContain('readCanonicalAssetBytes');
    expect(shared).not.toContain('storage.from');
    expect(shared).not.toContain('.download(');
  });

  it('the existing slide contract is preserved', () => {
    // Scrim, overlay, brand mark and CTA all still composite as before.
    expect(CAROUSEL).toContain('buildOverlaySvg({');
    expect(CAROUSEL).toContain('if (brandMark) {');
    expect(CAROUSEL).toContain('.composite(composites)');
  });
});

/* ── G. Deck shape does not change the reference (Phase 66B) ────────────────*/

describe('G — slide count and slide content are independent of the reference', () => {
  const resolveFor = async (w: number, h: number) => resolveUserBackgroundBytes({
    companyId: 'co-A', condition: routed('background'), width: w, height: h,
    enabled: true, namespace: 'carousel-bg:user',
  });

  it('CRITICAL: reference identity does not depend on how many slides there are', async () => {
    // The resolver is never told the slide count, so a 3-slide and a 9-slide
    // deck of the same canvas resolve to exactly the same asset and key.
    const a = await resolveFor(1080, 1080);
    const b = await resolveFor(1080, 1080);
    expect(a.cacheKey).toEqual(b.cacheKey);
    // And the signature has no slide/count/index input at all.
    const shared = read('backend/services/creator/userBackgroundReference.ts');
    const sig = shared.slice(shared.indexOf('export async function resolveUserBackgroundBytes'),
      shared.indexOf('}): Promise<UserBackgroundResult>'));
    for (const bad of ['slide', 'index', 'total', 'count', 'ordinal']) {
      expect(sig).not.toContain(bad);
    }
  });

  it('CRITICAL: slide-specific content stays independent of the background', () => {
    // The per-slide variant hash — which drives slide-to-slide distinctness —
    // is still computed from brand kit + index + body, untouched by the
    // background. Only the BASE LAYER is substituted.
    expect(CAROUSEL).toContain('variantId: `${input.brandKit.layoutVariantId}:${input.index}');
    // Overlay content per slide is still derived from that slide's own item.
    expect(CAROUSEL).toContain('headline: input.item.headline');
    expect(CAROUSEL).toContain('keyInsight: input.item.body');
  });

  it('CRITICAL: only the base layer is substituted — the composite stack is unchanged', () => {
    // Overlay SVG first, brand mark second, exactly as before the background
    // could come from a user asset.
    expect(CAROUSEL).toMatch(/const composites: Array<\{ input: Buffer; top: number; left: number \}> = \[\s*\{ input: Buffer\.from\(overlayRender\.svg\)/);
    expect(CAROUSEL).toContain('if (brandMark) {');
  });

  it('the deck background is resolved from options, never from slide data', () => {
    const block = CAROUSEL.slice(
      CAROUSEL.indexOf('const deckBackground = await'),
      CAROUSEL.indexOf('for (let index = 0; index < renderItems.length'),
    );
    expect(block).toContain('options.companyId');
    expect(block).toContain('options.compositionReferences?.conditionPlan?.condition');
    expect(block).not.toContain('renderItems');
  });
});

/* ── H. Unsupported purposes are disclosed, never silent ────────────────────*/

describe('H — carousel discloses what it cannot honour', () => {
  it('CRITICAL: the renderer emits the existing three-field disclosure', () => {
    expect(CAROUSEL).toContain('unsupportedFamilyConditionDegradation(');
    for (const f of ['condition_reference_status', 'condition_reference_fallback_category',
                     'condition_reference_user_message']) {
      expect(CAROUSEL).toMatch(new RegExp(`${f}: degradation\.`));
    }
  });

  it('CRITICAL: only background is ever reported as applied', () => {
    expect(CAROUSEL).toMatch(/appliedPurposes: deckBackground \? \['background'\] : \[\]/);
    expect(CAROUSEL).not.toContain("appliedPurposes: ['style_reference']");
    expect(CAROUSEL).not.toContain("appliedPurposes: ['subject']");
  });

  it('CRITICAL: no second status field or category was introduced', () => {
    for (const invented of ['carouselReferenceStatus', 'deckReferenceStatus', 'slide_unsupported']) {
      expect(CAROUSEL).not.toContain(invented);
    }
  });
});
