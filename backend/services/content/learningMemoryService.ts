/**
 * Learning Memory Service — WRITER-EXEC-006 Wave 5 (items 4/5/8).
 *
 * The company-scoped, durable READ+WRITE surface over the Wave-5 learning tables
 * introduced by supabase/migrations/20260718000003_content_learning_performance.sql:
 *
 *   - learning_memory       : one row per company; the winning-structures /
 *                             effective-adaptations rollup that EXTENDS (never
 *                             alters) the Wave-2 brand_memory rollup.
 *   - learning_intelligence : derived, upsert-idempotent PATTERNS (strongest
 *                             hooks / CTA / structures / lengths / platform …).
 *
 * Design notes (mirror the Wave-2 contentMemoryService exactly):
 *  - Reuses the shared service-role admin client (backend/db/supabaseClient). The
 *    service role bypasses RLS, so EVERY method is explicitly company-scoped.
 *  - Rows are snake_case; this service maps to/from camelCase DTOs. Callers never
 *    see snake_case.
 *  - FAIL-SAFE: every method is best-effort. A read/write failure MUST NOT throw
 *    into the caller — it logs and returns empty / null. Learning is an ASSIST,
 *    never a gate; it can never break content creation (ADR-009: recommends,
 *    never applies).
 *
 * CONTRACT NOTE: the canonical learning DTOs live at lib/content/learning/types.ts
 * (LearningMemory, LearningIntelligence), written concurrently. Until that module
 * lands, this file carries a self-contained, structurally-compatible mirror (field
 * names are exactly the documented ones) and re-exports it, so this service and its
 * unit tests compile and pass standalone. When the canonical module is present,
 * re-point the imports and delete the mirror below.
 */

import { supabase } from '../../db/supabaseClient';
import { getBrandMemory, type BrandMemory } from './contentMemoryService';
import {
  recordLearningRetrievalLatency,
  recordLearningUpdate,
  recordLearningModelFreshness,
  recordLearningPlatformIntelligenceCoverage,
} from '../../observability/learningMetrics';

const LEARNING_MEMORY_TABLE = 'learning_memory';
const LEARNING_INTELLIGENCE_TABLE = 'learning_intelligence';

/** Default number of top patterns returned by getTopIntelligence. */
const TOP_INTELLIGENCE_LIMIT = 10;

// ── DTOs (mirror; see CONTRACT NOTE) ─────────────────────────────────────────

/**
 * The company-level learning rollup that extends Brand Memory. Consumed TOGETHER
 * WITH the Wave-2 brand_memory at read time (this table never alters brand_memory).
 */
export interface LearningMemory {
  companyId: string;
  /** Messaging shapes that have historically performed well. */
  successfulMessaging: Record<string, unknown> | null;
  /** Messaging shapes that have historically underperformed. */
  unsuccessfulMessaging: Record<string, unknown> | null;
  /** Preferred / winning narrative styles. */
  narrativeStyles: Record<string, unknown> | null;
  /** Winning structural templates (opening → body → cta shapes that worked). */
  winningStructures: Record<string, unknown> | null;
  /** Effective per-platform adaptations. */
  platformAdaptations: Record<string, unknown> | null;
  /** Recurring audience interests. */
  audienceInterests: Record<string, unknown> | null;
  /** Freshness / reproducibility marker. */
  modelVersion: number;
  updatedAt: string | null;
}

/**
 * A single derived, structured learning pattern (one row of learning_intelligence).
 * The `pattern` jsonb carries the structured pattern + evidence; `score` is an
 * explainable 0..1 effectiveness.
 */
export interface LearningIntelligence {
  id: string;
  companyId: string;
  /** 'hook'|'cta'|'structure'|'length'|'hashtag'|'emoji'|'platform'|'campaign' */
  dimension: string;
  patternKey: string;
  /** null = cross-platform. */
  platform: string | null;
  pattern: Record<string, unknown> | null;
  /** Effectiveness score 0..1, explainable. */
  score: number | null;
  sampleSize: number;
  updatedAt: string | null;
}

/**
 * The MERGED consumption view: the Wave-2 brand rollup and the Wave-5 learning
 * rollup, read together so future generations consume both. Either half may be
 * null (no data yet / read failure) — the shape is always well-formed.
 */
export interface MergedLearningMemory {
  brand: BrandMemory | null;
  learning: LearningMemory | null;
}

/** A patch onto learning_memory. `companyId`/`updatedAt` are never patchable. */
export type LearningMemoryPatch = Partial<Omit<LearningMemory, 'companyId' | 'updatedAt'>>;

// ── mappers ──────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapLearningMemoryRow(row: any): LearningMemory {
  return {
    companyId: row.company_id,
    successfulMessaging: (row.successful_messaging ?? null) as Record<string, unknown> | null,
    unsuccessfulMessaging: (row.unsuccessful_messaging ?? null) as Record<string, unknown> | null,
    narrativeStyles: (row.narrative_styles ?? null) as Record<string, unknown> | null,
    winningStructures: (row.winning_structures ?? null) as Record<string, unknown> | null,
    platformAdaptations: (row.platform_adaptations ?? null) as Record<string, unknown> | null,
    audienceInterests: (row.audience_interests ?? null) as Record<string, unknown> | null,
    modelVersion: typeof row.model_version === 'number' ? row.model_version : 1,
    updatedAt: row.updated_at ?? null,
  };
}

