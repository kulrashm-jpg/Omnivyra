/**
 * Performance Intelligence — Wave 5 DETERMINISTIC learning-derivation engine.
 *
 * Turns a company's PUBLISHED-content performance signals into structured,
 * explainable, company-scoped intelligence PATTERNS. Backs the
 * `learning_intelligence` table from
 * supabase/migrations/20260718000003_content_learning_performance.sql.
 *
 * DESIGN (mirrors the Wave 1-2 content services):
 *  - Reuses the shared service-role admin client (backend/db/supabaseClient).
 *    The service role bypasses RLS, so EVERY query is explicitly company-scoped
 *    (`.eq('company_id', …)`). NO cross-company reads, ever.
 *  - NO ML / no opaque scoring. Each pattern's `score` is a percentile rank of
 *    the pattern's members within the company's OWN engagement-rate history — a
 *    number a human can reproduce by hand. The evidence (method, sample, mean
 *    rate, examples) is stored in the row so every score is auditable.
 *  - Signal join is `content_performance ⋈ content_memory` (by content_id).
 *    content_memory (Wave 2) already carries the deterministic intelligence
 *    {hooks,ctas,narratives,keyMessages}, platform, campaign_id and a text
 *    excerpt. This engine NEVER reads or writes the historical `content` table —
 *    learning is append-only relative to historical content.
 *  - FAIL-SAFE: any failure logs and returns `[]`. Deriving intelligence can
 *    never break a caller (it is an assist, not a gate).
 */

import { supabase } from '../../db/supabaseClient';
import { splitIntoBlocks } from '../../../lib/content/quality/sectionBlocks';
import {
  extractIntelligence,
  type ContentIntelligence,
} from '../../../lib/content/originality/intelligenceExtractor';
import type {
  LearningDimension,
  LearningIntelligence,
} from '../../../lib/content/learning/types';

const PERFORMANCE_TABLE = 'content_performance';
const MEMORY_TABLE = 'content_memory';
const INTELLIGENCE_TABLE = 'learning_intelligence';

/** How many performance rows to consider (recent-first). Bounds cost. */
const MAX_PERFORMANCE_ROWS = 2000;
/** How many patterns to persist per dimension (top by sample, then score). */
const PATTERNS_PER_DIMENSION = 12;
/** Max length of a canonical pattern key derived from free text. */
const KEY_MAX_LEN = 200;

// ── logging (fail-safe; never rethrows) ──────────────────────────────────────

