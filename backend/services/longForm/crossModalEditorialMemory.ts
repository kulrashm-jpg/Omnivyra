/**
 * Phase 7 — Cross-modal editorial memory.
 *
 * Walks the registry's lineage history + the asset catalog and surfaces:
 *   repeatedTransformationPaths    — same source-format → target-format path used many times
 *   exhaustedNarratives            — archetypes already saturated across formats
 *   expansionFatigue               — same expansion direction reused often
 *   repetitiveEducationalJourneys  — same ICP → same path of formats over time
 *
 * Produces crossModalNoveltyScore (0..100; high = ecosystem feels fresh).
 *
 * Pure / deterministic.
 */

import type {
  CrossModalAsset,
  CrossModalEditorialMemoryResult,
  CrossModalFormat,
  TransformationLineage,
} from './longFormRecommendationTypes';
import type { CrossModalContentRegistry } from './crossModalContentRegistry';
import { FORMAT_FUNNEL_RANK } from './authorityCompoundingEngine';

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface AnalyzeCrossModalEditorialMemoryInput {
  registry: CrossModalContentRegistry;
  companyId: string;
  /** repeated transformation path threshold (default 3) */
  pathRepeatThreshold?: number;
  /** repeated journey threshold (default 2) */
  journeyRepeatThreshold?: number;
}

export function analyzeCrossModalEditorialMemory(input: AnalyzeCrossModalEditorialMemoryInput): CrossModalEditorialMemoryResult {
  const assets = input.registry.listAssets(input.companyId);
  const lineages = input.registry.listLineages(input.companyId);
  const pathRepeatThreshold = Math.max(2, input.pathRepeatThreshold ?? 3);
  const journeyRepeatThreshold = Math.max(2, input.journeyRepeatThreshold ?? 2);

  // ── 1. repeated transformation paths ──────────────────────────────────
  const pathCounts = new Map<string, { count: number; lastUsedAt: string }>();
  for (const l of lineages) {
    const sig = `${l.sourceFormat}->${l.targetFormat}:${l.transformationType}`;
    const existing = pathCounts.get(sig);
    if (!existing) pathCounts.set(sig, { count: 1, lastUsedAt: l.createdAt });
    else { existing.count += 1; if (l.createdAt > existing.lastUsedAt) existing.lastUsedAt = l.createdAt; }
  }
  const repeatedTransformationPaths: CrossModalEditorialMemoryResult['repeatedTransformationPaths'] = [];
  pathCounts.forEach((info, sig) => {
    if (info.count >= pathRepeatThreshold) {
      repeatedTransformationPaths.push({ pathSignature: sig, occurrences: info.count, lastUsedAt: info.lastUsedAt });
    }
  });
  repeatedTransformationPaths.sort((a, b) => b.occurrences - a.occurrences);

  // ── 2. exhausted narratives — archetypes that span ≥ 4 formats AND ≥ 6 assets ──
  const archetypeMap = new Map<string, { formats: Set<CrossModalFormat>; count: number }>();
  for (const a of assets) {
    const arch = (a.narrativeArchetype ?? 'uncategorized').toString();
    const existing = archetypeMap.get(arch) ?? { formats: new Set<CrossModalFormat>(), count: 0 };
    existing.formats.add(a.format);
    existing.count += 1;
    archetypeMap.set(arch, existing);
  }
  const exhaustedNarratives: CrossModalEditorialMemoryResult['exhaustedNarratives'] = [];
  for (const [archetype, info] of archetypeMap) {
    if (info.formats.size >= 4 && info.count >= 6) {
      exhaustedNarratives.push({
        archetype,
        formats: Array.from(info.formats),
        occurrences: info.count,
      });
    }
  }
  exhaustedNarratives.sort((a, b) => b.occurrences - a.occurrences);

  // ── 3. expansion fatigue — short → long direction used many times ──────
  const expansionCounts = new Map<string, { src: CrossModalFormat; dst: CrossModalFormat; count: number }>();
  for (const l of lineages) {
    if (l.transformationType !== 'expansion') continue;
    const key = `${l.sourceFormat}->${l.targetFormat}`;
    const existing = expansionCounts.get(key) ?? { src: l.sourceFormat, dst: l.targetFormat, count: 0 };
    existing.count += 1;
    expansionCounts.set(key, existing);
  }
  const expansionFatigue: CrossModalEditorialMemoryResult['expansionFatigue'] = [];
  expansionCounts.forEach((info) => {
    if (info.count >= pathRepeatThreshold) {
      expansionFatigue.push({ sourceFormat: info.src, targetFormat: info.dst, occurrences: info.count });
    }
  });
  expansionFatigue.sort((a, b) => b.occurrences - a.occurrences);

  // ── 4. repetitive educational journeys per ICP ────────────────────────
  // Journey = ordered sequence of unique funnel ranks visited by formats
  // for that ICP, chronologically.
  const journeyMap = new Map<string, Map<string, number>>(); // icp → {journeySig: count}
  const byIcp = new Map<string, CrossModalAsset[]>();
  for (const a of assets) {
    for (const icp of a.icpFocus) {
      const key = icp.toLowerCase();
      const arr = byIcp.get(key) ?? [];
      arr.push(a);
      byIcp.set(key, arr);
    }
  }
  for (const [icp, group] of byIcp) {
    const ordered = [...group].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    // Bucket each ICP's assets into rolling windows of 3.
    if (ordered.length < 3) continue;
    const sigCounts = journeyMap.get(icp) ?? new Map<string, number>();
    for (let i = 0; i + 2 < ordered.length; i += 1) {
      const window = [ordered[i], ordered[i + 1], ordered[i + 2]];
      const sig = window.map((a) => `${a.format}:${FORMAT_FUNNEL_RANK[a.format]}`).join('->');
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    journeyMap.set(icp, sigCounts);
  }
  const repetitiveEducationalJourneys: CrossModalEditorialMemoryResult['repetitiveEducationalJourneys'] = [];
  for (const [icp, sigCounts] of journeyMap) {
    for (const [sig, count] of sigCounts) {
      if (count >= journeyRepeatThreshold) {
        repetitiveEducationalJourneys.push({ icp, journeySignature: sig, occurrences: count });
      }
    }
  }
  repetitiveEducationalJourneys.sort((a, b) => b.occurrences - a.occurrences);

  // ── 5. crossModalNoveltyScore ────────────────────────────────────────
  // high when repeated paths, exhausted archetypes, expansion fatigue,
  // and repetitive journeys are all low.
  const pathPenalty = Math.min(30, repeatedTransformationPaths.length * 8);
  const exhaustionPenalty = Math.min(30, exhaustedNarratives.length * 15);
  const fatiguePenalty = Math.min(20, expansionFatigue.length * 10);
  const journeyPenalty = Math.min(20, repetitiveEducationalJourneys.length * 8);
  const crossModalNoveltyScore = clamp100(100 - pathPenalty - exhaustionPenalty - fatiguePenalty - journeyPenalty);

  return {
    repeatedTransformationPaths,
    exhaustedNarratives,
    expansionFatigue,
    repetitiveEducationalJourneys,
    crossModalNoveltyScore,
  };
}
