/**
 * useCreditAdvisor — fetches the read-only Credit Advisor report for an org.
 *
 * Lifecycle via an explicit `status` discriminator (mirrors useCredits): the
 * `report` is authoritative ONLY when status === 'ready'. Never infer state
 * from a null/zero report in another status.
 *
 * OPT-005 Phase 2A: SWR facade — shared cache entry per (org, days); global
 * apiFetch fetcher; `refresh` is SWR mutate. Public signature unchanged.
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';
import type { CreditAdvisorReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

export type AdvisorStatus = 'loading' | 'ready' | 'error' | 'unavailable';

export interface CreditAdvisorState {
  status: AdvisorStatus;
  report: CreditAdvisorReport | null;
  error: string | null;
  refresh: () => void;
}

export function useCreditAdvisor(orgId: string | null | undefined, days = 30): CreditAdvisorState {
  const key = orgId ? `/api/credits/advisor?org_id=${orgId}&days=${days}` : null;
  const { data, error: swrError, mutate } = useSWR<CreditAdvisorReport>(key);

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  const report = data ?? null;
  let status: AdvisorStatus;
  if (!orgId || (!data && !swrError)) status = 'loading';
  else if (swrError) status = 'error';
  else if (data?.overview?.missing) status = 'unavailable';
  else status = 'ready';

  const error =
    status === 'error'
      ? swrError instanceof ApiFetchError
        ? `Request failed (${swrError.status})`
        : (swrError as Error)?.message ?? 'Failed to load credit advisor'
      : null;

  return { status, report, error, refresh };
}
