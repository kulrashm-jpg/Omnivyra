/**
 * Centralized polling hook for engine jobs (Trend, Market Pulse, Active Leads).
 * Polls every 3 seconds, stops on terminal state, prevents 304 with cache: 'no-store'.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const TERMINAL_STATUSES = ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'];
const POLL_INTERVAL_MS = 3000;

export type UseEngineJobPollingOptions = {
  enabled?: boolean;
  pollInterval?: number;
};

export function useEngineJobPolling<T = Record<string, unknown>>(
  jobId: string | null,
  fetchUrl: string | null,
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>,
  options: UseEngineJobPollingOptions = {}
): { job: T | null; loading: boolean; error: string | null } {
  const { enabled = true, pollInterval = POLL_INTERVAL_MS } = options;
  const [job, setJob] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!jobId || !fetchUrl || !fetchWithAuth) return;
    try {
      const res = await fetchWithAuth(fetchUrl, { cache: 'no-store' as RequestCache });
      if (res.status === 404) {
        setError('Job not found');
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      if (!res.ok) {
        setError(`Request failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as T;
      setJob(data);
      const status = (data as { status?: string })?.status;
      if (status && TERMINAL_STATUSES.includes(status)) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poll failed');
    }
  }, [jobId, fetchUrl, fetchWithAuth]);

  useEffect(() => {
    if (!enabled || !jobId || !fetchUrl) {
      setJob(null);
      setLoading(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setLoading(true);
    setError(null);
    poll();

    intervalRef.current = setInterval(poll, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setLoading(false);
    };
  }, [enabled, jobId, fetchUrl, pollInterval, poll]);

  useEffect(() => {
    if (job && TERMINAL_STATUSES.includes((job as { status?: string })?.status ?? '')) {
      setLoading(false);
    }
  }, [job]);

  return { job, loading, error };
}
