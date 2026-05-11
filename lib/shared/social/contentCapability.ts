/**
 * Content Capability Normalization
 * ──────────────────────────────────────────────────────────────────────────
 * The codebase carries several overlapping signals for "what kind of content
 * was generated":
 *   - `format_family`  (adaptation_trace, e.g. 'short_text' | 'long_form' |
 *                       'video' | 'visual_sequence')
 *   - `content_type`   ('post' | 'article' | 'video' | 'reel' | 'carousel' …)
 *   - workflow / output mode (UI route hints)
 *   - campaignType     (planner-level intent)
 *
 * None of these are interchangeable. `normalizeContentCapability` is the
 * SINGLE place that collapses them into one canonical `ContentCapability` for
 * downstream filtering and validation.
 *
 * Per architectural constraint #1: no UI guessing, no route-based assumptions,
 * no platform-specific overrides. If the input doesn't map cleanly we return
 * `null` so callers can fail closed rather than fall back to "show all".
 */

import type { ContentCapability } from './platformCapabilities';

export interface NormalizeContentCapabilityInput {
  /** From `platform_variant.adaptation_trace.format_family`. */
  formatFamily?: string | null;
  /** Generic content_type (e.g. 'post', 'article', 'reel'). */
  contentType?: string | null;
  /** Workflow signal (e.g. 'writer', 'social-post'); optional. */
  workflowType?: string | null;
  /** Output mode signal (e.g. 'text', 'media', 'creator'); optional. */
  outputMode?: string | null;
  /** Campaign planner intent (e.g. 'thought-leadership', 'creator'). */
  campaignType?: string | null;
}

const FORMAT_FAMILY_MAP: Record<string, ContentCapability> = {
  short_text: 'text',
  long_form: 'writer',
  longform: 'writer',
  long: 'writer',
  visual_sequence: 'carousel',
  visual: 'image',
  image: 'image',
  video: 'video',
  reel: 'creator',
  short: 'creator',
  story: 'creator',
};

const CONTENT_TYPE_MAP: Record<string, ContentCapability> = {
  post: 'text',
  tweet: 'text',
  feed_post: 'text',
  poll: 'text',
  thread: 'writer',
  short_story: 'text',
  article: 'writer',
  blog: 'writer',
  newsletter: 'writer',
  white_paper: 'writer',
  carousel: 'carousel',
  image: 'image',
  idea_pin: 'image',
  video: 'video',
  reel: 'creator',
  short: 'creator',
  story: 'creator',
};

const WORKFLOW_MAP: Record<string, ContentCapability> = {
  writer: 'writer',
  longform: 'writer',
  text: 'text',
  social_post: 'text',
  'social-post': 'text',
  reel: 'creator',
  creator: 'creator',
  video: 'video',
};

const OUTPUT_MODE_MAP: Record<string, ContentCapability> = {
  text: 'text',
  longform: 'writer',
  writer: 'writer',
  image: 'image',
  carousel: 'carousel',
  video: 'video',
  creator: 'creator',
  reel: 'creator',
};

const CAMPAIGN_TYPE_MAP: Record<string, ContentCapability> = {
  thought_leadership: 'writer',
  'thought-leadership': 'writer',
  longform: 'writer',
  social: 'text',
  creator: 'creator',
  video: 'video',
  visual: 'image',
};

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Resolve a single canonical `ContentCapability` from the available signals.
 *
 * Priority (most-specific → least):
 *   1. format_family  (this is what the generator emits)
 *   2. content_type   (next-most authoritative)
 *   3. workflowType
 *   4. outputMode
 *   5. campaignType
 *
 * Returns `null` if no signal maps to a known capability. Callers MUST treat
 * `null` as "do not filter — show nothing" (fail closed) rather than as a
 * synonym for "any capability."
 */
export function normalizeContentCapability(
  input: NormalizeContentCapabilityInput,
): ContentCapability | null {
  const ff = clean(input.formatFamily);
  if (ff && FORMAT_FAMILY_MAP[ff]) return FORMAT_FAMILY_MAP[ff];

  const ct = clean(input.contentType);
  if (ct && CONTENT_TYPE_MAP[ct]) return CONTENT_TYPE_MAP[ct];

  const wf = clean(input.workflowType);
  if (wf && WORKFLOW_MAP[wf]) return WORKFLOW_MAP[wf];

  const om = clean(input.outputMode);
  if (om && OUTPUT_MODE_MAP[om]) return OUTPUT_MODE_MAP[om];

  const cp = clean(input.campaignType);
  if (cp && CAMPAIGN_TYPE_MAP[cp]) return CAMPAIGN_TYPE_MAP[cp];

  return null;
}
