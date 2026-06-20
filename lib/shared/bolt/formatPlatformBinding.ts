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
