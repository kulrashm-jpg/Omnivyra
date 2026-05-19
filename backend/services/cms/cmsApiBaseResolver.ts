/**
 * Canonical CMS API-base resolution layer.
 *
 * Promotes discovered REST/API metadata into the authoritative operational
 * base for ALL provider operations (publish, update, media, taxonomy, sync,
 * reconciliation). Removes the hardcoded `${siteUrl}/wp-json/wp/v2` assumption
 * that broke /wp, subdirectory, reverse-proxy and custom-root installs.
 *
 * Resolution order (per spec C):
 *   1. persisted canonical base   (website_connections.non_secret_config.api_discovery)
 *   2. persisted detected root    → derive base
 *   3. runtime discovery          (detectProviderApiRoots) + persist
 *   4. legacy fallback            (`${siteUrl}/wp-json/wp/v2` for WordPress)
 *
 * Provider-agnostic: persistence keys carry no WordPress naming. The fallback
 * builder is the only provider-specific bit and is centralised here.
 *
 * Queue/cache safety: an in-process TTL cache + a per-connection rediscovery
 * cooldown stop queue replays / retries from hammering discovery or the DB.
 */
import { getWebsiteConnection, updateWebsiteConnection } from '../websiteService';
import {
  deriveApiBase,
  detectProviderApiRoots,
  getProviderCapabilities,
  type CmsProviderId,
} from './cmsEnvironmentFramework';

export type ApiBaseSource =
  | 'persisted'
  | 'detected_config'
  | 'runtime_discovery'
  | 'legacy_fallback';

export interface ResolvedApiBase {
  apiBase: string;
  detectedApiRoot: string | null;
  source: ApiBaseSource;
  /** true when running on the legacy fallback (no validated discovery). */
  degraded: boolean;
  diagnostics: Record<string, unknown>;
}

export interface PersistedApiDiscovery {
  canonical_api_base?: string;
  detected_api_root?: string | null;
  api_discovery_metadata?: Record<string, unknown>;
  api_discovery_last_validated_at?: string;
}

const RESOLVE_TTL_MS = 5 * 60_000; // 5 min — queue jobs reuse within a burst
const REDISCOVER_COOLDOWN_MS = 60_000; // min gap between forced rediscoveries
const REVALIDATE_AFTER_MS = 6 * 60 * 60_000; // re-persist timestamp every 6h

const resolveCache = new Map<string, { value: ResolvedApiBase; ts: number }>();
const rediscoverAt = new Map<string, number>();

function log(event: string, detail: Record<string, unknown>): void {
  // Operationally logged (spec F). Structured, greppable, low-noise.
  console.warn(`[cms.apiBase] ${event} ${JSON.stringify(detail)}`);
}

function normalizeSiteUrl(siteUrl: string): string {
  return String(siteUrl || '').replace(/\/+$/, '');
}

/** The only provider-specific knowledge left: the legacy default base. */
export function legacyFallbackBase(provider: string, siteUrl: string): string {
  const base = normalizeSiteUrl(siteUrl);
  if (provider === 'wordpress') return `${base}/wp-json/wp/v2`;
  return base;
}

function readPersisted(
  connectionNonSecret: Record<string, unknown> | null | undefined,
): PersistedApiDiscovery | null {
  const raw = (connectionNonSecret ?? {}) as Record<string, unknown>;
  const block = raw.api_discovery;
  if (block && typeof block === 'object') return block as PersistedApiDiscovery;
  // Backward tolerance: also honour flat keys if ever written that way.
  if (typeof raw.canonical_api_base === 'string') {
    return {
      canonical_api_base: raw.canonical_api_base as string,
      detected_api_root: (raw.detected_api_root as string) ?? null,
    };
  }
  return null;
}

/**
 * Persist discovered metadata onto the connection (read-merge-write so we
 * never clobber site_url/username/etc.). Rate-limited: only writes when the
 * canonical base changed or the validation timestamp is stale.
 */
