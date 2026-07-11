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

/* ── Campaign business-rule limits (CAMPAIGN-IMPL-001) ─────────────────────
 * Canonical numeric limits. These are the SINGLE source of truth for the
 * server validator, the planner clamp, and the campaign-builder UIs.
 *
 *   Writer campaign : ≤2 writer types, each ≤3/week.
 *   Creator campaign: ≤2 creator types, each ≤3/week.
 *   Intelligent Mix : ≤2 writer + ≤2 creator types; ≤5 writer TOTAL/week and
 *                     ≤5 creator TOTAL/week (the combined-lane caps).
 * The lane-total cap applies only to the mix (combined) — writer-only and
 * creator-only campaigns are bounded by (2 types × 3) alone. */
export const CAMPAIGN_LIMITS = {
  MAX_TYPES_PER_LANE: 2,
  MAX_FREQUENCY_PER_TYPE: 3,
  MAX_MIX_LANE_TOTAL: 5,
} as const;

/** Read the format_frequency object off an execution config, canonicalising
 *  keys (feed_post → post, …) so lookups match the resolved format lists. */
function normalizedFrequencyMap(ec: Record<string, unknown>): Map<string, number> {
  const raw = ec.format_frequency;
  const ff = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const map = new Map<string, number>();
  for (const [k, v] of Object.entries(ff)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    const key = normalizeTextFormat(k); // creator keys pass through lowercased/unaliased
    map.set(key, Math.max(map.get(key) ?? 0, Math.round(n)));
  }
  return map;
}

