/**
 * Visual Structuring Engine — Stage 3B of the content processing pipeline.
 *
 * Applies whitespace and visual rhythm rules AFTER structural formatting.
 * Responsibilities:
 *   - Hook spacing   (LinkedIn, Instagram, Facebook posts/articles)
 *   - Carousel slide separation
 *   - Thread pacing  (numbering + double-newline separation)
 *   - Whitespace control (max 2 consecutive blank lines, platform caps)
 */

export type VisualStructureInput = {
  content: string;
  platform: string;
  content_type: string;
};

export type VisualStructureOutput = {
  content: string;
  rules_applied: string[];
};

// ── Hook spacing ─────────────────────────────────────────────────────────────
// Ensures the first line (hook) has a blank line after it before the body.
const HOOK_SPACING_PLATFORMS = new Set(['linkedin', 'instagram', 'facebook']);

function ensureHookSpacing(content: string): string {
  const lines = content.split('\n');
  if (lines.length < 2) return content;
  // Find first non-empty line (the hook)
  const firstNonEmpty = lines.findIndex(l => l.trim() !== '');
  const nextLine = lines[firstNonEmpty + 1];
  if (nextLine !== undefined && nextLine.trim() !== '') {
    lines.splice(firstNonEmpty + 1, 0, '');
    return lines.join('\n');
  }
  return content;
}

// ── Thread pacing ────────────────────────────────────────────────────────────
// Ensures double-newline separation and consistent numbering.
function enforceThreadPacing(content: string): string {
  const rawTweets = content.split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
  if (rawTweets.length < 2) return content;

  const numbered = rawTweets.map((tweet, i) => {
    if (/^\d+[.)/]\s/.test(tweet)) return tweet; // already numbered
    return `${i + 1}/ ${tweet}`;
  });

  return numbered.join('\n\n');
}

// ── Carousel slide normalisation ─────────────────────────────────────────────
function normaliseCarouselSlides(content: string): string {
  return content
    .replace(/\n?-{3,}\n?/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Whitespace control ───────────────────────────────────────────────────────
function controlWhitespace(content: string, platform: string): string {
  let result = content.replace(/\n{3,}/g, '\n\n').trim();

  // LinkedIn: cap paragraphs at 2 lines — break longer blocks
  if (platform === 'linkedin') {
    result = result
      .split('\n\n')
      .map(para => {
        const lines = para.split('\n');
        if (lines.length <= 2) return para;
        const groups: string[] = [];
        for (let i = 0; i < lines.length; i += 2) {
          groups.push(lines.slice(i, i + 2).join('\n'));
        }
        return groups.join('\n\n');
      })
      .join('\n\n');
  }

  return result;
}

/**
 * Stage 3B: Apply visual structuring rules to formatted content.
 */
export function applyVisualStructure(input: VisualStructureInput): VisualStructureOutput {
  const platform = String(input.platform || '').toLowerCase().trim();
  const contentType = String(input.content_type || '').toLowerCase().trim();
  let content = String(input.content || '');
  const rulesApplied: string[] = [];

  // Hook spacing — LinkedIn, Instagram, Facebook posts/articles
  if (
    HOOK_SPACING_PLATFORMS.has(platform) &&
    ['post', 'article', 'blog'].includes(contentType)
  ) {
    const spaced = ensureHookSpacing(content);
    if (spaced !== content) {
      rulesApplied.push('hook_spacing');
      content = spaced;
    }
  }

  // Thread pacing
  if (contentType === 'thread' || contentType === 'tweetstorm') {
    const paced = enforceThreadPacing(content);
    if (paced !== content) {
      rulesApplied.push('thread_pacing');
      content = paced;
    }
  }

  // Carousel slide separation
  if (contentType === 'carousel' || contentType === 'slides') {
    const normalised = normaliseCarouselSlides(content);
    if (normalised !== content) {
      rulesApplied.push('carousel_slide_separation');
      content = normalised;
    }
  }

  // Whitespace control — all platforms
  const clean = controlWhitespace(content, platform);
  if (clean !== content) {
    rulesApplied.push('whitespace_control');
    content = clean;
  }

  return { content, rules_applied: rulesApplied };
}
