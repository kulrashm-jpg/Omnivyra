/**
 * Single authority for BOLT format ↔ platform binding (Phase 6B-1).
 *
 * `tweet` is X-exclusive: the Tweet format may ONLY target X/Twitter. Both
 * 'x' and 'twitter' are listed because the codebase has two competing
 * canonicalizations — social-account / platform-eligibility paths normalize to
 * 'x', while lib/shared/platforms.ts resolves to 'twitter'. Matching either
 * avoids a false-negative regardless of which side produced the platform key.
 *
 * This ONE definition replaces the three former duplicate copies in
 * hooks/useBoltStrategy.tsx, components/BoltStrategyView.tsx, and
 * backend/services/boltPipelineService.ts. It is consumed two equivalent ways
 * from the SAME data:
 *   - FORMAT_REQUIRED_PLATFORMS (UI): show a format chip only when one of its
 *     required platforms is connected.
 *   - FORMAT_EXCLUSIVE_PLATFORMS (planner): restrict a format to its platforms.
 *
 * Add new bindings here, nowhere else.
 */
export const FORMAT_PLATFORM_BINDING: Partial<Record<string, string[]>> = Object.freeze({
  tweet: ['x', 'twitter'],
});

/** UI alias — a format chip is shown only if one of these platforms is connected. */
export const FORMAT_REQUIRED_PLATFORMS = FORMAT_PLATFORM_BINDING;

/** Planner alias — a format may ONLY publish to these platforms. */
export const FORMAT_EXCLUSIVE_PLATFORMS = FORMAT_PLATFORM_BINDING;

/**
 * Inverse of the whitelist: a format may NOT publish to these platforms even
 * though the platform is otherwise text-capable. `poll` is blocked on X/Twitter
 * because X has no native long-poll body — the poll question gets coerced into a
 * post and truncated. Add exclusions here.
 */
export const FORMAT_BLOCKED_PLATFORMS: Partial<Record<string, string[]>> = Object.freeze({
  poll: ['x', 'twitter'],
});

/**
 * NOTE: this file is a DATA leaf only — it owns the format↔platform binding
 * maps and nothing else. The per-format platform *filter* lives in the single
 * canonical authority `lib/shared/bolt/contentPlatformAssignment.ts`
 * (`filterPlatformsForFormat` / `getSupportedPlatformsForFormat`), which composes
 * these maps with the platform-capability registry: eligibility =
 * capability ∩ exclusive-whitelist ∩ NOT-blocklist. A former blocklist-only
 * `filterPlatformsForFormat` used to live here; it was removed once every caller
 * migrated to the canonical authority, so there is exactly one filter path.
 */
