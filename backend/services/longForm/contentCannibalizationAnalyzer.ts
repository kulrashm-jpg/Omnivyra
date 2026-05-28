/**
 * Phase 3 — Content cannibalization analyzer.
 *
 * Pairwise comparison of portfolio assets across 8 risk axes. Pairs that
 * exceed thresholds get clustered into a `DuplicationCluster` with a
 * cannibalization risk score (0–100). Returns clusters + total risk + high-risk pairs.
 */

import type {
  CannibalizationAnalysisResult,
  CannibalizationTriggerType,
  ContentPortfolioAsset,
  DuplicationCluster,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

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

function normSet(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (k) out.add(k);
  }
  return out;
}

interface PairwiseScore {
  triggers: Array<{ type: CannibalizationTriggerType; detail: string; weight: number }>;
  riskScore: number;
  sharedThemes: string[];
  sharedICPs: string[];
  sharedWorkflows: string[];
  sharedAxes: string[];
}

function comparePair(a: ContentPortfolioAsset, b: ContentPortfolioAsset): PairwiseScore {
  const triggers: PairwiseScore['triggers'] = [];

  // 1. TOPIC_OVERLAP — title token Jaccard.
  const titleOverlap = jaccard(tokens(a.title), tokens(b.title));
  if (titleOverlap >= 0.45) {
    triggers.push({ type: 'TOPIC_OVERLAP', detail: `Title token overlap ${(titleOverlap * 100).toFixed(0)}%`, weight: Math.round(titleOverlap * 35) });
  }

  // 2. STRATEGIC_OVERLAP — strategicNarrative token Jaccard.
  const strategyOverlap = jaccard(tokens(a.strategicNarrative), tokens(b.strategicNarrative));
  if (strategyOverlap >= 0.50) {
    triggers.push({ type: 'STRATEGIC_OVERLAP', detail: `Strategic narrative overlap ${(strategyOverlap * 100).toFixed(0)}%`, weight: Math.round(strategyOverlap * 30) });
  }

  // 3. NARRATIVE_DUPLICATION — same archetype + same content mode.
  if (a.narrativeArchetype && a.narrativeArchetype === b.narrativeArchetype && a.contentMode === b.contentMode) {
    triggers.push({ type: 'NARRATIVE_DUPLICATION', detail: `Same archetype "${a.narrativeArchetype}" + mode "${a.contentMode}"`, weight: 18 });
  }

  // 4. ICP_DUPLICATION — ICP focus set Jaccard.
  const icpA = normSet(a.icpFocus);
  const icpB = normSet(b.icpFocus);
  const icpOverlap = jaccard(icpA, icpB);
  const sharedICPs = Array.from(icpA).filter((x) => icpB.has(x));
  if (icpOverlap >= 0.6 && sharedICPs.length >= 1) {
    triggers.push({ type: 'ICP_DUPLICATION', detail: `Shared ICPs: ${sharedICPs.join('; ')}`, weight: Math.round(icpOverlap * 22) });
  }

  // 5. SEO_CANNIBALIZATION — head-bigram of titles match.
  const headA = a.title.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
  const headB = b.title.toLowerCase().split(/\s+/).slice(0, 3).join(' ');
  if (headA && headA === headB) {
    triggers.push({ type: 'SEO_CANNIBALIZATION', detail: `Identical leading bigram "${headA}"`, weight: 25 });
  }

  // 6. WORKFLOW_REDUNDANCY — capability + workflow tag overlap.
  const wfA = normSet([...a.capabilityEmphasis, ...a.terminologyClusters]);
  const wfB = normSet([...b.capabilityEmphasis, ...b.terminologyClusters]);
  const wfOverlap = jaccard(wfA, wfB);
  const sharedWorkflows = Array.from(wfA).filter((x) => wfB.has(x));
  if (wfOverlap >= 0.55 && sharedWorkflows.length >= 2) {
    triggers.push({ type: 'WORKFLOW_REDUNDANCY', detail: `Shared workflows: ${sharedWorkflows.slice(0, 4).join('; ')}`, weight: Math.round(wfOverlap * 22) });
  }

  // 7. REPETITIVE_FRAMING — same editorialAngle leading clause.
  const angleA = a.editorialAngle.toLowerCase().slice(0, 80);
  const angleB = b.editorialAngle.toLowerCase().slice(0, 80);
  const angleOverlap = jaccard(tokens(angleA), tokens(angleB));
  if (angleOverlap >= 0.55) {
    triggers.push({ type: 'REPETITIVE_FRAMING', detail: `Editorial-angle token overlap ${(angleOverlap * 100).toFixed(0)}%`, weight: Math.round(angleOverlap * 22) });
  }

  // 8. AUTHORITY_SATURATION — same authority theme set overlap.
  const thA = normSet(a.authorityThemes);
  const thB = normSet(b.authorityThemes);
  const themeOverlap = jaccard(thA, thB);
  const sharedThemes = Array.from(thA).filter((x) => thB.has(x));
  if (themeOverlap >= 0.65 && sharedThemes.length >= 2) {
    triggers.push({ type: 'AUTHORITY_SATURATION', detail: `Shared authority themes: ${sharedThemes.slice(0, 4).join('; ')}`, weight: Math.round(themeOverlap * 20) });
  }

  const riskScore = Math.min(100, triggers.reduce((sum, t) => sum + t.weight, 0));
  const sharedAxes = triggers.map((t) => t.type);

  return {
    triggers,
    riskScore,
    sharedThemes,
    sharedICPs,
    sharedWorkflows,
    sharedAxes,
  };
}

