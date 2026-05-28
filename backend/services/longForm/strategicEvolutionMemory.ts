/**
 * Phase 8 — Strategic evolution memory.
 *
 * Stores periodic `EvolutionSnapshot` records per company and produces
 * findings about long-term drift, strategic stagnation, authority
 * plateaus, ecosystem rigidity.
 *
 * Caller calls `takeSnapshot()` at intervals (e.g. weekly or after every
 * 5 articles); the engine then exposes `analyzeEvolution()` to surface
 * findings + a trajectory score.
 */

import type {
  ContentPortfolioAsset,
  EvolutionSnapshot,
  StrategicEvolutionFinding,
  StrategicEvolutionResult,
} from './longFormRecommendationTypes';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function topN(map: Map<string, number>, n: number): string[] {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildSnapshot(companyId: string, assets: ContentPortfolioAsset[], averageNovelty: number): EvolutionSnapshot {
  const themeCounts = new Map<string, number>();
  const icpCounts = new Map<string, number>();
  const termCounts = new Map<string, number>();
  const archetypeCounts = new Map<string, number>();
  const positioningSet = new Set<string>();
  for (const a of assets) {
    for (const th of a.authorityThemes) themeCounts.set(th.toLowerCase(), (themeCounts.get(th.toLowerCase()) ?? 0) + 1);
    for (const ic of a.icpFocus) icpCounts.set(ic.toLowerCase(), (icpCounts.get(ic.toLowerCase()) ?? 0) + 1);
    for (const tc of a.terminologyClusters) termCounts.set(tc.toLowerCase(), (termCounts.get(tc.toLowerCase()) ?? 0) + 1);
    const arch = (a.narrativeArchetype ?? 'uncategorized').toLowerCase();
    archetypeCounts.set(arch, (archetypeCounts.get(arch) ?? 0) + 1);
    if (a.strategicNarrative) positioningSet.add(a.strategicNarrative.toLowerCase().slice(0, 80));
  }
  return {
    snapshotId: newId('snap'),
    companyId,
    takenAt: new Date().toISOString(),
    positioning: Array.from(positioningSet).slice(0, 5),
    authorityTopThemes: topN(themeCounts, 5),
    topICPs: topN(icpCounts, 5),
    topTerminology: topN(termCounts, 8),
    topArchetypes: topN(archetypeCounts, 5),
    portfolioSize: assets.length,
    averageNovelty,
  };
}

export interface StrategicEvolutionMemory {
  takeSnapshot(input: { companyId: string; assets: ContentPortfolioAsset[]; averageNovelty: number }): EvolutionSnapshot;
  list(companyId: string): EvolutionSnapshot[];
  analyzeEvolution(companyId: string): StrategicEvolutionResult;
  clear(companyId?: string): void;
  size(companyId?: string): number;
}

export function createStrategicEvolutionMemory(): StrategicEvolutionMemory {
  const buckets = new Map<string, EvolutionSnapshot[]>();

  function getBucket(companyId: string): EvolutionSnapshot[] {
    let b = buckets.get(companyId);
    if (!b) { b = []; buckets.set(companyId, b); }
    return b;
  }

  return {
    takeSnapshot(input) {
      const snap = buildSnapshot(input.companyId, input.assets, input.averageNovelty);
      getBucket(input.companyId).push(snap);
      return snap;
    },
    list(companyId) {
      return [...(buckets.get(companyId) ?? [])];
    },
    analyzeEvolution(companyId) {
      const snapshots = [...(buckets.get(companyId) ?? [])];
      snapshots.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      const findings: StrategicEvolutionResult['findings'] = [];

      if (snapshots.length < 2) {
        return {
          snapshots,
          findings,
          evolutionTrajectoryScore: 50,
        };
      }

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];

      // 1. long_term_drift: top archetype + dominant ICP changed.
      const firstArchetype = first.topArchetypes[0];
      const lastArchetype = last.topArchetypes[0];
      const firstIcp = first.topICPs[0];
      const lastIcp = last.topICPs[0];
      if (firstArchetype && lastArchetype && firstArchetype !== lastArchetype) {
        findings.push({
          finding: 'long_term_drift', severity: 'medium',
          detail: `Dominant archetype shifted ${firstArchetype} → ${lastArchetype} between first and last snapshot.`,
        });
      }
      if (firstIcp && lastIcp && firstIcp !== lastIcp) {
        findings.push({
          finding: 'long_term_drift', severity: 'medium',
          detail: `Top ICP shifted ${firstIcp} → ${lastIcp} between first and last snapshot.`,
        });
      }

      // 2. strategic_stagnation: positioning sets are identical AND portfolio grew.
      const positioningStable = jaccard(new Set(first.positioning), new Set(last.positioning)) >= 0.7;
      if (positioningStable && last.portfolioSize > first.portfolioSize + 4) {
        findings.push({
          finding: 'strategic_stagnation', severity: 'medium',
          detail: `Positioning unchanged across ${snapshots.length} snapshots even though portfolio grew ${first.portfolioSize} → ${last.portfolioSize}.`,
        });
      }

      // 3. authority_plateau: top authority themes are the same in last 3 snapshots.
      if (snapshots.length >= 3) {
        const recent = snapshots.slice(-3);
        const themeSets = recent.map((s) => new Set(s.authorityTopThemes));
        const overlap = jaccard(themeSets[0], themeSets[themeSets.length - 1]);
        if (overlap >= 0.8) {
          findings.push({
            finding: 'authority_plateau', severity: 'low',
            detail: `Top authority themes unchanged across the last ${recent.length} snapshots (Jaccard ${overlap.toFixed(2)}).`,
          });
        }
      }

      // 4. ecosystem_rigidity: novelty is dropping monotonically.
      const novelties = snapshots.map((s) => s.averageNovelty);
      let monotonicDrop = true;
      for (let i = 1; i < novelties.length; i += 1) {
        if (novelties[i] > novelties[i - 1] + 2) { monotonicDrop = false; break; }
      }
      if (monotonicDrop && novelties.length >= 3 && novelties[0] - novelties[novelties.length - 1] >= 10) {
        findings.push({
          finding: 'ecosystem_rigidity', severity: 'high',
          detail: `Average novelty has fallen monotonically across ${novelties.length} snapshots (${novelties[0]} → ${novelties[novelties.length - 1]}).`,
        });
      }

      // Trajectory score: combine novelty trend + finding severity.
      const noveltyTrendBonus = (last.averageNovelty - first.averageNovelty);
      const findingPenalty = findings.reduce((sum, f) => sum + (f.severity === 'high' ? 25 : f.severity === 'medium' ? 12 : 5), 0);
      const evolutionTrajectoryScore = Math.max(0, Math.min(100, Math.round(70 + noveltyTrendBonus - findingPenalty)));

      return { snapshots, findings, evolutionTrajectoryScore };
    },
    clear(companyId) {
      if (!companyId) { buckets.clear(); return; }
      buckets.delete(companyId);
    },
    size(companyId) {
      if (companyId) return buckets.get(companyId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _defaultMemory: StrategicEvolutionMemory | null = null;

export function getDefaultStrategicEvolutionMemory(): StrategicEvolutionMemory {
  if (!_defaultMemory) _defaultMemory = createStrategicEvolutionMemory();
  return _defaultMemory;
}

export function setDefaultStrategicEvolutionMemory(mem: StrategicEvolutionMemory): void {
  _defaultMemory = mem;
}
