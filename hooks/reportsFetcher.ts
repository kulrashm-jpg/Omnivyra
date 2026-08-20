/**
 * Command Center — one /api/reports request per company per concurrent moment.
 *
 * Two consumers request this endpoint on the same load with byte-identical
 * URLs: the SWR report-card poll and the readiness wave. Production capture
 * confirmed both, overlapping for ~3.9s. They are NOT merged into one
 * consumer — their lifecycles differ and both differences are load-bearing:
 * the SWR consumer is a long-lived subscription that polls every 5s while a
 * report is generating, and the readiness consumer is one-shot inside a
 * seventeen-request Promise.all whose value is usable only once all of them
 * settle. Feeding either from the other would trade a duplicate request for
 * stale report state or for a wave that re-runs on every poll.
 *
 * They share the in-flight request instead, through the repository's existing
 * singleFlight helper. This is deliberately NOT a cache: singleFlight releases
 * its slot the moment the request settles, so the next poll issues a fresh
 * request. Only genuinely concurrent work is collapsed.
 */
import { apiFetch } from '../lib/apiFetch';
import { singleFlight } from '../lib/auth/singleFlightRefresh';

/**
 * The parsed outcome, never the Response — a body can be read once, so handing
 * the same Response to both callers would break the second. `status` is carried
 * because the SWR consumer's retry policy is status-driven (4xx never retries,
 * 5xx retries capped); collapsing failures to a bare null would silently hand
 * it the readiness consumer's policy instead.
 */
export type ReportsFetchResult =
  | { outcome: 'ok'; status: number; json: unknown }
  | { outcome: 'non_ok'; status: number }
  | { outcome: 'error'; error: unknown };

export const reportsUrl = (companyId: string): string =>
  `/api/reports?company_id=${companyId}`;

/**
 * Company AND cache mode. The company term keeps tenants apart. The cache term
 * matters because the SWR consumer sets `cache: 'no-store'` while a report is
 * generating, deliberately bypassing the endpoint's 30s private cache — if a
 * no-store request could join a cache-eligible flight, that guarantee would be
 * silently lost and a generating report could render stale.
 */
export const reportsKey = (companyId: string, noStore: boolean): string =>
  `reports:${companyId}:${noStore ? 'nostore' : 'cache'}`;

export function fetchReportsOnce(
  companyId: string,
  options: { noStore?: boolean; url?: string } = {},
  fetchImpl?: typeof apiFetch,
): Promise<ReportsFetchResult> {
  const noStore = options.noStore === true;
  const doFetch = fetchImpl ?? apiFetch;
  const url = options.url ?? reportsUrl(companyId);

  return singleFlight<ReportsFetchResult>(reportsKey(companyId, noStore), async () => {
    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(noStore ? { cache: 'no-store' as RequestCache } : {}),
      });
      if (!response.ok) return { outcome: 'non_ok', status: response.status };
      return { outcome: 'ok', status: response.status, json: await response.json() };
    } catch (error) {
      return { outcome: 'error', error };
    }
  });
}
