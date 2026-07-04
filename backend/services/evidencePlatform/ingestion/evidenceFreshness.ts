/**
 * Evidence Freshness  (BETA-ENGINE-007, Phase 6)
 *
 * Deterministic freshness classification for persisted provider Evidence. Pure — compares two passed-in
 * ISO timestamps against the provider descriptor's `maxAgeHours`; no clock access, no randomness.
 *
 * States:
 *   fresh               — young enough that no refresh is needed
 *   stale               — usable but past the "fresh" fraction of its lifetime (refresh soon)
 *   expired             — past maxAge; must not be trusted as current → refresh_required
 *   refresh_required    — alias emitted for expired/absent records the orchestrator should re-fetch
 *   refresh_in_progress — a fetch is currently running (record status, set by the orchestrator)
 *   refresh_failed      — the last refresh attempt failed (record status, set by the orchestrator)
 */
export type FreshnessState =
  | 'fresh'
  | 'stale'
  | 'expired'
  | 'refresh_required'
  | 'refresh_in_progress'
  | 'refresh_failed';

/** Fraction of maxAge below which Evidence is considered "fresh" (deterministic default). */
export const FRESH_FRACTION = 0.5;

/** Hours between two ISO timestamps (>= 0), or null when either is unparseable. */
export function ageHours(fetchedAtIso: string | null | undefined, nowIso: string | null | undefined): number | null {
  if (!fetchedAtIso || !nowIso) return null;
  const a = Date.parse(fetchedAtIso);
  const b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 3_600_000);
}

/**
 * Classify a persisted record's freshness. `recordStatus` (when supplied) short-circuits to
 * refresh_in_progress / refresh_failed; otherwise the age vs maxAge determines fresh/stale/expired.
 * An absent fetch time → refresh_required.
 */
export function classifyFreshness(
  fetchedAtIso: string | null | undefined,
  nowIso: string,
  maxAgeHours: number,
  recordStatus?: 'ready' | 'refresh_in_progress' | 'refresh_failed',
): FreshnessState {
  if (recordStatus === 'refresh_in_progress') return 'refresh_in_progress';
  if (recordStatus === 'refresh_failed') return 'refresh_failed';
  const age = ageHours(fetchedAtIso, nowIso);
  if (age == null) return 'refresh_required';
  if (age >= maxAgeHours) return 'expired';
  if (age >= maxAgeHours * FRESH_FRACTION) return 'stale';
  return 'fresh';
}

/** Whether a freshness state means the orchestrator should (re)fetch. */
export function needsRefresh(state: FreshnessState): boolean {
  return state === 'expired' || state === 'refresh_required' || state === 'refresh_failed';
}
