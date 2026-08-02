import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/apiFetch';
import { ApiFetchError } from '@/lib/swr/swrClient';

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
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<LinkedInSyncResult | null>(null);

  // OPT-005 Phase 2B: overview is an SWR entry; enabled=false → null key.
  // `loading` maps to isValidating — the previous implementation flipped
  // loading on refresh() too. Public signature unchanged.
  const key =
    enabled && organizationId?.trim()
      ? `/api/engagement/linkedin/overview?${new URLSearchParams({
          organization_id: organizationId,
          organizationId,
        }).toString()}`
      : null;

  const { data, error: swrError, isValidating, mutate } = useSWR<{ overview?: LinkedInEngagementOverview | null }>(key);

  const overview: LinkedInEngagementOverview | null =
    !key || swrError ? null : (data?.overview ?? null);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const fetchErrorMessage = swrError
    ? swrError instanceof ApiFetchError && typeof (swrError.info as { error?: unknown })?.error === 'string'
      ? swrError.message
      : 'Failed to load LinkedIn engagement workspace'
    : null;

  const syncNow = useCallback(async () => {
    if (!enabled || !organizationId?.trim()) {
      return null;
    }

    setSyncing(true);
    setSyncError(null);

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
      // Same post-sync reload as the old `await refresh()` — a revalidation
      // of the shared overview entry.
      await mutate();
      return result;
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'LinkedIn sync failed');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [enabled, organizationId, mutate]);

  return {
    overview,
    loading: isValidating,
    syncing,
    error: syncError ?? fetchErrorMessage,
    lastSyncResult,
    refresh,
    syncNow,
  };
}
