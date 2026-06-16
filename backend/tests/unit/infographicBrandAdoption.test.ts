/**
 * Phase 4A — infographic brand adoption.
 *
 * Proves: (1) the accent change is byte-identical for a defaults-only tenant,
 * (2) the adapter threads asset geometry while overlaying brand typography/
 * accent, (3) the brandKit cache is registered with the Phase-3C invalidation
 * registry and cleared on publish (company-scoped).
 *
 * The infographic DEFAULTS render path is byte-identical by construction: the
 * source guard runs the exact same resolveCreatorBrandKit({...}) call as before
 * for a non-branded tenant, and the only accent change uses kit.accentColor,
 * which for DEFAULT_PALETTE equals palette[1] (asserted below).
 */
import { resolveCreatorBrandKit, __brandKitCacheHasForCompanyTest, __brandKitCacheSeedForTest } from '../../services/creatorBrandKit';
import { brandRuntimeToCreatorBrandKit } from '../../services/brand/brandRuntimeAdapter';
import { assembleBrandRuntime, invalidateBrandCaches } from '../../services/brand/brandRuntime';
import { publishDraft, type BrandIdentityStore, type BrandPointer } from '../../services/brand/brandIdentityWriteService';
import type { BrandIdentityRow } from '../../services/brand/brandRuntime';

const NOW = '2026-06-16T00:00:00.000Z';

describe('infographic accent — defaults-only byte-identical (Section C/D)', () => {
  it('the kit accentColor equals palette[1] for DEFAULT_PALETTE (no drift)', () => {
    const kit = resolveCreatorBrandKit({});
    expect(kit.accentColor).toBe(kit.normalizedPalette[1]);
    expect(kit.accentColor).toBe('#2563eb'); // DEFAULT_PALETTE[1] — old `palette[1]`
  });
});

describe('adapter — asset context threads geometry + overlays brand (Section B/C)', () => {
  const brandedRt = assembleBrandRuntime('co1', {
    version: { version: 1, status: 'published', colors: { palette: ['#ff0000', '#00ff00', '#0000ff'] }, typography: { bodyFont: 'Poppins' } } as BrandIdentityRow,
    profile: { name: 'Acme' },
  }, {}, NOW);

  it('platform/assetType change the geometry hash; brand typography/accent overlaid', () => {
    const noCtx = brandRuntimeToCreatorBrandKit(brandedRt);
    const withCtx = brandRuntimeToCreatorBrandKit(brandedRt, { platform: 'instagram', assetType: 'infographic' });
    expect(withCtx.layoutVariantId).not.toBe(noCtx.layoutVariantId); // geometry threaded
    expect(withCtx.renderIdentityHash).not.toBe(noCtx.renderIdentityHash);
    expect(withCtx.typography.fontFamily).toBe('Poppins');            // brand font
    expect(withCtx.accentColor).toBe(brandedRt.colors.accent);        // runtime accent
    expect(withCtx.normalizedPalette).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('asset brand_context.overrides are preserved through the merge', () => {
    const withOverrides = brandRuntimeToCreatorBrandKit(brandedRt, {
      assetPayload: {}, metadata: { brand_context: { overrides: { companyName: 'OVERRIDE_CO' } } }, platform: 'instagram', assetType: 'infographic',
    });
    expect(withOverrides.companyName).toBe('OVERRIDE_CO'); // operator override wins over runtime profile name
  });
});

describe('brandKit cache registration with Phase-3C registry (Section E/F)', () => {
  it('a real resolved kit is keyed by companyId and cleared on publish', () => {
    resolveCreatorBrandKit({ companyId: 'coReal', tenantId: 'coReal' });
    expect(__brandKitCacheHasForCompanyTest('coReal')).toBe(true);
    invalidateBrandCaches('coReal');
    expect(__brandKitCacheHasForCompanyTest('coReal')).toBe(false);
  });

  it('invalidation is company-scoped (A cleared, B intact)', () => {
    __brandKitCacheSeedForTest('coA'); __brandKitCacheSeedForTest('coB');
    invalidateBrandCaches('coA');
    expect(__brandKitCacheHasForCompanyTest('coA')).toBe(false);
    expect(__brandKitCacheHasForCompanyTest('coB')).toBe(true);
    invalidateBrandCaches('coB');
  });

  it('publishDraft clears the infographic brandKit cache in-process (publish → fresh brand)', async () => {
    __brandKitCacheSeedForTest('coP');
    const versions = new Map<string, BrandIdentityRow>([['1', { version: 1, status: 'draft', voice: {} }]]);
    let pointer: BrandPointer | null = { published_version: null, draft_version: 1 };
    const store: BrandIdentityStore = {
      async getPointer() { return pointer; },
      async getVersion(_c, v) { return versions.get(String(v)) ?? null; },
      async nextVersion() { return 2; },
      async insertVersion() {}, async updateVersionVoice() {},
      async setPublished(_c, v) { const r = versions.get(String(v)); if (r) r.status = 'published'; },
      async upsertPointer(_c, p) {
        pointer = {
          published_version: 'published_version' in p ? p.published_version ?? null : pointer?.published_version ?? null,
          draft_version: 'draft_version' in p ? p.draft_version ?? null : pointer?.draft_version ?? null,
        };
      },
    };
    await publishDraft('coP', { store, loadProfile: async () => null, nowIso: () => NOW });
    expect(__brandKitCacheHasForCompanyTest('coP')).toBe(false);
  });
});
