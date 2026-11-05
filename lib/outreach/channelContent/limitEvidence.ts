/**
 * D3 — the evidence behind every HARD content limit in this layer.
 *
 * Owner ruling (Checkpoint 1, item 8): validation rules come only from
 * evidence-backed platform/provider limits and verified existing constraints;
 * agent-proposed numbers never become mandatory. A limit listed here is hard
 * (an error); any other number in this layer is advisory (a warning).
 *
 * Social character caps are the `scheduled_posts` CHECK constraints
 * (`chk_<platform>_content`, supabase/_schema/baseline.sql), which Postgres
 * enforces on every scheduled post. `backend/services/unifiedContentProcessor.ts`
 * PLATFORM_CHAR_LIMITS mirrors them; a drift test pins all three together.
 * `lib/content/platformAdaptationProfiles.ts` is the production authority for
 * STYLE only: it defines no character limit.
 */
import type { LimitEnforcement } from './types';

/** `scheduled_posts.chk_<platform>_content`: the only enforced social caps. */
export const SCHEDULED_POSTS_CHAR_LIMITS: Readonly<Record<'linkedin' | 'twitter' | 'instagram' | 'youtube' | 'facebook', number>> = {
  linkedin: 3000,
  twitter: 280,
  instagram: 2200,
  youtube: 5000,
  facebook: 63206,
};

/** Platform names that store as another `scheduled_posts.platform` value. */
const SCHEDULED_POSTS_ALIASES: Readonly<Record<string, keyof typeof SCHEDULED_POSTS_CHAR_LIMITS>> = { x: 'twitter' };

/** The enforced cap for a social platform, or null when no constraint backs one. */
export function scheduledPostsCharLimit(platform: string): number | null {
  const key = (SCHEDULED_POSTS_ALIASES[platform] ?? platform) as keyof typeof SCHEDULED_POSTS_CHAR_LIMITS;
  return Object.prototype.hasOwnProperty.call(SCHEDULED_POSTS_CHAR_LIMITS, key) ? SCHEDULED_POSTS_CHAR_LIMITS[key] : null;
}

export interface LimitEvidence {
  readonly enforcement: LimitEnforcement;
  readonly basis: string;
}

/** The non-social hard limits and their evidence. */
export const HARD_LIMIT_EVIDENCE = {
  emailSubjectMax: {
    value: 200,
    enforcement: 'hard',
    basis: 'verified existing constraint: backend/services/emailEngine/emailContentGenerator.ts SUBJECT_MAX = 200 (not exported)',
  },
  whatsappTextBodyMax: {
    value: 4096,
    enforcement: 'hard',
    basis: "provider-documented: Meta's WhatsApp text-message reference (developers.facebook.com/docs/whatsapp/api/messages/text, "
      + 'the On-Premises API page) states 4096; Cloud API partner guides state the same. The Cloud API reference page itself was '
      + 'not confirmed. Template and interactive bodies are limited separately and are not modelled',
  },
} as const;
