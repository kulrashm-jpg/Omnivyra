/**
 * Returns the "Format:" line for a topic based on content type.
 * Word-based types show primaryFormat + maxWordTarget + platform; others show type label + platform only.
 */

export interface ContentTypeGuidance {
  primaryFormat?: string;
  maxWordTarget?: number;
  platformWithHighestLimit?: string;
}

/**
 * One sample output per content type (for docs/reference):
 *
 * Post / Posts          → Format: social post · Max words: 1000 · Highest-limit platform: facebook
 * Video / 2 video       → Format: Video · Platform: youtube
 * Long Video            → Format: Video · Platform: youtube
 * Reel / Reels          → Format: Video · Platform: instagram
 * Short / Shorts        → Format: Video · Platform: youtube
 * Blog / Blogs          → Format: long-form post · Max words: 800 · Highest-limit platform: linkedin
 * Article / Articles   → Format: article · Max words: 1200 · Highest-limit platform: linkedin
 * White Paper          → Format: long-form · Max words: 2400 · Highest-limit platform: linkedin
 * Carousel / Carousels  → Format: Carousel · Platform: instagram
 * Image / Images       → Format: Image · Platform: instagram
 * Story / Stories      → Format: Story · Platform: instagram
 * Thread / Threads      → Format: thread · Max words: 500 · Highest-limit platform: twitter
 * Space / Spaces       → Format: Space · Platform: twitter
 * Song / Songs         → Format: Song · Platform: youtube
 * Audio                → Format: Audio · Platform: spotify
 * Podcast / Podcasts   → Format: Podcast · Platform: spotify
 * Newsletter           → Format: newsletter · Max words: 800 · Highest-limit platform: linkedin
 * Webinar / Webinars   → Format: Webinar · Platform: linkedin
 * Slides / Slideware   → Format: Slides · Platform: linkedin
 */

/** Word-based: show primaryFormat + Max words + platform. All others (video, image, carousel, story, audio, podcast, webinar, slides, etc.) show type label + platform only. */
const WORD_BASED_TYPES = /^(post|posts|text|blog|blogs|article|articles|thread|threads|newsletter|newsletters|white\s*paper|whitepaper)$/i;

/**
 * Label for the "intent" field on creator cards so it matches the content type:
 * - Video/Reel/Short → "Video intent"
 * - Image/Carousel → "Visual intent"
 * - Post/Article/Thread etc. → "Writing intent"
 */
export function getIntentLabelForContentType(contentType: string | undefined | null): string {
  const t = String(contentType ?? '').toLowerCase().trim();
  if (/video|reel|short/.test(t)) return 'Video intent';
  if (/image|carousel|photo/.test(t)) return 'Visual intent';
  return 'Writing intent';
}

/**
 * Strip system-only content from tone/guidance for user-facing display.
 * Users need to be informed (tone, style), not see functioning metrics (alignment score).
 */
export function toneForUserDisplay(tone: string | undefined | null): string {
  const s = String(tone ?? '').trim();
  if (!s) return '';
  return s.replace(/\s*;\s*alignment score\s*\d+\s*\/\s*100\s*$/i, '').trim();
}

function getNonWordFormatLabel(contentType: string): string {
  const t = contentType.toLowerCase().trim();
  if (/video|reel|short/.test(t)) return 'Video';
  if (/carousel/.test(t)) return 'Carousel';
  if (/image|photo/.test(t)) return 'Image';
  if (/story|stories/.test(t)) return 'Story';
  if (/space|spaces/.test(t)) return 'Space';
  if (/song|songs/.test(t)) return 'Song';
  if (/audio/.test(t)) return 'Audio';
  if (/podcast/.test(t)) return 'Podcast';
  if (/webinar/.test(t)) return 'Webinar';
  if (/slide/.test(t)) return 'Slides';
  return contentType.trim() || '—';
}

/**
 * Returns the Format line string for display. Word-based types use guidance (primaryFormat, maxWordTarget, platform);
 * all others use content-type label + platform only (no "Max words").
 */
export function getFormatLineForContentType(
  contentType: string | undefined | null,
  guidance?: ContentTypeGuidance | null,
  platformTargets?: string[] | null
): string {
  const ct = String(contentType ?? '').trim();
  const platform = guidance?.platformWithHighestLimit || platformTargets?.[0] || '—';
  const normalized = ct.replace(/^\d+\s*/, '').trim();
  const isWordBased = WORD_BASED_TYPES.test(normalized) || !ct;

  if (isWordBased) {
    const primary = guidance?.primaryFormat || '—';
    const words = guidance?.maxWordTarget != null ? ` · Max words: ${guidance.maxWordTarget}` : '';
    const plat = guidance?.platformWithHighestLimit ? ` · Highest-limit platform: ${guidance.platformWithHighestLimit}` : '';
    return `Format: ${primary}${words}${plat}`;
  }

  const formatLabel = getNonWordFormatLabel(ct);
  return `Format: ${formatLabel}${platform && platform !== '—' ? ` · Platform: ${platform}` : ''}`;
}
