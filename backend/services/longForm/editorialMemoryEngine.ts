/**
 * Phase 5 — Long-term editorial memory engine.
 *
 * Walks a company's portfolio chronologically and surfaces:
 *   - repeatedPatterns          (narrative-structure / title shapes used > N times)
 *   - fatiguedTerminology       (terms whose frequency saturates the portfolio)
 *   - positioningDrift          (drift in dominant archetype / capability over time)
 *
 * Produces editorialNoveltyScore (0–100; high = portfolio feels fresh) and
 * strategicFreshnessScore (high = strategic positioning is evolving, not stale).
 */

import type {
  ContentPortfolioAsset,
  EditorialNoveltyResult,
  NarrativeArchetype,
} from './longFormRecommendationTypes';

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function titleShapeOf(title: string): string {
  const lower = title.toLowerCase();
  const tags: string[] = [];
  if (/^how to\b/.test(lower)) tags.push('HOW_TO');
  if (/^why\b/.test(lower)) tags.push('WHY');
  if (/^what is\b/.test(lower)) tags.push('WHAT_IS');
  if (/\bvs\.?\b/.test(lower) || /\bversus\b/.test(lower)) tags.push('VS');
  if (/\b(ultimate|complete|definitive) guide\b/.test(lower)) tags.push('UG');
  if (/\bfuture of\b/.test(lower)) tags.push('FUTURE_OF');
  if (/\bplaybook\b/.test(lower)) tags.push('PLAYBOOK');
  if (/\bframework\b/.test(lower)) tags.push('FRAMEWORK');
  return tags.length === 0 ? 'OTHER' : tags.sort().join('+');
}

function narrativeShapeOf(narrative: string): string {
  const lower = narrative.toLowerCase();
  const tags: string[] = [];
  if (/\bonly works when\b/.test(lower)) tags.push('ONLY_WHEN');
  if (/\bsequenced before\b/.test(lower)) tags.push('SEQUENCED_BEFORE');
  if (/\binstead of\b/.test(lower)) tags.push('INSTEAD_OF');
  if (/\brequires\b/.test(lower)) tags.push('REQUIRES');
  if (/\bcommon assumption\b/.test(lower)) tags.push('COMMON_ASSUMPTION');
  return tags.length === 0 ? 'BARE' : tags.sort().join('+');
}

export interface AnalyzeEditorialMemoryInput {
  assets: ContentPortfolioAsset[];
  /**
   * Threshold above which a term is considered "fatigued" — defaults to
   * 50% of the portfolio size (rounded). Caller can lower for stricter
   * fatigue detection.
   */
  fatigueThresholdRatio?: number;
}