function logError(op: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[performanceIntelligence] ${op} (non-fatal): ${message}`);
}

// ── deterministic numeric / text helpers ─────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Coerce a possibly string/bigint/numeric DB value to a finite number or null. */
function num(value: any): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whitespace-delimited word count. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/** Count of `#hashtag` tokens (deterministic, grapheme-safe token regex). */
function hashtagCount(text: string): number {
  const m = text.match(/#[A-Za-z0-9_]+/g);
  return m ? m.length : 0;
}

/** Count of emoji (Extended_Pictographic) code points. Deterministic. */
function emojiCount(text: string): number {
  const m = text.match(/\p{Extended_Pictographic}/gu);
  return m ? m.length : 0;
}

/** Deterministic length bucket from a word count. */
function lengthBucket(words: number): string {
  if (words === 0) return 'empty';
  if (words <= 30) return 'short';
  if (words <= 80) return 'medium';
  if (words <= 200) return 'long';
  return 'very_long';
}

/** Deterministic hashtag-usage bucket. */
function hashtagBucket(n: number): string {
  if (n === 0) return 'none';
  if (n <= 3) return 'light';
  if (n <= 7) return 'moderate';
  return 'heavy';
}

/** Deterministic emoji-usage bucket. */
function emojiBucket(n: number): string {
  if (n === 0) return 'none';
  if (n <= 2) return 'light';
  return 'heavy';
}

/**
 * Deterministic structural shape: the ordered block-type sequence from the
 * Wave-4 section-block splitter (e.g. `hook>opening>body>cta>hashtags`).
 */
function structureKey(text: string): string {
  if (!text.trim()) return 'empty';
  return splitIntoBlocks(text)
    .map((b) => b.blockType)
    .join('>');
}

/** Canonicalize free text into a stable, bounded pattern key. */
function canonicalKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, KEY_MAX_LEN);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── engagement-rate derivation (explainable) ─────────────────────────────────

interface RateResult {
  rate: number;
  rawEngagement: number;
  denominator: number | null;
  method: string;
}

/**
 * Deterministic, explainable engagement-rate for one performance row.
 *
 *  - raw engagement = `engagement` if present, else the sum of
 *    reactions+comments+shares+saves, else `clicks`, else 0.
 *  - When impressions (or reach) are known, rate = raw / denominator
 *    ("engagement per impression"). Else fall back to `ctr`. Else the raw
 *    absolute count (normalized later via company-history percentile).
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function engagementRate(p: any): RateResult {
  const engagement = num(p.engagement);
  const reactions = num(p.reactions);
  const comments = num(p.comments);
  const shares = num(p.shares);
  const saves = num(p.saves);
  const clicks = num(p.clicks);

  let raw: number;
  if (engagement != null) {
    raw = engagement;
  } else if (reactions != null || comments != null || shares != null || saves != null) {
    raw = (reactions ?? 0) + (comments ?? 0) + (shares ?? 0) + (saves ?? 0);
  } else if (clicks != null) {
    raw = clicks;
  } else {
    raw = 0;
  }

  const impressions = num(p.impressions);
  const reach = num(p.reach);
  const ctr = num(p.ctr);
  const denom = impressions != null && impressions > 0
    ? impressions
    : reach != null && reach > 0
      ? reach
      : null;

  if (denom != null) {
    return { rate: raw / denom, rawEngagement: raw, denominator: denom, method: 'engagement_per_impression' };
  }
  if (ctr != null) {
    return { rate: ctr, rawEngagement: raw, denominator: null, method: 'ctr' };
  }
  return { rate: raw, rawEngagement: raw, denominator: null, method: 'absolute_engagement' };
}

// ── observation model ────────────────────────────────────────────────────────

/**
 * One joined observation: a performance row enriched with the content's
 * deterministic intelligence + text, plus its engagement rate and the
 * percentile rank of that rate within the company's own history.
 */
export interface PerformanceObservation {
  contentId: string;
  platform: string | null;
  campaignId: string | null;
  contentType: string | null;
  intelligence: ContentIntelligence;
  text: string;
  rawEngagement: number;
  denominator: number | null;
  rate: number;
  rateMethod: string;
  /** 0..1 percentile rank of `rate` within the company's history (explainable). */
  percentile: number;
}

/**
 * Percentile rank of each value within the whole set, deterministically.
 *  - N <= 1  → 0.5 (no comparison possible; neutral).
 *  - else    → (count strictly less) / (N - 1) so the max maps to 1 and the min
 *    to 0. Ties share the same rank. Same input → identical output.
 */
function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 0.5);
  return values.map((v) => {
    let less = 0;
    for (const other of values) if (other < v) less += 1;
    return less / (n - 1);
  });
}

/**
 * Read the company's performance signals joined with content memory, and
 * annotate each with its engagement rate + company-history percentile.
 * Company-scoped. FAIL-SAFE: on error logs and returns [].
 *
 * Exported so the learning-memory rollup consumes the SAME deterministic
 * observation set (single source of truth).
 */
