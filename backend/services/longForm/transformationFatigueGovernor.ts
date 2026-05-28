/**
 * Phase 12.3 — Transformation fatigue governor.
 *
 * Looks at the cross-modal registry (assets + lineages) and surfaces
 * fatigued transformation patterns across 5 dimensions:
 *
 *   decomposition_path           "long_form → post" used many times
 *   expansion_strategy           "thread → long_form" used many times
 *   educational_journey          per-ICP recurring journey (rolling-3)
 *   funnel_transition            same funnel-rank jump repeated
 *   authority_reinforcement_loop a single archetype reinforced across
 *                                many lineages without new theme coverage
 *
 * Each pattern carries an `occurrences` count + severity. A composite
 * `transformationFatigueScore` (higher = more fatigued) is emitted.
 *
 * Pure / deterministic.
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  TransformationFatiguePattern,
  TransformationFatigueResult,
} from './longFormRecommendationTypes';
import type { CrossModalContentRegistry } from './crossModalContentRegistry';
import { FORMAT_FUNNEL_RANK } from './authorityCompoundingEngine';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function severityFromOccurrences(o: number): 'low' | 'medium' | 'high' {
  return o >= 6 ? 'high' : o >= 4 ? 'medium' : 'low';
}

export interface AnalyzeTransformationFatigueInput {
  registry: CrossModalContentRegistry;
  companyId: string;
  /** baseline threshold for a pattern to be reported (default 3). */
  patternThreshold?: number;
  /** journey window length (default 3). */
  journeyWindow?: number;
}

