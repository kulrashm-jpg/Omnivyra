import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

export type LinkedInEngagementOverview = {
  platform: 'linkedin';
  connected: boolean;
  activeAccountCount: number;
  publishedPosts: number;
  syncCandidates: number;
  rawComments: number;
  inboxThreads: number;
  inboxMessages: number;
  dmThreads: number;
  dmMessages: number;
  latestPublishedAt: string | null;
  latestInboxActivityAt: string | null;
  blockers: string[];
  coverage: {
    inboxScope: 'published-post-comments';
    backendReplyMode: 'partial';
    browserFallbackSupported: true;
  };
};

export type LinkedInSyncResult = {
  platform: 'linkedin';
  success: boolean;
  processedPosts: number;
  ingestedComments: number;
  failedPosts: number;
  latestPublishedAt: string | null;
  threadsAfterSync: number;
  messagesAfterSync: number;
  syncedAt: string;
};

export function useLinkedInEngagementWorkspace(organizationId: string, enabled = true) {
  const [overview, setOverview] = useState<LinkedInEngagementOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<LinkedInSyncResult | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !organizationId?.trim()) {
      setOverview(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        organization_id: organizationId,
        organizationId,
      });
      const response = await apiFetch(`/api/engagement/linkedin/overview?${params.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || 'Failed to load LinkedIn engagement workspace');
      }
      setOverview(body.overview ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LinkedIn engagement workspace');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncNow = useCallback(async () => {
    if (!enabled || !organizationId?.trim()) {
      return null;
    }

    setSyncing(true);
    setError(null);

    try {
      const response = await apiFetch('/api/engagement/linkedin/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organization_id: organizationId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) {
        throw new Error(body.error || body.message || 'LinkedIn sync failed');
      }

      const result = (body.result ?? null) as LinkedInSyncResult | null;
      setLastSyncResult(result);
      await refresh();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LinkedIn sync failed');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [enabled, organizationId, refresh]);

  return {
    overview,
    loading,
    syncing,
    error,
    lastSyncResult,
    refresh,
    syncNow,
  };
}
