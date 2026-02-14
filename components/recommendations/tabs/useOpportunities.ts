import { useState, useCallback } from 'react';
import type { OpportunityWithPayload } from './types';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export function useOpportunities(
  companyId: string | null,
  type: string,
  fetchWithAuth: FetchWithAuth,
  options?: { getRegions?: () => string[] | null | undefined }
) {
  const [opportunities, setOpportunities] = useState<OpportunityWithPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasRun, setHasRun] = useState(false);

  const runEngine = useCallback(async () => {
    if (!companyId) return;
    setHasRun(true);
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
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load opportunities');
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, type, fetchWithAuth]);

  const refetchGetOnly = useCallback(async () => {
    if (!companyId) return;
    setHasRun(true);
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
      setOpportunities(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load opportunities');
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, type, fetchWithAuth]);

  return { opportunities, loading, error, runEngine, hasRun, refetch: runEngine, refetchGetOnly };
}
