/**
 * BOLT format governance facade.
 *
 * Single entry point for "is this set of formats acceptable for the
 * given BOLT campaign mode?" — composes the existing two registries:
 *
 *   - Creator formats   → creatorGovernanceRegistry (canonical)
 *   - Text formats      → boltTextContentConfig    (BOLT_TEXT_CONTENT_TYPES)
 *
 * The original code paths kept these two registries separate AND
 * checked them at different layers (HTTP handler, pre-validate stage,
 * planner, scheduler). That worked when only creator formats had
 * governance, but it allowed text-mode strategies with an unsupported
 * text format (e.g. `blog`, `whitepaper`, `video`) to reach deep
 * pipeline stages and fail with a generic message.
 *
 * This facade is the ONE place callers should ask "is this format
 * valid?". It does not duplicate the per-registry knowledge — it
 * delegates. Adding a new format means updating the underlying
 * registry, not this file.
 *
 * Regression-protected formats (must continue to be accepted):
 *
 *   - Creator: carousel, story         (and the rest of the registry)
 *   - Text:    article, feed_post, post, tweet, poll
 *
 * "feed_post" is treated as an alias for "post" — the planner emits
 * `feed_post` for LinkedIn/X feed items but the user-facing format
 * picker uses "post". Both should pass validation.
 */

import {
  getCreatorFormatsFromExecutionConfig,
  getUnsupportedCreatorFormats,
} from '../creatorGovernanceRegistry';
import {
  BOLT_TEXT_CONTENT_TYPES,
  BOLT_EXCLUDED_CONTENT_TYPES,
} from '../../../backend/utils/boltTextContentConfig';

export type BoltCampaignMode = 'text' | 'creator' | 'combined';

/** Aliases the user-facing picker collapses into canonical text formats.
 *  Mirrors the planner's internal naming (feed_post → post). */
const TEXT_FORMAT_ALIASES: Record<string, string> = {
  feed_post: 'post',
  linkedin_post: 'post',
  twitter_post: 'tweet',
  x_post: 'tweet',
  microblog: 'tweet',
  shortstory: 'short_story',
  'short-story': 'short_story',
  blog_article: 'article',
};

function normalizeTextFormat(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return '';
  return TEXT_FORMAT_ALIASES[s] ?? s;
}

/** Canonical set of text formats BOLT accepts (after alias normalization). */
export function getSupportedTextFormats(): string[] {
  return [...BOLT_TEXT_CONTENT_TYPES];
}

/** True iff `format` is a registered BOLT text format (or alias). */
export function isSupportedTextFormat(format: unknown): boolean {
  const canon = normalizeTextFormat(format);
  if (!canon) return false;
  if (BOLT_EXCLUDED_CONTENT_TYPES.has(canon)) return false;
  return BOLT_TEXT_CONTENT_TYPES.has(canon);
}

/** Returns the subset of `formats` that are NOT supported text formats. */
export function getUnsupportedTextFormats(formats: unknown[]): string[] {
  if (!Array.isArray(formats)) return [];
  const bad: string[] = [];
  for (const f of formats) {
    const canon = normalizeTextFormat(f);
    if (!canon) continue;
    if (!isSupportedTextFormat(canon)) bad.push(String(f));
  }
  return bad;
}

/** Pulls text formats from an execution config, normalising aliases. */
export function getTextFormatsFromExecutionConfig(config: unknown): string[] {
  const obj = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const fromText = Array.isArray(obj.text_formats) ? obj.text_formats : [];
  const fromContent = Array.isArray(obj.content_formats) ? obj.content_formats : [];
  // Combined-mode strategies emit text formats under `content_formats`
  // alongside creator formats — partition by registry membership.
  const candidates = [...fromText, ...fromContent];
  const canonicals = new Set<string>();
  for (const raw of candidates) {
    const canon = normalizeTextFormat(raw);
    if (canon && BOLT_TEXT_CONTENT_TYPES.has(canon)) canonicals.add(canon);
  }
  return [...canonicals];
}

export interface FormatValidationResult {
  ok: boolean;
  unsupportedCreator: string[];
  unsupportedText: string[];
  /** Combined campaigns must have at least one format from EITHER registry. */
  noFormatsSelected: boolean;
}

/**
 * Validate all formats present in an execution config against both registries.
 *
 * Pure function. Returns the offending formats grouped by registry so
 * callers can produce specific error messages. Does NOT throw — the
 * caller decides whether to short-circuit with a BoltError.
 */
export function validateExecutionConfigFormats(
  executionConfig: Record<string, unknown> | null | undefined,
  campaignMode: BoltCampaignMode
): FormatValidationResult {
  const ec = executionConfig ?? {};
  const creatorFormats = campaignMode === 'creator' || campaignMode === 'combined'
    ? getCreatorFormatsFromExecutionConfig(ec)
    : [];
  const textFormats = campaignMode === 'text' || campaignMode === 'combined'
    ? getTextFormatsFromExecutionConfig(ec)
    : [];

  // Even for text-mode, also check the RAW text_formats AND content_formats
  // arrays for entries that aren't registered. getTextFormatsFromExecutionConfig
  // silently drops unknowns when partitioning by registry, so we have to
  // walk the raw input to detect them.
  const stray: string[] = [];
  if (campaignMode === 'text' || campaignMode === 'combined') {
    const rawText = Array.isArray((ec as { text_formats?: unknown }).text_formats)
      ? ((ec as { text_formats: unknown[] }).text_formats)
      : [];
    const rawContent = campaignMode === 'text' && Array.isArray((ec as { content_formats?: unknown }).content_formats)
      ? ((ec as { content_formats: unknown[] }).content_formats)
      : [];
    for (const raw of [...rawText, ...rawContent]) {
      const canon = normalizeTextFormat(raw);
      // Empty/blank entries silently dropped. Non-empty entries that
      // don't normalise to a registered text format become stray.
      if (canon && !BOLT_TEXT_CONTENT_TYPES.has(canon)) stray.push(String(raw));
    }
  }

  // In combined mode `getCreatorFormatsFromExecutionConfig` reads the MERGED
  // content_formats/format_frequency, so BOLT-text formats (post, tweet,
  // article, poll, short_story) appear in the creator set. A format that is a
  // valid BOLT text format is NOT an "unsupported creator format" — it belongs
  // to the text lane — so it must never be flagged here.
  const unsupportedCreator = creatorFormats.length > 0
    ? getUnsupportedCreatorFormats(creatorFormats).filter((f) => !isSupportedTextFormat(f))
    : [];
  const unsupportedText = [
    ...getUnsupportedTextFormats(textFormats),
    ...stray,
  ];
  // Empty text_formats is only a problem when no other formats are
  // present. Need to consider the raw input — combined-mode may declare
  // text via content_formats which already got partitioned into textFormats.
  const noFormatsSelected = creatorFormats.length === 0
    && textFormats.length === 0
    && stray.length === 0;

  return {
    ok: unsupportedCreator.length === 0 && unsupportedText.length === 0 && !noFormatsSelected,
    unsupportedCreator,
    unsupportedText,
    noFormatsSelected,
  };
}

/**
 * Determine the campaign mode from execution config.
 * Defaults to 'text' when missing — preserves prior behavior of
 * deriveBoltCampaignType which used 'bolt-text' as the default tag.
 */
export function resolveCampaignMode(executionConfig: unknown): BoltCampaignMode {
  const m = String((executionConfig as { campaign_mode?: unknown } | null | undefined)?.campaign_mode ?? '')
    .toLowerCase()
    .trim();
  if (m === 'creator') return 'creator';
  if (m === 'combined') return 'combined';
  return 'text';
}
