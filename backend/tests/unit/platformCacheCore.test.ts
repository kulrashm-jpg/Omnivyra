/**
 * Foundation Batch B (F-05) — Cache SDK core.
 *
 * Contract under test: tenant-required namespaces REFUSE keyless-tenant
 * builds (the structural B-04 guarantee), key shape is stable/versioned,
 * sanitization cannot collide, kill switches work, and the compression
 * helpers round-trip.
 */
import {
  registerCacheNamespace,
  getCacheNamespace,
  buildCacheKey,
  keyBelongsToTenant,
  isCacheNamespaceEnabled,
  compressIfLarge,
  decompressIfNeeded,
  CACHE_COMPRESS_THRESHOLD_BYTES,
  onCacheInvalidation,
  announceCacheInvalidation,
} from '../../../lib/platform/cacheCore';
import { registry } from '../../../backend/observability/registry';

const tenantNs = registerCacheNamespace({
  prefix: 'test:batchb_tenant',
  description: 'unit test — tenant required',
  version: 2,
  defaultTtlSeconds: 60,
  requireTenant: true,
});

const sharedNs = registerCacheNamespace({
  prefix: 'test:batchb_shared',
  description: 'unit test — explicitly shared',
  version: 1,
  defaultTtlSeconds: 60,
  requireTenant: false,
});

describe('F-05 cache key construction', () => {
  test('tenant-scoped key shape is prefix:vN:t.tenant:parts', () => {
    expect(buildCacheKey(tenantNs, { tenantId: 'org-123', parts: ['opA'] }))
      .toBe('test:batchb_tenant:v2:t.org-123:opA');
  });

  test('requireTenant refuses to build without a tenant (returns null + counter)', () => {
    expect(buildCacheKey(tenantNs, { parts: ['opA'] })).toBeNull();
    expect(buildCacheKey(tenantNs, { tenantId: '   ', parts: ['opA'] })).toBeNull();
    const refused = registry.counterEntries()
      .find((c) => c.name === 'cache.key_refused_no_tenant' && c.labels?.namespace === tenantNs.prefix);
    expect(refused?.value).toBeGreaterThanOrEqual(2);
  });

  test('shared namespace uses the explicit global segment', () => {
    expect(buildCacheKey(sharedNs, { parts: ['x'] }))
      .toBe('test:batchb_shared:v1:t.global:x');
  });

  test('unsafe/long parts are sanitized with a collision-proof hash suffix', () => {
    const a = buildCacheKey(sharedNs, { parts: ['has:colon and spaces'] })!;
    const b = buildCacheKey(sharedNs, { parts: ['has colon:and spaces'] })!;
    expect(a).not.toBe(b); // sanitize alone would collide; hash suffix must not
    expect(a).not.toContain(' ');
    expect(a.split(':').length).toBe(b.split(':').length); // no colon injection
    const long = buildCacheKey(sharedNs, { parts: ['x'.repeat(500)] })!;
    expect(long.length).toBeLessThan(150);
  });

  test('version bump changes every key (sanctioned global invalidation)', () => {
    const v2 = buildCacheKey(tenantNs, { tenantId: 'org-1', parts: ['op'] });
    const v3 = buildCacheKey({ ...tenantNs, version: 3 }, { tenantId: 'org-1', parts: ['op'] });
    expect(v2).not.toBe(v3);
  });

  test('keyBelongsToTenant is exact on tenant + namespace + version', () => {
    const key = buildCacheKey(tenantNs, { tenantId: 'org-1', parts: ['op'] })!;
    expect(keyBelongsToTenant(tenantNs, key, 'org-1')).toBe(true);
    expect(keyBelongsToTenant(tenantNs, key, 'org-2')).toBe(false);
    expect(keyBelongsToTenant({ ...tenantNs, version: 3 }, key, 'org-1')).toBe(false);
  });
});

describe('F-05 kill switches', () => {
  afterEach(() => {
    delete process.env.CACHE_KILL_ALL;
    delete process.env[`CACHE_KILL_${tenantNs.killEnvSuffix}`];
  });

  test('enabled by default; per-namespace and global kills work', () => {
    expect(isCacheNamespaceEnabled(tenantNs)).toBe(true);
    process.env[`CACHE_KILL_${tenantNs.killEnvSuffix}`] = '1';
    expect(isCacheNamespaceEnabled(tenantNs)).toBe(false);
    expect(isCacheNamespaceEnabled(sharedNs)).toBe(true);
    delete process.env[`CACHE_KILL_${tenantNs.killEnvSuffix}`];
    process.env.CACHE_KILL_ALL = 'true';
    expect(isCacheNamespaceEnabled(tenantNs)).toBe(false);
    expect(isCacheNamespaceEnabled(sharedNs)).toBe(false);
  });
});

describe('F-05 compression + hooks + registry', () => {
  test('compression round-trips and skips small values', async () => {
    const small = 'tiny';
    expect(await compressIfLarge(small)).toBe(small);
    const big = JSON.stringify({ data: 'y'.repeat(CACHE_COMPRESS_THRESHOLD_BYTES * 4) });
    const stored = await compressIfLarge(big);
    expect(stored).not.toBe(big);
    expect(stored.length).toBeLessThan(big.length);
    expect(await decompressIfNeeded(stored)).toBe(big);
    expect(await decompressIfNeeded(small)).toBe(small);
  });

  test('invalidation announcements reach listeners', () => {
    const seen: Array<{ namespace: string; reason: string }> = [];
    onCacheInvalidation((info) => seen.push(info));
    announceCacheInvalidation(sharedNs, 'unit-test', 3);
    expect(seen).toContainEqual({ namespace: sharedNs.prefix, reason: 'unit-test' });
  });

  test('namespace registry lookup', () => {
    expect(getCacheNamespace(tenantNs.prefix)?.requireTenant).toBe(true);
    expect(getCacheNamespace('nope')).toBeUndefined();
  });
});
