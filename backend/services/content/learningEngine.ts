/**
 * Learning Engine — Wave 5 DETERMINISTIC continuous-optimization seam.
 *
 * `recordLearningEvent` is the single entry point invoked when content is
 * published. It turns a publish into a durable, company-scoped learning event
 * WITHOUT ever touching the historical `content` table. Backs
 * content_performance / learning_intelligence / learning_memory from
 * supabase/migrations/20260718000003_content_learning_performance.sql.
 *
 * INVARIANTS
 *  - FAIL-OPEN: every step is wrapped so a failure logs and returns. A learning
 *    failure MUST NEVER throw into (or block) publishing.
 *  - IDEMPOTENT: re-running for the same contentId converges — the placeholder
 *    performance row is created at most once, and the rollup content is a pure
 *    function of the observation set. No duplicate rows.
 *  - APPEND-ONLY vs history: only content_performance / learning_intelligence /
 *    learning_memory are written. The `content` table is NEVER read or mutated.
 *  - DETERMINISTIC + EXPLAINABLE: the rollup is a percentile-thresholded fold of
 *    the company's own history (mirrors performanceIntelligence). No ML.
 */

import { supabase } from '../../db/supabaseClient';
import {
  deriveIntelligence,
  fetchPerformanceObservations,
  type PerformanceObservation,
} from './performanceIntelligence';
import { splitIntoBlocks } from '../../../lib/content/quality/sectionBlocks';
import type { LearningMemory } from '../../../lib/content/learning/types';

const PERFORMANCE_TABLE = 'content_performance';
const LEARNING_MEMORY_TABLE = 'learning_memory';

// Percentile thresholds separating winning from losing content (explainable).
const HIGH_PERCENTILE = 0.6;
const LOW_PERCENTILE = 0.4;

// Rollup caps — keep the aggregate bounded regardless of history size.
const MESSAGING_CAP = 50;
const NARRATIVE_CAP = 30;
const STRUCTURE_CAP = 25;
const INTEREST_CAP = 25;

export interface RecordLearningEventInput {
  companyId: string;
  contentId: string;
  platform?: string | null;
}

// ── logging (fail-open; never rethrows) ──────────────────────────────────────

