/**
 * UNREADABLE != ZERO (e9, 2026-11-12): the blog-analytics routes (/api/track/analytics, /hot,
 * /clusters) read every query's error. A failed read throws a named AnalyticsReadError, which the
 * route answers as "unavailable" - never as zero views, no clusters, or a trend computed from a read
 * that did not happen.
 */
export class AnalyticsReadError extends Error {
  constructor(readonly what: string, detail: string) {
    super(`${what}: ${detail}`);
    this.name = 'AnalyticsReadError';
  }
}

/** The rows of a read, or a throw naming it - a failed read is never an empty result. */
export function rowsOf<T>(result: { data: T[] | null; error: { message?: string } | null }, what: string): T[] {
  if (result.error) throw new AnalyticsReadError(what, result.error.message ?? 'unknown error');
  return result.data ?? [];
}

/**
 * The exact count of a `{ count: 'exact', head: true }` read, or a throw naming it. A null count is
 * NOT zero: postgrest-js can answer a blank response as `{ error: null, count: null }`.
 */
export function countOf(result: { count: number | null; error: { message?: string } | null }, what: string): number {
  if (result.error) throw new AnalyticsReadError(what, result.error.message ?? 'unknown error');
  if (typeof result.count !== 'number') throw new AnalyticsReadError(what, 'no count returned');
  return result.count;
}
