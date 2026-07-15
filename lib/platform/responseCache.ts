/**
 * W4-1 — Response cache middleware (Foundation route-factory `use` slot).
 *
 * Caches 200 JSON responses of idempotent GET endpoints, keyed by
 * tenant (+user where the endpoint's data is user-specific) + normalized
 * query. Composes the F-12 client, so tenant isolation, versioning, gzip,
 * kill switches, and hit/miss metrics all apply. Rollout: the shared
 * 'response-cache' flag must be ON **and** the endpoint must have opted in
 * via createApiRoute's `use` — nothing caches by accident. HITs are marked
 * `x-response-cache: hit` (additive header, only ever present on flag-on
 * endpoints).
 *
 * NEVER use on: auth, billing, credits-mutating, publishing, or any endpoint
 * whose response reflects mutable operation state (per the Wave 4 no-cache
 * list).
 *
 * ADOPTION STATUS (certification-corrected): this middleware is the
 * sanctioned seam for endpoints whose tenant is resolvable pre-handler
 * (context or `tenantFrom`); it has NO adopter yet. The Wave 4 starter
 * endpoint (readiness-score, audit B-40) resolves its tenant inside the
 * handler and therefore adopts the F-12 cache CLIENT directly instead.
 * First middleware adoption lands with the response-cache ramp.
 */
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { registerCacheNamespace, type CacheNamespace } from './cacheCore';
import { createCache } from './cacheClient';
import { defineRolloutFlag, resolveRolloutSync } from './rollout';
import { getTenantId, getRequestContext } from './requestContext';
import type { RouteMiddleware } from './routeFactory';

export const RESPONSE_CACHE_FLAG = defineRolloutFlag({
  key: 'response-cache',
  description: 'W4-1: opt-in per-endpoint response caching at the route factory (audit B-11)',
});

export interface ResponseCacheOptions {
  /** Stable endpoint label — becomes part of the namespace registry. */
  endpoint: string;
  ttlSeconds: number;
  /** 'tenant' (company-shared) or 'user' (adds userId to the key). */
  scope: 'tenant' | 'user';
  /** Query params that participate in the key (whitelist — unknown = miss-through). */
  varyQuery?: string[];
  /**
   * Tenant extractor for endpoints where the middleware runs before the
   * guard resolves the principal (e.g. explicit ?company_id=). Falls back to
   * the request-context orgId. No tenant from either source → bypass.
   */
  tenantFrom?: (req: NextApiRequest) => string | null | undefined;
}

interface CachedResponse {
  status: 200;
  body: unknown;
}

/**
 * Build the middleware for createApiRoute's `use` slot. One namespace per
 * endpoint (per-endpoint TTL + independent kill switch CACHE_KILL_*).
 */
export function withResponseCache(options: ResponseCacheOptions): RouteMiddleware {
  const ns: CacheNamespace = registerCacheNamespace({
    prefix: `omnivyra:resp:${options.endpoint}`,
    description: `W4-1 response cache — ${options.endpoint}`,
    version: 1,
    defaultTtlSeconds: options.ttlSeconds,
    requireTenant: true, // ALWAYS tenant-required — untenanted requests bypass
  });
  const cache = createCache(ns);

  return (handler: NextApiHandler): NextApiHandler =>
    async (req: NextApiRequest, res: NextApiResponse) => {
      try {
        if (req.method !== 'GET') return handler(req, res);
        if (resolveRolloutSync(RESPONSE_CACHE_FLAG, { tenantId: getTenantId() }).mode === 'off') {
          return handler(req, res);
        }
        const tenantId = options.tenantFrom?.(req) ?? getTenantId();
        if (!tenantId) return handler(req, res);

        const parts: Array<string | number> = [];
        if (options.scope === 'user') {
          const userId = getRequestContext().userId;
          if (!userId) return handler(req, res);
          parts.push(`u.${userId}`);
        }
        for (const q of options.varyQuery ?? []) {
          parts.push(`${q}=${String(req.query[q] ?? '')}`);
        }

        const hit = await cache.get<CachedResponse>({ tenantId, parts });
        if (hit && hit.status === 200) {
          res.setHeader('x-response-cache', 'hit');
          return res.status(200).json(hit.body);
        }

        // MISS: capture the handler's json body; store only EXPLICIT 200s
        // (certification fix: an undefined statusCode is no longer assumed
        // to be a success — never cache an ambiguous response).
        const origJson = res.json.bind(res);
        (res as NextApiResponse).json = (body: unknown) => {
          try {
            if (res.statusCode === 200) {
              void cache.set({ tenantId, parts, value: { status: 200, body } }).catch(() => {});
            }
          } catch { /* fail-open */ }
          return origJson(body);
        };
        res.setHeader('x-response-cache', 'miss');
        return await handler(req, res);
      } catch {
        return handler(req, res); // middleware failure must never break the route
      }
    };
}

/**
 * W4-7 helper — standardized SWR headers for idempotent, non-sensitive GETs.
 * Private by default (per-user CDN sharing is never assumed).
 */
export function setSwrCacheHeaders(
  res: NextApiResponse,
  opts: { maxAgeSeconds: number; staleWhileRevalidateSeconds?: number; visibility?: 'private' | 'public' },
): void {
  try {
    const swr = opts.staleWhileRevalidateSeconds ?? opts.maxAgeSeconds * 5;
    res.setHeader(
      'Cache-Control',
      `${opts.visibility ?? 'private'}, max-age=${opts.maxAgeSeconds}, stale-while-revalidate=${swr}`,
    );
  } catch { /* fail-safe */ }
}
