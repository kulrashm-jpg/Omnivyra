/**
 * Platform Intent Engine — Stage 0 of the content processing pipeline.
 *
 * Applies platform-native structural signals BEFORE language refinement.
 * Does NOT rewrite meaning. Only adjusts:
 *   - Thread separation for Twitter/X
 *   - Line-break cadence for TikTok captions
 *   - Slide delimiter normalisation for carousel content
 *
 * Eligible content types: post, thread, carousel, reel, story, tweet, tweetstorm
 * Skipped for: video (script), article, blog, newsletter (long-form)
 */

export type PlatformIntentInput = {
  content: string;
  platform: string;
  content_type: string;
  goal?: string;
};

export type PlatformIntentOutput = {
  content: string;
  intent_applied: boolean;
  platform_pattern: string;
};

const INTENT_ELIGIBLE_TYPES = new Set([
  'post', 'thread', 'tweetstorm', 'tweet', 'carousel', 'slides', 'reel', 'short', 'story', 'image',
]);

const SKIP_INTENT_TYPES = new Set(['video', 'article', 'blog', 'newsletter', 'podcast']);

/** Enforce tweet-by-tweet separation: each tweet on its own double-newline block. */
function separateThreadTweets(content: string): string {
  // If already double-newline separated, normalise only
  if (content.includes('\n\n')) {
    return content.replace(/\n{3,}/g, '\n\n').trim();
  }
  // Single-newline separated — promote to double
  if (content.includes('\n')) {
    return content.split('\n').join('\n\n').trim();
  }
  return content;
}

/** TikTok captions: each sentence on its own line for readability. */
function applyTikTokLineBreaks(content: string): string {
  const sentences = content.split(/(?<=[.!?])\s+/);
  if (sentences.length <= 1) return content;
  return sentences.join('\n');
}

/** Carousel: normalise slide delimiters (---, SLIDE N:) to double newlines. */
function normaliseCarouselDelimiters(content: string): string {
  return content
    .replace(/\n?-{3,}\n?/g, '\n\n')
    .replace(/\n?SLIDE\s+\d+[:.]\s*/gi, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Stage 0: Apply platform-native intent signals.
 * Runs before artifact stripping and language refinement.
 */
export function applyPlatformIntent(input: PlatformIntentInput): PlatformIntentOutput {
  const platform = String(input.platform || '').toLowerCase().trim();
  const contentType = String(input.content_type || '').toLowerCase().trim();
  let content = String(input.content || '');

  if (SKIP_INTENT_TYPES.has(contentType)) {
    return { content, intent_applied: false, platform_pattern: 'skip_long_form' };
  }

  if (!INTENT_ELIGIBLE_TYPES.has(contentType)) {
    return { content, intent_applied: false, platform_pattern: 'none' };
  }

  // Thread separation — Twitter/X and LinkedIn threads
  if (contentType === 'thread' || contentType === 'tweetstorm') {
    const separated = separateThreadTweets(content);
    if (separated !== content) {
      return { content: separated, intent_applied: true, platform_pattern: 'thread_separation' };
    }
    return { content, intent_applied: false, platform_pattern: 'thread_already_separated' };
  }

  // TikTok post: one sentence per line
  if (platform === 'tiktok' && contentType === 'post') {
    const lined = applyTikTokLineBreaks(content);
    if (lined !== content) {
      return { content: lined, intent_applied: true, platform_pattern: 'tiktok_line_break' };
    }
  }

  // Carousel/slides: normalise slide delimiters
  if (contentType === 'carousel' || contentType === 'slides') {
    const normalised = normaliseCarouselDelimiters(content);
    if (normalised !== content) {
      return { content: normalised, intent_applied: true, platform_pattern: 'carousel_delimiter_normalisation' };
    }
  }

  return { content, intent_applied: false, platform_pattern: platform || 'default' };
}
