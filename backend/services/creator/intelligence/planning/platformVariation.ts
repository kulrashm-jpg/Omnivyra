/**
 * Creator Planning — Phase-6 platform-variation strategy (pure).
 * ──────────────────────────────────────────────────────────────────────────
 * Deterministic per-platform deltas the planner/expander layer applies
 * ON TOP of the shared creative core. This is PLANNING logic (how the
 * same idea is framed per destination) — it does NOT re-derive strategic
 * content (that stays in the Step-2 engine + Step-3/5 adapters). No DB,
 * no scheduler, no randomness, no clock.
 *
 * Every supported destination — LinkedIn, Instagram, Facebook, TikTok,
 * YouTube Shorts, X/Twitter — gets a distinct: CTA framing, pacing
 * guidance, hook angle, metadata emphasis, and a platform hashtag.
 * `normalizePlatformKey` upstream maps twitter→x; profiles are matched
 * by substring so instagram_reels / youtube_shorts also resolve.
 */

export interface PlatformVariation {
  /** Reframes the shared CTA for this platform's native behaviour. */
  ctaFraming: (primaryCta: string) => string;
  /** Whole-asset pacing guidance for this destination. */
  pacing: string;
  /** How the hook should be angled here. */
  hookAngle: string;
  /** Metadata/SEO emphasis for packaging.meta_description + keywords. */
  metadataStrategy: string;
  /** A destination-native hashtag appended (deduped) to packaging. */
  platformHashtag: string;
  /** One-line adaptation note surfaced on the card/task. */
  note: string;
}

const PROFILES: Array<{ match: string; v: PlatformVariation }> = [
  {
    match: 'linkedin',
    v: {
      ctaFraming: (c) => `${c} — share your take in the comments`,
      pacing: 'Measured, educational pacing; insight-first opening, let points breathe.',
      hookAngle: 'Lead with the contrarian professional insight, not a gimmick.',
      metadataStrategy: 'Authority + search: long-tail professional keywords, outcome-led meta.',
      platformHashtag: '#LinkedInLearning',
      note: 'LinkedIn: authority framing, educational pacing, insight-first.',
    },
  },
  {
    match: 'instagram',
    v: {
      ctaFraming: (c) => `${c} 👉 link in bio`,
      pacing: 'Visual-first, fast cuts; CTA as an on-screen overlay.',
      hookAngle: 'Visual hook first, text overlay second.',
      metadataStrategy: 'Discovery: trend-aligned hashtags, concise scannable meta.',
      platformHashtag: '#Reels',
      note: 'Instagram: visual-first, fast cuts, overlay CTA.',
    },
  },
  {
    match: 'facebook',
    v: {
      ctaFraming: (c) => `${c} — tag someone who needs this`,
      pacing: 'Moderate pacing, clear staging for a broad audience.',
      hookAngle: 'Plain-spoken, relatable hook; no insider jargon.',
      metadataStrategy: 'Accessibility: broad keywords, community-framed meta.',
      platformHashtag: '#Community',
      note: 'Facebook: broader accessibility, community framing.',
    },
  },
  {
    match: 'tiktok',
    v: {
      ctaFraming: (c) => `${c} — follow for part 2`,
      pacing: 'Rapid cuts (1–2s), conversational energy, trend velocity.',
      hookAngle: 'Pattern-interrupt in the first 0.5s — say the surprising thing now.',
      metadataStrategy: 'Trend velocity: trending keywords, short punchy meta.',
      platformHashtag: '#FYP',
      note: 'TikTok: trend velocity, conversational pacing, pattern-interrupt.',
    },
  },
  {
    match: 'youtube',
    v: {
      ctaFraming: (c) => `${c} — subscribe so you don't miss the next one`,
      pacing: 'Retention loop; time the payoff, last frame invites a re-watch.',
      hookAngle: 'Tease the payoff up front to drive retention.',
      metadataStrategy: 'Search + retention: question-style keywords, payoff-led meta.',
      platformHashtag: '#Shorts',
      note: 'YouTube Shorts: retention loop, payoff timing, replayability.',
    },
  },
  {
    match: 'x',
    v: {
      ctaFraming: (c) => `${c} — RT if this resonates`,
      pacing: 'Punchy and concise; one sharp idea, no preamble.',
      hookAngle: 'Open with the boldest single line; thread the rest.',
      metadataStrategy: 'Conversation: terse keywords, hot-take meta.',
      platformHashtag: '#BuildInPublic',
      note: 'X/Twitter: concise, conversational, hot-take framing.',
    },
  },
];

const DEFAULT_VARIATION: PlatformVariation = {
  ctaFraming: (c) => c,
  pacing: 'Hook in 3s, one idea per beat, single CTA, captions always on.',
  hookAngle: 'Lead with the strongest line in the first 3s.',
  metadataStrategy: 'Balanced keywords, outcome-led meta description.',
  platformHashtag: '#Marketing',
  note: 'General short-form best practice.',
};

/** Resolve the variation for a (normalized) platform key. Pure. */
export function getPlatformVariation(platformKey: string): PlatformVariation {
  const k = String(platformKey ?? '').toLowerCase();
  for (const { match, v } of PROFILES) {
    if (k.includes(match)) return v;
  }
  // bare 'twitter' guard in case a caller skipped normalizePlatformKey
  if (k.includes('twitter')) return PROFILES.find((p) => p.match === 'x')!.v;
  return DEFAULT_VARIATION;
}

/** Append a platform hashtag without duplicating (case-insensitive). */
export function withPlatformHashtag(
  hashtags: string[],
  platformKey: string,
): string[] {
  const tag = getPlatformVariation(platformKey).platformHashtag;
  const seen = new Set(hashtags.map((h) => h.toLowerCase()));
  return seen.has(tag.toLowerCase()) ? hashtags.slice() : [...hashtags, tag];
}
