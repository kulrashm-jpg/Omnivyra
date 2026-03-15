/**
 * Platform Response Formatter
 * Applies platform-specific rules to reply text.
 */

export type PlatformFormatRules = {
  maxLength?: number;
  tone: string;
  emojiAllowed: boolean;
  styleHint: string;
};

const PLATFORM_RULES: Record<string, PlatformFormatRules> = {
  linkedin: {
    maxLength: 1250,
    tone: 'professional',
    emojiAllowed: false,
    styleHint: 'Professional, concise, business-appropriate.',
  },
  instagram: {
    maxLength: 2200,
    tone: 'friendly',
    emojiAllowed: true,
    styleHint: 'Friendly, personable, emoji allowed when natural.',
  },
  twitter: {
    maxLength: 280,
    tone: 'concise',
    emojiAllowed: true,
    styleHint: 'Very concise, punchy, under 280 characters.',
  },
  x: {
    maxLength: 280,
    tone: 'concise',
    emojiAllowed: true,
    styleHint: 'Very concise, punchy, under 280 characters.',
  },
  facebook: {
    maxLength: 8000,
    tone: 'friendly',
    emojiAllowed: true,
    styleHint: 'Friendly, conversational.',
  },
  youtube: {
    maxLength: 10000,
    tone: 'community',
    emojiAllowed: true,
    styleHint: 'Community tone, appreciative, engaging.',
  },
  reddit: {
    maxLength: 10000,
    tone: 'conversational',
    emojiAllowed: false,
    styleHint: 'Conversational, Reddit-appropriate, minimal emoji.',
  },
};

/**
 * Apply platform formatting to reply text.
 */
export function formatForPlatform(
  text: string,
  platform: string,
  options?: { emojiPolicy?: string }
): string {
  const key = (platform ?? '').toString().trim().toLowerCase();
  const rules = PLATFORM_RULES[key] ?? PLATFORM_RULES.linkedin;

  let out = text.trim();

  const emojiPolicy = (options?.emojiPolicy ?? 'minimal').toLowerCase();
  if (emojiPolicy === 'none' || !rules.emojiAllowed) {
    out = stripEmojis(out);
  }

  if (rules.maxLength && out.length > rules.maxLength) {
    out = out.slice(0, rules.maxLength - 3) + '...';
  }

  return out;
}

function stripEmojis(s: string): string {
  return s.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
}

/**
 * Get platform format rules for generation hints.
 */
export function getPlatformFormatRules(platform: string): PlatformFormatRules {
  const key = (platform ?? '').toString().trim().toLowerCase();
  return PLATFORM_RULES[key] ?? PLATFORM_RULES.linkedin;
}
