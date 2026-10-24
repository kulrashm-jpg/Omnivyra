/**
 * Client helpers for the report view page (pages/reports/view/[reportId].tsx).
 *
 * Kept out of the page so the behaviour is unit-testable:
 *
 * 1. `fetchSnapshotHtml` — the snapshot is shown as server-rendered HTML fetched
 *    in a SECOND request after the JSON payload. One dropped body (2026-10-24:
 *    `net::ERR_CONNECTION_RESET 200 (OK)` while the server logged a 200 after
 *    ~10.6s) used to leave the page on "Snapshot HTML unavailable" with no way
 *    back but a full reload. A transient transport failure, or a 5xx, is now
 *    retried; a 4xx (auth, not found) is not, because retrying cannot fix it.
 *
 * 2. `resolveRegenerateOutcome` — the Regenerate button on this page did not
 *    read the `REPORT_IN_PROGRESS` 409's `reportId` (PR #324 fixed only the
 *    snapshot form page), so a second click while a regenerate was running
 *    dead-ended on "Report already in progress". It now opens that report,
 *    whose view polls and shows the generating state.
 */

export type SnapshotHtml = { styles: string; markup: string };

export type SnapshotHtmlResult =
  | { ok: true; html: SnapshotHtml }
  | { ok: false; reason: 'http' | 'network'; status: number | null };

type Fetcher = (url: string) => Promise<Response>;

/** Split the exported document into the parts the page injects. */
export function extractSnapshotHtml(rawHtml: string): SnapshotHtml {
  const styleMatch = rawHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const pageMatch = rawHtml.match(/<div class="report-page">([\s\S]*?)<\/div>\s*<\/body>/i);
  return { styles: styleMatch?.[1] ?? '', markup: pageMatch?.[1] ?? rawHtml };
}

function isRetryableStatus(status: number): boolean {
  // apiFetch turns a thrown fetch() into a synthetic 503, so 5xx covers both.
  return status >= 500 || status === 408 || status === 429;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchSnapshotHtml(
  fetcher: Fetcher,
  url: string,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    isCancelled?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SnapshotHtmlResult> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1500;
  const sleep = options.sleep ?? defaultSleep;
  let last: SnapshotHtmlResult = { ok: false, reason: 'network', status: null };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.isCancelled?.()) return last;
    try {
      const res = await fetcher(url);
      if (res.ok) {
        // A body that breaks mid-transfer (connection reset after the 200
        // headers) rejects here, not at fetch() — it must be retried too.
        const raw = await res.text();
        if (raw.trim().length > 0) return { ok: true, html: extractSnapshotHtml(raw) };
        last = { ok: false, reason: 'network', status: res.status };
      } else {
        last = { ok: false, reason: 'http', status: res.status };
        if (!isRetryableStatus(res.status)) return last;
      }
    } catch {
      last = { ok: false, reason: 'network', status: null };
    }
    if (attempt < attempts) await sleep(baseDelayMs * attempt);
  }
  return last;
}

export type RegenerateOutcome =
  | { kind: 'open'; reportId: string }
  | { kind: 'error'; message: string };

/**
 * Decide what the Regenerate button does with the generate response.
 * `currentReportId` is the report on screen: when the in-flight report the
 * 409 names IS this one, navigating would be a no-op, so say so instead.
 */
export function resolveRegenerateOutcome(
  res: { ok: boolean; status: number },
  data: { reportId?: string; error?: string; code?: string } | null | undefined,
  currentReportId: string,
): RegenerateOutcome {
  const body = data ?? {};
  if (res.ok && body.reportId) return { kind: 'open', reportId: body.reportId };
  if (res.status === 409 && body.code === 'REPORT_IN_PROGRESS') {
    if (body.reportId && body.reportId !== currentReportId) {
      return { kind: 'open', reportId: body.reportId };
    }
    return {
      kind: 'error',
      message:
        'A report for this domain is already being generated. It will appear in your reports when it finishes.',
    };
  }
  return { kind: 'error', message: body.error || 'Failed to regenerate report' };
}