/**
 * Union-find clustering: pairs above MIN_CLUSTER_RISK get merged into a
 * single cluster. Each cluster's risk is the max pairwise risk.
 */
const MIN_PAIR_RISK = 40;

export interface AnalyzeCannibalizationInput {
  assets: ContentPortfolioAsset[];
}

export function analyzeContentCannibalization(input: AnalyzeCannibalizationInput): CannibalizationAnalysisResult {
  const assets = input.assets;
  const pairScores: Array<{ a: ContentPortfolioAsset; b: ContentPortfolioAsset; score: PairwiseScore }> = [];

  for (let i = 0; i < assets.length; i += 1) {
    for (let j = i + 1; j < assets.length; j += 1) {
      const score = comparePair(assets[i], assets[j]);
      if (score.riskScore >= MIN_PAIR_RISK) {
        pairScores.push({ a: assets[i], b: assets[j], score });
      }
    }
  }

  // Union-find clustering.
  const parent = new Map<string, string>();
  function find(x: string): string {
    const p = parent.get(x);
    if (!p || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const asset of assets) parent.set(asset.articleId, asset.articleId);
  for (const ps of pairScores) union(ps.a.articleId, ps.b.articleId);

  const clusterMembers = new Map<string, ContentPortfolioAsset[]>();
  for (const asset of assets) {
    const root = find(asset.articleId);
    const arr = clusterMembers.get(root) ?? [];
    arr.push(asset);
    clusterMembers.set(root, arr);
  }

  const clusters: DuplicationCluster[] = [];
  for (const [root, members] of clusterMembers) {
    if (members.length < 2) continue; // skip singletons
    const memberPairs = pairScores.filter((p) =>
      find(p.a.articleId) === root || find(p.b.articleId) === root,
    );
    if (memberPairs.length === 0) continue;
    const aggregatedRisk = Math.min(100, Math.round(
      memberPairs.reduce((sum, p) => sum + p.score.riskScore, 0) / memberPairs.length,
    ));
    const themes = new Set<string>();
    const icps = new Set<string>();
    const workflows = new Set<string>();
    const triggerMap = new Map<CannibalizationTriggerType, string>();
    for (const p of memberPairs) {
      for (const t of p.score.sharedThemes) themes.add(t);
      for (const t of p.score.sharedICPs) icps.add(t);
      for (const t of p.score.sharedWorkflows) workflows.add(t);
      for (const trig of p.score.triggers) {
        if (!triggerMap.has(trig.type)) triggerMap.set(trig.type, trig.detail);
      }
    }
    clusters.push({
      duplicationClusterId: `dup_${stableHash(root).slice(0, 8)}`,
      articleIds: members.map((m) => m.articleId),
      sharedThemes: Array.from(themes),
      sharedICPs: Array.from(icps),
      sharedWorkflows: Array.from(workflows),
      cannibalizationRiskScore: aggregatedRisk,
      triggers: Array.from(triggerMap.entries()).map(([type, detail]) => ({ type, detail })),
    });
  }

  const totalCannibalizationRiskScore = clusters.length === 0
    ? 0
    : Math.round(clusters.reduce((s, c) => s + c.cannibalizationRiskScore, 0) / clusters.length);

  const highRiskPairs = pairScores
    .filter((p) => p.score.riskScore >= 65)
    .map((p) => ({
      articleAId: p.a.articleId,
      articleBId: p.b.articleId,
      riskScore: p.score.riskScore,
      sharedAxes: p.score.sharedAxes,
    }));

  return { clusters, totalCannibalizationRiskScore, highRiskPairs };
}