export async function fetchPerformanceObservations(
  companyId: string,
): Promise<PerformanceObservation[]> {
  try {
    const { data: perfRows, error: perfErr } = await supabase
      .from(PERFORMANCE_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .order('captured_at', { ascending: false })
      .limit(MAX_PERFORMANCE_ROWS);
    if (perfErr) {
      logError('fetchPerformanceObservations(performance)', perfErr);
      return [];
    }
    const rows = perfRows ?? [];
    if (rows.length === 0) return [];

    const contentIds = Array.from(
      new Set(rows.map((r) => r.content_id).filter((id): id is string => Boolean(id))),
    );

    // Join intelligence + text via content_memory (Wave 2). NEVER touches the
    // historical `content` table. Keep the first memory row per content_id.
    const memoryById = new Map<string, { intelligence: ContentIntelligence; text: string; platform: string | null; campaignId: string | null; contentType: string | null }>();
    if (contentIds.length > 0) {
      const { data: memRows, error: memErr } = await supabase
        .from(MEMORY_TABLE)
        .select('*')
        .eq('company_id', companyId)
        .in('content_id', contentIds);
      if (memErr) {
        logError('fetchPerformanceObservations(memory)', memErr);
      } else {
        for (const m of memRows ?? []) {
          if (!m.content_id || memoryById.has(m.content_id)) continue;
          const text = typeof m.text_excerpt === 'string' ? m.text_excerpt : '';
          const intelligence: ContentIntelligence =
            m.intelligence && typeof m.intelligence === 'object'
              ? {
                  hooks: asStrArray(m.intelligence.hooks),
                  ctas: asStrArray(m.intelligence.ctas),
                  narratives: asStrArray(m.intelligence.narratives),
                  keyMessages: asStrArray(m.intelligence.keyMessages),
                }
              : extractIntelligence(text);
          memoryById.set(m.content_id, {
            intelligence,
            text,
            platform: m.platform ?? null,
            campaignId: m.campaign_id ?? null,
            contentType: m.content_type ?? null,
          });
        }
      }
    }

    // Build observations (only rows with a content_id are learnable units).
    const observations: PerformanceObservation[] = [];
    for (const r of rows) {
      if (!r.content_id) continue;
      const mem = memoryById.get(r.content_id);
      const text = mem?.text ?? '';
      const intelligence = mem?.intelligence ?? extractIntelligence(text);
      const rate = engagementRate(r);
      observations.push({
        contentId: r.content_id,
        platform: r.platform ?? mem?.platform ?? null,
        campaignId: mem?.campaignId ?? null,
        contentType: mem?.contentType ?? null,
        intelligence,
        text,
        rawEngagement: rate.rawEngagement,
        denominator: rate.denominator,
        rate: rate.rate,
        rateMethod: rate.method,
        percentile: 0, // filled below
      });
    }

    // Percentile rank each observation's rate within the company's history.
    const ranks = percentileRanks(observations.map((o) => o.rate));
    observations.forEach((o, i) => {
      o.percentile = ranks[i];
    });

    // Stable order: percentile desc, then contentId asc (deterministic).
    observations.sort((a, b) =>
      b.percentile - a.percentile || (a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0),
    );
    return observations;
  } catch (error) {
    logError('fetchPerformanceObservations', error);
    return [];
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function asStrArray(value: any): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ── pattern aggregation ──────────────────────────────────────────────────────

interface Accumulator {
  patternKey: string;
  platform: string | null;
  percentiles: number[];
  examples: string[];
  rates: number[];
}

type KeyExtractor = (o: PerformanceObservation) => Array<{ key: string; example: string; platform?: string | null }>;

const DIMENSION_EXTRACTORS: Record<LearningDimension, KeyExtractor> = {
  // Each distinct hook string is a pattern; effectiveness = mean percentile of
  // the posts that used it.
  hook: (o) => o.intelligence.hooks.map((h) => ({ key: canonicalKey(h), example: h })),
  cta: (o) => o.intelligence.ctas.map((c) => ({ key: canonicalKey(c), example: c })),
  structure: (o) => [{ key: structureKey(o.text), example: structureKey(o.text) }],
  length: (o) => {
    const w = wordCount(o.text);
    const b = lengthBucket(w);
    return [{ key: b, example: `${b} (${w} words)` }];
  },
  hashtag: (o) => {
    const n = hashtagCount(o.text);
    const b = hashtagBucket(n);
    return [{ key: b, example: `${b} (${n} hashtags)` }];
  },
  emoji: (o) => {
    const n = emojiCount(o.text);
    const b = emojiBucket(n);
    return [{ key: b, example: `${b} (${n} emoji)` }];
  },
  // Platform is the ONLY dimension that sets the row's `platform` column.
  platform: (o) =>
    o.platform ? [{ key: o.platform, example: o.platform, platform: o.platform }] : [],
  campaign: (o) => (o.campaignId ? [{ key: o.campaignId, example: o.campaignId }] : []),
};

/** Round to 4 decimals for stable, human-readable persisted scores. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Deterministic mean of a numeric array (0 for empty). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build the persisted intelligence patterns for one dimension from the
 * observation set. Deterministic: same observations → identical patterns
 * (including order). Caps to the top PATTERNS_PER_DIMENSION.
 */
function buildDimension(
  dimension: LearningDimension,
  observations: PerformanceObservation[],
): LearningIntelligence[] {
  const extract = DIMENSION_EXTRACTORS[dimension];
  const acc = new Map<string, Accumulator>();

  for (const o of observations) {
    for (const { key, example, platform } of extract(o)) {
      if (!key) continue;
      const mapKey = `${platform ?? ''} ${key}`;
      let a = acc.get(mapKey);
      if (!a) {
        a = { patternKey: key, platform: platform ?? null, percentiles: [], examples: [], rates: [] };
        acc.set(mapKey, a);
      }
      a.percentiles.push(o.percentile);
      a.rates.push(o.rate);
      if (a.examples.length < 3 && !a.examples.includes(example)) a.examples.push(example);
    }
  }

  const patterns: LearningIntelligence[] = [];
  for (const a of acc.values()) {
    const score = round4(mean(a.percentiles));
    patterns.push({
      dimension,
      patternKey: a.patternKey,
      platform: a.platform,
      score,
      sampleSize: a.percentiles.length,
      pattern: {
        dimension,
        patternKey: a.patternKey,
        method: 'company_history_percentile',
        explanation: `Mean engagement-rate percentile of the ${a.percentiles.length} published item(s) matching this ${dimension}, ranked within this company's own history.`,
        meanPercentile: score,
        meanRate: round4(mean(a.rates)),
        sampleSize: a.percentiles.length,
        examples: a.examples,
      },
    });
  }

  // Deterministic ranking: sampleSize desc, score desc, patternKey asc.
  patterns.sort(
    (x, y) =>
      y.sampleSize - x.sampleSize ||
      y.score - x.score ||
      (x.patternKey < y.patternKey ? -1 : x.patternKey > y.patternKey ? 1 : 0),
  );
  return patterns.slice(0, PATTERNS_PER_DIMENSION);
}

const ALL_DIMENSIONS: LearningDimension[] = [
  'hook', 'cta', 'structure', 'length', 'hashtag', 'emoji', 'platform', 'campaign',
];

// ── idempotent upsert (avoids the expression unique index onConflict) ────────

/**
 * Idempotently persist one pattern into learning_intelligence. The table's
 * unique key is an EXPRESSION index (COALESCE(platform,'')), which supabase-js
 * `onConflict` cannot target, so we select-then-update/insert (mirrors
 * contentService.associateAsset). Re-running converges — no duplicate rows.
 * Best-effort: a failure here logs and is swallowed.
 */
async function upsertPattern(companyId: string, p: LearningIntelligence): Promise<void> {
  try {
    let lookup = supabase
      .from(INTELLIGENCE_TABLE)
      .select('id')
      .eq('company_id', companyId)
      .eq('dimension', p.dimension)
      .eq('pattern_key', p.patternKey);
    lookup = p.platform == null ? lookup.is('platform', null) : lookup.eq('platform', p.platform);
    const { data: existing, error: lookupErr } = await lookup.limit(1);
    if (lookupErr) {
      logError('upsertPattern(lookup)', lookupErr);
      return;
    }

    const row = {
      company_id: companyId,
      dimension: p.dimension,
      pattern_key: p.patternKey,
      platform: p.platform ?? null,
      pattern: p.pattern,
      score: p.score,
      sample_size: p.sampleSize,
      updated_at: new Date().toISOString(),
    };

    if (existing && existing.length > 0) {
      const { error: updErr } = await supabase
        .from(INTELLIGENCE_TABLE)
        .update(row)
        .eq('id', existing[0].id);
      if (updErr) logError('upsertPattern(update)', updErr);
    } else {
      const { error: insErr } = await supabase.from(INTELLIGENCE_TABLE).insert(row);
      if (insErr) logError('upsertPattern(insert)', insErr);
    }
  } catch (error) {
    logError('upsertPattern', error);
  }
}

// ── public: deriveIntelligence ───────────────────────────────────────────────

/**
 * Derive and persist the company's learning intelligence across all dimensions.
 * DETERMINISTIC: same performance/memory input → identical returned patterns
 * (values and order). Idempotently upserts each pattern (re-derivation updates
 * in place). FAIL-SAFE: on any error logs and returns [].
 *
 * @returns the computed patterns (persistence is best-effort and does not affect
 *          the returned value — auditing/testing reads the deterministic result).
 */
export async function deriveIntelligence(companyId: string): Promise<LearningIntelligence[]> {
  try {
    const observations = await fetchPerformanceObservations(companyId);
    if (observations.length === 0) return [];

    const patterns: LearningIntelligence[] = [];
    for (const dimension of ALL_DIMENSIONS) {
      patterns.push(...buildDimension(dimension, observations));
    }

    // Best-effort persistence (idempotent). Never affects the returned value.
    for (const p of patterns) {
      // eslint-disable-next-line no-await-in-loop
      await upsertPattern(companyId, p);
    }

    // Deterministic overall order for callers/auditing.
    const dimOrder = new Map(ALL_DIMENSIONS.map((d, i) => [d, i] as const));
    patterns.sort(
      (x, y) =>
        (dimOrder.get(x.dimension)! - dimOrder.get(y.dimension)!) ||
        y.score - x.score ||
        (x.patternKey < y.patternKey ? -1 : x.patternKey > y.patternKey ? 1 : 0),
    );
    return patterns;
  } catch (error) {
    logError('deriveIntelligence', error);
    return [];
  }
}
