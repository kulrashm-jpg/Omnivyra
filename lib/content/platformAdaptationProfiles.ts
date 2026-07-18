/**
 * Canonical per-platform adaptation profiles (Wave 2 — cross-platform
 * originality).
 *
 * PURPOSE — this module is the ONE authoritative source for how a given
 * platform's variant should read. Before this existed, the batch variant
 * generator routed threads / youtube_community / tiktok / pinterest / reddit to
 * a single shared `'Neutral adaptation with clear readability.'` style, so those
 * surfaces could collide on byte-identical output. Every listed platform now
 * carries its OWN distinct `styleDirective` (no two platforms share one), which
 * eliminates the generic fallback entirely.
 *
 * DETERMINISM — this is a static, side-effect-free lookup. It introduces no
 * randomness and is safe to call inside temperature-0 generation paths; the same
 * platform key always yields the same profile.
 *
 * BACKWARD COMPATIBILITY — the five platforms that already had explicit style
 * strings (linkedin, facebook, x, instagram, youtube) keep directives that are
 * equivalent in intent to the legacy `PLATFORM_STYLE_MAP`, so their generated
 * output does not regress. `twitter` is the legacy alias of `x`; it resolves to
 * its own X-native profile (distinct wording, same fast-feed intent) rather than
 * sharing X's string verbatim.
 */

export interface PlatformAdaptationProfile {
  /** Canonical, normalized platform key (e.g. 'x', 'youtube_community'). */
  platform: string;
  /**
   * The distinct per-platform style directive fed to the rewriter. MUST be
   * materially distinct from every other profile's directive — this is what
   * prevents cross-platform output collisions.
   */
  styleDirective: string;
  /** How the opening hook should read on this surface. */
  hookStyle: string;
  /** Native call-to-action style for this platform. */
  ctaStyle: string;
  /** Emoji count + role guidance (empty string ⇒ no emojis on this platform). */
  emojiPolicy: string;
  /** Structural / formatting conventions a native reader expects. */
  formatting: string;
  /** Natural reading length range, in words, for this surface. */
  wordRange: [number, number];
  /**
   * One-line note stating what makes this platform's voice distinct from its
   * neighbours — the anti-collision rationale, human-readable.
   */
  differentiationNote: string;
}

/**
 * Canonical registry. Keys are the normalized platform identifiers. No two
 * entries share a `styleDirective`.
 */
