/**
 * Hook for fetching per-platform inbox counts.
 *
 * OPT-005 Phase 1: backed by SWR — all mounted consumers share ONE cache
 * entry per org, and `refresh` is SWR `mutate`, which bypasses the cache,
 * revalidates once and pushes the fresh counts to every subscriber (the
 * mutation-propagation contract that made this route ineligible for HTTP
 * caching in OPT-002). Public signature unchanged.
 *
 * Parity with the previous hand-rolled hook (risk review §9):
 *  - error  → counts blank to {} (consumers assume reset on failure)
 *  - loading → isValidating (refresh flips it, as before)
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';

export type PlatformCount = {
  thread_count: number;
  unread_count: number;
  max_priority_tier: 'high' | 'medium' | 'low';
};

export type PlatformCounts = Record<string, PlatformCount>;

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (unchanged)

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiFetchError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function usePlatformCounts(
  organizationId: string
): { counts: PlatformCounts; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const key = organizationId?.trim()
    ? `/api/engagement/platform-counts?${new URLSearchParams({
        organization_id: organizationId,
        organizationId: organizationId,
      }).toString()}`
    : null;

  const { data, error, isValidating, mutate } = useSWR<{ counts?: PlatformCounts }>(key, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    counts: error ? {} : (data?.counts ?? {}),
    loading: isValidating,
    error: error ? errorMessage(error, 'Failed to fetch platform counts') : null,
    refresh,
  };
}
