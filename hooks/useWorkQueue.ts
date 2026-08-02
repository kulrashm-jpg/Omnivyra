/**
 * Hook for fetching daily work queue (actionable threads per platform).
 *
 * OPT-005 Phase 1: backed by SWR — shared cache entry per org; `refresh`
 * is SWR `mutate` (cache-bypassing revalidation pushed to all subscribers).
 * Public signature unchanged.
 *
 * Parity with the previous hand-rolled hook (risk review §9):
 *  - error  → work queue blanks to the empty shape
 *  - loading → isValidating (refresh flips it, as before)
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';

export type PlatformWorkItem = {
  platform: string;
  actionable_threads: number;
  high_priority_threads: number;
  unread_messages: number;
};

export type WorkQueue = {
  total_actionable_threads: number;
  platforms: PlatformWorkItem[];
};

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (unchanged)

const EMPTY_QUEUE: WorkQueue = { total_actionable_threads: 0, platforms: [] };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiFetchError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function useWorkQueue(
  organizationId: string
): { workQueue: WorkQueue; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const key = organizationId?.trim()
    ? `/api/engagement/work-queue?${new URLSearchParams({
        organization_id: organizationId,
        organizationId: organizationId,
      }).toString()}`
    : null;

  const { data, error, isValidating, mutate } = useSWR<{
    total_actionable_threads?: number;
    platforms?: PlatformWorkItem[];
  }>(key, { refreshInterval: REFRESH_INTERVAL_MS });

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const workQueue: WorkQueue =
    error || !data
      ? EMPTY_QUEUE
      : {
          total_actionable_threads: data.total_actionable_threads ?? 0,
          platforms: Array.isArray(data.platforms) ? data.platforms : [],
        };

  return {
    workQueue,
    loading: isValidating,
    error: error ? errorMessage(error, 'Failed to fetch work queue') : null,
    refresh,
  };
}