const PLATFORM_ADAPTATION_PROFILES: Record<string, PlatformAdaptationProfile> = {
  linkedin: {
    platform: 'linkedin',
    // Parity: equivalent in intent to legacy PLATFORM_STYLE_MAP.linkedin.
    styleDirective: 'Professional tone, clear structure, slightly longer form with practical insight.',
    hookStyle: 'Credible insight-led opener in the first 1-2 lines, above the "see more" fold.',
    ctaStyle: 'Reflective question or professional next step (e.g. "DM me to compare notes"), on its own line.',
    emojiPolicy: '0-2 emojis, only to reinforce a point — never decorative.',
    formatting: 'Short professional paragraphs separated by line breaks; 3-5 hashtags at the end on their own line.',
    wordRange: [120, 220],
    differentiationNote: 'Authoritative B2B thought-leadership voice — the most formal surface in the set.',
  },
  facebook: {
    platform: 'facebook',
    // Parity: equivalent in intent to legacy PLATFORM_STYLE_MAP.facebook.
    styleDirective: 'Conversational voice, engagement-focused flow, short paragraphs.',
    hookStyle: 'Warm, relatable opener that reads easily for a broad audience.',
    ctaStyle: 'Natural engagement prompt or next step (e.g. "Comment below if this resonates").',
    emojiPolicy: '2-4 emojis for warmth — never more than one per line.',
    formatting: '1-2 sentence paragraphs to survive the "See more" fold; 0-3 hashtags; inline link at the end.',
    wordRange: [60, 110],
    differentiationNote: 'Broad, friendly, community-living-room tone — warmer and less punchy than X.',
  },
  x: {
    platform: 'x',
    // Parity: equivalent in intent to legacy PLATFORM_STYLE_MAP.x.
    styleDirective: 'Concise and punchy style, high information density.',
    hookStyle: 'One sharp point or contrarian insight in the opening line.',
    ctaStyle: 'Single low-friction CTA that fits the 280-char budget (e.g. "Learn more →", a quote-tweet prompt).',
    emojiPolicy: '1-2 emojis, placed to punctuate a beat — not decorating every line.',
    formatting: 'Short punchy lines, not paragraphs; 280-char hard limit; max 2 hashtags on their own final line.',
    wordRange: [25, 45],
    differentiationNote: 'Fast-feed, single-idea density — the tightest, most information-dense surface.',
  },
  twitter: {
    platform: 'twitter',
    // twitter is the legacy alias of X. Distinct wording, same fast-feed intent
    // (byte-identical directives are exactly the collision this module removes).
    styleDirective: 'Terse, timeline-native phrasing for the legacy X feed — one sharp idea, maximum signal per character.',
    hookStyle: 'Open on the single strongest claim; no wind-up, no throat-clearing.',
    ctaStyle: 'One low-friction CTA sized for the 280-char budget (e.g. "Try it free", a reply-bait question).',
    emojiPolicy: '1-2 emojis used as beats, never as decoration.',
    formatting: 'Line-per-thought, blank line between thought groups; 280-char cap; max 2 trailing hashtags.',
    wordRange: [25, 45],
    differentiationNote: 'Legacy alias of X: same fast-feed native voice, kept as its own profile so it never collides byte-for-byte with x.',
  },
  instagram: {
    platform: 'instagram',
    // Parity: equivalent in intent to legacy PLATFORM_STYLE_MAP.instagram.
    styleDirective: 'Emotionally resonant and visually descriptive tone, hashtag-friendly ending.',
    hookStyle: 'Scroll-stopping first line that works as a standalone preview.',
    ctaStyle: 'Action prompt respecting the no-clickable-link reality (e.g. "Link in bio 👆", "Save this").',
    emojiPolicy: '3-6 emojis distributed naturally for rhythm and warmth.',
    formatting: 'Short emotional/story blocks separated by line breaks; 5-10 hashtags grouped at the very end.',
    wordRange: [80, 150],
    differentiationNote: 'Caption-native, visual-first, emotionally warm — never a LinkedIn post in disguise.',
  },
  youtube: {
    platform: 'youtube',
    // Parity: verbatim carry-over of the legacy PLATFORM_STYLE_MAP.youtube
    // two-part TITLE + DESCRIPTION directive so YouTube output does not regress.
    styleDirective:
      'Output for YouTube in TWO parts separated by a blank line. FIRST LINE = a compelling, SEO-optimized video TITLE, keyword front-loaded, max 70 characters, no hashtags. Then a blank line, then the DESCRIPTION: a strong hook in the first 1-2 lines (shown above the fold), followed by the value/detail, a clear call-to-action, and finish with 3-5 relevant hashtags on the last line.',
    hookStyle: 'Keyword-front-loaded SEO title, then a strong description hook in the first 1-2 lines (above the fold).',
    ctaStyle: 'Explicit description CTA (subscribe, watch, click) before the hashtag block.',
    emojiPolicy: '0-2 emojis in the description; never in the title.',
    formatting: 'TITLE line, blank line, DESCRIPTION with structured paragraphs; 3-5 hashtags on the last line.',
    wordRange: [70, 160],
    differentiationNote: 'The only surface that emits a separate SEO title + description — search-and-watch intent.',
  },
  youtube_community: {
    platform: 'youtube_community',
    styleDirective:
      'Short YouTube Community-tab update — a direct, familiar note to existing subscribers. NO SEO title, NO description structure; poll- and question-friendly phrasing that invites the channel community to react.',
    hookStyle: 'Familiar, in-the-know opener that assumes the reader already follows the channel.',
    ctaStyle: 'Community engagement prompt (vote in the poll, comment your take, tap 👍) — never an SEO/search CTA.',
    emojiPolicy: '1-3 emojis for a friendly, community-insider tone.',
    formatting: '1-2 short paragraphs; optional poll-style question; no title line and no hashtag SEO block.',
    wordRange: [20, 60],
    differentiationNote: 'Distinct from youtube: a subscriber-facing community post, not a searchable video listing — no title, no SEO description.',
  },
  threads: {
    platform: 'threads',
    styleDirective:
      'Casual, candid, conversation-starting voice — reply-bait phrasing that invites the community to weigh in. Looser and more personal than X, never a repackaged tweet.',
    hookStyle: 'Opinionated or curious opener that begs a reply.',
    ctaStyle: 'Soft conversational prompt ("What am I missing?", "Curious what you\'d do") — invite replies, not clicks.',
    emojiPolicy: '1-3 emojis for a relaxed, human tone.',
    formatting: 'Short conversational lines; blank line between beats; 0-2 hashtags only if genuinely relevant.',
    wordRange: [20, 60],
    differentiationNote: 'Distinct from X: looser, chattier, reply-first — a conversation opener, not a dense one-liner.',
  },
  pinterest: {
    platform: 'pinterest',
    styleDirective:
      'Search-first, benefit-led pin copy — keyword-rich and outcome-oriented. Lead with the searchable topic; read like a Pin description, not a social caption.',
    hookStyle: 'Front-loaded searchable topic or concrete outcome in the first 100 characters.',
    ctaStyle: 'Benefit-led, search-aligned CTA ("Save for later", "Click to read the full guide").',
    emojiPolicy: '1-2 emojis only — Pinterest copy is search-driven, not decorative; never open on an emoji.',
    formatting: 'Keyword-rich sentence(s), 500-char cap; 2-3 hashtags max, no hashtag spam.',
    wordRange: [20, 40],
    differentiationNote: 'Search-engine intent, not feed intent — indexable keywords over conversation.',
  },
  tiktok: {
    platform: 'tiktok',
    styleDirective:
      'Creator-native, high-energy, hook-forward phrasing built for short attention spans. Compact and punchy; sound like creator copy, never corporate.',
    hookStyle: 'Immediate curiosity gap on the very first line.',
    ctaStyle: 'Creator-native prompt ("Follow for part 2", "Comment YES for the breakdown") — no corporate "Learn more", no links.',
    emojiPolicy: '2-3 emojis — one on the hook line, the rest sparingly.',
    formatting: 'Rapid compact phrasing, strongest captions under 150 chars; 3-5 hashtags (trend + niche); no inline URLs.',
    wordRange: [15, 35],
    differentiationNote: 'Youngest, fastest, most informal voice — creator slang over brand polish.',
  },
  reddit: {
    platform: 'reddit',
    styleDirective:
      'Plain, unpolished, community-native voice with zero marketing gloss — sound like a real user contributing to a discussion, not a brand posting an ad.',
    hookStyle: 'Lead with substance or a genuine observation; no brand hook.',
    ctaStyle: 'NO marketing CTA — close with an authentic discussion prompt ("Curious how others have handled this?").',
    emojiPolicy: '',
    formatting: 'Longer plain-text body, lead with the insight; NO hashtags and NO emojis; no corporate tone.',
    wordRange: [80, 200],
    differentiationNote: 'The only anti-promotional surface — community trust over marketing; punished for salesy phrasing.',
  },
};

