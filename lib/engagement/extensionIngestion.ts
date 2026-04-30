import {
  isAuthorSelf,
  stripSenderColonPrefix,
} from './messageRoles';

const PLATFORM_ALIASES: Record<string, string> = {
  x: 'twitter',
  'twitter/x': 'twitter',
  li: 'linkedin',
  fb: 'facebook',
  ig: 'instagram',
  yt: 'youtube',
};

export const EXTENSION_COMMENT_PLATFORMS = new Set([
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
]);

export const EXTENSION_DM_PLATFORMS = new Set([
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
]);

export function normalizeExtensionPlatform(platform: unknown): string {
  const key = String(platform ?? '').trim().toLowerCase();
  return PLATFORM_ALIASES[key] ?? key;
}

export function isExtensionCommentPlatform(platform: unknown): boolean {
  return EXTENSION_COMMENT_PLATFORMS.has(normalizeExtensionPlatform(platform));
}

export function isExtensionDmPlatform(platform: unknown): boolean {
  return EXTENSION_DM_PLATFORMS.has(normalizeExtensionPlatform(platform));
}

function trimOrNull(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

export function buildProfileUrl(platform: string, username: string | null): string | null {
  const handle = trimOrNull(username)?.replace(/^@/, '') ?? null;
  if (!handle) return null;
  switch (normalizeExtensionPlatform(platform)) {
    case 'linkedin':
      return `https://www.linkedin.com/in/${handle}/`;
    case 'twitter':
      return `https://x.com/${handle}`;
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    case 'youtube':
      return `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`;
    default:
      return handle;
  }
}

export function resolvePlatformUserId(
  platform: string,
  profileUrl?: string | null,
  username?: string | null,
): string | null {
  const url = trimOrNull(profileUrl);
  if (url) return url;
  return buildProfileUrl(platform, username);
}

export function normalizeScrapedMessageContent(input: {
  content?: string | null;
  direction?: string | null;
  sender_self?: boolean | null;
  author_self?: boolean | null;
}): { content: string; isSelf: boolean; prefixDetected: boolean } {
  const rawContent = String(input.content ?? '');
  const prefixDetected = /^you\s*:/i.test(rawContent.trim());
  const isSelf = isAuthorSelf({
    direction: input.direction,
    sender_self: input.sender_self,
    author_self: input.author_self,
    content: rawContent,
  });

  return {
    content: stripSenderColonPrefix(rawContent),
    isSelf,
    prefixDetected,
  };
}