export async function persistCanonicalApiBase(
  connectionId: string,
  data: { apiBase: string; detectedApiRoot: string | null; metadata?: Record<string, unknown> },
): Promise<boolean> {
  try {
    const connection = await getWebsiteConnection(connectionId);
    if (!connection) return false;
    const nonSecret = { ...(connection.non_secret_config ?? {}) } as Record<string, unknown>;
    const prev = readPersisted(nonSecret);
    const nowIso = new Date().toISOString();
    const lastValidated = prev?.api_discovery_last_validated_at
      ? Date.parse(prev.api_discovery_last_validated_at)
      : 0;
    const unchanged =
      prev?.canonical_api_base === data.apiBase &&
      (prev?.detected_api_root ?? null) === data.detectedApiRoot;
    if (unchanged && Date.now() - lastValidated < REVALIDATE_AFTER_MS) {
      return false; // nothing to do — avoids write storms under queue load
    }
    nonSecret.api_discovery = {
      canonical_api_base: data.apiBase,
      detected_api_root: data.detectedApiRoot,
      api_discovery_metadata: { ...(prev?.api_discovery_metadata ?? {}), ...(data.metadata ?? {}) },
      api_discovery_last_validated_at: nowIso,
    } satisfies PersistedApiDiscovery;
    await updateWebsiteConnection(connectionId, {
      non_secret_config: nonSecret as Record<string, unknown>,
    });
    if (!unchanged) {
      log('persisted', { connectionId, apiBase: data.apiBase, detectedApiRoot: data.detectedApiRoot });
    }
    return true;
  } catch (err) {
    log('persist_failed', { connectionId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export interface ResolveApiBaseOptions {
  provider: string;
  siteUrl: string;
  connectionId?: string | null;
  fetchFn: (url: string) => Promise<Response>;
  /** Bypass cache + persisted value, force discovery, persist result. */
  forceRediscover?: boolean;
}

/**
 * Resolve the canonical operational API base. Always returns a usable base
 * (worst case the legacy fallback, flagged `degraded`) — never throws so
 * publish/queue flows stay runtime-safe.
 */
export async function resolveCanonicalApiBase(
  opts: ResolveApiBaseOptions,
): Promise<ResolvedApiBase> {
  const provider = opts.provider;
  const siteUrl = normalizeSiteUrl(opts.siteUrl);
  const connectionId = opts.connectionId || null;
  const cacheKey = connectionId ?? `anon:${provider}:${siteUrl}`;

  if (!opts.forceRediscover) {
    const hit = resolveCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < RESOLVE_TTL_MS) return hit.value;
  }

  const finalize = (value: ResolvedApiBase): ResolvedApiBase => {
    resolveCache.set(cacheKey, { value, ts: Date.now() });
    if (value.degraded) {
      log('degraded', { connectionId, provider, apiBase: value.apiBase, source: value.source });
    }
    return value;
  };

  // (1)/(2) persisted canonical base or detected root (skipped on force).
  if (connectionId && !opts.forceRediscover) {
    const connection = await getWebsiteConnection(connectionId).catch(() => null);
    const persisted = readPersisted(connection?.non_secret_config);
    if (persisted?.canonical_api_base) {
      return finalize({
        apiBase: persisted.canonical_api_base,
        detectedApiRoot: persisted.detected_api_root ?? null,
        source: 'persisted',
        degraded: false,
        diagnostics: { lastValidatedAt: persisted.api_discovery_last_validated_at ?? null },
      });
    }
    if (persisted?.detected_api_root) {
      return finalize({
        apiBase: deriveApiBase(provider as CmsProviderId, persisted.detected_api_root),
        detectedApiRoot: persisted.detected_api_root,
        source: 'detected_config',
        degraded: false,
        diagnostics: {},
      });
    }
  }

  // (3) Runtime discovery — rate-limited when forced (cooldown per connection).
  const caps = getProviderCapabilities(provider);
  if (caps.apiDiscoveryMode === 'rest_root_probe') {
    const lastForced = rediscoverAt.get(cacheKey) ?? 0;
    const cooledDown = Date.now() - lastForced >= REDISCOVER_COOLDOWN_MS;
    if (!opts.forceRediscover || cooledDown) {
      if (opts.forceRediscover) rediscoverAt.set(cacheKey, Date.now());
      const discovery = await detectProviderApiRoots(provider, siteUrl, opts.fetchFn).catch(
        () => null,
      );
      if (discovery?.detectedApiRoot && discovery.apiBase) {
        const resolved: ResolvedApiBase = {
          apiBase: discovery.apiBase,
          detectedApiRoot: discovery.detectedApiRoot,
          source: 'runtime_discovery',
          degraded: false,
          diagnostics: { lastStatus: discovery.lastStatus },
        };
        if (connectionId) {
          await persistCanonicalApiBase(connectionId, {
            apiBase: discovery.apiBase,
            detectedApiRoot: discovery.detectedApiRoot,
            metadata: { discoveredVia: 'runtime', lastStatus: discovery.lastStatus },
          });
        }
        return finalize(resolved);
      }
    }
  }

  // (4) Legacy fallback — degraded, but keeps publishing alive.
  return finalize({
    apiBase: legacyFallbackBase(provider, siteUrl),
    detectedApiRoot: null,
    source: 'legacy_fallback',
    degraded: true,
    diagnostics: { reason: 'discovery_unavailable' },
  });
}

/**
 * Self-healing entrypoint. Called by operational flows when an endpoint 404s
 * (REST root may have moved: install relocated, subdir changed, proxy change).
 * Forces a rate-limited rediscovery, persists the repaired base, and returns
 * the new resolution. Idempotent and safe to call from queue retries.
 */
export async function rediscoverAndRepairApiBase(
  opts: Omit<ResolveApiBaseOptions, 'forceRediscover'>,
): Promise<ResolvedApiBase> {
  const cacheKey = opts.connectionId || `anon:${opts.provider}:${normalizeSiteUrl(opts.siteUrl)}`;
  resolveCache.delete(cacheKey);
  log('self_heal_attempt', { connectionId: opts.connectionId ?? null, provider: opts.provider });
  return resolveCanonicalApiBase({ ...opts, forceRediscover: true });
}

/** Invalidate the cached resolution for one connection (e.g. after re-detect). */
export function invalidateApiBaseCache(connectionId: string | null | undefined): void {
  if (connectionId) resolveCache.delete(connectionId);
}

/** Test-only: clear in-process caches. */
export function __resetApiBaseCaches(): void {
  resolveCache.clear();
  rediscoverAt.clear();
}
