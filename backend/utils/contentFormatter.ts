/**
 * Content Formatter
 * 
 * Automatically formats content to match each platform's requirements:
 * - Character limits
 * - Hashtag limits
 * - Media limits
 * - Content type formats
 * - Platform-specific formatting rules
 * 
 * This ensures content is automatically aligned to the right format for each platform.
 */

export interface PlatformContentLimits {
  maxChars: number;
  maxHashtags: number;
  maxMedia: number;
  hashtagPlacement: 'inline' | 'separate' | 'both';
  allowMentions: boolean;
  allowLinks: boolean;
  linkFormat: 'auto' | 'shorten' | 'full';
}

export interface FormattedContent {
  text: string;
  hashtags: string[];
  mentions: string[];
  links: string[];
  truncated: boolean;
  warnings: string[];
}

/**
 * Platform-specific content limits and rules
 */
const PLATFORM_LIMITS: Record<string, PlatformContentLimits> = {
  linkedin: {
    maxChars: 3000,
    maxHashtags: 5,
    maxMedia: 9,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'full',
  },
  twitter: {
    maxChars: 280,
    maxHashtags: 2,
    maxMedia: 4,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'shorten',
  },
  x: {
    maxChars: 280,
    maxHashtags: 2,
    maxMedia: 4,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'shorten',
  },
  instagram: {
    maxChars: 2200,
    maxHashtags: 30,
    maxMedia: 10,
    hashtagPlacement: 'both',
    allowMentions: true,
    allowLinks: false, // Links only in bio
    linkFormat: 'auto',
  },
  facebook: {
    maxChars: 63206,
    maxHashtags: 30,
    maxMedia: 12,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'full',
  },
  youtube: {
    maxChars: 5000,
    maxHashtags: 15,
    maxMedia: 1,
    hashtagPlacement: 'separate',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'full',
  },
  tiktok: {
    maxChars: 2200,
    maxHashtags: 100,
    maxMedia: 1,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: false,
    linkFormat: 'auto',
  },
  spotify: {
    maxChars: 2000,
    maxHashtags: 0, // No hashtags in Spotify
    maxMedia: 1,
    hashtagPlacement: 'separate',
    allowMentions: true,
    allowLinks: true,
    linkFormat: 'full',
  },
  starmaker: {
    maxChars: 500,
    maxHashtags: 10,
    maxMedia: 1,
    hashtagPlacement: 'inline',
    allowMentions: true,
    allowLinks: false,
    linkFormat: 'auto',
  },
  suno: {
    maxChars: 1000,
    maxHashtags: 5,
    maxMedia: 1,
    hashtagPlacement: 'separate',
    allowMentions: false,
    allowLinks: true,
    linkFormat: 'full',
  },
  pinterest: {
    maxChars: 500,
    maxHashtags: 20,
    maxMedia: 1,
    hashtagPlacement: 'inline',
    allowMentions: false,
    allowLinks: true,
    linkFormat: 'full',
  },
};

/**
 * Format content for a specific platform
 * 
 * @param content - Original content text
 * @param platform - Platform name (linkedin, twitter, instagram, etc.)
 * @param options - Additional formatting options
 * @returns Formatted content ready for platform posting
 */
