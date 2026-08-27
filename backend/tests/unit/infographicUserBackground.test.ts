/**
 * Phase 63 — a user's photograph, as the faded background of an infographic.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The infographic composites deterministically. There is no model in its path,
 * so the only honest thing it can do with an uploaded picture is place it and
 * soften it. This suite exists to keep three promises true at once:
 *
 *   the background is ACTUALLY applied      — not merely handed to a function
 *   a style_reference is STILL unsupported  — not quietly turned into one
 *   tenant A's image never reaches tenant B — including through the cache
 *
 * The third is the sharp one. `getCachedRenderBuffer` is a process-global map
 * with no notion of tenancy, so the key is the entire boundary; a key built
 * from asset identity alone would be a cross-tenant leak waiting for two ids to
 * coincide. That is asserted directly rather than by inspection.
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
  resolveInfographicBackgroundBytes,
  infographicUserBackgroundEnabled,
  MAX_INFOGRAPHIC_BACKGROUND_BYTES,
} from '../../services/creator/infographicUserBackground';
import { unsupportedFamilyConditionDegradation } from '../../services/creatorAssetRendererContracts';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const FLAG = 'CREATOR_INFOGRAPHIC_USER_BACKGROUND_ENABLED';
const asset = (over: Record<string, unknown> = {}) => ({
  id: 'asset-1', companyId: 'co-A', lifecycleState: 'ready',
  mimeType: 'image/png', byteSize: 1024,
  storageBucket: 'media', storagePath: 'co-A/asset-1.png', ...over,
});
const routed = (purpose: string, assetId = 'asset-1') => ([{
  reference: { id: `ref-${purpose}`, assetId, purpose, mode: 'condition', ordinal: 0 },
  sourceUrl: 'storage://media/x.png',
}] as never);

let originalFlag: string | undefined;
beforeEach(() => {
  originalFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  mockGetAsset.mockReset().mockResolvedValue(asset());
  mockReadBytes.mockReset().mockResolvedValue(Buffer.from('PNGBYTES'));
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = originalFlag;
});

/* ── A. The gate ────────────────────────────────────────────────────────────*/

