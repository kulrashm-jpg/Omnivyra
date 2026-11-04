/**
 * One static profile per Outreach channel.
 *
 * Numbers are content-layer POLICY, not a statement of what a provider accepts.
 * Each `basis` says where a number comes from; the ones marked "policy" are
 * proposals for the coordinator to confirm.
 *
 * SMS and voice are FORMATTING PROFILES ONLY (`status: 'formatting_only'`):
 * there is no provider or transport for them, and this file does not create
 * one.
 *
 * Social posts are not profiled here: they go through `socialAdapter.ts`,
 * which reuses `lib/content/platformAdaptationProfiles.ts`.
 */
import type { ChannelProfile, EmojiRule, FieldRule, LinkRule } from './types';

const NO_LINKS: LinkRule = { allowed: false, maxLinks: 0 };
const NO_EMOJI: EmojiRule = { allowed: false, maxEmoji: 0 };

function field(
  name: string,
  maxCharacters: number,
  opts: { singleLine?: boolean; links?: LinkRule; emoji?: EmojiRule; required?: boolean } = {},
): FieldRule {
  return {
    name,
    required: opts.required ?? true,
    length: { maxCharacters, minCharacters: 1 },
    singleLine: opts.singleLine ?? false,
    links: opts.links ?? NO_LINKS,
    emoji: opts.emoji ?? NO_EMOJI,
  };
}

export const EMAIL_PROFILE: ChannelProfile = {
  channel: 'email',
  label: 'Email',
  fields: [
    field('subject', 200, { singleLine: true }),
    field('body', 10000, {
      links: { allowed: true, maxLinks: 3 },
      emoji: { allowed: true, maxEmoji: 3 },
    }),
  ],
  personalizationPermitted: true,
  status: 'active',
  basis:
    'subject 200 matches the 041-A generator SUBJECT_MAX (not exported, so restated here); '
    + 'body 10000, 3 links, 3 emoji, no links/emoji in subject: policy.',
};

export const WHATSAPP_PROFILE: ChannelProfile = {
  channel: 'whatsapp',
  label: 'WhatsApp',
  fields: [
    field('body', 4096, {
      links: { allowed: true, maxLinks: 2 },
      emoji: { allowed: true, maxEmoji: null },
    }),
  ],
  personalizationPermitted: true,
  status: 'active',
  basis:
    'body 4096 = WhatsApp Cloud API text-message body limit (unverified against current Meta docs; '
    + 'approved TEMPLATE bodies are limited separately and are not modelled here); 2 links: policy.',
};

export const COMMUNITY_REPLY_PROFILE: ChannelProfile = {
  channel: 'community_reply',
  label: 'Community reply',
  fields: [
    field('body', 1500, {
      links: { allowed: true, maxLinks: 1 },
      emoji: { allowed: true, maxEmoji: 2 },
    }),
  ],
  // A community reply is public: person fields must not be written into it.
  personalizationPermitted: false,
  status: 'active',
  basis: 'policy: 1500 chars, 1 link, 2 emoji; personalization refused because the surface is public.',
};

export const SMS_PROFILE: ChannelProfile = {
  channel: 'sms',
  label: 'SMS',
  fields: [
    // 459 = 3 concatenated GSM-7 parts x 153. The segment rule is the real cap;
    // this keeps the character rule consistent with it.
    field('body', 459, { links: { allowed: true, maxLinks: 1 } }),
  ],
  personalizationPermitted: true,
  segments: { maxSegments: 3, encodingPolicy: 'auto' },
  status: 'formatting_only',
  basis:
    'GSM 03.38 arithmetic (160/153 GSM-7, 70/67 UCS-2); 3 segments, 1 link, no emoji: policy. '
    + 'No SMS provider exists or is activated.',
};

export const VOICE_SCRIPT_PROFILE: ChannelProfile = {
  channel: 'voice_script',
  label: 'Voice script',
  fields: [field('body', 3000)],
  personalizationPermitted: true,
  status: 'formatting_only',
  basis: 'policy: 3000 chars (roughly 3-4 spoken minutes); no links or emoji in spoken text. No voice provider exists or is activated.',
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
