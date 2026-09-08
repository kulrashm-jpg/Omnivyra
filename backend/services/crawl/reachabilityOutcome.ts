/**
 * D2 — what the crawler actually observed when it asked for a page.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * `fetchHtml` threw on any status outside 200–399, and the crawl loop's catch
 * wrote `http_status: 0` with the error message as free text. So a 404, a 500,
 * a DNS failure, a timeout and an SSRF block all landed in the database as the
 * same row. The status code — the only thing that distinguishes "this page is
 * broken" from "we could not reach the site at all" — was destroyed at the
 * moment of observation.
 *
 * Downstream, `broken_links` counts `(http_status ?? 200) >= 400`. Zero fails
 * that test, so the check was structurally incapable of firing: every report
 * printed "0 pages returned 4xx/5xx" and scored 100, on every site, forever.
 * The same `0` was simultaneously read as not-crawlable by `crawlability`, so
 * two checks disagreed about the same row.
 *
 * ─── THE DISTINCTION THIS MODULE EXISTS TO KEEP ────────────────────────────
 * A page that ANSWERED with 404 is a finding about the page. A request that
 * never got an answer is a finding about the crawl. Collapsing them lets an
 * unreachable site report a clean bill of health, which is the worst possible
 * direction for the error to run.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * Deliberately local to the crawl path, and deliberately NOT a new member of
 * the platform-wide `ScoreState`: this describes one HTTP request's outcome,
 * not a report surface's evidence state. Redirect CHAINS, link-destination
 * probing and the broken-link graph are DG-005 and are not started here.
 */

/** What one HTTP request actually did. */
export type ReachabilityOutcome =
  /** 2xx — the page answered. */
  | 'success'
  /** 3xx surfaced to us (the fetcher follows hops itself; this is the residue). */
  | 'redirect'
  /** 4xx — the page answered, and the answer was "no". */
  | 'client_error'
  /** 5xx — the server answered, and the answer was a failure. */
  | 'server_error'
  /** DNS, connection, SSRF refusal — no HTTP response existed at all. */
  | 'transport_failure'
  /** The request was abandoned before an answer arrived. */
  | 'timeout';

export type ReachabilityObservation = {
  readonly outcome: ReachabilityOutcome;
  /** The real status. NULL only when no HTTP response existed — never 0, never 200. */
  readonly status: number | null;
  /** Diagnostic detail for the non-answering cases. Null when the page answered. */
  readonly reason: string | null;
};

/**
 * The sentinel written to `canonical_pages.http_status` when there was no HTTP
 * response at all.
 *
 * Zero is not a status code, and every existing consumer already treats it as
 * "not 200" — so it is retained rather than switched to NULL. That is not
 * cosmetic: `http_status` is read in several places as `(http_status ?? 200)`,
 * so a NULL would DEFAULT A FAILED FETCH TO SUCCESS. The structured
 * observation below carries the truth; this column keeps the shape its readers
 * already expect.
 */
export const NO_HTTP_RESPONSE_STATUS = 0;

/** Classify a status code that we actually received. */
export function classifyHttpStatus(status: number): ReachabilityOutcome {
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  if (status >= 300) return 'redirect';
  return 'success';
}

/**
 * Classify a thrown fetch error.
 *
 * Timeout detection matches the same undici error identities `safeFetch` itself
 * tests for when it records its timeout metric, so the two agree about what a
 * timeout is rather than each guessing.
 */
export function classifyFetchError(error: unknown): ReachabilityObservation {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = /timeout|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i.test(message);
  return {
    outcome: timedOut ? 'timeout' : 'transport_failure',
    status: null,
    reason: message,
  };
}

/** An observation built from a status code we received. */
export function observationFromStatus(status: number): ReachabilityObservation {
  const outcome = classifyHttpStatus(status);
  return {
    outcome,
    status,
    reason: outcome === 'success' ? null : `HTTP ${status}`,
  };
}

/** True when an HTTP response existed — the precondition for any status claim. */
export function hasHttpResponse(outcome: ReachabilityOutcome): boolean {
  return outcome !== 'transport_failure' && outcome !== 'timeout';
}

/**
 * True when the page ANSWERED with an error. This — not "anything that went
 * wrong" — is the population "N pages returned 4xx/5xx" is allowed to count.
 */
export function isHttpErrorOutcome(outcome: ReachabilityOutcome): boolean {
  return outcome === 'client_error' || outcome === 'server_error';
}

/** The row shape persisted under `crawl_metadata.reachability`. No migration: existing JSONB. */
export type PersistedReachability = ReachabilityObservation;

/**
 * Recover the observation for a persisted page.
 *
 * Rows crawled BEFORE this change carry no `reachability` object, so their
 * outcome is reconstructed from `http_status` alone. Two cases matter:
 *
 *   `0`    — a legacy failure row. Which KIND of failure is unrecoverable (the
 *            old code kept only free text), so it reports `transport_failure`:
 *            no HTTP response, which is the honest reading and keeps it out of
 *            the 4xx/5xx population it was never evidence for.
 *   `null` — never observed. Also no response. It must NOT default to 200; that
 *            default is precisely how a failed fetch became a healthy page.
 */
export function reachabilityForPage(page: {
  http_status?: number | null;
  crawl_metadata?: { reachability?: PersistedReachability | null } | null;
}): ReachabilityObservation {
  const persisted = page.crawl_metadata?.reachability;
  if (persisted && typeof persisted.outcome === 'string') return persisted;

  const status = page.http_status;
  if (typeof status !== 'number' || status === NO_HTTP_RESPONSE_STATUS) {
    return {
      outcome: 'transport_failure',
      status: null,
      reason: 'No HTTP response was recorded for this page.',
    };
  }
  return observationFromStatus(status);
}
