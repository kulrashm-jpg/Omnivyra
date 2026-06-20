/**
 * Phase 6D-D1 — Format preference intelligence for Intelligent Mix.
 *
 * Re-orders the user's SELECTED formats by historical performance. RANKING ONLY:
 * never adds, removes, or invents a format; never changes counts/frequencies.
 * Membership is preserved exactly — only order changes, and only in combined mode
 * under advisory/active.
 *
 * The signal comes solely from `marketing_memory` (memory_type
 * 'content_performance' / 'narrative_performance') per the readiness audit — the
 * only confidently-populated format-performance source. No other engine is used.
 */

export type FormatPriorityMode = 'off' | 'shadow' | 'advisory' | 'active';

/** Performance signal for one format — higher score = better. */
export interface FormatPerformanceSignal {
  format: string;
  score: number;
}

export interface FormatOrderingResult {
  /** Order to USE downstream (input unless advisory/active reorders). */
  order: string[];
  /** Order the ranking WOULD produce (for shadow-mode logging). */
  proposedOrder: string[];
  /** Whether proposedOrder differs from the input order. */
  changed: boolean;
  /** How many selected-format occurrences had a usable signal. */
  rankingCount: number;
}

/** Minimal structural shape of a marketing_memory row (avoids coupling to backend types). */
export interface MemoryFormatEntry {
  memory_value?: Record<string, unknown> | null;
  confidence?: number | null;
}

function normFormat(f: unknown): string {
  return String(f ?? '').toLowerCase().trim();
}

/** Normalize INTELLIGENT_MIX_FORMAT_PRIORITY_MODE (default 'shadow'). */
export function normalizeFormatPriorityMode(raw: string | undefined | null): FormatPriorityMode {
  const m = String(raw ?? 'shadow').toLowerCase().trim();
  return m === 'off' || m === 'shadow' || m === 'advisory' || m === 'active' ? m : 'shadow';
}

/** Prioritization runs ONLY for combined campaigns and when mode !== 'off'. */
export function shouldPrioritizeFormats(mode: FormatPriorityMode, isCombined: boolean): boolean {
  return isCombined && mode !== 'off';
}

/**
 * Extract per-format performance signals from marketing_memory rows. Only rows
 * carrying a `format` field in memory_value contribute (content_performance);
 * narrative_performance rows have no format and are naturally ignored. Scores
 * are confidence-weighted averages of `avg_engagement` / `engagement_score`.
 */
export function extractFormatSignalsFromMemory(entries: MemoryFormatEntry[]): FormatPerformanceSignal[] {
  const acc = new Map<string, { weighted: number; weight: number }>();
  for (const e of entries ?? []) {
    const mv = e?.memory_value ?? {};
    const format = normFormat((mv as Record<string, unknown>).format);
    if (!format) continue; // narrative_performance / non-format rows skipped
    const rawScore = (mv as Record<string, unknown>).avg_engagement ?? (mv as Record<string, unknown>).engagement_score;
    const score = Number(rawScore);
    if (!Number.isFinite(score)) continue;
    const confidence = typeof e?.confidence === 'number' ? Math.min(1, Math.max(0, e.confidence)) : 1;
    const cur = acc.get(format) ?? { weighted: 0, weight: 0 };
    cur.weighted += score * confidence;
    cur.weight += confidence;
    acc.set(format, cur);
  }
  return Array.from(acc.entries())
    .filter(([, v]) => v.weight > 0)
    .map(([format, v]) => ({ format, score: v.weighted / v.weight }));
}

/**
 * Order selected formats by performance, preserving membership exactly.
 *
 *   off      → input order unchanged (no ranking)
 *   shadow   → input order unchanged, proposedOrder/changed computed for logs
 *   advisory → reordered by performance (input order is the tiebreaker)
 *   active   → same as advisory (reserved for future phases)
 *
 * Ranked formats sort highest-score-first; ties and unranked formats fall back to
 * original order. Duplicate-safe (index-keyed) and always a permutation of input.
 */
export function orderFormatsForIntelligentMix(
  selectedFormats: string[],
  performanceSignals: FormatPerformanceSignal[],
  mode: FormatPriorityMode,
): FormatOrderingResult {
  const input = Array.isArray(selectedFormats) ? [...selectedFormats] : [];

  if (mode === 'off' || input.length === 0) {
    return { order: input, proposedOrder: input, changed: false, rankingCount: 0 };
  }

  const scoreByFormat = new Map<string, number>();
  for (const s of performanceSignals ?? []) {
    if (!s || typeof s.format !== 'string') continue;
    const key = normFormat(s.format);
    if (key && !scoreByFormat.has(key)) scoreByFormat.set(key, Number(s.score) || 0);
  }

  // Index-keyed items so duplicate format strings keep their own positions.
  const items = input.map((format, idx) => ({ format, idx }));
  const rankingCount = items.filter((it) => scoreByFormat.has(normFormat(it.format))).length;

  const proposedOrder = [...items]
    .sort((a, b) => {
      const sa = scoreByFormat.get(normFormat(a.format));
      const sb = scoreByFormat.get(normFormat(b.format));
      const aHas = sa !== undefined;
      const bHas = sb !== undefined;
      if (aHas && bHas) {
        if (sb !== sa) return (sb as number) - (sa as number); // higher score first
        return a.idx - b.idx; // tiebreak: original order
      }
      if (aHas !== bHas) return aHas ? -1 : 1; // ranked before unranked
      return a.idx - b.idx; // both unranked: original order
    })
    .map((it) => it.format);

  const changed = proposedOrder.some((f, i) => f !== input[i]);
  const applied = (mode === 'advisory' || mode === 'active') && rankingCount > 0 ? proposedOrder : input;

  return { order: applied, proposedOrder, changed, rankingCount };
}
