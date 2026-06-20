/**
 * useCreditOptimization — fetches the read-only Consumption Optimization report
 * (automations, opportunities, drivers, runway, upgrade advice, scenarios).
 *
 * Explicit status discriminator (mirrors useCreditAdvisor): `report` is
 * authoritative only when status === 'ready'.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
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
  const [report, setReport] = useState<ConsumptionOptimizationReport | null>(null);
  const [status, setStatus] = useState<OptimizationStatus>('loading');
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
        const res = await apiFetch(`/api/credits/optimization?org_id=${orgId}&days=${days}`);
        if (!res.ok) {
          if (cancelled) return;
          setStatus('error');
          setError(`Request failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as ConsumptionOptimizationReport;
        if (cancelled) return;
        setReport(data);
        setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        setStatus('error');
        setError(err?.message ?? 'Failed to load optimization report');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, days, nonce]);

  return { status, report, error, refresh };
}
