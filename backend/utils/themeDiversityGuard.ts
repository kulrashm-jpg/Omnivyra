/**
 * Theme Diversity Guard
 *
 * Prevents repetitive or overly similar strategic themes across the ladder.
 * Uses token-based similarity; when above threshold, later theme is flagged for diversification.
 */

export const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

function tokenize(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

/**
 * Jaccard similarity: intersection size / union size.
 * Returns 0–1. Higher = more similar.
 */
export function computeTextSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const w of ta) {
    if (tb.has(w)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export type LadderEntry<T = unknown> = {
  stage: string;
  objective: string;
  psychological_goal: string;
  momentum_level: string;
  recommendations: Array<{ topic: string; [key: string]: unknown }>;
};

/**
 * Ensures themes in the ladder are sufficiently distinct.
 * When similarity(themeA, themeB) > threshold, the later recommendation is marked
 * for diversification (caller can rewrite via LLM or filter).
 *
 * Returns the ladder with potentially updated recommendations and a list of
 * indices that were flagged as too similar to a prior theme.
 */
export function ensureThemeDiversity<T extends LadderEntry>(
  ladder: T[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): { ladder: T[]; flaggedIndices: number[]; similarPairs: Array<{ i: number; j: number; score: number }> } {
  const allTopics: Array<{ ladderIndex: number; recIndex: number; topic: string }> = [];
  ladder.forEach((entry, li) => {
    (entry.recommendations ?? []).forEach((rec, ri) => {
      const topic = String(rec.topic ?? '').trim();
      if (topic) allTopics.push({ ladderIndex: li, recIndex: ri, topic });
    });
  });

  const similarPairs: Array<{ i: number; j: number; score: number }> = [];
  const flaggedSet = new Set<number>();

  for (let j = 1; j < allTopics.length; j++) {
    for (let i = 0; i < j; i++) {
      const score = computeTextSimilarity(allTopics[i].topic, allTopics[j].topic);
      if (score > threshold) {
        similarPairs.push({ i, j, score });
        flaggedSet.add(j);
      }
    }
  }

  const flaggedIndices = Array.from(flaggedSet);
  return { ladder, flaggedIndices, similarPairs };
}
