/**
 * useCreditAdvisor — fetches the read-only Credit Advisor report for an org.
 *
 * Lifecycle via an explicit `status` discriminator (mirrors useCredits): the
 * `report` is authoritative ONLY when status === 'ready'. Never infer state
 * from a null/zero report in another status.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { CreditAdvisorReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

export type AdvisorStatus = 'loading' | 'ready' | 'error' | 'unavailable';

export interface CreditAdvisorState {
  status: AdvisorStatus;
  report: CreditAdvisorReport | null;
  error: string | null;
  refresh: () => void;
}

export function useCreditAdvisor(orgId: string | null | undefined, days = 30): CreditAdvisorState {
  const [report, setReport] = useState<CreditAdvisorReport | null>(null);
  const [status, setStatus] = useState<AdvisorStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!orgId) {
      setStatus('loading');
      return;
    }
    let cancelled = false;

    (async () => {
      setStatus('loading');
      setError(null);
      try {
        const res = await apiFetch(`/api/credits/advisor?org_id=${orgId}&days=${days}`);
        if (!res.ok) {
          if (cancelled) return;
          setStatus('error');
          setError(`Request failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as CreditAdvisorReport;
        if (cancelled) return;
        if (data?.overview?.missing) {
          setReport(data);
          setStatus('unavailable');
          return;
        }
        setReport(data);
        setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        setStatus('error');
        setError(err?.message ?? 'Failed to load credit advisor');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, days, nonce]);

  return { status, report, error, refresh };
}
