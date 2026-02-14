/**
 * Pre-LLM noise filter to reduce cost. Reject low-value posts.
 */

const MIN_LENGTH = 20;
const ONLY_EMOJI_REGEX = /^[\p{Emoji}\s]+$/u;
const SPAM_PATTERNS = [
  /\bcrypto\b/i,
  /\bgiveaway\b/i,
  /\bfree\s+bitcoin\b/i,
  /\bbot\b/i,
  /\bautomated\b/i,
  /\bclick\s+here\b/i,
  /\bwinner\b.*\bselected\b/i,
  /\bdm\s+to\s+win\b/i,
  /\bfollow\s+.*\s+to\s+enter\b/i,
];

function isOnlyLink(text: string): boolean {
  const t = text.trim();
  if (t.length < 10) return false;
  const withoutUrl = t.replace(/https?:\/\/[^\s]+/g, '').trim();
  return withoutUrl.length < 5;
}

function isOnlyEmoji(text: string): boolean {
  const t = text.replace(/\s/g, '');
  if (t.length < 2) return false;
  return ONLY_EMOJI_REGEX.test(t);
}

function hasSpamKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return SPAM_PATTERNS.some((re) => re.test(lower));
}

/**
 * Return true if the post should be rejected before LLM (noise floor).
 */
export function shouldRejectPost(rawText: string): boolean {
  const t = (rawText || '').trim();
  if (t.length < MIN_LENGTH) return true;
  if (isOnlyLink(t)) return true;
  if (isOnlyEmoji(t)) return true;
  if (hasSpamKeywords(t)) return true;
  return false;
}
