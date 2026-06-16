/**
 * Phase 4D-A — image + banner brand adoption.
 *
 * Both renderers route through composeSingleVisualAsset (one kit point), which
 * now source-guards: published brand_identity → adapter, else the identical
 * legacy resolveCreatorBrandKit path (defaults byte-identical).
 *
 * Section G mandatory gate: per-asset deep-equality (adapter(defaults) ===
 * legacy(defaults)) for image AND banner — proves the adapter introduces no
 * drift in any derived field (renderIdentityHash / layoutVariantId /
 * contrastProfile / overlayStrategy), so a branded render differs ONLY by brand.
 */
import { resolveCreatorBrandKit, __brandKitCacheHasForCompanyTest } from '../../services/creatorBrandKit';
import { brandRuntimeToCreatorBrandKit } from '../../services/brand/brandRuntimeAdapter';
import { assembleBrandRuntime, invalidateBrandCaches } from '../../services/brand/brandRuntime';
import type { BrandIdentityRow } from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';
const DEFAULT_PALETTE = ['#111827', '#2563eb', '#14b8a6'];
const defaultsRt = (id = 'co1') => assembleBrandRuntime(id, { version: null, profile: null }, {}, NOW);

describe('Section G — mandatory per-asset deep-equality gate (defaults)', () => {
  for (const assetType of ['image', 'banner'] as const) {
    it(`adapter(defaults) deep-equals legacy resolveCreatorBrandKit for assetType=${assetType}`, () => {
      const adapted = brandRuntimeToCreatorBrandKit(defaultsRt(), { platform: 'instagram', assetType });
      const baseline = resolveCreatorBrandKit({
        companyId: 'co1', tenantId: 'co1',
        assetPayload: { color_palette: DEFAULT_PALETTE },
        metadata: { brand_context: { profile: {} } },
        platform: 'instagram', assetType,
      });
      expect(adapted).toEqual(baseline); // Section E: every derived field stable for defaults
    });
  }
});

describe('Section C — typography (branded font + no stale-cache leak)', () => {
  it('branded tenant receives runtime typography', () => {
    const rt = assembleBrandRuntime('coT', {
      version: { version: 1, status: 'published', colors: { palette: ['#101010', '#00ff00', '#0000ff'] }, typography: { bodyFont: 'Poppins' } } as BrandIdentityRow,
      profile: { name: 'Acme' },
    }, {}, NOW);
    expect(brandRuntimeToCreatorBrandKit(rt, { assetType: 'image' }).typography.fontFamily).toBe('Poppins');
  });

  it('typography cannot go stale via the inner resolveCreatorBrandKit cache (font overlaid AFTER the cache)', () => {
    // Same palette + name → the inner resolver cache key collides, but the brand
    // font is applied by the adapter OUTSIDE that cache, so each runtime keeps its own font.
    const mk = (font: string) => assembleBrandRuntime('coStale', {
      version: { version: 1, status: 'published', colors: { palette: ['#222222', '#33ff33', '#3333ff'] }, typography: { bodyFont: font } } as BrandIdentityRow,
      profile: { name: 'SameName' },
    }, {}, NOW);
    const a = brandRuntimeToCreatorBrandKit(mk('Poppins'), { assetType: 'banner' });
    const b = brandRuntimeToCreatorBrandKit(mk('Georgia, serif'), { assetType: 'banner' });
    expect(a.typography.fontFamily).toBe('Poppins');
    expect(b.typography.fontFamily).toContain('Georgia'); // NOT stale 'Poppins'
  });
});

describe('Section D — accent (canonical, no palette[1])', () => {
  it('defaults accent === palette[1]; branded accent === runtime accent', () => {
    expect(resolveCreatorBrandKit({ assetType: 'image' }).accentColor).toBe('#2563eb'); // DEFAULT_PALETTE[1]
    const rt = assembleBrandRuntime('coA2', {
      version: { version: 1, status: 'published', colors: { palette: ['#ffffff', '#123456', '#abcdef'] } } as BrandIdentityRow, profile: null,
    }, {}, NOW);
    expect(brandRuntimeToCreatorBrandKit(rt, { assetType: 'banner' }).accentColor).toBe(rt.colors.accent);
  });
});

describe('Section F — cache coherence (image/banner)', () => {
  for (const assetType of ['image', 'banner'] as const) {
    it(`a ${assetType} kit registers under companyId and is cleared on publish`, () => {
      const id = `coCache_${assetType}`;
      resolveCreatorBrandKit({ companyId: id, tenantId: id, assetType });
      expect(__brandKitCacheHasForCompanyTest(id)).toBe(true);
      invalidateBrandCaches(id);
      expect(__brandKitCacheHasForCompanyTest(id)).toBe(false);
    });
  }
});
