/**
 * Phase 4B — brand card brand adoption.
 *
 * The brand-card DEFAULTS render path is byte-identical by construction: the
 * source guard runs the identical resolveCreatorBrandKit({assetType:'brand_card'})
 * call for non-branded tenants, the accent change uses kit.accentColor (=== the
 * prior palette[1] for DEFAULT_PALETTE), and each hardcoded font literal is
 * preserved per-spot when not branded. These tests cover the kit-level
 * invariants + adapter typography/accent + cache coherence.
 */
import { resolveCreatorBrandKit, __brandKitCacheHasForCompanyTest } from '../../services/creatorBrandKit';
import { brandRuntimeToCreatorBrandKit } from '../../services/brand/brandRuntimeAdapter';
import { assembleBrandRuntime, invalidateBrandCaches } from '../../services/brand/brandRuntime';
import type { BrandIdentityRow } from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';
const brandedRt = () => assembleBrandRuntime('coCard', {
  version: { version: 1, status: 'published', colors: { palette: ['#101010', '#00ff00', '#0000ff'] }, typography: { bodyFont: 'Poppins' } } as BrandIdentityRow,
  profile: { name: 'Acme' },
}, {}, NOW);

describe('brand card — defaults-only parity (Section C/E)', () => {
  it('brand_card kit accentColor === palette[1] for DEFAULT_PALETTE (accent change is byte-identical)', () => {
    const kit = resolveCreatorBrandKit({ assetType: 'brand_card' });
    expect(kit.accentColor).toBe(kit.normalizedPalette[1]);
    expect(kit.accentColor).toBe('#2563eb');
  });
});

describe('brand card — adapter typography + accent (Section B/C/E)', () => {
  it('branded brand_card kit uses runtime font + runtime accent', () => {
    const rt = brandedRt();
    const kit = brandRuntimeToCreatorBrandKit(rt, { platform: 'linkedin', assetType: 'brand_card' });
    expect(kit.typography.fontFamily).toBe('Poppins'); // runtime typography
    expect(kit.accentColor).toBe(rt.colors.accent);    // canonical accent
    expect(kit.normalizedPalette).toEqual(['#101010', '#00ff00', '#0000ff']);
  });
});

describe('brand card — logo handling (Section D: document & stop)', () => {
  it('a brand mark IS resolved on the kit (available), but the card renders the name text — adopting the mark would change geometry, so logo behavior is intentionally unchanged', () => {
    const kit = brandRuntimeToCreatorBrandKit(brandedRt(), { platform: 'linkedin', assetType: 'brand_card' });
    expect(kit.resolvedBrandMark).toBeTruthy();
    expect(['logo', 'favicon', 'initials']).toContain(kit.resolvedBrandMarkType);
    // No assertion that the renderer consumes it — by design it does not (text line, not an <image>).
  });
});

describe('brand card — cache coherence (Section F)', () => {
  it('a brand_card kit registers under companyId and is cleared on publish', () => {
    resolveCreatorBrandKit({ companyId: 'coCardCache', tenantId: 'coCardCache', assetType: 'brand_card' });
    expect(__brandKitCacheHasForCompanyTest('coCardCache')).toBe(true);
    invalidateBrandCaches('coCardCache');
    expect(__brandKitCacheHasForCompanyTest('coCardCache')).toBe(false);
  });
});