export function analyzeTransformationFatigue(input: AnalyzeTransformationFatigueInput): TransformationFatigueResult {
  const assets = input.registry.listAssets(input.companyId);
  const lineages = input.registry.listLineages(input.companyId);
  const threshold = Math.max(2, input.patternThreshold ?? 3);
  const journeyWindow = Math.max(2, input.journeyWindow ?? 3);

  const patterns: TransformationFatiguePattern[] = [];

  // 1. decomposition_path — source > target word count (decomposition / extraction).
  const decompPairCounts = new Map<string, number>();
  for (const l of lineages) {
    if (l.transformationType !== 'decomposition' && l.transformationType !== 'extraction') continue;
    const key = `${l.sourceFormat}->${l.targetFormat}`;
    decompPairCounts.set(key, (decompPairCounts.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of decompPairCounts) {
    if (count >= threshold) {
      patterns.push({
        patternType: 'decomposition_path',
        signature: pair,
        occurrences: count,
        scope: { formatPair: pair },
        fatigueSeverity: severityFromOccurrences(count),
      });
    }
  }

  // 2. expansion_strategy — source < target (expansion).
  const expandPairCounts = new Map<string, number>();
  for (const l of lineages) {
    if (l.transformationType !== 'expansion') continue;
    const key = `${l.sourceFormat}->${l.targetFormat}`;
    expandPairCounts.set(key, (expandPairCounts.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of expandPairCounts) {
    if (count >= threshold) {
      patterns.push({
        patternType: 'expansion_strategy',
        signature: pair,
        occurrences: count,
        scope: { formatPair: pair },
        fatigueSeverity: severityFromOccurrences(count),
      });
    }
  }

  // 3. educational_journey — per ICP, rolling window of format-sequences.
  const byIcp = new Map<string, CrossModalAsset[]>();
  for (const a of assets) {
    for (const icp of a.icpFocus) {
      const k = icp.toLowerCase();
      const arr = byIcp.get(k) ?? [];
      arr.push(a);
      byIcp.set(k, arr);
    }
  }
  for (const [icp, group] of byIcp) {
    const ordered = [...group].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    if (ordered.length < journeyWindow) continue;
    const sigCounts = new Map<string, number>();
    for (let i = 0; i + (journeyWindow - 1) < ordered.length; i += 1) {
      const win = ordered.slice(i, i + journeyWindow);
      const sig = win.map((a) => a.format).join('->');
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    for (const [sig, count] of sigCounts) {
      if (count >= 2) {
        patterns.push({
          patternType: 'educational_journey',
          signature: sig,
          occurrences: count,
          scope: { icp, journey: sig },
          fatigueSeverity: severityFromOccurrences(count + 1), // journeys are heavier signal
        });
      }
    }
  }

  // 4. funnel_transition — chronologically: count repeated funnel-rank jumps
  //    per ICP (e.g. rank 1 → rank 3 happening 4 times).
  for (const [icp, group] of byIcp) {
    const ordered = [...group].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const transitionCounts = new Map<string, number>();
    for (let i = 1; i < ordered.length; i += 1) {
      const a = FORMAT_FUNNEL_RANK[ordered[i - 1].format];
      const b = FORMAT_FUNNEL_RANK[ordered[i].format];
      if (a === b) continue;
      const key = `${a}->${b}`;
      transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
    }
    for (const [transition, count] of transitionCounts) {
      if (count >= threshold) {
        patterns.push({
          patternType: 'funnel_transition',
          signature: `${icp}|${transition}`,
          occurrences: count,
          scope: { icp },
          fatigueSeverity: severityFromOccurrences(count),
        });
      }
    }
  }

  // 5. authority_reinforcement_loop — a single archetype that has been
  //    reinforced across many lineages with NO new theme coverage.
  const archetypeLineageCounts = new Map<string, { count: number; themes: Set<string> }>();
  for (const l of lineages) {
    const src = input.registry.getAsset(input.companyId, l.sourceAssetId);
    const dst = input.registry.getAsset(input.companyId, l.derivedAssetId);
    if (!src || !dst) continue;
    if (src.narrativeArchetype !== dst.narrativeArchetype || src.narrativeArchetype == null) continue;
    const arch = src.narrativeArchetype.toString();
    const existing = archetypeLineageCounts.get(arch) ?? { count: 0, themes: new Set<string>() };
    existing.count += 1;
    for (const th of [...src.authorityThemes, ...dst.authorityThemes]) existing.themes.add(th.toLowerCase());
    archetypeLineageCounts.set(arch, existing);
  }
  for (const [archetype, info] of archetypeLineageCounts) {
    // "loop" = many lineages, few unique themes. Heuristic: count ≥ threshold and themes ≤ 2.
    if (info.count >= threshold && info.themes.size <= 2) {
      patterns.push({
        patternType: 'authority_reinforcement_loop',
        signature: `archetype:${archetype}|themes:${[...info.themes].sort().join(',')}`,
        occurrences: info.count,
        scope: { archetype },
        fatigueSeverity: severityFromOccurrences(info.count),
      });
    }
  }

  // ── Per-scope rollups ───────────────────────────────────────────────────
  const fatigueByIcp = new Map<string, number>();
  const fatigueByArchetype = new Map<string, number>();
  const fatigueByFormatPair = new Map<string, number>();
  const sevPoints = { low: 5, medium: 12, high: 25 };
  for (const p of patterns) {
    const pts = sevPoints[p.fatigueSeverity];
    if (p.scope.icp) fatigueByIcp.set(p.scope.icp, (fatigueByIcp.get(p.scope.icp) ?? 0) + pts);
    if (p.scope.archetype) fatigueByArchetype.set(p.scope.archetype, (fatigueByArchetype.get(p.scope.archetype) ?? 0) + pts);
    if (p.scope.formatPair) fatigueByFormatPair.set(p.scope.formatPair, (fatigueByFormatPair.get(p.scope.formatPair) ?? 0) + pts);
  }

  // Composite fatigue score = clamped sum of severities weighted by type.
  const transformationFatigueScore = clamp100(
    patterns.reduce((s, p) => s + sevPoints[p.fatigueSeverity], 0),
  );

  // Sort patterns: severity high → low, then occurrences high → low.
  const sevRank = { low: 0, medium: 1, high: 2 } as const;
  patterns.sort((a, b) => {
    if (sevRank[b.fatigueSeverity] !== sevRank[a.fatigueSeverity]) return sevRank[b.fatigueSeverity] - sevRank[a.fatigueSeverity];
    return b.occurrences - a.occurrences;
  });

  return {
    transformationFatigueScore,
    exhaustedTransformationPatterns: patterns,
    fatigueByIcp: Array.from(fatigueByIcp.entries()).map(([icp, score]) => ({ icp, score: clamp100(score) })).sort((a, b) => b.score - a.score),
    fatigueByArchetype: Array.from(fatigueByArchetype.entries()).map(([archetype, score]) => ({ archetype, score: clamp100(score) })).sort((a, b) => b.score - a.score),
    fatigueByFormatPair: Array.from(fatigueByFormatPair.entries()).map(([pair, score]) => ({ pair, score: clamp100(score) })).sort((a, b) => b.score - a.score),
  };
}

// Helper retained for callers that want to validate funnel ranks externally.
export function formatFunnelRank(format: CrossModalFormat): number {
  return FORMAT_FUNNEL_RANK[format];
}
