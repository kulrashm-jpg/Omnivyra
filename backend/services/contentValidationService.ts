/**
 * Content Validation Service — post-generation structural validation.
 *
 * Validates carousel slide count, thread structure, and hook quality.
 * Does NOT block the pipeline by default — returns issues for logging/retry decisions.
 *
 * Usage:
 *   const result = validateContent(content, 'carousel', { expected_slides: 7 });
 *   if (!result.valid) { log or retry }
 */

export type CarouselValidationResult = {
  valid: boolean;
  slide_count: number;
  expected_slides: number;
  issues: string[];
};

export type ThreadValidationResult = {
  valid: boolean;
  tweet_count: number;
  issues: string[];
};

export type HookQualityResult = {
  score: number; // 0–1
  hook_text: string;
  issues: string[];
};

export type ContentValidationResult = {
  valid: boolean;
  content_type: string;
  issues: string[];
  carousel?: CarouselValidationResult;
  thread?: ThreadValidationResult;
  hook_quality?: HookQualityResult;
};

// ── Carousel validation ──────────────────────────────────────────────────────
// Default used when config service is unavailable (sync call-sites only)
const MAX_SLIDE_WORDS_DEFAULT = 15;

const CTA_KEYWORDS = [
  'learn', 'start', 'join', 'follow', 'book', 'contact', 'try',
  'download', 'subscribe', 'click', 'visit', 'get', 'discover',
];

export function validateCarouselStructure(
  content: string,
  expectedSlides: number,
  maxSlideWords: number = MAX_SLIDE_WORDS_DEFAULT,
): CarouselValidationResult {
  // Split on double-newlines, --- dividers, or "SLIDE N" labels
  const slides = content
    .split(/\n{2,}|-{3,}|SLIDE\s+\d+[:.]/gi)
    .map(s => s.trim())
    .filter(Boolean);

  const issues: string[] = [];

  if (slides.length !== expectedSlides) {
    issues.push(`Expected ${expectedSlides} slides, found ${slides.length}`);
  }

  slides.forEach((slide, i) => {
    const wordCount = slide.split(/\s+/).filter(Boolean).length;
    if (wordCount > maxSlideWords) {
      issues.push(`Slide ${i + 1}: ${wordCount} words (max ${maxSlideWords})`);
    }
  });

  if (slides.length > 0) {
    const lastSlide = slides[slides.length - 1].toLowerCase();
    const hasCta = CTA_KEYWORDS.some(kw => lastSlide.includes(kw));
    if (!hasCta) issues.push('Last slide appears to lack a CTA');
  }

  return {
    valid: issues.length === 0,
    slide_count: slides.length,
    expected_slides: expectedSlides,
    issues,
  };
}

// ── Thread validation ────────────────────────────────────────────────────────
const THREAD_MIN_DEFAULT    = 5;
const THREAD_MAX_DEFAULT    = 7;
const TWEET_CHAR_LIMIT_DEFAULT = 280;

export function validateThreadStructure(
  content: string,
  threadMin: number = THREAD_MIN_DEFAULT,
  threadMax: number = THREAD_MAX_DEFAULT,
  tweetCharLimit: number = TWEET_CHAR_LIMIT_DEFAULT,
): ThreadValidationResult {
  const tweets = content
    .split(/\n{2,}/)
    .map(t => t.trim())
    .filter(Boolean);

  const issues: string[] = [];

  if (tweets.length < threadMin) {
    issues.push(`Thread has ${tweets.length} tweets (minimum ${threadMin})`);
  }
  if (tweets.length > threadMax) {
    issues.push(`Thread has ${tweets.length} tweets (maximum ${threadMax})`);
  }

  if (tweets.length > 0) {
    const hook = tweets[0];
    const isHook =
      hook.includes('?') ||
      /[!]$/.test(hook.trim()) ||
      hook.split(/\s+/).length <= 12;
    if (!isHook) {
      issues.push('First tweet may not be an effective hook');
    }
  }

  tweets.forEach((tweet, i) => {
    if (tweet.length > tweetCharLimit) {
      issues.push(`Tweet ${i + 1} exceeds ${tweetCharLimit} chars (${tweet.length})`);
    }
  });

  return { valid: issues.length === 0, tweet_count: tweets.length, issues };
}

// ── Hook quality scoring ─────────────────────────────────────────────────────
const STRONG_HOOK_PATTERNS = [
  /\bsecret\b/i, /\btruth\b/i, /\bmistake\b/i, /\bnobody\b/i,
  /\bstop\b/i, /\bhow to\b/i, /\bwhy\b/i, /\bwhat if\b/i,
  /\bhere'?s\b/i, /\bthis changed\b/i, /\bunpopular opinion\b/i,
  /\bhot take\b/i, /\bwarning\b/i, /\bthread:/i,
  /\?\s*$/, /!\s*$/,
];

