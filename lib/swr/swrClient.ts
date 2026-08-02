/**
 * OPT-005 Phase 1 — repository SWR client.
 *
 * One fetcher, one retry policy, one purge helper. Constraints (risk review):
 *  - The fetcher goes through apiFetch ONLY: Bearer attach, OPT-004 token
 *    memoization and credentials behavior are inherited, never reimplemented.
 *  - EVERY non-OK response throws (including apiFetch's synthetic 503) so an
 *    error payload can never be cached as data.
 *  - 4xx never retries (auth/authz outcomes don't change by retrying);
 *    5xx retries are capped so dev-HMR synthetic 503s cannot storm.
 */

import type { SWRConfiguration } from 'swr';
import { apiFetch } from '../apiFetch';

export class ApiFetchError extends Error {
  status: number;
  /** Parsed JSON error body when available (routes emit { error: string }). */
  info: unknown;

  constructor(url: string, status: number, info?: unknown) {
    super(
      typeof (info as { error?: unknown })?.error === 'string'
        ? String((info as { error: string }).error)
        : `${url} → ${status}`,
    );
    this.name = 'ApiFetchError';
    this.status = status;
    this.info = info;
  }
}

/** JSON fetcher for SWR. Throws ApiFetchError on any non-OK response. */
export async function swrJsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    let info: unknown;
    try {
      info = await res.json();
    } catch {
      info = undefined;
    }
    throw new ApiFetchError(url, res.status, info);
  }
  return res.json() as Promise<T>;
}

export const MAX_5XX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2_000;

/** Never retry 4xx; cap 5xx (and synthetic-503) retries with backoff. */
export const swrOnErrorRetry: NonNullable<SWRConfiguration['onErrorRetry']> = (
  error,
  _key,
  _config,
  revalidate,
  { retryCount },
) => {
  const status = error instanceof ApiFetchError ? error.status : 0;
  if (status >= 400 && status < 500) return;
  if (retryCount >= MAX_5XX_RETRIES) return;
  setTimeout(() => {
    void revalidate({ retryCount });
  }, RETRY_BASE_DELAY_MS * 2 ** retryCount);
};

/**
 * Global defaults for the app-level <SWRConfig>. Focus revalidation stays ON
 * globally (SWR's focus throttle bounds it); keys needing a single
 * revalidation owner (NotificationBell) opt out per-hook.
 */
export const SWR_GLOBAL_CONFIG: SWRConfiguration = {
  fetcher: swrJsonFetcher,
  dedupingInterval: 15_000,
  revalidateOnFocus: true,
  onErrorRetry: swrOnErrorRetry,
};

/**
 * Full cache purge (invalidation matrix: SIGNED_OUT / principal change).
 * revalidate:false — protected keys must not refetch as the old principal;
 * surviving mounts revalidate naturally on their next trigger.
 */
export function clearSwrCache(
  mutate: (
    matcher: (key: unknown) => boolean,
    data?: undefined,
    opts?: { revalidate?: boolean },
  ) => Promise<unknown>,
): Promise<unknown> {
  return mutate(() => true, undefined, { revalidate: false });
}
