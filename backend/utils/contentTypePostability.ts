/**
 * Content-Type Postability — single source of truth for the question:
 * "Which connected social platforms can this company actually publish a piece
 * of content of type X to, right now?"
 *
 * Composes two existing helpers:
 *   - `getConnectedPlatformsForCompany` (platformEligibility.ts) — OAuth-active
 *     row in social_accounts AND token not expired. Tokens are kept fresh by
 *     the cron + by /api/social-accounts/status' proactive refresh, so this
 *     reflects "actually postable right now".
 *   - `BOLT_EXCLUDED_PLATFORMS` (boltTextContentConfig.ts) — visual-only
 *     surfaces (YouTube, TikTok, Instagram, Pinterest) where a text-only post
 *     cannot succeed. Re-used so BOLT and the post-result/share-to-social
 *     flows can never disagree.
 *
 * Used by `/api/social-accounts/postable-platforms` (the unified endpoint).
 * Both the post result page chips and the multi-platform scheduler call that
 * endpoint; BOLT delegates here too so all three flows share one rule.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getConnectedPlatformsForCompany } from './platformEligibility';
import { BOLT_EXCLUDED_PLATFORMS } from './boltTextContentConfig';

export type PostablePlatform = {
  platform_key: string;
  platform_label: string;
  account_name: string | null;
  username: string | null;
  social_account_id: string | null;
};

/**
 * Content type families. The categories below map a free-form `contentType`
 * string (post, tweet, video, reel, …) to a publishing modality so we can
 * pick the right platform-eligibility rule.
 */
type ContentTypeFamily = 'text' | 'video' | 'image' | 'unknown';

const TEXT_CONTENT_TYPES = new Set([
  'post',
  'tweet',
  'thread',
  'short_story',
  'article',
  'blog',
  'newsletter',
  'white_paper',
  'poll',
]);

const VIDEO_CONTENT_TYPES = new Set([
  'video',
  'reel',
  'reels',
  'short',
  'shorts',
  'short_video',
]);

const IMAGE_CONTENT_TYPES = new Set([
  'image',
  'images',
  'carousel',
  'carousels',
  'story',
  'idea_pin',
  'banner',
  'banners',
]);

function classifyContentType(raw: string): ContentTypeFamily {
  const norm = String(raw ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (!norm) return 'unknown';
  if (TEXT_CONTENT_TYPES.has(norm)) return 'text';
  if (VIDEO_CONTENT_TYPES.has(norm)) return 'video';
  if (IMAGE_CONTENT_TYPES.has(norm)) return 'image';
  // Substring fallbacks for prefixed/variant names like "linkedin_post".
  if (norm.includes('post') && !norm.includes('video')) return 'text';
  if (norm.includes('tweet') || norm.includes('article')) return 'text';
  if (norm.includes('video') || norm.includes('reel')) return 'video';
  if (norm.includes('carousel') || norm.includes('image') || norm.includes('story')) return 'image';
  return 'unknown';
}

/**
 * Platform eligibility per content-type family. Rule of thumb:
 *   - text  → exclude visual-only surfaces (BOLT_EXCLUDED_PLATFORMS).
 *   - video → only platforms that natively distribute video.
 *   - image → only platforms that publish image-first content.
 *   - unknown → fall back to "all connected" (caller decides).
 */
const VIDEO_CAPABLE_PLATFORMS = new Set(['youtube', 'tiktok', 'instagram', 'facebook', 'linkedin']);
const IMAGE_CAPABLE_PLATFORMS = new Set(['instagram', 'pinterest', 'facebook', 'linkedin']);

function isPlatformEligibleForFamily(platform: string, family: ContentTypeFamily): boolean {
  const norm = String(platform ?? '').trim().toLowerCase().replace(/^twitter$/i, 'x');
  if (!norm) return false;
  switch (family) {
    case 'text':
      return !BOLT_EXCLUDED_PLATFORMS.has(norm);
    case 'video':
      return VIDEO_CAPABLE_PLATFORMS.has(norm);
    case 'image':
      return IMAGE_CAPABLE_PLATFORMS.has(norm);
    case 'unknown':
    default:
      return true;
  }
}

/**
 * Return the postable platforms for a company + content type.
 *
 * "Postable" = (a) OAuth-connected with a non-expired token, AND
 *              (b) the platform supports this content type.
 *
 * Token freshness is enforced HERE (at the consumer layer) rather than inside
 * `getConnectedPlatformsForCompany`. The shared helper is also called by the
 * BOLT executor and other paths that must stay unaffected by transient token
 * states; only the user-facing surfaces (picker, post chips, scheduler) need
 * to hide platforms that can't publish right now.
 *
 * Rows are enriched with display fields (label, account_name, username,
 * social_account_id) so the consumer can render a card without a second
 * lookup.
 */
export async function getPostablePlatformsForContentType(args: {
  companyId: string;
  contentType: string;
}): Promise<PostablePlatform[]> {
  if (!args.companyId) return [];

  const family = classifyContentType(args.contentType);
  const connectedKeys = await getConnectedPlatformsForCompany(args.companyId);
  const eligibleKeys = connectedKeys.filter((p) => isPlatformEligibleForFamily(p, family));
  if (eligibleKeys.length === 0) return [];

  // Pull display fields + token expiry from the company's active social_accounts
  // rows. Display fields make the response self-sufficient (UI doesn't need a
  // parallel call); token_expires_at lets us drop platforms whose access token
  // has lapsed so the user can't pick a target we can't actually publish to.
  const { data: rows } = await supabase
    .from('social_accounts')
    .select('id, platform, account_name, username, token_expires_at')
    .eq('company_id', args.companyId)
    .eq('is_active', true)
    .not('platform_user_id', 'like', 'planning_%');

  type Row = {
    id: string;
    platform: string;
    account_name: string | null;
    username: string | null;
    token_expires_at: string | null;
  };
  const nowMs = Date.now();
  const byPlatform = new Map<string, Row>();
  for (const r of (rows ?? []) as Row[]) {
    const key = String(r.platform ?? '').trim().toLowerCase().replace(/^twitter$/i, 'x');
    if (!key || byPlatform.has(key)) continue;
    if (r.token_expires_at) {
      const expMs = Date.parse(r.token_expires_at);
      if (Number.isFinite(expMs) && expMs <= nowMs) continue;
    }
    byPlatform.set(key, r);
  }

  return eligibleKeys
    .filter((key) => byPlatform.has(key))
    .map((key) => {
      const row = byPlatform.get(key)!;
      return {
        platform_key: key,
        platform_label: PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
        account_name: row.account_name ?? null,
        username: row.username ?? null,
        social_account_id: row.id ?? null,
      };
    });
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  facebook: 'Facebook',
  threads: 'Threads',
  reddit: 'Reddit',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
};