export function analyzeEditorialMemory(input: AnalyzeEditorialMemoryInput): EditorialNoveltyResult {
  const assets = [...input.assets].sort((a, b) =>
    (a.publishedAt ?? a.lastUpdatedAt).localeCompare(b.publishedAt ?? b.lastUpdatedAt),
  );
  const portfolioSize = assets.length;
  const fatigueThreshold = Math.max(2, Math.ceil((input.fatigueThresholdRatio ?? 0.5) * portfolioSize));

  // 1. repeated patterns — by title shape AND narrative shape.
  const patternCounts = new Map<string, { count: number; lastUsedAt: string }>();
  function recordPattern(pattern: string, when: string) {
    const existing = patternCounts.get(pattern);
    if (!existing) patternCounts.set(pattern, { count: 1, lastUsedAt: when });
    else { existing.count += 1; if (when > existing.lastUsedAt) existing.lastUsedAt = when; }
  }
  for (const a of assets) {
    const when = a.publishedAt ?? a.lastUpdatedAt;
    recordPattern(`title:${titleShapeOf(a.title)}`, when);
    recordPattern(`narrative:${narrativeShapeOf(a.strategicNarrative)}`, when);
    recordPattern(`archetype:${a.narrativeArchetype ?? 'uncategorized'}`, when);
  }
  const repeatedPatterns: EditorialNoveltyResult['repeatedPatterns'] = [];
  patternCounts.forEach((info, pattern) => {
    if (info.count >= Math.max(3, Math.ceil(portfolioSize * 0.35))) {
      repeatedPatterns.push({ pattern, occurrences: info.count, lastUsedAt: info.lastUsedAt });
    }
  });
  repeatedPatterns.sort((a, b) => b.occurrences - a.occurrences);

  // 2. fatigued terminology — every term in terminologyClusters + authorityThemes.
  const termCounts = new Map<string, number>();
  for (const a of assets) {
    const seen = new Set<string>();
    for (const t of [...a.terminologyClusters, ...a.authorityThemes]) {
      const k = t.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      termCounts.set(k, (termCounts.get(k) ?? 0) + 1);
    }
  }
  const fatiguedTerminology: EditorialNoveltyResult['fatiguedTerminology'] = [];
  for (const [term, occurrences] of termCounts) {
    if (occurrences >= fatigueThreshold) {
      fatiguedTerminology.push({ term, occurrences });
    }
  }
  fatiguedTerminology.sort((a, b) => b.occurrences - a.occurrences);

  // 3. positioning drift — compare dominant archetype + capability across first vs. last quartile.
  let positioningDrift: EditorialNoveltyResult['positioningDrift'] = { detected: false, detail: 'No drift detected.' };
  if (portfolioSize >= 4) {
    const quartile = Math.max(1, Math.floor(portfolioSize / 4));
    const firstQ = assets.slice(0, quartile);
    const lastQ = assets.slice(-quartile);
    const dominant = (group: ContentPortfolioAsset[]): { archetype: string; cap: string } => {
      const arche = new Map<string, number>();
      const caps = new Map<string, number>();
      for (const a of group) {
        const arch = a.narrativeArchetype ?? 'uncategorized';
        arche.set(arch, (arche.get(arch) ?? 0) + 1);
        for (const c of a.capabilityEmphasis) {
          const k = c.toLowerCase();
          caps.set(k, (caps.get(k) ?? 0) + 1);
        }
      }
      const topArchetype = Array.from(arche.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'uncategorized';
      const topCap = Array.from(caps.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
      return { archetype: topArchetype, cap: topCap };
    };
    const a0 = dominant(firstQ);
    const a1 = dominant(lastQ);
    if (a0.archetype !== a1.archetype || (a0.cap && a1.cap && a0.cap !== a1.cap)) {
      positioningDrift = {
        detected: true,
        detail: `Dominant archetype drifted ${a0.archetype} → ${a1.archetype}${a0.cap && a1.cap ? `; capability emphasis ${a0.cap} → ${a1.cap}` : ''}.`,
      };
    }
  }

  // 4. Composite scores.
  // editorialNoveltyScore: high when repeated patterns are few + fatigued terms are few.
  const repeatPenalty = Math.min(60, repeatedPatterns.length * 12);
  const fatiguePenalty = Math.min(40, fatiguedTerminology.length * 8);
  const editorialNoveltyScore = clamp100(100 - repeatPenalty - fatiguePenalty);

  // strategicFreshnessScore: positioning evolving = fresh (positive); stale = penalized.
  let strategicFreshnessScore = 80;
  if (positioningDrift.detected) strategicFreshnessScore += 10;
  if (repeatedPatterns.length > 4) strategicFreshnessScore -= 25;
  if (fatiguedTerminology.length > 4) strategicFreshnessScore -= 15;
  if (portfolioSize >= 8 && !positioningDrift.detected) strategicFreshnessScore -= 15;
  strategicFreshnessScore = clamp100(strategicFreshnessScore);

  return {
    editorialNoveltyScore,
    strategicFreshnessScore,
    repeatedPatterns,
    fatiguedTerminology,
    positioningDrift,
  };
}

export type { NarrativeArchetype };