export function formatContentForPlatform(
  content: string,
  platform: string,
  options: {
    hashtags?: string[];
    mentions?: string[];
    links?: string[];
    mediaUrls?: string[];
  } = {}
): FormattedContent {
  const platformKey = platform.toLowerCase();
  const limits = PLATFORM_LIMITS[platformKey] || PLATFORM_LIMITS.linkedin; // Default to LinkedIn

  const warnings: string[] = [];
  let text = content.trim();
  let hashtags = options.hashtags || [];
  let mentions = options.mentions || [];
  let links = options.links || [];

  // Extract hashtags and mentions from content if not provided
  if (!options.hashtags) {
    hashtags = extractHashtags(text);
    text = removeHashtags(text);
  }

  if (!options.mentions) {
    mentions = extractMentions(text);
  }

  if (!options.links) {
    links = extractLinks(text);
  }

  // Limit hashtags
  if (hashtags.length > limits.maxHashtags) {
    warnings.push(`Hashtags truncated from ${hashtags.length} to ${limits.maxHashtags}`);
    hashtags = hashtags.slice(0, limits.maxHashtags);
  }

  // Format hashtags based on platform
  const formattedHashtags = hashtags.map(tag => 
    tag.startsWith('#') ? tag : `#${tag}`
  );

  // Build final text based on platform rules
  let finalText = text;
  let truncated = false;

  // Add hashtags based on platform preference
  if (limits.hashtagPlacement === 'inline' || limits.hashtagPlacement === 'both') {
    // Add hashtags to text (will be counted in character limit)
    const hashtagText = formattedHashtags.join(' ');
    finalText = `${finalText} ${hashtagText}`.trim();
  }

  // Truncate if over limit
  if (finalText.length > limits.maxChars) {
    truncated = true;
    warnings.push(`Content truncated from ${finalText.length} to ${limits.maxChars} characters`);
    
    // Smart truncation: try to cut at word boundary
    let truncatedText = finalText.substring(0, limits.maxChars);
    const lastSpace = truncatedText.lastIndexOf(' ');
    if (lastSpace > limits.maxChars * 0.9) { // Only if we're close to limit
      truncatedText = truncatedText.substring(0, lastSpace);
    }
    finalText = truncatedText + (truncatedText.length < finalText.length ? '...' : '');
  }

  // Handle links
  if (!limits.allowLinks && links.length > 0) {
    warnings.push(`Links removed (not allowed on ${platform})`);
    links = [];
  }

  // Handle mentions
  if (!limits.allowMentions && mentions.length > 0) {
    warnings.push(`Mentions removed (not allowed on ${platform})`);
    mentions = [];
  }

  // Format links based on platform preference
  if (limits.linkFormat === 'shorten' && links.length > 0) {
    // Note: In production, you'd integrate with a URL shortener here
    warnings.push('Links should be shortened for this platform');
  }

  return {
    text: finalText,
    hashtags: formattedHashtags,
    mentions,
    links,
    truncated,
    warnings,
  };
}

/**
 * Extract hashtags from text
 */
function extractHashtags(text: string): string[] {
  const hashtagRegex = /#(\w+)/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map(tag => tag.replace('#', '')) : [];
}

/**
 * Remove hashtags from text
 */
function removeHashtags(text: string): string {
  return text.replace(/#\w+/g, '').trim();
}

/**
 * Extract mentions from text
 */
function extractMentions(text: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const matches = text.match(mentionRegex);
  return matches ? matches.map(mention => mention.replace('@', '')) : [];
}

/**
 * Extract links from text
 */
function extractLinks(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * Get platform content limits
 */
export function getPlatformLimits(platform: string): PlatformContentLimits {
  const platformKey = platform.toLowerCase();
  return PLATFORM_LIMITS[platformKey] || PLATFORM_LIMITS.linkedin;
}

/**
 * Validate content before posting
 */
export function validateContentForPlatform(
  content: string,
  platform: string,
  options: {
    hashtags?: string[];
    mediaUrls?: string[];
  } = {}
): { valid: boolean; errors: string[]; warnings: string[] } {
  const limits = getPlatformLimits(platform);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check content length
  const formatted = formatContentForPlatform(content, platform, options);
  if (formatted.text.length > limits.maxChars) {
    errors.push(`Content exceeds ${limits.maxChars} character limit`);
  }

  // Check hashtags
  const hashtags = options.hashtags || formatted.hashtags;
  if (hashtags.length > limits.maxHashtags) {
    errors.push(`Exceeds ${limits.maxHashtags} hashtag limit`);
  }

  // Check media
  const mediaUrls = options.mediaUrls || [];
  if (mediaUrls.length > limits.maxMedia) {
    errors.push(`Exceeds ${limits.maxMedia} media limit`);
  }

  // Warnings
  if (formatted.truncated) {
    warnings.push('Content was truncated to fit platform limits');
  }

  warnings.push(...formatted.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