describe('A — the capability is fail-closed and its own switch', () => {
  it('CRITICAL: absent means disabled', () => {
    delete process.env[FLAG];
    expect(infographicUserBackgroundEnabled()).toBe(false);
  });

  it('CRITICAL: only the exact value enables it', () => {
    for (const v of ['', 'false', 'TRUE', 'True', 'true ', '1', 'yes']) {
      process.env[FLAG] = v;
      expect(infographicUserBackgroundEnabled()).toBe(false);
    }
    process.env[FLAG] = 'true';
    expect(infographicUserBackgroundEnabled()).toBe(true);
  });

  it('CRITICAL: disabled reads NO asset and NO bytes', async () => {
    delete process.env[FLAG];
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(out.reason).toBe('capability_disabled');
    expect(mockGetAsset).not.toHaveBeenCalled();
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('it is NOT the template/brand background flag', () => {
    const src = read('backend/services/creator/infographicUserBackground.ts');
    expect(src).toContain(FLAG);
    expect(src).not.toMatch(/INFOGRAPHIC_BACKGROUND_IMAGES_ENABLED\s*===/);
  });
});

/* ── B. Purpose discipline ──────────────────────────────────────────────────*/

describe('B — only background, ever', () => {
  it('CRITICAL: a style_reference is NOT treated as a background', async () => {
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('style_reference'), width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('picks the background out of a mixed set and ignores the rest', async () => {
    const mixed = [
      ...(routed('style_reference', 'asset-style') as unknown as unknown[]),
      ...(routed('background', 'asset-bg') as unknown as unknown[]),
    ] as never;
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: mixed, width: 1080, height: 1350,
    });
    expect(out.bytes).not.toBeNull();
    expect(mockGetAsset).toHaveBeenCalledWith('co-A', 'asset-bg');
  });

  it('no attachment at all is not a rejection — it is simply nothing', async () => {
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: [], width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(out.reason).toBeNull();
  });
});

/* ── C. Tenancy ─────────────────────────────────────────────────────────────*/

describe('C — company is the authorization boundary', () => {
  it('CRITICAL: the asset is looked up scoped to the company', async () => {
    await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(mockGetAsset).toHaveBeenCalledWith('co-A', 'asset-1');
  });

  it("CRITICAL: another tenant's asset resolves to nothing, and is never read", async () => {
    mockGetAsset.mockResolvedValue(null); // company-scoped lookup finds nothing
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-B', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(out.reason).toBe('asset_not_found');
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('no company id means no lookup', async () => {
    const out = await resolveInfographicBackgroundBytes({
      companyId: '', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(mockGetAsset).not.toHaveBeenCalled();
  });

  it('authorization is company, never createdBy', () => {
    const src = read('backend/services/creator/infographicUserBackground.ts');
    expect(src).toContain('getCanonicalMediaAsset(companyId');
    expect(src).not.toMatch(/createdBy|created_by/);
  });
});

/* ── D. The cache key IS the boundary ───────────────────────────────────────*/

describe('D — cache isolation', () => {
  const keyFor = async (companyId: string, assetId = 'asset-1', w = 1080, h = 1350) => {
    mockGetAsset.mockResolvedValue(asset({ id: assetId, companyId }));
    const out = await resolveInfographicBackgroundBytes({
      companyId, condition: routed('background', assetId), width: w, height: h,
    });
    return out.cacheKey;
  };

  it('CRITICAL: tenant A and tenant B never share a key for the same asset id', async () => {
    const a = await keyFor('co-A', 'same-asset');
    const b = await keyFor('co-B', 'same-asset');
    expect(a).not.toBeNull();
    expect(a).not.toEqual(b);
    expect(a).toContain('co-A');
    expect(b).toContain('co-B');
  });

  it('CRITICAL: the key carries company, asset AND canvas', async () => {
    expect(await keyFor('co-A', 'asset-9', 1080, 1350))
      .toBe('infographic-bg:user:co-A:asset-9:1080x1350');
  });

  it('the same tenant, asset and canvas reuse one key', async () => {
    expect(await keyFor('co-A', 'asset-9')).toEqual(await keyFor('co-A', 'asset-9'));
  });

  it('a different canvas is a different key — the cached value is the RESIZED buffer', async () => {
    expect(await keyFor('co-A', 'asset-9', 1080, 1350))
      .not.toEqual(await keyFor('co-A', 'asset-9', 1200, 1200));
  });

  it('the key is never asset identity alone', async () => {
    const k = await keyFor('co-A', 'asset-9');
    expect(k).not.toBe('asset-9');
    expect(k!.indexOf('co-A')).toBeLessThan(k!.indexOf('asset-9'));
  });
});

/* ── E. Bounds and lifecycle ────────────────────────────────────────────────*/

describe('E — an unusable asset is refused, not decoded', () => {
  it('CRITICAL: an oversized asset is refused BEFORE download', async () => {
    mockGetAsset.mockResolvedValue(asset({ byteSize: MAX_INFOGRAPHIC_BACKGROUND_BYTES + 1 }));
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.reason).toBe('asset_too_large');
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('CRITICAL: bytes larger than the bound are refused even if the record lied', async () => {
    mockGetAsset.mockResolvedValue(asset({ byteSize: 10 }));
    mockReadBytes.mockResolvedValue(Buffer.alloc(MAX_INFOGRAPHIC_BACKGROUND_BYTES + 1));
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.bytes).toBeNull();
    expect(out.reason).toBe('asset_too_large');
  });

  it('the bound matches the URL path this stands in for', () => {
    expect(MAX_INFOGRAPHIC_BACKGROUND_BYTES).toBe(25 * 1024 * 1024);
  });

  it('a not-ready asset is refused', async () => {
    mockGetAsset.mockResolvedValue(asset({ lifecycleState: 'pending' }));
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.reason).toBe('asset_not_ready');
    expect(mockReadBytes).not.toHaveBeenCalled();
  });

  it('an undecodable format is refused', async () => {
    for (const mimeType of ['image/gif', 'image/svg+xml', 'application/pdf', '']) {
      mockGetAsset.mockResolvedValue(asset({ mimeType }));
      const out = await resolveInfographicBackgroundBytes({
        companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
      });
      expect(out.reason).toBe('unsupported_mime_type');
    }
  });

  it('unreadable bytes are a typed refusal, not a throw', async () => {
    mockReadBytes.mockResolvedValue(null);
    const out = await resolveInfographicBackgroundBytes({
      companyId: 'co-A', condition: routed('background'), width: 1080, height: 1350,
    });
    expect(out.reason).toBe('bytes_unavailable');
  });
});

/* ── F. No provider, no URL ─────────────────────────────────────────────────*/

describe('F — deterministic, and the asset stays private', () => {
  // Comments stripped: the docblock DISCUSSES the URL path it replaces, and a
  // guard that cannot tell prose from code would be satisfied by a comment.
  const src = read('backend/services/creator/infographicUserBackground.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('CRITICAL: no URL of any kind is minted', () => {
    for (const bad of ['getPublicUrl', 'createSignedUrl', 'signedUrl', 'bufferFromRemoteImage', 'https://']) {
      expect(src).not.toContain(bad);
    }
  });

  it('CRITICAL: no provider is called or imported', () => {
    for (const bad of ['images.edit', 'generateProviderImage', 'openai', 'aiGateway', 'referenceImages']) {
      expect(src).not.toContain(bad);
    }
  });

  it('bytes come from THE shared reader, not a second one', () => {
    expect(src).toContain('readCanonicalAssetBytes');
    expect(src).not.toContain('storage.from');
    expect(src).not.toContain('.download(');
  });
});

/* ── G. Disclosure is per purpose ───────────────────────────────────────────*/

describe('G — applied and not-applied can both be true at once', () => {
  const refs = (...purposes: string[]) => ({
    conditionPlan: { condition: purposes.map((p) => ({ reference: { purpose: p } })) },
  });

  it('CRITICAL: an applied background is NOT reported as not-applied', () => {
    expect(unsupportedFamilyConditionDegradation(refs('background'), { appliedPurposes: ['background'] }))
      .toBeNull();
  });

  it('CRITICAL: an unsupported style_reference is still reported', () => {
    const out = unsupportedFamilyConditionDegradation(
      refs('background', 'style_reference'), { appliedPurposes: ['background'] });
    expect(out).not.toBeNull();
    expect(out!.category).toBe('family_unsupported');
  });

  it('nothing applied still reports — the original behaviour is intact', () => {
    expect(unsupportedFamilyConditionDegradation(refs('background'))!.category).toBe('family_unsupported');
    expect(unsupportedFamilyConditionDegradation(refs('background'), { appliedPurposes: [] })!.category)
      .toBe('family_unsupported');
  });

  it('nothing attached says nothing', () => {
    expect(unsupportedFamilyConditionDegradation(refs(), { appliedPurposes: ['background'] })).toBeNull();
    expect(unsupportedFamilyConditionDegradation(null)).toBeNull();
  });
});

/* ── H. The renderer actually uses it ───────────────────────────────────────*/

describe('H — wired into the compositor, not merely available', () => {
  const R = read('backend/services/creatorAssetRendererInfographic.ts');

  it('CRITICAL: resolved bytes become the background buffer', () => {
    expect(R).toContain('resolveInfographicBackgroundBytes({');
    expect(R).toMatch(/backgroundImageBuffer = await getCachedRenderBuffer\(resolved\.cacheKey/);
  });

  it('CRITICAL: the tenant-safe key from the resolver is the one used', () => {
    expect(R).toContain('getCachedRenderBuffer(resolved.cacheKey');
    // Never the old URL-derived key for a user asset.
    expect(R).not.toMatch(/infographic-bg:\$\{backgroundConfig\.imageUrl\}[\s\S]{0,80}resolved/);
  });

  it('CRITICAL: the existing crop and scrim are untouched', () => {
    // Same resize contract as the URL path it stands beside.
    expect((R.match(/\.resize\(width, height, \{ fit: 'cover' \}\)/g) ?? []).length).toBe(2);
    // The scrim is still produced by the one function that guarantees contrast.
    expect(R).toContain('buildBackgroundLayerSvg({');
  });

  it('CRITICAL: a decode failure falls open to gradient', () => {
    const block = R.slice(R.indexOf('resolveInfographicBackgroundBytes'), R.indexOf('const backgroundMode'));
    expect(block).toContain('catch');
    expect(block).toContain('backgroundImageBuffer = null');
  });

  it('the user asset takes precedence over the template backdrop', () => {
    // The brand/template URL path only runs when the user path produced nothing.
    expect(R).toMatch(/!backgroundImageBuffer\s*\n\s*&& infographicBackgroundImagesEnabled\(\)/);
  });

  it('CRITICAL: only background is reported applied', () => {
    expect(R).toMatch(/appliedPurposes: userBackgroundApplied \? \['background'\] : \[\]/);
    expect(R).not.toContain("'style_reference'");
  });

  it('still no model anywhere in this renderer', () => {
    for (const bad of ['images.edit', 'generateProviderImage', 'openai', 'referenceImages']) {
      expect(R).not.toContain(bad);
    }
  });
});
