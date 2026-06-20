/**
 * Single source of truth for campaign duration options.
 *
 * Replaces the duplicated `DURATION_OPTIONS` arrays across BOLT Text/Creator/
 * Combined (pages + hooks + views), the recommendation blueprint card, and the
 * planner panels.
 *
 * Ranges are PRESERVED EXACTLY (behavior contract):
 *   - BOLT surfaces (Text/Creator/Combined): 1–4 weeks.
 *   - Planner surfaces: the curated [1, 2, 4, 6, 8, 10, 12] set.
 *
 * EXECUTION RANGES (Phase 6C-4A):
 *   - BOLT Text / Creator: 1–4 weeks (SHORT_CAMPAIGN_DURATIONS /
 *     MAX_SHORT_CAMPAIGN_DURATION_WEEKS) — short-form experience, unchanged.
 *   - Intelligent Mix (campaign_mode === 'combined'): 1–12 weeks
 *     (ALL_CAMPAIGN_DURATIONS / MAX_CAMPAIGN_DURATION_WEEKS) — the extended-
 *     planning surface. The pipeline clamp + validators + combined UI all derive
 *     their max from these constants (no duplicated numeric limits).
 */

/** Canonical full range, 1–12 weeks. */
export const CAMPAIGN_DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Alias — full range. */
export const ALL_CAMPAIGN_DURATIONS = CAMPAIGN_DURATION_OPTIONS;

/** BOLT (Text/Creator/Combined) — 1–4 weeks, derived from the authority. */
export const SHORT_CAMPAIGN_DURATIONS = CAMPAIGN_DURATION_OPTIONS.filter((w) => w <= 4);

/** Planner curated set (spans 1–12, non-contiguous) — preserved exactly. */
export const PLANNER_DURATIONS = [1, 2, 4, 6, 8, 10, 12];

export interface DurationOption {
  value: number;
  label: string;
}

/**
 * Build `{ value, label }` options from a duration list, preserving the exact
 * label style each surface currently renders (e.g. "1 Week" / "2 Weeks", or
 * lowercase "1 week" / "2 weeks").
 */
export function toDurationOptions(values: number[], opts: { lowercase?: boolean } = {}): DurationOption[] {
  const unit = opts.lowercase ? 'week' : 'Week';
  return values.map((v) => ({ value: v, label: `${v} ${unit}${v === 1 ? '' : 's'}` }));
}

/** Precomputed BOLT options ("1 Week" / "N Weeks") — what BOLT Text/Creator render. */
export const BOLT_DURATION_OPTIONS: DurationOption[] = toDurationOptions(SHORT_CAMPAIGN_DURATIONS);

/**
 * Intelligent Mix (combined) options — full 1–12 range. Phase 6C-4A: the
 * combined builder is the extended-planning surface, so it renders the whole
 * range while BOLT Text/Creator keep BOLT_DURATION_OPTIONS.
 */
export const COMBINED_DURATION_OPTIONS: DurationOption[] = toDurationOptions(ALL_CAMPAIGN_DURATIONS);

/**
 * Max execution weeks per surface, DERIVED from the option arrays above (never a
 * duplicated literal). Consumers gate on these instead of hardcoding 4 / 12.
 */
export const MAX_CAMPAIGN_DURATION_WEEKS = Math.max(...ALL_CAMPAIGN_DURATIONS); // 12 — Intelligent Mix
export const MAX_SHORT_CAMPAIGN_DURATION_WEEKS = Math.max(...SHORT_CAMPAIGN_DURATIONS); // 4 — BOLT Text/Creator