function logError(op: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[learningEngine] ${op} (non-fatal): ${message}`);
}

// ── deterministic text helpers (shared shape with performanceIntelligence) ───

function structureKey(text: string): string {
  if (!text.trim()) return 'empty';
  return splitIntoBlocks(text).map((b) => b.blockType).join('>');
}

/** Order-preserving de-dupe capped to the first `cap` entries. */
function capHead(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'with', 'you', 'your', 'our', 'this',
  'that', 'from', 'have', 'has', 'was', 'were', 'will', 'can', 'all', 'not',
  'they', 'their', 'what', 'when', 'how', 'why', 'who', 'get', 'out', 'now',
  'more', 'about', 'into', 'over', 'than', 'then', 'them', 'its', 'his', 'her',
]);

/**
 * Deterministic audience-interest terms: frequency-ranked significant words
 * across the winning content's key messages + narratives. Ties broken
 * alphabetically so the output is reproducible.
 */
function deriveInterests(winning: PerformanceObservation[]): string[] {
  const freq = new Map<string, number>();
  for (const o of winning) {
    const text = [...o.intelligence.keyMessages, ...o.intelligence.narratives].join(' ');
    const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, INTEREST_CAP)
    .map(([w]) => w);
}

/**
 * Fold the observation set into the deterministic company rollup.
 * Winning = percentile >= HIGH; losing = percentile <= LOW. Pure function of
 * `observations` (+ prior version for the monotonic version bump).
 */
export function buildLearningMemory(
  observations: PerformanceObservation[],
  priorVersion: number,
): LearningMemory {
  const winning = observations.filter((o) => o.percentile >= HIGH_PERCENTILE);
  const losing = observations.filter((o) => o.percentile <= LOW_PERCENTILE);

  const successfulMessaging = capHead(
    winning.flatMap((o) => [...o.intelligence.hooks, ...o.intelligence.keyMessages]),
    MESSAGING_CAP,
  );
  const unsuccessfulMessaging = capHead(
    losing.flatMap((o) => [...o.intelligence.hooks, ...o.intelligence.keyMessages]),
    MESSAGING_CAP,
  );
  const narrativeStyles = capHead(
    winning.flatMap((o) => o.intelligence.narratives),
    NARRATIVE_CAP,
  );
  const winningStructures = capHead(
    winning.map((o) => structureKey(o.text)),
    STRUCTURE_CAP,
  );

  // Per-platform mean percentile (deterministic; keys sorted for stability).
  const byPlatform = new Map<string, number[]>();
  for (const o of observations) {
    if (!o.platform) continue;
    const arr = byPlatform.get(o.platform) ?? [];
    arr.push(o.percentile);
    byPlatform.set(o.platform, arr);
  }
  const platformAdaptations: Record<string, number> = {};
  for (const platform of Array.from(byPlatform.keys()).sort()) {
    const arr = byPlatform.get(platform)!;
    platformAdaptations[platform] =
      Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1e4) / 1e4;
  }

  return {
    successfulMessaging,
    unsuccessfulMessaging,
    narrativeStyles,
    winningStructures,
    platformAdaptations,
    audienceInterests: deriveInterests(winning),
    modelVersion: priorVersion + 1,
  };
}

// ── step 1: ensure a placeholder performance row (idempotent) ────────────────

/**
 * Ensure a content_performance row exists for (companyId, contentId) so the
 * publish is a learning event even before metrics arrive. Idempotent: if ANY
 * performance row already exists for the content_id (placeholder OR real synced
 * metrics), nothing is inserted — re-calling never duplicates.
 */
async function ensurePerformanceRow(
  companyId: string,
  contentId: string,
  platform: string | null | undefined,
): Promise<void> {
  try {
    const { data: existing, error } = await supabase
      .from(PERFORMANCE_TABLE)
      .select('id')
      .eq('company_id', companyId)
      .eq('content_id', contentId)
      .limit(1);
    if (error) {
      logError('ensurePerformanceRow(lookup)', error);
      return;
    }
    if (existing && existing.length > 0) return; // already a learning event

    const { error: insErr } = await supabase.from(PERFORMANCE_TABLE).insert({
      company_id: companyId,
      content_id: contentId,
      platform: platform ?? null,
      source: 'learning_event',
      metrics: { placeholder: true },
    });
    if (insErr) logError('ensurePerformanceRow(insert)', insErr);
  } catch (error) {
    logError('ensurePerformanceRow', error);
  }
}

// ── step 3: fold the company learning-memory rollup (idempotent upsert) ───────

/** Read the current learning_memory model_version (0 if none). FAIL-OPEN. */
async function currentModelVersion(companyId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from(LEARNING_MEMORY_TABLE)
      .select('model_version')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) {
      logError('currentModelVersion', error);
      return 0;
    }
    const v = data?.model_version;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  } catch (error) {
    logError('currentModelVersion', error);
    return 0;
  }
}

/**
 * Recompute and upsert the company rollup from the current observation set.
 * The single learning_memory row is keyed by company_id (a true PK), so
 * onConflict upsert is safe and idempotent — the rollup CONTENT converges; only
 * model_version advances monotonically as a freshness marker.
 */
async function updateLearningMemory(companyId: string): Promise<void> {
  try {
    const observations = await fetchPerformanceObservations(companyId);
    const priorVersion = await currentModelVersion(companyId);
    const memory = buildLearningMemory(observations, priorVersion);

    const { error } = await supabase.from(LEARNING_MEMORY_TABLE).upsert(
      {
        company_id: companyId,
        successful_messaging: memory.successfulMessaging,
        unsuccessful_messaging: memory.unsuccessfulMessaging,
        narrative_styles: memory.narrativeStyles,
        winning_structures: memory.winningStructures,
        platform_adaptations: memory.platformAdaptations,
        audience_interests: memory.audienceInterests,
        model_version: memory.modelVersion,
      },
      { onConflict: 'company_id' },
    );
    if (error) logError('updateLearningMemory(upsert)', error);
  } catch (error) {
    logError('updateLearningMemory', error);
  }
}

// ── public: recordLearningEvent ──────────────────────────────────────────────

/**
 * Record a publish as a durable learning event. FAIL-OPEN + IDEMPOTENT.
 * Steps (each independently wrapped so one failure never skips the others, and
 * the whole thing can never throw into the publishing flow):
 *   1. ensure a content_performance row exists (placeholder if no metrics yet).
 *   2. refresh the derived learning_intelligence patterns.
 *   3. fold the learning_memory company rollup (bump model_version).
 *
 * NEVER reads or writes the `content` table — learning is append-only relative
 * to historical content.
 */
export async function recordLearningEvent(input: RecordLearningEventInput): Promise<void> {
  const { companyId, contentId, platform } = input ?? ({} as RecordLearningEventInput);
  try {
    if (!companyId || !contentId) {
      logError('recordLearningEvent', new Error('companyId and contentId are required'));
      return;
    }
    await ensurePerformanceRow(companyId, contentId, platform);
    await deriveIntelligence(companyId);
    await updateLearningMemory(companyId);
  } catch (error) {
    // Belt-and-suspenders: the inner steps already swallow, but never throw.
    logError('recordLearningEvent', error);
  }
}