/**
 * Alternate spellings / shorthands that normalize onto a canonical key. Note
 * `twitter` is NOT here — it is a first-class profile of its own (the legacy X
 * alias) and must keep its distinct entry.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  'youtubecommunity': 'youtube_community',
  'youtube community': 'youtube_community',
  'youtube-community': 'youtube_community',
  'yt_community': 'youtube_community',
  'yt community': 'youtube_community',
  'yt': 'youtube',
  'ig': 'instagram',
  'insta': 'instagram',
  'fb': 'facebook',
  'li': 'linkedin',
};

/** Normalizes a raw platform string to a canonical registry key. */
function normalizePlatformKey(platform: string | null | undefined): string {
  const raw = String(platform ?? '').trim().toLowerCase();
  if (!raw) return 'unknown';
  // Collapse separators for community-tab spellings while leaving single-token
  // keys untouched (so 'youtube_community' stays as-is via the direct hit).
  const compact = raw.replace(/[\s-]+/g, '_');
  if (PLATFORM_ADAPTATION_PROFILES[compact]) return compact;
  if (PLATFORM_ALIASES[raw]) return PLATFORM_ALIASES[raw];
  if (PLATFORM_ALIASES[compact]) return PLATFORM_ALIASES[compact];
  return compact;
}

/**
 * Returns the canonical adaptation profile for a platform.
 *
 * NEVER returns the legacy generic `'Neutral adaptation with clear readability.'`
 * fallback. Every listed platform has a real, distinct profile. A truly-unknown
 * platform receives a minimal but platform-NAMED profile whose directive still
 * references that platform's name — not the shared generic string.
 */
export function getPlatformProfile(platform: string | null | undefined): PlatformAdaptationProfile {
  const key = normalizePlatformKey(platform);
  const known = PLATFORM_ADAPTATION_PROFILES[key];
  if (known) return known;

  // Unknown platform — synthesize a minimal, platform-named profile. The
  // directive names the platform so no two unknown platforms collide and so it
  // never degrades to the generic 'Neutral adaptation' string.
  const label = key === 'unknown' ? 'this platform' : key;
  return {
    platform: key,
    styleDirective: `Native adaptation tailored for ${label} — match that surface's own pacing, tone, and conventions rather than a generic template.`,
    hookStyle: `Open in a way that reads naturally to a ${label} audience.`,
    ctaStyle: `Close with a single next step appropriate to ${label}.`,
    emojiPolicy: 'Use emojis only if they suit the platform; otherwise omit them.',
    formatting: `Follow the structural conventions a native ${label} reader expects.`,
    wordRange: [40, 120],
    differentiationNote: `Synthesized profile for an unlisted platform (${label}); still platform-named, never the shared generic fallback.`,
  };
}

/** Returns every canonical (listed) platform profile. Excludes synthesized/unknown. */
export function listPlatformProfiles(): PlatformAdaptationProfile[] {
  return Object.values(PLATFORM_ADAPTATION_PROFILES);
}

/** The canonical platform keys that have a real, distinct profile. */
export function listPlatformKeys(): string[] {
  return Object.keys(PLATFORM_ADAPTATION_PROFILES);
}
