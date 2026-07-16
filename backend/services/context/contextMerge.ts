/**
 * contextMerge.ts — deterministic fact merging. Facts are never blindly
 * overwritten: on conflict the higher-trust / more-confident / fresher fact
 * wins, and list facts UNION their values while inheriting the best fact's
 * provenance.
 */
import { ORIGIN_TRUST, type Fact, type Freshness } from './canonicalContextTypes';

export function freshnessScore(f: Freshness): number {
  switch (f.label) {
    case 'today': return 1;
    case 'recent': return 0.8;
    case 'aging': return 0.5;
    case 'stale': return 0.2;
    default: return 0.3;
  }
}

/** Blended desirability of a fact — deterministic, in [0,1]. */
export function factScore<T>(fact: Fact<T>): number {
  return (
    ORIGIN_TRUST[fact.origin] * 0.5 +
    fact.confidence * 0.3 +
    freshnessScore(fact.freshness) * 0.2
  );
}

/** Highest-scoring non-null fact (stable: earlier wins ties). */
export function pickBest<T>(facts: Array<Fact<T> | null | undefined>): Fact<T> | null {
  let best: Fact<T> | null = null;
  let bestScore = -1;
  for (const f of facts) {
    if (!f) continue;
    const s = factScore(f);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return best;
}

/**
 * Union list facts: dedup values (case-insensitive, first spelling kept), keep
 * the best contributing fact's origin/confidence/freshness. Never drops a value
 * that any source supplied (up to `cap`).
 */
export function mergeListFacts(
  facts: Array<Fact<string[]> | null | undefined>,
  cap = 12,
): Fact<string[]> | null {
  const present = facts.filter((f): f is Fact<string[]> => !!f && Array.isArray(f.value) && f.value.length > 0);
  if (present.length === 0) return null;

  const seen = new Set<string>();
  const merged: string[] = [];
  // Iterate sources best-first so the highest-trust spelling is kept on dupes.
  const ordered = [...present].sort((a, b) => factScore(b) - factScore(a));
  for (const f of ordered) {
    for (const raw of f.value) {
      const v = String(raw).trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(v);
      if (merged.length >= cap) break;
    }
    if (merged.length >= cap) break;
  }

  const best = ordered[0];
  return {
    value: merged,
    origin: best.origin,
    confidence: best.confidence,
    freshness: best.freshness,
  };
}
