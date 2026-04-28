/**
 * Fetches per-platform health for the Engagement Command Center.
 * Thin wrapper over GET /api/engagement/platform-health. Refetches
 * when organizationId changes and on explicit refresh(). 60-second
 * client-side staleness guard so switching between platform tabs
 * doesn't fire a request every click.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export type EgressStatus = 'ok' | 'unsupported' | 'no_session' | 'unverified' | 'none';
export type IngressStatus = 'active' | 'none';
export type ActionKey = 'reply' | 'like' | 'dm' | 'post';

export type PlatformHealth = {
  platform: string;
  admin_configured: boolean;
  has_live_connection: boolean;
  connected_via: Array<'api' | 'rpa' | 'extension' | 'publish_adapter'>;
  egress: Record<ActionKey, {
    api: EgressStatus;
    rpa: EgressStatus;
    extension: EgressStatus;
    publish_adapter: EgressStatus;
  }>;
  ingress: {
    polling: IngressStatus;
    webhook: IngressStatus;
    extension_events: IngressStatus;
  };
  overall: 'green' | 'orange' | 'red';
  observed_at: string;
};

const STALE_MS = 60 * 1000;

export function useEngagementPlatformHealth(organizationId: string): {
  platforms: PlatformHealth[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  byPlatform: (platform: string) => PlatformHealth | null;
} {
  const [platforms, setPlatforms] = useState<PlatformHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAt = useRef<number>(0);
  const inflight = useRef<Promise<void> | null>(null);

  const fetchHealth = useCallback(
    async (force = false): Promise<void> => {
      if (!organizationId?.trim()) {
        setPlatforms([]);
        setLoading(false);
        setError(null);
        return;
      }
      if (!force && Date.now() - lastFetchedAt.current < STALE_MS) return;
      if (inflight.current) return inflight.current;

      setLoading(true);
      setError(null);
      const run = (async () => {
        try {
          const res = await apiFetch(
            `/api/engagement/platform-health?organization_id=${encodeURIComponent(organizationId)}`,
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(body?.error || body?.message || 'Failed to fetch platform health');
          }
          const list = Array.isArray(body?.platforms) ? body.platforms : [];
          setPlatforms(list as PlatformHealth[]);
          lastFetchedAt.current = Date.now();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch platform health');
        } finally {
          setLoading(false);
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    [organizationId],
  );

  useEffect(() => {
    fetchHealth(true);
  }, [fetchHealth]);

  const byPlatform = useCallback(
    (platform: string) => {
      const key = (platform || '').toLowerCase().trim();
      if (!key || key === 'all') return null;
      const normalized = key === 'x' ? 'twitter' : key;
      return platforms.find((p) => p.platform === normalized) ?? null;
    },
    [platforms],
  );

  return { platforms, loading, error, refresh: () => fetchHealth(true), byPlatform };
}
