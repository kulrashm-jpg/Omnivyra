/**
 * Execution ownership inference for weekly blueprint enrichment.
 * Infers execution_mode from content_type (and optional media/source signals) so every
 * execution slot clearly indicates who owns execution (AI vs creator vs conditional).
 * Enrichment-only; no schema change required.
 *
 * SOURCE OF TRUTH: execution_mode is set once during weekly enrichment (topic_slots)
 * and propagated: topic_slot → resolved_postings → daily_execution_items.
 * Downstream (daily generation, calendar, UI) must NEVER recompute; use existing value only.
 */

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

/** Type guard: use at boundaries (JSON/posting) to narrow to ExecutionMode and reject typos like "CREATOR" or "AUTO". */
export function isExecutionMode(s: unknown): s is ExecutionMode {
  return s === 'AI_AUTOMATED' || s === 'CREATOR_REQUIRED' || s === 'CONDITIONAL_AI';
}

export interface ExecutionModeContext {
  /** When true, slot is explicitly placeholder → CREATOR_REQUIRED */
  placeholder?: boolean;
  /** When true, media is ready → can treat as AI_AUTOMATED for scheduling */
  media_ready?: boolean;
  /** source === 'placeholder' → CREATOR_REQUIRED */
  source?: string;
}

const CREATOR_TYPES = new Set([
  'video', 'reel', 'short', 'audio', 'podcast', 'song',
]);
const CONDITIONAL_TYPES = new Set([
  'carousel', 'slides', 'slide', 'slideware', 'infographic', 'deck', 'presentation',
]);
const AI_AUTOMATED_TYPES = new Set([
  'text', 'post', 'article', 'thread', 'story', 'tweet', 'blog',
]);

/** Normalize before inference: trim, lowercase, remove separators (_, -, spaces). Ensures video_short, short-video, Video all map consistently. */
function normalizeContentType(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

/**
 * Infers execution_mode from content_type and optional context.
 * Content type is normalized (trim, lowercase, remove separators) so video_short, short-video, Video behave the same.
 * Rules:
 * - video, reel, short, audio, podcast, song → CREATOR_REQUIRED
 * - carousel, slides, infographic, deck, presentation → CONDITIONAL_AI
 * - text, post, article, thread, story, tweet, blog → AI_AUTOMATED
 * - placeholder/source: placeholder or !media_ready overrides to CREATOR_REQUIRED where applicable
 */
export function inferExecutionMode(
  contentType: string,
  context?: ExecutionModeContext
): ExecutionMode {
  const raw = String(contentType ?? '').trim();
  const ct = normalizeContentType(raw);
  if (!ct) return 'AI_AUTOMATED';

  if (context?.placeholder === true || (context?.source && String(context.source).toLowerCase() === 'placeholder')) {
    return 'CREATOR_REQUIRED';
  }
  if (context?.media_ready === true && [...CREATOR_TYPES].some((t) => ct.includes(t))) {
    return 'AI_AUTOMATED';
  }

  if ([...CREATOR_TYPES].some((t) => ct.includes(t))) return 'CREATOR_REQUIRED';
  if ([...CONDITIONAL_TYPES].some((t) => ct.includes(t))) return 'CONDITIONAL_AI';
  if ([...AI_AUTOMATED_TYPES].some((t) => ct.includes(t))) return 'AI_AUTOMATED';

  if (ct.includes('video') || ct.includes('reel') || ct.includes('short') || ct.includes('audio') || ct.includes('podcast')) {
    return 'CREATOR_REQUIRED';
  }
  if (ct.includes('carousel') || ct.includes('slide') || ct.includes('infographic') || ct.includes('deck') || ct.includes('presentation')) {
    return 'CONDITIONAL_AI';
  }
  if (ct.includes('text') || ct.includes('post') || ct.includes('article') || ct.includes('thread') || ct.includes('story')) {
    return 'AI_AUTOMATED';
  }

  if (raw) {
    console.debug('[execution_mode] unknown content_type:', raw);
  }
  return 'AI_AUTOMATED';
}
