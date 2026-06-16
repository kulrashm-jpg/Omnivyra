/**
 * Phase 3C / 4A — dependency-free cross-module cache invalidation registry.
 *
 * Lives in its OWN module (imports nothing) so any cache — brand runtime,
 * content generators, creator brand kit — can register a company-scoped clear
 * without creating an import cycle. brandRuntime.invalidateBrandCaches() fans
 * out to the runtime cache PLUS every invalidator registered here.
 *
 * In-process only; cross-process caches converge by TTL.
 */
type BrandCacheInvalidator = (companyId: string) => void;
const _brandCacheInvalidators = new Set<BrandCacheInvalidator>();

export function registerBrandCacheInvalidator(fn: BrandCacheInvalidator): void {
  _brandCacheInvalidators.add(fn);
}

export function unregisterBrandCacheInvalidator(fn: BrandCacheInvalidator): void {
  _brandCacheInvalidators.delete(fn);
}

/** Run every registered downstream invalidator for a company. Error-isolated:
 *  one misbehaving invalidator must never break a publish. */
export function runBrandCacheInvalidators(companyId: string): void {
  for (const fn of _brandCacheInvalidators) {
    try {
      fn(companyId);
    } catch {
      /* swallow — a bad invalidator can't break publish/rollback */
    }
  }
}
