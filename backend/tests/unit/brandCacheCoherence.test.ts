/**
 * Phase 3C — brand publish cache coherence.
 *
 * Proves that a brand publish/rollback leaves NO in-process cache serving
 * pre-publish voice: the runtime cache AND the content generators' identity
 * caches (which bake the resolved voice) are cleared, company-scoped.
 */
import {
  invalidateBrandCaches,
  registerBrandCacheInvalidator,
  unregisterBrandCacheInvalidator,
  resolveBrand,
  resetBrandRuntimeCache,
  type BrandDataLoader,
} from '../../services/brand/brandRuntime';
import { publishDraft, rollbackPublished, type BrandWriteDeps, type BrandIdentityStore, type BrandPointer } from '../../services/brand/brandIdentityWriteService';
// Importing the generators triggers their registerBrandCacheInvalidator(...) side-effect.
import { __identityCacheHasForTest, __identityCacheSeedForTest } from '../../services/contentGeneration/blueprintGenerator';
import { __variantCacheHasForTest, __variantCacheSeedForTest } from '../../services/contentGeneration/platformVariantGenerator';
import type { BrandIdentityRow } from '../../services/brand/brandRuntime';

beforeEach(() => resetBrandRuntimeCache());

function storeWithPublishedDraft(): { store: BrandIdentityStore; getPointer: () => BrandPointer | null } {
  const versions = new Map<string, BrandIdentityRow>([['1', { version: 1, status: 'draft', voice: {} }]]);
  let pointer: BrandPointer | null = { published_version: null, draft_version: 1 };
  const store: BrandIdentityStore = {
    async getPointer() { return pointer; },
    async getVersion(_c, v) { return versions.get(String(v)) ?? null; },
    async nextVersion() { return versions.size + 1; },
    async insertVersion() {},
    async updateVersionVoice() {},
    async setPublished(_c, v) { const r = versions.get(String(v)); if (r) r.status = 'published'; },
    async upsertPointer(_c, p) {
      pointer = {
        published_version: 'published_version' in p ? p.published_version ?? null : pointer?.published_version ?? null,
        draft_version: 'draft_version' in p ? p.draft_version ?? null : pointer?.draft_version ?? null,
      };
    },
  };
  return { store, getPointer: () => pointer };
}
const baseDeps = (store: BrandIdentityStore): BrandWriteDeps => ({ store, loadProfile: async () => null, nowIso: () => '2026-06-16T00:00:00.000Z' });

describe('brand cache coherence (Phase 3C)', () => {
  it('publish clears BOTH generator identity caches + is company-scoped (A not B)', async () => {
    __identityCacheSeedForTest('coA'); __identityCacheSeedForTest('coB');
    __variantCacheSeedForTest('coA'); __variantCacheSeedForTest('coB');

    // Real default invalidate = invalidateBrandCaches (no injected spy).
    const { store } = storeWithPublishedDraft();
    await publishDraft('coA', baseDeps(store));

    expect(__identityCacheHasForTest('coA')).toBe(false); // new voice on next generation
    expect(__variantCacheHasForTest('coA')).toBe(false);
    expect(__identityCacheHasForTest('coB')).toBe(true);  // company B untouched
    expect(__variantCacheHasForTest('coB')).toBe(true);
  });

  it('rollback also clears the generator caches (pointer flip + coherence)', async () => {
    const versions = new Map<string, BrandIdentityRow>([['1', { version: 1, status: 'published', voice: {} }]]);
    const store: BrandIdentityStore = {
      async getPointer() { return { published_version: 2, draft_version: null }; },
      async getVersion(_c, v) { return versions.get(String(v)) ?? null; },
      async nextVersion() { return 3; },
      async insertVersion() {}, async updateVersionVoice() {}, async setPublished() {}, async upsertPointer() {},
    };
    __identityCacheSeedForTest('coA');
    await rollbackPublished('coA', 1, baseDeps(store));
    expect(__identityCacheHasForTest('coA')).toBe(false);
  });

  it('runtime cache is cleared too → planning re-resolution sees the NEW voice', async () => {
    let toneVar = 'warm, expert';
    let loads = 0;
    const fakeLoad: BrandDataLoader = async () => {
      loads += 1;
      return { version: { version: 1, status: 'published', voice: { tone: toneVar } } as BrandIdentityRow, profile: null };
    };
    const r1 = await resolveBrand('coA', {}, { load: fakeLoad });
    await resolveBrand('coA', {}, { load: fakeLoad }); // cache hit — no reload
    expect(loads).toBe(1);
    expect(r1.voice.tone).toBe('warm, expert');

    toneVar = 'dry, contrarian';
    invalidateBrandCaches('coA'); // publish-equivalent

    const r2 = await resolveBrand('coA', {}, { load: fakeLoad });
    expect(loads).toBe(2);                       // reloaded after invalidation
    expect(r2.voice.tone).toBe('dry, contrarian'); // NEW voice, no stale hit
  });

  it('repeated publish/invalidate is deterministic + company-scoped on the registry', () => {
    const hits: string[] = [];
    const fake = (id: string) => hits.push(id);
    registerBrandCacheInvalidator(fake);
    try {
      invalidateBrandCaches('coA');
      invalidateBrandCaches('coA');
      invalidateBrandCaches('coB');
      expect(hits).toEqual(['coA', 'coA', 'coB']);
    } finally {
      unregisterBrandCacheInvalidator(fake);
    }
  });

  it('a throwing invalidator never breaks publish or other invalidators', () => {
    const hits: string[] = [];
    const boom = () => { throw new Error('boom'); };
    const good = (id: string) => hits.push(id);
    registerBrandCacheInvalidator(boom);
    registerBrandCacheInvalidator(good);
    try {
      expect(() => invalidateBrandCaches('coA')).not.toThrow();
      expect(hits).toEqual(['coA']);
    } finally {
      unregisterBrandCacheInvalidator(boom);
      unregisterBrandCacheInvalidator(good);
    }
  });
});
