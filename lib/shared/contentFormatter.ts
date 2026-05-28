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
 * Format content for a specific platform.
 *
 * Phase C — `mutateTruncate` controls the over-limit behavior:
 *
 *   - `true` (DEFAULT, BACKWARD-COMPATIBLE): if the formatted text exceeds
 *     `limits.maxChars`, silently truncate at a word boundary and append
 *     '...'. Returns `truncated: true` + a warning so the caller knows.
 *     This is the historical behavior every adapter relies on today.
 *
 *   - `false` (RECOMMENDED once schedule-time char-limit enforce is on):
 *     do NOT mutate the text. Return `truncated: true` (so the adapter can
 *     refuse to publish) with a clear warning and the text UNTOUCHED. The
 *     adapter is then responsible for not publishing partially-correct
 *     content. The intended consumer pairs this flag with the G11 schedule-
 *     time guard (`SCHEDULE_CHAR_LIMIT_MODE=enforce`) which rejects the
 *     overflow at schedule time — at publish time, `mutateTruncate=false`
 *     becomes the second line of defense that ALSO refuses to publish if
 *     somehow over-limit content slipped past the schedule-time gate.
 *
 * Roll-out: adapter call sites should remain on the default until prod has
 * been observed under `SCHEDULE_CHAR_LIMIT_MODE=enforce` for a soak window.
 * Then flip adapters one-platform-at-a-time to `mutateTruncate: false` and
 * add per-adapter publish-readiness reject for the over-limit case.
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
    /** Phase C — when false, over-limit text is NOT auto-truncated; the
     *  caller receives `truncated:true` + warning + the UNMUTATED text and
     *  is expected to refuse to publish. Default true preserves legacy
     *  silent-truncate behavior. */
    mutateTruncate?: boolean;
  } = {}
): FormattedContent {
  const platformKey = platform.toLowerCase();
  const limits = PLATFORM_LIMITS[platformKey] || PLATFORM_LIMITS.linkedin; // Default to LinkedIn

  const warnings: string[] = [];
  let text = content.trim();
  let hashtags = options.hashtags || [];
  let mentions = options.mentions || [];
  let links = options.links || [];

  // If content is HTML (from RichTextEditor), convert to plain text preserving structure
  if (/^<[a-z][\s\S]*>/i.test(text) || /<\/p>|<\/li>|<br\s*\/?>/.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '')
      .replace(/<\/li>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/ul>|<\/ol>/gi, '\n')
      .replace(/<ul[^>]*>|<ol[^>]*>/gi, '')
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '$1\n')
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Strip markdown bold/italic markers — social platforms render these as literal characters
  // ContentRenderer handles the visual rendering; the wire content must be clean text
  text = text
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/_([^_\n]+?)_/g, '$1');

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

  // Over-limit handling (see `mutateTruncate` docstring above).
  if (finalText.length > limits.maxChars) {
    truncated = true;
    const mutateTruncate = options.mutateTruncate !== false; // default true
    if (mutateTruncate) {
      warnings.push(`Content truncated from ${finalText.length} to ${limits.maxChars} characters`);
      // Smart truncation: try to cut at word boundary
      let truncatedText = finalText.substring(0, limits.maxChars);
      const lastSpace = truncatedText.lastIndexOf(' ');
      if (lastSpace > limits.maxChars * 0.9) { // Only if we're close to limit
        truncatedText = truncatedText.substring(0, lastSpace);
      }
      finalText = truncatedText + (truncatedText.length < finalText.length ? '...' : '');
    } else {
      // Phase C — strict mode. Do NOT mutate. Adapter must refuse to publish.
      warnings.push(
        `Content exceeds ${platform} ${limits.maxChars}-char limit (actual: ${finalText.length}). ` +
        `Adapter should refuse to publish; reject upstream via schedule-time guard.`
      );
    }
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

