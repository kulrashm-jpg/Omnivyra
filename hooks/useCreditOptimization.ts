/**
 * useCreditOptimization — fetches the read-only Consumption Optimization report
 * (automations, opportunities, drivers, runway, upgrade advice, scenarios).
 *
 * Explicit status discriminator (mirrors useCreditAdvisor): `report` is
 * authoritative only when status === 'ready'.
 *
 * OPT-005 Phase 2A: SWR facade — shared cache entry per (org, days); global
 * apiFetch fetcher; `refresh` is SWR mutate. Public signature unchanged.
 */

import { useCallback } from 'react';
import useSWR from 'swr';
import { ApiFetchError } from '@/lib/swr/swrClient';
import type { ConsumptionOptimizationReport } from '@/backend/services/creditAdvisor/creditAdvisorTypes';

export type OptimizationStatus = 'loading' | 'ready' | 'error';

export interface CreditOptimizationState {
  status: OptimizationStatus;
  report: ConsumptionOptimizationReport | null;
  error: string | null;
  refresh: () => void;
}

export function useCreditOptimization(
  orgId: string | null | undefined,
  days = 30,
): CreditOptimizationState {
  const key = orgId ? `/api/credits/optimization?org_id=${orgId}&days=${days}` : null;
  const { data, error: swrError, mutate } = useSWR<ConsumptionOptimizationReport>(key);

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  const report = data ?? null;
  const status: OptimizationStatus =
    !orgId || (!data && !swrError) ? 'loading' : swrError ? 'error' : 'ready';

  const error =
    status === 'error'
      ? swrError instanceof ApiFetchError
        ? `Request failed (${swrError.status})`
        : (swrError as Error)?.message ?? 'Failed to load optimization report'
      : null;

  return { status, report, error, refresh };
}
