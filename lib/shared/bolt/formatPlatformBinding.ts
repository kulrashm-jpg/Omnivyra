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
 * Canonical per-format platform filter used by the scheduler. Applies BOTH the
 * exclusive whitelist (format restricted to certain platforms, e.g. tweet→X) and
 * the blocklist (format forbidden on certain platforms, e.g. poll↛X). Returns the
 * surviving platforms; an empty result means the format cannot run on any of the
 * candidates and the caller should drop that piece.
 */
export function filterPlatformsForFormat(platforms: readonly string[], format: string): string[] {
  const fmt = String(format || '').trim().toLowerCase();
  const norm = (p: string) => String(p || '').trim().toLowerCase();
  let out = (platforms || []).map(norm).filter(Boolean);
  const whitelist = FORMAT_EXCLUSIVE_PLATFORMS[fmt];
  if (whitelist && whitelist.length) {
    const allow = new Set(whitelist.map(norm));
    out = out.filter((p) => allow.has(p));
  }
  const block = FORMAT_BLOCKED_PLATFORMS[fmt];
  if (block && block.length) {
    const deny = new Set(block.map(norm));
    out = out.filter((p) => !deny.has(p));
  }
  return out;
}
