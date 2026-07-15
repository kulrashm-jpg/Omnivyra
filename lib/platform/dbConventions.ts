/**
 * F-11 — Database Query Conventions Kit (Foundation Batch C).
 *
 * Shared helpers that make the DB Query Standard the path of least
 * resistance: explicit projections, keyset (cursor) pagination, estimated
 * counts, and bounded batching. NO query is migrated and NO SQL changes in
 * Batch C — Wave 2 (W2-6) and the B-19/B-49 sweeps adopt these.
 *
 * Enforcement foundation: scripts/check-db-conventions.js reports
 * `select('*')` and `count: 'exact'` usage (report-only; a later wave flips
 * it strict via DB_CONVENTIONS_STRICT=1). Same culture as check:ssrf /
 * check-tenant-authz.
 */

// ── Projections ───────────────────────────────────────────────────────────────

/**
 * Build an explicit column projection: cols('id','status') → 'id,status'.
 * Exists so projections are grep-able (`cols(`) and never drift into `'*'`
 * — passing '*' throws at call time.
 */
export function cols(...columns: string[]): string {
  if (columns.length === 0) throw new Error('cols(): at least one column required');
  for (const c of columns) {
    if (c.trim() === '*') throw new Error("cols(): '*' is not a projection — list the columns");
  }
  return columns.join(',');
}

// ── Estimated counts ──────────────────────────────────────────────────────────

/**
 * Spread into supabase select options for UI badges/dashboards:
 *   .select('id', ESTIMATED_COUNT)  →  planner-estimate instead of a full
 * scan (audit B-26). Use EXACT counts only where the number is contractual
 * (billing, quotas).
 */
export const ESTIMATED_COUNT = { count: 'estimated' as const, head: true as const };

// ── Keyset pagination (audit B-49: replaces OFFSET on unbounded tables) ──────

export interface KeysetCursor {
  /** ISO timestamp (or comparable string) of the last row seen. */
  value: string;
  /** Tie-breaker id of the last row seen. */
  id: string;
}

/** Opaque, URL-safe cursor encoding. */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Returns null on any malformed input (treat as first page). */
export function decodeCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (parsed && typeof parsed.value === 'string' && typeof parsed.id === 'string') {
      return { value: parsed.value, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * PostgREST `or` filter implementing (col, id) < (value, id) keyset ordering
 * for a DESC listing (flip with ascending=true). Apply as:
 *   query.or(keysetFilter(cursor, 'created_at'))
 * alongside .order(column, {ascending}).order('id', {ascending}).
 */
export function keysetFilter(cursor: KeysetCursor, column: string, ascending = false): string {
  const op = ascending ? 'gt' : 'lt';
  return `${column}.${op}.${cursor.value},and(${column}.eq.${cursor.value},id.${op}.${cursor.id})`;
}

// ── Batching ──────────────────────────────────────────────────────────────────

/** Split items into bounded chunks for `.in()` filters and bulk writes. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk(): size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

/** Default `.in()` chunk size — PostgREST URL-length safe. */
export const IN_FILTER_CHUNK = 200;
