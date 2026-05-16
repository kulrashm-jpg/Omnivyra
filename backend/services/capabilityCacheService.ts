/**
 * Phase 1 — Tenant-scoped capability cache.
 *
 * In-process TTL cache that wraps the capability aggregation service.
 * Strict invariants:
 *   • Tenant key is organization_id; entries are mutually invisible across
 *     tenants by construction (no shared key namespace).
 *   • Stored value is the read-only CapabilityAggregate. Never tokens,
 *     never refresh_tokens, never raw OAuth payloads.
 *   • Default TTL is short (30s) so even without explicit invalidation a
 *     stale value cannot persist beyond a single browser session-tick.
 *   • Every capability-changing mutation in this codebase MUST call
 *     `invalidateCapabilityAggregate(orgId)` before returning to the caller.
 *     Writers in integrationCapabilityService and consentLedgerService do.
 *   • Cache is in-process only (no Redis). Multi-instance deployments will
 *     see at most TTL_MS of skew per instance — acceptable for read paths,
 *     and we keep authorization checks reading from the DB directly.
 *
 * Authorization safety:
 *   Reads of capability state for *gating decisions* (POST /capabilities
 *   path, monitoring start, etc.) MUST bypass the cache. Use
 *   `buildCapabilityAggregate` (cache-miss path) directly for those. The
 *   cache exists solely for UI snapshot reads.
 */

import {
  buildCapabilityAggregate,
  type CapabilityAggregate,
} from './capabilityAggregationService';

const TTL_MS = 30_000;

type CacheEntry = {
  value: CapabilityAggregate;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlightBuilds = new Map<string, Promise<CapabilityAggregate>>();

let hits = 0;
let misses = 0;
let invalidations = 0;
let totalBuildMs = 0;
let builds = 0;

/**
 * Read-only cached aggregate. Returns a fresh build if no entry / expired.
 * Safe for UI hydration; do not use for authorization decisions.
 */
export async function getCachedCapabilityAggregate(
  organizationId: string,
  options?: { forceRefresh?: boolean },
): Promise<CapabilityAggregate> {
  const now = Date.now();
  if (!options?.forceRefresh) {
    const hit = cache.get(organizationId);
    if (hit && hit.expiresAt > now) {
      hits += 1;
      return hit.value;
    }
  }
  misses += 1;
  const existingBuild = inFlightBuilds.get(organizationId);
  if (existingBuild) return existingBuild;

  const startedAt = Date.now();
  const build = buildCapabilityAggregate(organizationId)
    .then((value) => {
      builds += 1;
      totalBuildMs += Date.now() - startedAt;
      cache.set(organizationId, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => {
      inFlightBuilds.delete(organizationId);
    });
  inFlightBuilds.set(organizationId, build);
  return build;
}

/**
 * Explicit per-tenant invalidation. Callers: every mutation that changes
 * (a) integration_capabilities row, (b) consent_records row, (c)
 * listening_sources row, or (d) social_accounts.granted_scopes.
 */
export function invalidateCapabilityAggregate(organizationId: string): void {
  if (cache.delete(organizationId)) {
    invalidations += 1;
  }
  inFlightBuilds.delete(organizationId);
}

/**
 * Best-effort full clear. Use sparingly — primarily for tests and worker
 * boot to avoid stale state surviving a restart-without-clear scenario.
 */
export function clearCapabilityCache(): void {
  invalidations += cache.size;
  cache.clear();
  inFlightBuilds.clear();
}

/**
 * Cache observability snapshot. Surfaces hit/miss/invalidation counters and
 * the current resident size. No PII / no tenant content exposed.
 */
export function getCapabilityCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
  ttl_ms: number;
  in_flight: number;
  avg_build_ms: number;
} {
  return {
    size: cache.size,
    hits,
    misses,
    invalidations,
    ttl_ms: TTL_MS,
    in_flight: inFlightBuilds.size,
    avg_build_ms: builds > 0 ? Math.round(totalBuildMs / builds) : 0,
  };
}
