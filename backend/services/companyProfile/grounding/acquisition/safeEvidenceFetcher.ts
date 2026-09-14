/**
 * CPG-012 — the production EvidenceFetcher: CPG acquisition over `safeFetch`.
 *
 * `evidenceSource.ts` states that production passes the `safeFetch` seam
 * (HARDEN-005) and tests pass a fixture. Until the Company Profile facts lookup
 * called grounding, only the evaluation harness had such an adapter, and that
 * one must never be reachable from a production path. This is the production
 * one — nothing else.
 *
 * WHAT IT ADDS TO safeFetch
 *   - a per-request timeout and a response-size cap;
 *   - ONE request budget shared by the whole run: a user is waiting on a button,
 *     so once the budget is spent every further request fails immediately. Each
 *     CPG stage already treats a failed fetch as "not retrieved", so the run
 *     degrades to what it could read in time instead of the platform killing
 *     the function;
 *   - a declared product User-Agent (SEC fair-access asks for one). It carries
 *     no personal contact and no credential.
 *
 * Host pinning (`allowedHosts`) is passed through: each CPG source pins its own
 * hosts, and safeFetch enforces them together with the SSRF policy.
 */

import { safeFetch, readCapped } from '../../../../../lib/security/safeFetch';
import type { EvidenceFetcher } from './evidenceSource';

export const GROUNDING_USER_AGENT = 'Omnivyra-CompanyProfile/1.0 (+https://www.omnivyra.com)';

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const HARD_MAX_BYTES = 16 * 1024 * 1024;
/** Below this much remaining budget a request cannot usefully complete. */
const MIN_REQUEST_MS = 500;

export interface SafeEvidenceFetcherOptions {
  /** Total time every request of this run may take together. */
  budgetMs: number;
  requestTimeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export function createSafeEvidenceFetcher(opts: SafeEvidenceFetcherOptions): EvidenceFetcher {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.budgetMs;
  const perRequest = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return async (url, fetchOpts) => {
    const remaining = deadline - now();
    if (remaining < MIN_REQUEST_MS) return null;
    const maxBytes = Math.min(fetchOpts.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    try {
      const res = await safeFetch(url, {
        method: 'GET',
        headers: { 'user-agent': GROUNDING_USER_AGENT, accept: 'text/html,application/json,application/vnd.api+json', ...(fetchOpts.headers ?? {}) },
      }, { allowedHosts: fetchOpts.allowedHosts, timeoutMs: Math.min(perRequest, remaining), maxBytes, maxRedirects: 3 });
      const text = (await readCapped(res, maxBytes)).toString('utf8');
      return { ok: res.ok, status: res.status, url: res.url || url, text };
    } catch {
      // Blocked host, SSRF refusal, timeout, reset: "not retrieved", never a crash.
      return null;
    }
  };
}
