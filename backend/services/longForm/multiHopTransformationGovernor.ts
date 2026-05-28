/**
 * Phase 12.1 — Multi-hop transformation governor.
 *
 * The pairwise continuity governor (Phase 3 of the cross-modal layer)
 * catches single-step drift. This module catches the slower failure mode:
 * A→B→C→D where each hop is within tolerance but D is unrecognizable
 * relative to A.
 *
 * Inputs: registry + an assetId (typically the leaf of a chain) OR a
 * caller-supplied chain of asset IDs.
 *
 * Outputs:
 *   chainContinuityScore               aggregate score (per-hop + cumulative penalty)
 *   cumulativeAuthorityRetention       (leaf / root) × 100, clamped
 *   cumulativeNarrativeRetention       Jaccard(leaf.narrative, root.narrative)
 *   cumulativeICPAlignment             intersection ratio leaf-vs-root ICPs
 *   cumulativeTerminologyRetention     intersection ratio leaf-vs-root terminology
 *   cumulativeEvidenceRetention        evidence density ratio
 *   chainDriftSeverity                 low / medium / high
 *   driftAxes                          per-axis breakdown
 *   perHopContinuity                   pairwise scores along the chain
 *
 * Pure / deterministic.
 */

import type {
  CrossModalAsset,
  MultiHopContinuityResult,
  MultiHopDriftAxis,
} from './longFormRecommendationTypes';
import type { CrossModalContentRegistry } from './crossModalContentRegistry';
import { governCrossModalContinuity } from './crossModalContinuityGovernor';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of (text ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
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

function lowerSet(list: string[]): Set<string> {
  return new Set(list.map((s) => s.toLowerCase()));
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface GovernMultiHopInput {
  registry: CrossModalContentRegistry;
  companyId: string;
  /** Either a leaf asset id (chain reconstructed via ancestorsOf) ... */
  leafAssetId?: string;
  /** ...OR an explicit ordered chain of asset ids (root → leaf). */
  chain?: string[];
}

export function governMultiHopTransformation(input: GovernMultiHopInput): MultiHopContinuityResult {
  // 1. Reconstruct the chain.
  let chainIds: string[];
  if (input.chain && input.chain.length > 0) {
    chainIds = [...input.chain];
  } else if (input.leafAssetId) {
    const ancestors = input.registry.ancestorsOf(input.companyId, input.leafAssetId);
    chainIds = [...ancestors, input.leafAssetId];
  } else {
    throw new Error('governMultiHopTransformation: must supply chain or leafAssetId');
  }

  // 2. Resolve assets, dropping unknown ids.
  const assets: CrossModalAsset[] = [];
  for (const id of chainIds) {
    const a = input.registry.getAsset(input.companyId, id);
    if (a) assets.push(a);
  }

  // Degenerate cases.
  if (assets.length === 0) {
    return {
      chainId: 'chain_empty',
      chainLength: 0,
      chainContinuityScore: 100,
      cumulativeAuthorityRetention: 0,
      cumulativeNarrativeRetention: 0,
      cumulativeICPAlignment: 0,
      cumulativeTerminologyRetention: 0,
      cumulativeEvidenceRetention: 0,
      chainDriftSeverity: 'low',
      driftAxes: [],
      perHopContinuity: [],
    };
  }
  if (assets.length === 1) {
    return {
      chainId: `chain_${assets[0].assetId}`,
      chainLength: 1,
      chainContinuityScore: 100,
      cumulativeAuthorityRetention: 100,
      cumulativeNarrativeRetention: 100,
      cumulativeICPAlignment: 100,
      cumulativeTerminologyRetention: 100,
      cumulativeEvidenceRetention: 100,
      chainDriftSeverity: 'low',
      driftAxes: [],
      perHopContinuity: [],
    };
  }

  const root = assets[0];
  const leaf = assets[assets.length - 1];

  // 3. Per-hop continuity scores (uses the pairwise governor).
  const perHopContinuity: MultiHopContinuityResult['perHopContinuity'] = [];
  for (let i = 1; i < assets.length; i += 1) {
    const hop = governCrossModalContinuity({ source: assets[i - 1], derived: assets[i] });
    perHopContinuity.push({
      hopIndex: i,
      fromAssetId: assets[i - 1].assetId,
      toAssetId: assets[i].assetId,
      continuityScore: hop.continuityScore,
    });
  }
  const avgHopScore = perHopContinuity.reduce((s, h) => s + h.continuityScore, 0) / perHopContinuity.length;

  // 4. Cumulative axis-level retention (leaf vs root).
  const cumulativeNarrativeRetention = clamp100(jaccard(tokens(root.strategicNarrative), tokens(leaf.strategicNarrative)) * 100);

  const rootIcps = lowerSet(root.icpFocus);
  const leafIcps = lowerSet(leaf.icpFocus);
  const icpInter = rootIcps.size === 0 ? 0 : (() => { let n = 0; rootIcps.forEach((t) => { if (leafIcps.has(t)) n += 1; }); return n; })();
  const cumulativeICPAlignment = rootIcps.size === 0 ? 100 : clamp100((icpInter / rootIcps.size) * 100);

  const rootTerms = lowerSet(root.terminologyClusters);
  const leafTerms = lowerSet(leaf.terminologyClusters);
  const termInter = rootTerms.size === 0 ? 0 : (() => { let n = 0; rootTerms.forEach((t) => { if (leafTerms.has(t)) n += 1; }); return n; })();
  const cumulativeTerminologyRetention = rootTerms.size === 0 ? 100 : clamp100((termInter / rootTerms.size) * 100);

  const cumulativeAuthorityRetention = root.authorityClaimCoverage <= 0
    ? 100
    : clamp100((leaf.authorityClaimCoverage / root.authorityClaimCoverage) * 100);

  const cumulativeEvidenceRetention = root.evidenceDensity <= 0
    ? 100
    : clamp100((leaf.evidenceDensity / root.evidenceDensity) * 100);

  // 5. Drift axes — anything < 60 cumulative retention is flagged.
  const driftAxes: MultiHopContinuityResult['driftAxes'] = [];
  function pushAxis(axis: MultiHopDriftAxis, retained: number, rationale: string) {
    const cumulativeLoss = clamp100(100 - retained);
    if (retained < 60) driftAxes.push({ axis, cumulativeLoss, rationale });
  }
  pushAxis('narrative', cumulativeNarrativeRetention,
    `Leaf narrative shares ${cumulativeNarrativeRetention}% token overlap with root.`);
  pushAxis('terminology', cumulativeTerminologyRetention,
    `Leaf retains ${cumulativeTerminologyRetention}% of root terminology clusters.`);
  pushAxis('authority', cumulativeAuthorityRetention,
    `Leaf authority claim coverage is ${cumulativeAuthorityRetention}% of root.`);
  pushAxis('icp', cumulativeICPAlignment,
    `Leaf ICP set overlaps ${cumulativeICPAlignment}% of root ICP set.`);
  pushAxis('evidence', cumulativeEvidenceRetention,
    `Leaf evidence density is ${cumulativeEvidenceRetention}% of root.`);

  // 6. Chain continuity score = blend of avg per-hop score and cumulative
  //    integrity. Chain length penalty fires for 4+ hops (drift compounds).
  const cumulativeBase = (
    cumulativeNarrativeRetention * 0.30
    + cumulativeAuthorityRetention * 0.25
    + cumulativeICPAlignment * 0.20
    + cumulativeTerminologyRetention * 0.15
    + cumulativeEvidenceRetention * 0.10
  );
  const chainLengthPenalty = Math.max(0, (assets.length - 3) * 5); // 0 for ≤3 hops, +5 per extra hop
  const chainContinuityScore = clamp100(avgHopScore * 0.4 + cumulativeBase * 0.6 - chainLengthPenalty);

  // 7. Drift severity classification.
  const highLossAxes = driftAxes.filter((a) => a.cumulativeLoss >= 60).length;
  const chainDriftSeverity: 'low' | 'medium' | 'high' =
    chainContinuityScore < 45 || highLossAxes >= 2 ? 'high'
    : chainContinuityScore < 65 || driftAxes.length >= 2 ? 'medium'
    : 'low';

  return {
    chainId: `chain_${root.assetId}_${leaf.assetId}`,
    chainLength: assets.length,
    chainContinuityScore,
    cumulativeAuthorityRetention,
    cumulativeNarrativeRetention,
    cumulativeICPAlignment,
    cumulativeTerminologyRetention,
    cumulativeEvidenceRetention,
    chainDriftSeverity,
    driftAxes,
    perHopContinuity,
  };
}
