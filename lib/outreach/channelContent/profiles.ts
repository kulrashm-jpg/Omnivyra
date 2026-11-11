/**
 * One static profile per Outreach channel.
 *
 * D3: a number is `hard` only with evidence (limitEvidence.ts); every policy
 * number is `advisory` and produces a warning, never a refusal. Each `basis`
 * says where a number comes from. Required fields, the single-line subject and
 * the personalization rules are not limits and stay errors.
 *
 * SMS and voice are FORMATTING PROFILES ONLY (`status: 'formatting_only'`):
 * there is no provider or transport for them, and this file does not create
 * one.
 *
 * Social posts are not profiled here: they go through `socialAdapter.ts`,
 * which reuses `lib/content/platformAdaptationProfiles.ts`.
 */
import { HARD_LIMIT_EVIDENCE } from './limitEvidence';
import type { ChannelProfile, EmojiRule, FieldRule, LimitEnforcement, LinkRule } from './types';

const NO_LINKS: LinkRule = { allowed: false, maxLinks: 0, enforcement: 'advisory' };
const NO_EMOJI: EmojiRule = { allowed: false, maxEmoji: 0, enforcement: 'advisory' };
const links = (maxLinks: number | null): LinkRule => ({ allowed: true, maxLinks, enforcement: 'advisory' });
const emoji = (maxEmoji: number | null): EmojiRule => ({ allowed: true, maxEmoji, enforcement: 'advisory' });

function field(
  name: string,
  maxCharacters: number,
  enforcement: LimitEnforcement,
  opts: { singleLine?: boolean; links?: LinkRule; emoji?: EmojiRule; required?: boolean } = {},
): FieldRule {
  return {
    name,
    required: opts.required ?? true,
    length: { maxCharacters, enforcement, minCharacters: 1 },
    singleLine: opts.singleLine ?? false,
    links: opts.links ?? NO_LINKS,
    emoji: opts.emoji ?? NO_EMOJI,
  };
}

export const EMAIL_PROFILE: ChannelProfile = {
  channel: 'email',
  label: 'Email',
  fields: [
    field('subject', HARD_LIMIT_EVIDENCE.emailSubjectMax.value, 'hard', { singleLine: true }),
    field('body', 10000, 'advisory', { links: links(3), emoji: emoji(3) }),
  ],
  personalizationPermitted: true,
  status: 'active',
  basis:
    `subject ${HARD_LIMIT_EVIDENCE.emailSubjectMax.value} hard (${HARD_LIMIT_EVIDENCE.emailSubjectMax.basis}); `
    + 'single-line subject hard (a line break in a header is never valid); '
    + 'body 10000, 3 links, 3 emoji, no links/emoji in subject: advisory policy.',
};

export const WHATSAPP_PROFILE: ChannelProfile = {
  channel: 'whatsapp',
  label: 'WhatsApp',
  fields: [
    field('body', HARD_LIMIT_EVIDENCE.whatsappTextBodyMax.value, 'hard', { links: links(2), emoji: emoji(null) }),
  ],
  personalizationPermitted: true,
  status: 'active',
  basis: `body ${HARD_LIMIT_EVIDENCE.whatsappTextBodyMax.value} hard (${HARD_LIMIT_EVIDENCE.whatsappTextBodyMax.basis}); 2 links: advisory policy.`,
};

export const COMMUNITY_REPLY_PROFILE: ChannelProfile = {
  channel: 'community_reply',
  label: 'Community reply',
  fields: [
    field('body', 1500, 'advisory', { links: links(1), emoji: emoji(2) }),
  ],
  // A community reply is public: person fields must not be written into it.
  personalizationPermitted: false,
  status: 'active',
  basis: 'advisory policy: 1500 chars, 1 link, 2 emoji (no platform evidence); personalization refused because the surface is public.',
};

export const SMS_PROFILE: ChannelProfile = {
  channel: 'sms',
  label: 'SMS',
  fields: [
    // 459 = 3 concatenated GSM-7 parts x 153. The segment rule is the real cap;
    // this keeps the character rule consistent with it.
    field('body', 459, 'advisory', { links: links(1) }),
  ],
  personalizationPermitted: true,
  segments: { maxSegments: 3, encodingPolicy: 'auto', enforcement: 'advisory' },
  status: 'formatting_only',
  basis:
    'GSM 03.38 arithmetic (160/153 GSM-7, 70/67 UCS-2) is a standard; 3 segments, 459 chars, 1 link, no emoji: advisory policy. '
    + 'No SMS provider exists or is activated.',
};

export const VOICE_SCRIPT_PROFILE: ChannelProfile = {
  channel: 'voice_script',
  label: 'Voice script',
  fields: [field('body', 3000, 'advisory')],
  personalizationPermitted: true,
  status: 'formatting_only',
  basis: 'advisory policy: 3000 chars (roughly 3-4 spoken minutes); no links or emoji in spoken text. No voice provider exists or is activated.',
};

export const CHANNEL_PROFILES: Readonly<Record<ChannelProfile['channel'], ChannelProfile>> = {
  email: EMAIL_PROFILE,
  whatsapp: WHATSAPP_PROFILE,
  community_reply: COMMUNITY_REPLY_PROFILE,
  sms: SMS_PROFILE,
  voice_script: VOICE_SCRIPT_PROFILE,
};

export function getChannelProfile(channel: ChannelProfile['channel']): ChannelProfile {
  return CHANNEL_PROFILES[channel];
}
