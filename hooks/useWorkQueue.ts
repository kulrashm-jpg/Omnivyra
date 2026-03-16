/**
 * Hook for fetching daily work queue (actionable threads per platform).
 * Polls every 60 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

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

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useWorkQueue(
  organizationId: string
): { workQueue: WorkQueue; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [workQueue, setWorkQueue] = useState<WorkQueue>({
    total_actionable_threads: 0,
    platforms: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    if (!organizationId?.trim()) {
      setWorkQueue({ total_actionable_threads: 0, platforms: [] });
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
      const res = await apiFetch(`/api/engagement/work-queue?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || 'Failed to fetch work queue');
      }
      if (body.error) throw new Error(body.error);
      setWorkQueue({
        total_actionable_threads: body.total_actionable_threads ?? 0,
        platforms: Array.isArray(body.platforms) ? body.platforms : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch work queue');
      setWorkQueue({ total_actionable_threads: 0, platforms: [] });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    if (!organizationId?.trim()) return;
    const interval = setInterval(fetchQueue, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [organizationId, fetchQueue]);

  return { workQueue, loading, error, refresh: fetchQueue };
}
