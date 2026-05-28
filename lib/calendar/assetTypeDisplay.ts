/**
 * Single source of truth for how a calendar event picks the content-type
 * label to display.
 *
 * Background: `scheduled_posts.content_type` stores a PLATFORM-NATIVE value
 * (`tweet`, `feed_post`, `post`, `pin`, `reel`, `video`, …) because the
 * underlying DB constraint `chk_content_type` only accepts per-platform
 * tokens. The user-selected canonical asset (`post` / `poll` / `article` /
 * `story` / `carousel` / `reel` / `image`) is preserved on
 * `daily_content_plans.content_type` and surfaced on the calendar event
 * payload as `asset_type`.
 *
 * Every calendar renderer (modal, week strip, day-cell tile, day-detail
 * card) MUST use this helper so the chosen format is shown consistently.
 *
 * Resolution order:
 *   1. `asset_type` — the canonical, user-selected format
 *   2. `content_type` — platform-native fallback (legacy events, standalone
 *      non-campaign posts that have no `daily_content_plans` row to join)
 *   3. `'post'` — final fallback so we never render empty
 */

export type CalendarContentTypeInputs = {
  asset_type?: string | null | undefined;
  content_type?: string | null | undefined;
};

const DEFAULT_LABEL = 'post';

function clean(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Resolves the user-facing content-type label for a calendar event.
 * Lower-cased, hyphen-to-underscore normalized so callers can match against
 * conditional renderers (e.g. `=== 'article'`, `=== 'poll'`).
 */
export function resolveDisplayContentType(
  event: CalendarContentTypeInputs,
): string {
  const asset = clean(event.asset_type);
  if (asset) return asset.toLowerCase().replace(/[\s-]/g, '_');
  const native = clean(event.content_type);
  if (native) return native.toLowerCase().replace(/[\s-]/g, '_');
  return DEFAULT_LABEL;
}

/**
 * Human-readable variant — same resolution, but underscores become spaces
 * for display ("feed_post" → "feed post", "short_story" → "short story").
 * Returns the lower-cased, hyphen-or-underscore-tokenized label without
 * extra capitalization so call sites can apply their own CSS `capitalize`.
 */
export function resolveDisplayContentTypeLabel(
  event: CalendarContentTypeInputs,
): string {
  const asset = clean(event.asset_type);
  const native = clean(event.content_type);
  const pick = asset || native || DEFAULT_LABEL;
  return pick.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim() || DEFAULT_LABEL;
}
