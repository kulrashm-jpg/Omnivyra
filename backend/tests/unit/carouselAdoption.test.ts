/**
 * Phase 4D-B — carousel / deck brand adoption (final visual consumer).
 *
 * composeStructuredDeckAsset renders carousel / slider / deck-PDF (one shared
 * kit point; NOT the separate report system). It now source-guards: published
 * brand_identity → adapter, else the identical legacy resolveCreatorBrandKit
 * path (defaults byte-identical).
 *
 * Section G mandatory gate: per-asset deep-equality (adapter(defaults) ===
 * legacy(defaults)) for the deck asset types — proves every derived field
 * (renderIdentityHash / layoutVariantId / contrastProfile / overlayStrategy) is
 * stable for defaults.
 */
import { resolveCreatorBrandKit, __brandKitCacheHasForCompanyTest } from '../../services/creatorBrandKit';
import { brandRuntimeToCreatorBrandKit } from '../../services/brand/brandRuntimeAdapter';
import { assembleBrandRuntime, invalidateBrandCaches } from '../../services/brand/brandRuntime';
import type { BrandIdentityRow } from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';
const DEFAULT_PALETTE = ['#111827', '#2563eb', '#14b8a6'];
const defaultsRt = (id = 'co1') => assembleBrandRuntime(id, { version: null, profile: null }, {}, NOW);

describe('Section G — mandatory deep-equality gate (deck defaults)', () => {
  for (const assetType of ['carousel', 'slider', 'pdf'] as const) {
    it(`adapter(defaults) deep-equals legacy resolveCreatorBrandKit for assetType=${assetType}`, () => {
      const adapted = brandRuntimeToCreatorBrandKit(defaultsRt(), { platform: 'linkedin', assetType });
      const baseline = resolveCreatorBrandKit({
        companyId: 'co1', tenantId: 'co1',
        assetPayload: { color_palette: DEFAULT_PALETTE },
        metadata: { brand_context: { profile: {} } },
        platform: 'linkedin', assetType,
      });
      expect(adapted).toEqual(baseline); // renderIdentityHash/layoutVariantId/contrastProfile/overlayStrategy stable
    });
  }
});

describe('Section C/D — typography + accent (branded)', () => {
  const rt = assembleBrandRuntime('coDeck', {
    version: { version: 1, status: 'published', colors: { palette: ['#101010', '#00ff00', '#0000ff'] }, typography: { bodyFont: 'Poppins' } } as BrandIdentityRow,
    profile: { name: 'Acme' },
  }, {}, NOW);

  it('branded deck kit uses runtime font + canonical accent + brand palette', () => {
    const kit = brandRuntimeToCreatorBrandKit(rt, { platform: 'linkedin', assetType: 'carousel' });
    expect(kit.typography.fontFamily).toBe('Poppins');
    expect(kit.accentColor).toBe(rt.colors.accent);
    expect(kit.overlayStrategy.ctaFill).toBe(rt.colors.accent); // accent flows via overlayStrategy
    expect(kit.normalizedPalette).toEqual(['#101010', '#00ff00', '#0000ff']);
  });

  it('defaults accent === palette[1] (no palette[1] drift in the deck path)', () => {
    expect(resolveCreatorBrandKit({ assetType: 'carousel' }).accentColor).toBe('#2563eb');
  });

  it('typography stays correct under inner-cache reuse (font overlaid after cache)', () => {
    const mk = (font: string) => assembleBrandRuntime('coDeckStale', {
      version: { version: 1, status: 'published', colors: { palette: ['#222222', '#33ff33', '#3333ff'] }, typography: { bodyFont: font } } as BrandIdentityRow,
      profile: { name: 'SameName' },
    }, {}, NOW);
    expect(brandRuntimeToCreatorBrandKit(mk('Poppins'), { assetType: 'carousel' }).typography.fontFamily).toBe('Poppins');
    expect(brandRuntimeToCreatorBrandKit(mk('Georgia, serif'), { assetType: 'carousel' }).typography.fontFamily).toContain('Georgia');
  });
});

describe('Section F — cache coherence (deck)', () => {
  it('a carousel kit registers under companyId and is cleared on publish', () => {
    resolveCreatorBrandKit({ companyId: 'coDeckCache', tenantId: 'coDeckCache', assetType: 'carousel' });
    expect(__brandKitCacheHasForCompanyTest('coDeckCache')).toBe(true);
    invalidateBrandCaches('coDeckCache');
    expect(__brandKitCacheHasForCompanyTest('coDeckCache')).toBe(false);
  });
});
