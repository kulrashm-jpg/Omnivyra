/**
 * Social channel adapter.
 *
 * This does NOT define social platform profiles. It delegates to the existing
 * sources and adds only outreach-layer checks on top (D3):
 * - style, emoji policy and natural word range: `getPlatformProfile` from
 *   `lib/content/platformAdaptationProfiles.ts`, the verified production
 *   authority for STYLE. It defines no character limit, so everything taken
 *   from it is advisory (a warning);
 * - hard character cap: the `scheduled_posts` CHECK constraints
 *   (`scheduledPostsCharLimit`, limitEvidence.ts), the only social caps the
 *   database enforces. A platform without one gets NO hard cap here;
 * - advisory character cap: `PROMOTION_PLATFORM_CHAR_LIMITS` from
 *   `lib/content/promotionDraft.ts` (client-side, self-described advisory),
 *   used only where no enforced cap exists.
 *
 * Social posts are public, so personalization placeholders are refused.
 */
import { getPlatformProfile, type PlatformAdaptationProfile } from '../../content/platformAdaptationProfiles';
import { PROMOTION_PLATFORM_CHAR_LIMITS } from '../../content/promotionDraft';
import { scheduledPostsCharLimit } from './limitEvidence';
import { checkPlaceholders } from './personalization';
import { countEmoji, normalizeText } from './textRules';
import type { ChannelContentFinding, FormatResult, ValidationResult } from './types';

export interface SocialChannelProfile {
  readonly channel: 'social';
  readonly platform: string;
  /** The canonical adaptation profile, exactly as `getPlatformProfile` returned it. */
  readonly adaptation: PlatformAdaptationProfile;
  /** Hard cap from the scheduled_posts CHECK constraints, or null when none backs one. */
  readonly maxCharacters: number | null;
  /** Advisory cap from PROMOTION_PLATFORM_CHAR_LIMITS, only when there is no hard cap. */
  readonly advisoryMaxCharacters: number | null;
  readonly wordRange: readonly [number, number];
  /** platformAdaptationProfiles encodes "no emojis" as an empty emojiPolicy (style: advisory). */
  readonly emojiAllowed: boolean;
  readonly personalizationPermitted: false;
}

export function getSocialChannelProfile(platform: string | null | undefined): SocialChannelProfile {
  const adaptation = getPlatformProfile(platform);
  const hard = scheduledPostsCharLimit(adaptation.platform);
  const advisory = PROMOTION_PLATFORM_CHAR_LIMITS[adaptation.platform];
  return {
    channel: 'social',
    platform: adaptation.platform,
    adaptation,
    maxCharacters: hard,
    advisoryMaxCharacters: hard === null && typeof advisory === 'number' ? advisory : null,
    wordRange: adaptation.wordRange,
    emojiAllowed: adaptation.emojiPolicy.trim() !== '',
    personalizationPermitted: false,
  };
}

const wordCount = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

export function validateSocialPost(platform: string | null | undefined, body: string | null | undefined): ValidationResult {
  const profile = getSocialChannelProfile(platform);
  const text = typeof body === 'string' ? body : '';
  const findings: ChannelContentFinding[] = [];

  if (text.trim() === '') {
    findings.push({ code: 'required_field_missing', severity: 'error', message: `a ${profile.platform} post requires a non-empty "body"`, field: 'body' });
    return { valid: false, findings };
  }
  if (profile.maxCharacters !== null && text.length > profile.maxCharacters) {
    findings.push({
      code: 'length_exceeded',
      severity: 'error',
      message: `"body" is ${text.length} characters; the ${profile.platform} limit is ${profile.maxCharacters}`,
      field: 'body',
    });
  } else if (profile.advisoryMaxCharacters !== null && text.length > profile.advisoryMaxCharacters) {
    findings.push({
      code: 'length_exceeded',
      severity: 'warning',
      message: `"body" is ${text.length} characters; the ${profile.platform} recommended maximum is ${profile.advisoryMaxCharacters}`,
      field: 'body',
    });
  }
  const words = wordCount(text);
  const [lo, hi] = profile.wordRange;
  if (words < lo || words > hi) {
    findings.push({
      code: 'word_range_outside_profile',
      severity: 'warning',
      message: `${words} words; the ${profile.platform} adaptation profile reads naturally at ${lo}-${hi}`,
      field: 'body',
    });
  }
  if (!profile.emojiAllowed && countEmoji(text) > 0) {
    findings.push({ code: 'emoji_not_allowed', severity: 'warning', message: `the ${profile.platform} adaptation profile recommends no emoji`, field: 'body' });
  }
  findings.push(...checkPlaceholders(text, 'body', false));
  return { valid: !findings.some((x) => x.severity === 'error'), findings };
}

/** Normalize and validate. No rewriting: style adaptation belongs to the content generators. */
export function formatSocialPost(platform: string | null | undefined, body: string | null | undefined): FormatResult {
  const profile = getSocialChannelProfile(platform);
  const text = normalizeText(typeof body === 'string' ? body : '');
  const { findings } = validateSocialPost(platform, text);
  if (findings.some((x) => x.severity === 'error')) return { content: null, findings };
  return { content: { channel: 'social', fields: { body: text, platform: profile.platform }, personalizationUsed: {} }, findings };
}
