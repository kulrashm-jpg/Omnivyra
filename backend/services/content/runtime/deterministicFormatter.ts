/**
 * Writer Wave 3 — AI Runtime Consolidation: DETERMINISTIC FORMATTER.
 *
 * These are the transforms that must move OUT of the AI model: platform
 * char-trimming, hashtag formatting/placement, emoji spacing, and
 * capitalization/spacing normalization. The model should produce ideas and
 * prose; mechanical shaping is deterministic and belongs here.
 *
 * REUSE, DO NOT DUPLICATE:
 *   - Platform char LIMITS come from unifiedContentProcessor.PLATFORM_CHAR_LIMITS
 *     (the single source of truth). The authoritative sentence-aware truncation
 *     lives in unifiedContentProcessor.processContent; `formatViaPipeline` below
 *     delegates the full deterministic pipeline to it. The synchronous `format`
 *     applies a hard word-boundary cap using the SAME limit table so a pure/sync
 *     caller never emits over-limit text.
 *   - Hashtag helpers are wrapped from
 *     backend/services/contentGeneration/discoverabilityHelpers.ts
 *     (normalizeHashtag, appendHashtagsToVariantContent, and
 *     buildDeterministicDiscoverabilityMeta for generated discoverability tags).
 *
 * PURITY / DETERMINISM — `format` and every exported transform here are pure and
 * deterministic: no clocks, no randomness, no I/O. The same input always yields
 * byte-identical output, and every transform is IDEMPOTENT
 * (format(format(x)) === format(x)). `formatViaPipeline` is the ONE async escape
 * hatch and is explicitly NOT pure (it runs the full processContent pipeline).
 */

import {
  PLATFORM_CHAR_LIMITS,
  processContent,
  type ProcessContentInput,
} from '../../unifiedContentProcessor';
import {
  normalizeHashtag,
  appendHashtagsToVariantContent,
  buildDeterministicDiscoverabilityMeta,
} from '../../contentGeneration/discoverabilityHelpers';
import type { Formatter } from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a raw platform string for the char-limit lookup (lowercased key). */
function platformKey(platform: string | null | undefined): string {
  return String(platform ?? '').trim().toLowerCase();
}

