/**
 * W1-1 (B-04 fix) — tenant-scoped AI semantic cache: source + wiring contract.
 *
 * aiResponseCache talks to live Redis, so (repo pattern: cron/topology
 * contracts) the isolation-critical wiring is locked at SOURCE level, plus
 * the namespace registration is verified at runtime (module import is
 * side-effect-safe — the Redis client is lazy).
 *
 * Locked contract:
 *   1. the semantic namespace is registered v3 with requireTenant: true,
 *   2. no v2 semantic key construction remains (the leaking shape),
 *   3. get/set accept the tenant param and skip near-match when the key
 *      builder refuses (no tenant),
 *   4. the gateway threads request.companyId into BOTH cache calls,
 *   5. read-side defense in depth: entry tenant mismatch → isolation-
 *      violation counter, never served.
 */
import fs from 'fs';
import path from 'path';
import { getCacheNamespace } from '../../../lib/platform/cacheCore';
// Importing the cache module registers the namespace (lazy Redis — no I/O).
import '../../services/aiResponseCache';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const cacheSrc = read('services/aiResponseCache.ts');
const gatewaySrc = read('services/aiGatewayProvidersOps.ts');

describe('W1-1 semantic cache tenant scoping', () => {
  it('registers the semantic namespace v3 with requireTenant: true', () => {
    const ns = getCacheNamespace('omnivyra:ai_sem');
    expect(ns).toBeDefined();
    expect(ns!.version).toBe(3);
    expect(ns!.requireTenant).toBe(true);
  });

  it('the leaking v2 semantic key shape is gone from the source', () => {
    expect(cacheSrc).not.toContain("'omnivyra:ai_sem:v2'");
    expect(cacheSrc).not.toContain('SEMANTIC_PREFIX');
  });

  it('near-match read/write build keys through the SDK and skip without a key', () => {
    // Read side: buildCacheKey guarded by the kill switch; null → miss return.
    expect(cacheSrc).toMatch(/const semKey = isCacheNamespaceEnabled\(SEMANTIC_NS\)\s*\n?\s*\? buildCacheKey\(SEMANTIC_NS, \{ tenantId: tenant, parts: \[operation\] \}\)/);
    expect(cacheSrc).toMatch(/if \(!semKey\) \{ recordCacheMiss\(\); return null; \}/);
    // Write side: null key → entry not indexed (exact cache already written).
    expect(cacheSrc).toMatch(/if \(!semKey\) return;/);
    // Tenant resolution chain: explicit param → request-context orgId → null.
    expect(cacheSrc.match(/const tenant = tenantId \?\? getTenantId\(\) \?\? null;/g)?.length).toBe(2);
  });

  it('read-side entries verify their recorded tenant (defense in depth)', () => {
    expect(cacheSrc).toContain('noteCacheIsolationViolation(SEMANTIC_NS)');
    expect(cacheSrc).toMatch(/entry\.t !== undefined && entry\.t !== \(tenant \?\? ''\)/);
    // Write side stamps the tenant into every entry.
    expect(cacheSrc).toMatch(/JSON\.stringify\(\{ words, key: exactKey, t: tenant \?\? '' \}\)/);
  });

  it('the gateway threads request.companyId into both cache calls', () => {
    // The cache-version argument is `effectiveCacheVersion` (aiGatewayProvidersOps
    // WAVE3 item 3), which IS `request.cache_version` unless the caller supplies a
    // seed. Anchoring on the local preserves this assertion's meaning; the tenant
    // requirement — `request.companyId ?? null` in BOTH calls — is unchanged.
    expect(gatewaySrc).toMatch(/getCachedCompletion\([\s\S]{0,220}?effectiveCacheVersion,[\s\S]{0,120}?request\.companyId \?\? null,\s*\)/);
    expect(gatewaySrc).toMatch(/setCachedCompletion\(request\.operation, effectiveModel, request\.messages, content, effectiveCacheVersion, request\.companyId \?\? null\)/);
  });

  it('signatures accept the optional tenant parameter (backward compatible)', () => {
    expect(cacheSrc).toMatch(/export async function getCachedCompletion\([\s\S]{0,300}?tenantId\?: string \| null,\s*\): Promise<string \| null>/);
    expect(cacheSrc).toMatch(/export async function setCachedCompletion\([\s\S]{0,340}?tenantId\?: string \| null,\s*\): Promise<void>/);
  });
});
