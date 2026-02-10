import { useEffect, useState, useCallback } from 'react';
import type { OpportunityWithPayload } from './types';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export function useOpportunities(
  companyId: string | null,
  type: string,
  fetchWithAuth: FetchWithAuth,
  options?: { getRegions?: () => string[] | null | undefined }
) {
  const [opportunities, setOpportunities] = useState<OpportunityWithPayload[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(
        `/api/opportunities?companyId=${encodeURIComponent(companyId)}&type=${encodeURIComponent(type)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to load opportunities');
      }
      const data = await res.json();
      const list = (Array.isArray(data?.opportunities) ? data.opportunities : []) as OpportunityWithPayload[];
      const count = typeof data?.activeCount === 'number' ? data.activeCount : 0;
      setOpportunities(list);
      setActiveCount(count);
      if (count < 10) {
        const regions = options?.getRegions?.();
        const regionsList = Array.isArray(regions) && regions.length ? regions : undefined;
        const postRes = await fetchWithAuth('/api/opportunities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, type, ...(regionsList ? { regions: regionsList } : {}) }),
        });
        if (postRes.ok) {
          const refetchRes = await fetchWithAuth(
            `/api/opportunities?companyId=${encodeURIComponent(companyId)}&type=${encodeURIComponent(type)}`
          );
          if (refetchRes.ok) {
            const refetchData = await refetchRes.json();
            setOpportunities((Array.isArray(refetchData?.opportunities) ? refetchData.opportunities : []) as OpportunityWithPayload[]);
            setActiveCount(typeof refetchData?.activeCount === 'number' ? refetchData.activeCount : 0);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load opportunities');
      setOpportunities([]);
      setActiveCount(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, type, fetchWithAuth]);

  useEffect(() => {
    if (!companyId || !type) return;
    refetch();
  }, [companyId, type, refetch]);

  return { opportunities, activeCount, loading, error, refetch };
}
