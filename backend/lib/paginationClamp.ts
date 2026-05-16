/**
 * Phase 13 — Pagination clamp.
 *
 * Single source of truth for limit/offset clamping across Phase 0-12
 * list endpoints. Each service file currently re-implements
 * `Math.min(N, Math.max(1, options?.limit ?? D))`; this helper
 * consolidates that pattern with named caps per surface so the
 * limits are easy to audit + change in one place.
 *
 * Adoption is opt-in: callers can use `clampLimit(input, surface)`
 * incrementally; the existing inline clamps remain correct.
 *
 * NOT a behavioral change. Same numeric result for the same inputs.
 */

export type PaginationSurface =
  | 'default'              // 1..500, default 200
  | 'small_list'           // 1..200, default 50
  | 'narrow_list'          // 1..200, default 100
  | 'events_log'           // 1..500, default 100
  | 'snapshot_list'        // 1..200, default 50
  | 'retrieval_top_k'      // 1..100, default 20
  | 'macro_steps';         // 1..25,  default 25

const PROFILES: Record<PaginationSurface, { min: number; max: number; defaultLimit: number }> = {
  default: { min: 1, max: 500, defaultLimit: 200 },
  small_list: { min: 1, max: 200, defaultLimit: 50 },
  narrow_list: { min: 1, max: 200, defaultLimit: 100 },
  events_log: { min: 1, max: 500, defaultLimit: 100 },
  snapshot_list: { min: 1, max: 200, defaultLimit: 50 },
  retrieval_top_k: { min: 1, max: 100, defaultLimit: 20 },
  macro_steps: { min: 1, max: 25, defaultLimit: 25 },
};

/**
 * Clamp a caller-provided limit against a named surface profile.
 * Returns the surface default when input is null/undefined/non-finite.
 *
 * @example
 *   const limit = clampLimit(options?.limit, 'small_list');
 */
export function clampLimit(input: number | undefined | null, surface: PaginationSurface = 'default'): number {
  const profile = PROFILES[surface];
  if (typeof input !== 'number' || !Number.isFinite(input)) return profile.defaultLimit;
  return Math.max(profile.min, Math.min(profile.max, Math.trunc(input)));
}

/**
 * Clamp an offset to a non-negative integer with an upper ceiling. Used
 * defensively for the rare offset-paginated endpoint; keyset pagination
 * is preferred where the surface supports it.
 */
export function clampOffset(input: number | undefined | null, maxOffset: number = 10_000): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return 0;
  return Math.max(0, Math.min(maxOffset, Math.trunc(input)));
}

/**
 * Profile inspector — useful for advisory tooling that wants to surface
 * the configured limits in the UI without hard-coding them client-side.
 */
export function getPaginationProfile(surface: PaginationSurface): { min: number; max: number; defaultLimit: number } {
  return { ...PROFILES[surface] };
}
