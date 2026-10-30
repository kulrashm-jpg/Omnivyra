/**
 * Score availability semantics (closure C; contract § "Enrichment contributions
 * and score availability (closure C)").
 *
 *   NULL / missing ⇒ UNSCORED (unavailable). Never converted into 0.
 *   0              ⇒ genuinely scored zero.
 *
 * `canonical_leads.qualification_score` was `NOT NULL DEFAULT 0` until
 * 20270109000002, so rows that pre-date it may hold the old default 0, which is
 * indistinguishable from a genuine zero at the column level. The documented
 * rule (no production backfill): a stored 0 counts as a score ONLY when the
 * row's `lead_metadata` carries the scoring marker
 * `qualificationScoring` (any scorer that can emit 0 must stamp it). A bare 0
 * is the legacy default ⇒ unscored. Any value > 0 is a score.
 *
 * Pure; no I/O. Every reader that turns `qualification_score` into a number
 * goes through `effectiveQualificationScore`.
 */

/** `lead_metadata` key a scorer stamps when it writes a qualification score that may be 0. */
export const QUALIFICATION_SCORE_MARKER = 'qualificationScoring' as const;

export type QualificationScoreState = 'scored' | 'unscored' | 'legacy_default';

export interface QualificationScoreReading {
  readonly state: QualificationScoreState;
  /** The score (percent, 0..100) when `state === 'scored'`; otherwise null. */
  readonly value: number | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** True when the row's lead_metadata carries the scoring marker. */
export function hasQualificationScoreMarker(leadMetadata: unknown): boolean {
  if (!isObject(leadMetadata)) return false;
  const m = leadMetadata[QUALIFICATION_SCORE_MARKER];
  return m === true || isObject(m) || (typeof m === 'string' && m.trim() !== '');
}

/**
 * Read `canonical_leads.qualification_score` with its availability.
 * `leadMetadata` may be the whole `lead_metadata` object or just the marker
 * value under `{ qualificationScoring: … }`.
 */
export function readQualificationScore(value: unknown, leadMetadata?: unknown): QualificationScoreReading {
  if (value === null || value === undefined || value === '') return { state: 'unscored', value: null };
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return { state: 'unscored', value: null };
  if (n === 0 && !hasQualificationScoreMarker(leadMetadata)) return { state: 'legacy_default', value: null };
  return { state: 'scored', value: n };
}

/** The score as a number, or null when unscored (including the legacy default 0). */
export function effectiveQualificationScore(value: unknown, leadMetadata?: unknown): number | null {
  return readQualificationScore(value, leadMetadata).value;
}

/** Mean of the SCORED values only; null when nothing is scored (never 0 for "no data"). */
export function meanOfScored(values: ReadonlyArray<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n === 0 ? null : sum / n;
}