export interface CampaignLimitViolation {
  code: 'WRITER_TYPE_COUNT' | 'CREATOR_TYPE_COUNT' | 'PER_TYPE_FREQUENCY' | 'WRITER_TOTAL_FREQUENCY' | 'CREATOR_TOTAL_FREQUENCY';
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface CampaignLimitsResult {
  ok: boolean;
  violations: CampaignLimitViolation[];
  writerTypes: string[];
  creatorTypes: string[];
  writerTotal: number;
  creatorTotal: number;
}

/**
 * Validate the canonical campaign business rules against an execution config.
 * Pure — no DB, no throw. Returns every violation so the caller can surface
 * the first precisely. Only the lanes that apply to `campaignMode` are checked.
 */
export function validateCampaignLimits(
  executionConfig: Record<string, unknown> | null | undefined,
  campaignMode: BoltCampaignMode,
): CampaignLimitsResult {
  const ec = executionConfig ?? {};
  const writerTypes = campaignMode === 'text' || campaignMode === 'combined'
    ? getTextFormatsFromExecutionConfig(ec)
    : [];
  // In combined mode the creator getter returns text formats too (merged
  // content_formats) — strip them so we only count real creator types.
  const creatorTypes = campaignMode === 'creator' || campaignMode === 'combined'
    ? getCreatorFormatsFromExecutionConfig(ec).filter((f) => !isSupportedTextFormat(f))
    : [];

  const freq = normalizedFrequencyMap(ec);
  const freqOf = (t: string): number => freq.get(normalizeTextFormat(t)) ?? 1; // planner floors selected types to 1
  const writerTotal = writerTypes.reduce((s, t) => s + freqOf(t), 0);
  const creatorTotal = creatorTypes.reduce((s, t) => s + freqOf(t), 0);

  const violations: CampaignLimitViolation[] = [];
  const { MAX_TYPES_PER_LANE, MAX_FREQUENCY_PER_TYPE, MAX_MIX_LANE_TOTAL } = CAMPAIGN_LIMITS;

  if (writerTypes.length > MAX_TYPES_PER_LANE) {
    violations.push({
      code: 'WRITER_TYPE_COUNT', field: 'text_formats',
      message: `At most ${MAX_TYPES_PER_LANE} writer content types are allowed (received ${writerTypes.length}: ${writerTypes.join(', ')}).`,
      details: { writer_types: writerTypes, max: MAX_TYPES_PER_LANE },
    });
  }
  if (creatorTypes.length > MAX_TYPES_PER_LANE) {
    violations.push({
      code: 'CREATOR_TYPE_COUNT', field: 'creator_formats',
      message: `At most ${MAX_TYPES_PER_LANE} creator content types are allowed (received ${creatorTypes.length}: ${creatorTypes.join(', ')}).`,
      details: { creator_types: creatorTypes, max: MAX_TYPES_PER_LANE },
    });
  }
  // Per-type frequency: only flag an explicitly-set value over the cap.
  for (const t of [...writerTypes, ...creatorTypes]) {
    const set = freq.get(normalizeTextFormat(t));
    if (set != null && set > MAX_FREQUENCY_PER_TYPE) {
      violations.push({
        code: 'PER_TYPE_FREQUENCY', field: 'format_frequency',
        message: `"${t}" is set to ${set}/week; the maximum is ${MAX_FREQUENCY_PER_TYPE}/week.`,
        details: { format: t, frequency: set, max: MAX_FREQUENCY_PER_TYPE },
      });
    }
  }
  // Lane totals apply ONLY to Intelligent Mix (combined).
  if (campaignMode === 'combined') {
    if (writerTotal > MAX_MIX_LANE_TOTAL) {
      violations.push({
        code: 'WRITER_TOTAL_FREQUENCY', field: 'format_frequency',
        message: `Writer output is ${writerTotal}/week; Intelligent Mix allows at most ${MAX_MIX_LANE_TOTAL} writer posts/week.`,
        details: { writer_total: writerTotal, max: MAX_MIX_LANE_TOTAL },
      });
    }
    if (creatorTotal > MAX_MIX_LANE_TOTAL) {
      violations.push({
        code: 'CREATOR_TOTAL_FREQUENCY', field: 'format_frequency',
        message: `Creator output is ${creatorTotal}/week; Intelligent Mix allows at most ${MAX_MIX_LANE_TOTAL} creator posts/week.`,
        details: { creator_total: creatorTotal, max: MAX_MIX_LANE_TOTAL },
      });
    }
  }

  return { ok: violations.length === 0, violations, writerTypes, creatorTypes, writerTotal, creatorTotal };
}

/**
 * Planner defence-in-depth: clamp a format_frequency map down to the business
 * limits so the planner can NEVER generate an invalid campaign even if a
 * payload bypasses the server validator (internal re-execution, an existing
 * over-limit saved campaign). Drops types beyond the lane cap, clamps per-type
 * frequency to ≤3, and (for a mix — both lanes present, or `combined`) trims
 * each lane total to ≤5. Returns a NEW object; never mutates the input.
 */
export function clampCampaignFormatFrequency(
  formatFrequency: Record<string, number> | null | undefined,
  campaignMode?: BoltCampaignMode,
): Record<string, number> | null {
  if (!formatFrequency || typeof formatFrequency !== 'object' || Array.isArray(formatFrequency)) return null;
  const { MAX_TYPES_PER_LANE, MAX_FREQUENCY_PER_TYPE, MAX_MIX_LANE_TOTAL } = CAMPAIGN_LIMITS;
  const entries: Array<[string, number]> = [];
  for (const [k, v] of Object.entries(formatFrequency)) {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n > 0) entries.push([k, n]);
  }
  const writer = entries.filter(([k]) => isSupportedTextFormat(k));
  const creator = entries.filter(([k]) => !isSupportedTextFormat(k));
  // A mix if the mode says so, or both lanes are populated.
  const isMix = campaignMode === 'combined' || (writer.length > 0 && creator.length > 0);

  const clampLane = (lane: Array<[string, number]>): Array<[string, number]> => {
    // Keep at most N types (preserve selection order), clamp each to ≤ per-type max.
    let kept: Array<[string, number]> = lane.slice(0, MAX_TYPES_PER_LANE)
      .map(([k, v]) => [k, Math.min(MAX_FREQUENCY_PER_TYPE, v)] as [string, number]);
    if (isMix) {
      let sum = kept.reduce((s, [, v]) => s + v, 0);
      // Trim the currently-largest value by 1 until the lane total fits.
      while (sum > MAX_MIX_LANE_TOTAL && kept.some(([, v]) => v > 1)) {
        let maxIdx = 0;
        for (let i = 1; i < kept.length; i += 1) if (kept[i][1] > kept[maxIdx][1]) maxIdx = i;
        kept[maxIdx][1] -= 1;
        sum -= 1;
      }
    }
    return kept.filter(([, v]) => v > 0);
  };

  const out: Record<string, number> = {};
  for (const [k, v] of [...clampLane(writer), ...clampLane(creator)]) out[k] = v;
  return out;
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