const WEAK_HOOK_PATTERNS = [
  /^we are\b/i, /^our company\b/i, /^today we\b/i,
  /^i am (happy|excited|pleased)\b/i, /^pleased to announce\b/i,
  /^excited to share\b/i, /^we would like to\b/i,
];

export function scoreHookQuality(
  content: string,
  hookMinWords: number = 4,
  hookMaxWords: number = 20,
): HookQualityResult {
  const hookText = content.split('\n')[0].trim();
  const issues: string[] = [];

  let score = 0.5;
  const wordCount = hookText.split(/\s+/).filter(Boolean).length;

  if (wordCount < hookMinWords) { score -= 0.2; issues.push(`Hook is too short (< ${hookMinWords} words)`); }
  if (wordCount > hookMaxWords) { score -= 0.15; issues.push(`Hook is too long (> ${hookMaxWords} words)`); }

  const strongMatches = STRONG_HOOK_PATTERNS.filter(p => p.test(hookText)).length;
  score += strongMatches * 0.12;

  const weakMatches = WEAK_HOOK_PATTERNS.filter(p => p.test(hookText)).length;
  score -= weakMatches * 0.25;
  if (weakMatches > 0) {
    issues.push('Hook uses weak opening pattern (announcement/corporate style)');
  }

  score = parseFloat(Math.max(0, Math.min(1, score)).toFixed(2));
  return { score, hook_text: hookText, issues };
}

// ── Master validator ─────────────────────────────────────────────────────────
const HOOK_REQUIRED_TYPES = new Set([
  'post', 'carousel', 'slides', 'thread', 'tweetstorm', 'article', 'reel', 'short',
]);

export type ValidationOptions = {
  expected_slides?: number;
  // Config overrides (populated by validateContentWithConfig)
  hook_min_score?: number;
  carousel_max_words?: number;
  thread_min_count?: number;
  thread_max_count?: number;
  tweet_char_limit?: number;
  hook_min_words?: number;
  hook_max_words?: number;
};

export function validateContent(
  content: string,
  content_type: string,
  options?: ValidationOptions,
): ContentValidationResult {
  const ct = String(content_type || '').toLowerCase().trim();
  const issues: string[] = [];
  const result: ContentValidationResult = { valid: true, content_type: ct, issues };

  const hookMinScore     = options?.hook_min_score     ?? 0.3;
  const carouselMaxWords = options?.carousel_max_words ?? MAX_SLIDE_WORDS_DEFAULT;
  const threadMin        = options?.thread_min_count   ?? THREAD_MIN_DEFAULT;
  const threadMax        = options?.thread_max_count   ?? THREAD_MAX_DEFAULT;
  const tweetCharLimit   = options?.tweet_char_limit   ?? TWEET_CHAR_LIMIT_DEFAULT;
  const hookMinWords     = options?.hook_min_words     ?? 4;
  const hookMaxWords     = options?.hook_max_words     ?? 20;

  if (!content?.trim()) {
    return { valid: false, content_type: ct, issues: ['Content is empty'] };
  }

  if (HOOK_REQUIRED_TYPES.has(ct)) {
    const hookResult = scoreHookQuality(content, hookMinWords, hookMaxWords);
    result.hook_quality = hookResult;
    if (hookResult.score < hookMinScore) {
      issues.push(`Low hook quality (score: ${hookResult.score})`);
      hookResult.issues.forEach(i => issues.push(i));
    }
  }

  if (ct === 'carousel' || ct === 'slides') {
    const carouselResult = validateCarouselStructure(content, options?.expected_slides ?? 7, carouselMaxWords);
    result.carousel = carouselResult;
    if (!carouselResult.valid) {
      carouselResult.issues.forEach(i => issues.push(i));
    }
  }

  if (ct === 'thread' || ct === 'tweetstorm') {
    const threadResult = validateThreadStructure(content, threadMin, threadMax, tweetCharLimit);
    result.thread = threadResult;
    if (!threadResult.valid) {
      threadResult.issues.forEach(i => issues.push(i));
    }
  }

  result.valid = issues.length === 0;
  return result;
}

/**
 * Config-aware async wrapper — loads thresholds from DB then validates.
 * Used by unifiedContentProcessor (Stage 5) so validation limits are admin-tunable.
 */
export async function validateContentWithConfig(
  content: string,
  content_type: string,
  options?: { expected_slides?: number },
): Promise<ContentValidationResult> {
  try {
    const { getValidationConfig } = await import('./configService');
    const cfg = await getValidationConfig();
    return validateContent(content, content_type, {
      ...options,
      hook_min_score:     cfg.hook_min_score,
      carousel_max_words: cfg.carousel_max_words,
      thread_min_count:   cfg.thread_min_count,
      thread_max_count:   cfg.thread_max_count,
      tweet_char_limit:   cfg.tweet_char_limit,
      hook_min_words:     cfg.hook_min_words,
      hook_max_words:     cfg.hook_max_words,
    });
  } catch {
    // Fall back to defaults if config service unavailable
    return validateContent(content, content_type, options);
  }
}