function mapIntelligenceRow(row: any): LearningIntelligence {
  return {
    id: row.id,
    companyId: row.company_id,
    dimension: row.dimension,
    patternKey: row.pattern_key,
    platform: row.platform ?? null,
    pattern: (row.pattern ?? null) as Record<string, unknown> | null,
    score: typeof row.score === 'number' ? row.score : row.score == null ? null : Number(row.score),
    sampleSize: typeof row.sample_size === 'number' ? row.sample_size : 0,
    updatedAt: row.updated_at ?? null,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── logging (fail-safe; never rethrows) ──────────────────────────────────────

function logLearningError(op: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[learningMemoryService] ${op} (non-fatal): ${message}`);
}

function nowMs(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

// ── read: merged brand + learning view (item 4) ──────────────────────────────

/**
 * Read the company's MERGED memory view — the Wave-2 brand rollup AND the Wave-5
 * learning rollup — for consumption by future generations. FAIL-SAFE: on any
 * error each half independently degrades to null; never throws. Always returns a
 * well-formed `{ brand, learning }`.
 */
export async function getLearningMemory(companyId: string): Promise<MergedLearningMemory> {
  if (!companyId) return { brand: null, learning: null };
  const t0 = nowMs();
  try {
    const [brand, learning] = await Promise.all([
      getBrandMemory(companyId), // already fail-safe → BrandMemory | null
      readLearningMemoryRow(companyId),
    ]);
    try {
      recordLearningRetrievalLatency(nowMs() - t0, 'merged');
      if (learning) recordLearningModelFreshness(learning.modelVersion, 'read');
    } catch { /* metrics never break reads */ }
    return { brand, learning };
  } catch (error) {
    logLearningError('getLearningMemory', error);
    return { brand: null, learning: null };
  }
}

/** Read just the learning_memory row (or null). FAIL-SAFE. */
async function readLearningMemoryRow(companyId: string): Promise<LearningMemory | null> {
  try {
    const { data, error } = await supabase
      .from(LEARNING_MEMORY_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) {
      logLearningError('readLearningMemoryRow', error);
      return null;
    }
    return data ? mapLearningMemoryRow(data) : null;
  } catch (error) {
    logLearningError('readLearningMemoryRow', error);
    return null;
  }
}

// ── write: upsert learning_memory ────────────────────────────────────────────

/**
 * Upsert a partial patch onto the company learning rollup. Only the keys present
 * on `patch` are written (append/replace semantics are the caller's). FAIL-SAFE:
 * on error logs and returns null. Emits a learning.updates signal on success.
 */
export async function upsertLearningMemory(
  companyId: string,
  patch: LearningMemoryPatch,
): Promise<LearningMemory | null> {
  if (!companyId) return null;
  try {
    const row: Record<string, unknown> = { company_id: companyId };
    if ('successfulMessaging' in patch) row.successful_messaging = patch.successfulMessaging ?? null;
    if ('unsuccessfulMessaging' in patch) row.unsuccessful_messaging = patch.unsuccessfulMessaging ?? null;
    if ('narrativeStyles' in patch) row.narrative_styles = patch.narrativeStyles ?? null;
    if ('winningStructures' in patch) row.winning_structures = patch.winningStructures ?? null;
    if ('platformAdaptations' in patch) row.platform_adaptations = patch.platformAdaptations ?? null;
    if ('audienceInterests' in patch) row.audience_interests = patch.audienceInterests ?? null;
    if (typeof patch.modelVersion === 'number') row.model_version = patch.modelVersion;

    const { data, error } = await supabase
      .from(LEARNING_MEMORY_TABLE)
      .upsert(row, { onConflict: 'company_id' })
      .select('*')
      .single();
    if (error || !data) {
      logLearningError('upsertLearningMemory', error);
      return null;
    }
    try { recordLearningUpdate('memory'); } catch { /* metrics never break writes */ }
    return mapLearningMemoryRow(data);
  } catch (error) {
    logLearningError('upsertLearningMemory', error);
    return null;
  }
}

// ── read: top learning intelligence patterns (item 5 evidence source) ────────

/**
 * Read the company's strongest learning patterns, highest effectiveness first.
 * Optionally scoped to a single `dimension` and/or `platform`. Deterministic
 * ordering: score DESC, then pattern_key ASC as a stable tie-break. FAIL-SAFE:
 * on error logs and returns [].
 */
export async function getTopIntelligence(
  companyId: string,
  dimension?: string,
  platform?: string,
  limit: number = TOP_INTELLIGENCE_LIMIT,
): Promise<LearningIntelligence[]> {
  if (!companyId) return [];
  const t0 = nowMs();
  try {
    let query = supabase
      .from(LEARNING_INTELLIGENCE_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .order('score', { ascending: false })
      .order('pattern_key', { ascending: true })
      .limit(limit);

    if (dimension) query = query.eq('dimension', dimension);
    if (platform) query = query.eq('platform', platform);

    const { data, error } = await query;
    if (error) {
      logLearningError('getTopIntelligence', error);
      return [];
    }
    const rows = (data ?? []).map(mapIntelligenceRow);
    try {
      recordLearningRetrievalLatency(nowMs() - t0, 'intelligence');
      const platforms = new Set(rows.map((r) => r.platform).filter((p): p is string => !!p));
      if (rows.length) recordLearningPlatformIntelligenceCoverage(platforms.size);
    } catch { /* metrics never break reads */ }
    return rows;
  } catch (error) {
    logLearningError('getTopIntelligence', error);
    return [];
  }
}
