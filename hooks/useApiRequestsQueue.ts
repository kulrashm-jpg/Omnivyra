/**
 * useApiRequestsQueue: the ONE client data layer for "Request an API" and the approval
 * queue (UI step 7b, 2026-11-13). /external-apis (company mode) is its home; the old
 * copy in useSocialPlatforms is removed and that page links here instead.
 *
 * - Reads through the shared SWR cache (one GET per key across subscribers).
 * - Approve/reject use the ONLY route that serves them:
 *   PUT /api/external-apis/requests/{id} (pages/api/external-apis/requests/[id].ts).
 *   The previous /social-platforms copy sent PATCH /api/external-apis/requests, which
 *   that route answers with 405, so approve/reject never worked there.
 * - A successful status change is written through the cache (revalidate:false: the
 *   server was just told), so no requests GET follows. An approval also calls
 *   `onApproved`, because an approved request becomes an API in the list.
 * - Authorization stays server-side: companyId is only a query parameter, and [id].ts
 *   decides who may approve (MANAGE_EXTERNAL_APIS, tenant-scoped). This hook gates
 *   nothing on its own.
 */
import { useCallback } from 'react';
import useSWR from 'swr';
import { apiFetch } from '../lib/apiFetch';

export type ApiRequestRow = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  purpose?: string | null;
  category?: string | null;
  rejection_reason?: string | null;
  [key: string]: unknown;
};

export type ApiRequestStatusChange = 'approved' | 'rejected';

export type ApiRequestResult = { ok: true } | { ok: false; error: string };

/** The SWR key (and GET URL) for a company's request list; null = don't fetch. */
export function apiRequestsKey(companyId: string | null | undefined): string | null {
  return companyId ? `/api/external-apis/requests?companyId=${encodeURIComponent(companyId)}` : null;
}

/** The single approve/reject URL: the [id] route, the only one that serves PUT. */
export function apiRequestStatusUrl(id: string, companyId: string): string {
  return `/api/external-apis/requests/${encodeURIComponent(id)}?companyId=${encodeURIComponent(companyId)}`;
}

export function useApiRequestsQueue(
  companyId: string | null | undefined,
  options: { onApproved?: () => void | Promise<void> } = {},
) {
  const key = apiRequestsKey(companyId);
  const { data, isLoading, mutate } = useSWR<{ requests?: ApiRequestRow[] }>(key);
  const requests: ApiRequestRow[] = data?.requests ?? [];
  const { onApproved } = options;

  const reload = useCallback(async () => {
    if (!key) return;
    await mutate();
  }, [key, mutate]);

  const updateStatus = useCallback(
    async (id: string, status: ApiRequestStatusChange, rejectionReason?: string): Promise<ApiRequestResult> => {
      if (!companyId) return { ok: false, error: 'Select a company first.' };
      const rejection_reason = status === 'rejected' ? (rejectionReason ?? '') : undefined;
      try {
        const r = await apiFetch(apiRequestStatusUrl(id, companyId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, rejection_reason }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          return { ok: false, error: (e as { error?: string }).error || 'Failed to update request' };
        }
        await mutate(
          (current) => ({
            requests: (current?.requests ?? requests).map((req) =>
              req.id === id ? { ...req, status, ...(status === 'rejected' ? { rejection_reason } : {}) } : req,
            ),
          }),
          { revalidate: false },
        );
        if (status === 'approved') await onApproved?.();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Failed to update request' };
      }
    },
    [companyId, mutate, requests, onApproved],
  );

  return { requests, isLoading, reload, updateStatus };
}
