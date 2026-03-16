/**
 * Hook for fetching per-platform inbox counts.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export type PlatformCount = {
  thread_count: number;
  unread_count: number;
  max_priority_tier: 'high' | 'medium' | 'low';
};

export type PlatformCounts = Record<string, PlatformCount>;

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function usePlatformCounts(
  organizationId: string
): { counts: PlatformCounts; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [counts, setCounts] = useState<PlatformCounts>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!organizationId?.trim()) {
      setCounts({});
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      organization_id: organizationId,
      organizationId: organizationId,
    });

    try {
      const res = await apiFetch(`/api/engagement/platform-counts?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to fetch platform counts');
      }
      if (body.error) throw new Error(body.error);
      setCounts(body.counts ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch platform counts');
      setCounts({});
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    if (!organizationId?.trim()) return;
    const interval = setInterval(fetchCounts, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, fetchCounts]);

  return { counts, loading, error, refresh: fetchCounts };
}
