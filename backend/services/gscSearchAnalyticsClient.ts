/**
 * Search Console Search Analytics client — the ONE paginated, retrying reader of
 * `searchAnalytics/query`, shared by the tenant pipeline (gscIngestionService) and the platform
 * website pipeline (omnivyraGscAnalyticsService). Extracted from the latter so the two cannot drift.
 *
 *   - Pagination: `startRow` in steps of `rowLimit` (Google's maximum is 25,000) until a short page,
 *     capped at `maxPages`; hitting the cap is reported as a partial failure, never silent truncation.
 *   - Retries: 408 / 429 / 5xx / network errors / timeouts, exponential backoff, `Retry-After` honoured
 *     (capped). Other statuses (401 / 403 / 404 / 400) fail at once — they will not fix themselves.
 *   - Errors carry the HTTP status and a classification, and only Google's own error message (never
 *     the access token, never the raw body).
 */
export const GSC_ROW_LIMIT = 25_000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export type SearchAnalyticsRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

export type GscErrorKind = 'unauthorized' | 'permission_denied' | 'not_found' | 'quota' | 'bad_request' | 'server' | 'network';

export class GscApiError extends Error {
  constructor(readonly kind: GscErrorKind, readonly httpStatus: number | null, message: string) {
    super(message);
    this.name = 'GscApiError';
  }
}

export function classifyGscStatus(status: number | null): GscErrorKind {
  if (status == null) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'quota';
  if (status === 400) return 'bad_request';
  return 'server';
}

/** Google's `error.message` (or status text), trimmed — never the raw body. */
async function googleMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.error_description ?? parsed?.error;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 200);
  } catch { /* not JSON */ }
  return response.statusText || 'no message';
}

export type SearchAnalyticsRequest = {
  accessToken: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
};

export type SearchAnalyticsDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  rowLimit?: number;
  maxPages?: number;
  /** Called after each page (logging hook). */
  onPage?: (info: { startRow: number; rows: number; retries: number }) => void;
};

export async function requestSearchAnalyticsPage(
  params: SearchAnalyticsRequest & { startRow: number },
  deps: SearchAnalyticsDeps = {},
): Promise<{ rows: SearchAnalyticsRow[]; retries: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? 3;
  let retries = 0;
  for (let attempt = 0; ; attempt++) {
    let error: GscApiError;
    let retryAfterMs: number | null = null;
    try {
      const response = await fetchImpl(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(params.propertyUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startDate: params.startDate,
            endDate: params.endDate,
            dimensions: params.dimensions,
            rowLimit: deps.rowLimit ?? GSC_ROW_LIMIT,
            startRow: params.startRow,
          }),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
        },
      );
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        return { rows: Array.isArray(payload?.rows) ? payload.rows : [], retries };
      }
      const ra = Number(response.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 60_000);
      error = new GscApiError(classifyGscStatus(response.status), response.status, `Search Console API failed (${response.status}): ${await googleMessage(response)}`);
      if (!RETRYABLE.has(response.status)) throw error;
    } catch (caught) {
      if (caught instanceof GscApiError && !RETRYABLE.has(caught.httpStatus ?? 0)) throw caught;
      error = caught instanceof GscApiError
        ? caught
        : new GscApiError('network', null, `Search Console API request failed: ${caught instanceof Error ? caught.message.slice(0, 160) : 'unknown error'}`);
    }
    if (attempt >= maxRetries) throw error;
    retries += 1;
    await sleep(retryAfterMs ?? 500 * 2 ** attempt);
  }
}

/**
 * Every row for the request, page by page. A failure after some pages returns the rows read so far
 * with `partialFailure` set (callers decide whether partial data is acceptable).
 */
export async function fetchAllSearchAnalyticsRows(
  params: SearchAnalyticsRequest,
  deps: SearchAnalyticsDeps = {},
): Promise<{ rows: SearchAnalyticsRow[]; retries: number; pages: number; partialFailure: string | null; error: GscApiError | null }> {
  const rowLimit = deps.rowLimit ?? GSC_ROW_LIMIT;
  const maxPages = deps.maxPages ?? 40;
  const rows: SearchAnalyticsRow[] = [];
  let retries = 0;
  for (let page = 0; page < maxPages; page++) {
    const startRow = page * rowLimit;
    try {
      const result = await requestSearchAnalyticsPage({ ...params, startRow }, deps);
      rows.push(...result.rows);
      retries += result.retries;
      deps.onPage?.({ startRow, rows: result.rows.length, retries: result.retries });
      if (result.rows.length < rowLimit) return { rows, retries, pages: page + 1, partialFailure: null, error: null };
    } catch (caught) {
      const error = caught instanceof GscApiError ? caught : new GscApiError('network', null, String(caught).slice(0, 200));
      return { rows, retries, pages: page, partialFailure: error.message, error };
    }
  }
  const error = new GscApiError('server', null, `Search Console returned more than ${maxPages * rowLimit} rows; stopped at the page cap.`);
  return { rows, retries, pages: maxPages, partialFailure: error.message, error };
}
