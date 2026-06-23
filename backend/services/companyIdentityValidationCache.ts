/**
 * companyIdentityValidationCache.ts
 *
 * In-memory, TTL-bounded cache of SUCCESSFUL company-identity domain verdicts.
 * Purpose (Phase 11D): avoid repeating the expensive DNS/website probe
 * (`resolveDomain`) for a domain that very recently validated successfully.
 *
 * Caches ONLY clean successes (eligible === true). Never caches failures,
 * timeouts, DNS/network errors, blocks, or review-required outcomes — those must
 * always re-evaluate. The claimed-domain check (DB state) is re-run on every hit
 * by the caller, so the cache can never let a now-claimed domain through.
 *
 * No DB, no external dependency, no schema. Deterministic expiry by timestamp.
 */

/** Domain-level fields of a successful verdict (all derivable from the domain). */
export interface CachedDomainVerdict {
  websiteUrl: string;
  websiteDomain: string;
  normalizedWebsiteDomain: string;
  companyIdentityDomain: string;
  /** Always false for cached entries (only clean successes are cached). */
  reviewRequired: boolean;
  /** Epoch ms when cached. */
  cachedAt: number;
}

const DEFAULT_TTL_SECONDS = 6 * 60 * 60; // 6 hours — see PHASE11D_CACHE_REPORT.md
const envTtl = Number(process.env.DOMAIN_VALIDATION_SUCCESS_TTL_SECONDS);
export const DOMAIN_VALIDATION_SUCCESS_TTL_MS =
  (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS) * 1000;

/** Bound memory; oldest-inserted entry is evicted past this. */
const MAX_ENTRIES = 5000;

const store = new Map<string, CachedDomainVerdict>();

/** Return a non-expired cached verdict, or null. Expired entries are deleted. */
export function getCachedDomainVerdict(domain: string, nowMs: number): CachedDomainVerdict | null {
  if (!domain) return null;
  const hit = store.get(domain);
  if (!hit) return null;
  if (nowMs - hit.cachedAt >= DOMAIN_VALIDATION_SUCCESS_TTL_MS) {
    store.delete(domain); // deterministic expiration: never serve a stale entry
    return null;
  }
  return hit;
}

/** Store a successful domain verdict (caller guarantees it's a clean success). */
export function setCachedDomainVerdict(domain: string, verdict: CachedDomainVerdict): void {
  if (!domain) return;
  if (store.size >= MAX_ENTRIES && !store.has(domain)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(domain, verdict);
}

/** Test/ops helpers. */
export function clearDomainVerdictCache(): void { store.clear(); }
export function domainVerdictCacheSize(): number { return store.size; }