/** Dedupe preserving first-seen order. */
function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform 1 — spacing normalization
// Collapse intra-line whitespace runs, strip line-trailing/leading spaces, cap
// blank lines at one, and remove spaces before sentence punctuation. Newlines
// that separate paragraphs are preserved. Idempotent.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeSpacing(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')          // CRLF / CR → LF
    .replace(/[ \t]+/g, ' ')          // collapse runs of spaces/tabs
    .replace(/[ \t]+\n/g, '\n')       // strip trailing spaces before a newline
    .replace(/\n[ \t]+/g, '\n')       // strip leading spaces after a newline
    .replace(/[ \t]+([,.!?;:])/g, '$1') // no space before sentence punctuation
    .replace(/\n{3,}/g, '\n\n')       // at most one blank line between blocks
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform 2 — leading capitalization
// Capitalize the first alphabetic character of the text. Conservative and
// idempotent (an already-capital first letter is unchanged). We deliberately do
// NOT touch mid-text casing to avoid mangling acronyms/brand names.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeCapitalization(text: string): string {
  return String(text ?? '').replace(/^(\s*)([a-z])/, (_m, ws: string, ch: string) => ws + ch.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform 3 — emoji spacing
// Ensure a single space between an emoji and an adjacent alphanumeric character
// so emoji never fuse onto words. Idempotent: once a space exists the adjacency
// no longer matches.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeEmojiSpacing(text: string): string {
  return String(text ?? '')
    .replace(/([A-Za-z0-9])(\p{Extended_Pictographic})/gu, '$1 $2')
    .replace(/(\p{Extended_Pictographic})([A-Za-z0-9])/gu, '$1 $2');
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform 4 — hashtag formatting + placement
// Extract every inline hashtag, normalize each via the shared normalizeHashtag
// (lowercased, stripped to [a-z0-9_]), dedupe, remove them from the body, and
// re-emit them as a single trailing block on their own line. Placement only —
// it never invents new tags. Idempotent.
// ─────────────────────────────────────────────────────────────────────────────

const HASHTAG_RE = /#[A-Za-z0-9_]+/g;

export function formatHashtags(text: string): string {
  const source = String(text ?? '');
  const found = source.match(HASHTAG_RE);
  if (!found || found.length === 0) return source;

  const normalized = uniqueInOrder(found.map(normalizeHashtag).filter(Boolean));
  const body = normalizeSpacing(source.replace(HASHTAG_RE, ' '));
  if (normalized.length === 0) return body;
  return `${body}\n\n${normalized.join(' ')}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform 5 — platform char cap
// Trim to the platform's hard ceiling from the SINGLE source of truth
// (PLATFORM_CHAR_LIMITS). Word-boundary cut, no ellipsis — a plain, idempotent
// guard. The authoritative sentence-aware truncation is in processContent and is
// reachable via formatViaPipeline; this sync cap never emits over-limit text.
// ─────────────────────────────────────────────────────────────────────────────

export function capToPlatformLimit(text: string, platform: string): string {
  const limit = PLATFORM_CHAR_LIMITS[platformKey(platform)];
  const source = String(text ?? '');
  if (!limit || source.length <= limit) return source;
  const slice = source.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > limit * 0.8 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
// The composed deterministic formatter (implements the Formatter contract).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure, deterministic, idempotent formatting pipeline. Order:
 *   1. spacing normalization
 *   2. leading capitalization
 *   3. emoji spacing
 *   4. hashtag formatting + placement
 *   5. platform char cap (PLATFORM_CHAR_LIMITS)
 *
 * `contentType` is accepted for interface parity and future per-type shaping; it
 * does not affect the current deterministic transforms.
 */
export function format(text: string, platform: string, _contentType?: string): string {
  let out = String(text ?? '');
  out = normalizeSpacing(out);
  out = normalizeCapitalization(out);
  out = normalizeEmojiSpacing(out);
  out = formatHashtags(out);
  out = capToPlatformLimit(out, platform);
  return out.trim();
}

/** Named alias for `format` (positional signature). */
export const formatDeterministic = format;

/** The Formatter-contract implementation. */
export const deterministicFormatter: Formatter = {
  format,
};

// ─────────────────────────────────────────────────────────────────────────────
// Discoverability hashtag wrapper — GENERATES platform-aware hashtags from the
// content and appends them, wrapping the existing deterministic helpers. Kept
// separate from `format` (which only PLACES existing tags) because generation is
// a distinct, opt-in operation. Deterministic in its hashtag output (only the
// helper's `generated_at` timestamp field, which we never read, is time-based).
// ─────────────────────────────────────────────────────────────────────────────

export function appendDiscoverabilityHashtags(
  text: string,
  platform: string,
  contentType = 'post',
): string {
  const meta = buildDeterministicDiscoverabilityMeta(String(text ?? ''), platform, contentType);
  const maxLength = PLATFORM_CHAR_LIMITS[platformKey(platform)];
  return appendHashtagsToVariantContent(String(text ?? ''), meta, maxLength);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-pipeline delegation — the ONE async, NON-pure escape hatch. Runs the
// canonical processContent pipeline (language refinement, structural/visual
// shaping, sentence-aware char enforcement, validation). Use this when a caller
// wants the authoritative deterministic pipeline rather than the sync transforms.
// ─────────────────────────────────────────────────────────────────────────────

export async function formatViaPipeline(
  text: string,
  platform: string,
  contentType?: string,
  extra?: Partial<ProcessContentInput>,
): Promise<string> {
  const result = await processContent({
    content: String(text ?? ''),
    platform,
    content_type: contentType,
    enforce_char_limit: true,
    ...extra,
  });
  return result.content;
}
