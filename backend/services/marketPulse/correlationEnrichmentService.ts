/**
 * Market Pulse — Correlation & Cluster-Role Enrichment.
 *
 * Phase 1B: relates findings to each other within a single run, and assigns
 * each finding a "cluster_role" describing where it sits in the run-wide
 * pattern.
 *
 * Reuses the same Jaccard-token-similarity primitive that
 * `signalCorrelationEngine` uses elsewhere in the codebase, but operates on
 * the in-run findings collection (no DB joins needed). This is the right
 * scope for Phase 1B — it gives the UI "related findings in this run"
 * without forcing a deeper integration with the cross-product
 * `signal_clusters`/`intelligence_signals` tables (reserved for Phase 2).
 *
 * Output shape mirrors what the legacy `signalCorrelationEngine.detectCorrelations`
 * returns so a future swap to that engine is a drop-in.
 */

import type { MarketPulseExecutorContext } from './executorContext';

export type CorrelationRelation =
  | 'topic_similarity'
  | 'region_overlap'
  | 'competitor_cluster'
  | 'category_cluster';

export type ClusterRole = 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly';

export interface CorrelationEdge {
  related_finding_id: string;
  related_finding_title: string;
  relation: CorrelationRelation;
  /** 0..1 — Jaccard, shared-region count normalized, etc. */
  score: number;
}

export interface ClusterRoleResult {
  cluster_role: ClusterRole;
  rationale: string;
}

export interface CorrelationFindingInput {
  id: string;
  title: string;
  summary: string;
  category: string;
  regions: string[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function regionOverlapScore(a: string[], b: string[]): number {
  const sa = new Set(a.map((r) => r.toUpperCase().trim()).filter(Boolean));
  const sb = new Set(b.map((r) => r.toUpperCase().trim()).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const r of sa) if (sb.has(r)) intersection++;
  return intersection / Math.min(sa.size, sb.size);
}

const TOPIC_SIM_THRESHOLD = 0.25;
const REGION_OVERLAP_THRESHOLD = 0.5;

/**
 * For each finding, return the up-to-N most-relevant peer findings in the
 * same run. Edges are deduplicated per pair (a→b only, not also b→a) by
 * caller iteration order, but we compute the full matrix so multi-edge
 * relations (topic + region + competitor) all surface.
 */
export function correlateFindings(
  findings: CorrelationFindingInput[],
  executorContext: MarketPulseExecutorContext | null,
  options: { maxEdgesPerFinding?: number } = {},
): Map<string, CorrelationEdge[]> {
  const maxEdges = options.maxEdgesPerFinding ?? 4;
  const edgesByFinding = new Map<string, CorrelationEdge[]>();
  if (findings.length < 2) {
    for (const f of findings) edgesByFinding.set(f.id, []);
    return edgesByFinding;
  }

  // Precompute token sets once.
  const tokenSets = new Map<string, Set<string>>();
  for (const f of findings) {
    tokenSets.set(f.id, tokenize(`${f.title} ${f.summary}`));
  }

  // Competitor mention sets per finding — used by the competitor_cluster relation.
  const competitorMentions = new Map<string, Set<string>>();
  if (executorContext?.named_competitors?.length) {
    const competitorTokenized = (executorContext.named_competitors ?? []).map((c) => ({
      name: c,
      tokens: tokenize(c),
    }));
    for (const f of findings) {
      const fTokens = tokenSets.get(f.id) ?? new Set<string>();
      const matched = new Set<string>();
      for (const c of competitorTokenized) {
        if (c.tokens.size === 0) continue;
        let hit = 0;
        for (const t of c.tokens) if (fTokens.has(t)) hit++;
        if (hit / c.tokens.size >= 0.5) matched.add(c.name.toLowerCase());
      }
      competitorMentions.set(f.id, matched);
    }
  }

  for (const a of findings) {
    const edges: CorrelationEdge[] = [];
    for (const b of findings) {
      if (a.id === b.id) continue;
      // Topic similarity (strongest signal).
      const topicSim = jaccard(tokenSets.get(a.id) ?? new Set(), tokenSets.get(b.id) ?? new Set());
      if (topicSim >= TOPIC_SIM_THRESHOLD) {
        edges.push({
          related_finding_id: b.id,
          related_finding_title: b.title,
          relation: 'topic_similarity',
          score: Math.round(topicSim * 1000) / 1000,
        });
      }
      // Region overlap (only if not already topic-similar; weaker but useful).
      else {
        const regOverlap = regionOverlapScore(a.regions, b.regions);
        if (regOverlap >= REGION_OVERLAP_THRESHOLD && a.category === b.category) {
          edges.push({
            related_finding_id: b.id,
            related_finding_title: b.title,
            relation: 'region_overlap',
            score: Math.round(regOverlap * 1000) / 1000,
          });
        }
      }
      // Competitor cluster — both findings mention the same named competitor.
      const aComps = competitorMentions.get(a.id);
      const bComps = competitorMentions.get(b.id);
      if (aComps && bComps && aComps.size > 0 && bComps.size > 0) {
        let shared = 0;
        for (const c of aComps) if (bComps.has(c)) shared++;
        if (shared > 0) {
          edges.push({
            related_finding_id: b.id,
            related_finding_title: b.title,
            relation: 'competitor_cluster',
            score: Math.min(1, shared / Math.max(aComps.size, bComps.size)),
          });
        }
      }
    }
    // Dedupe: keep the strongest relation per peer.
    const bestPerPeer = new Map<string, CorrelationEdge>();
    for (const e of edges) {
      const existing = bestPerPeer.get(e.related_finding_id);
      if (!existing || e.score > existing.score) bestPerPeer.set(e.related_finding_id, e);
    }
    const top = Array.from(bestPerPeer.values())
      .sort((x, y) => y.score - x.score)
      .slice(0, maxEdges);
    edgesByFinding.set(a.id, top);
  }

  return edgesByFinding;
}

/**
 * Classify each finding's role in the run-wide cluster topology:
 *   - isolated:           no peers in this run, single region
 *   - repeated:           recurrence across runs (timesSeenPrior >= 2)
 *   - market_wide:        topic-similar peers across ≥3 distinct regions
 *   - localized_anomaly:  high relevance + risk + concentrated in 1 region
 *                         while category-peers span multiple regions
 */
export function classifyClusterRole(
  finding: CorrelationFindingInput & { timesSeenPrior?: number; impactType?: string; relevanceScore?: number },
  allFindings: Array<CorrelationFindingInput & { impactType?: string }>,
  edges: CorrelationEdge[],
): ClusterRoleResult {
  const peers = allFindings.filter((f) => f.id !== finding.id);
  const distinctRegionsAcrossPeers = new Set<string>();
  for (const e of edges) {
    const peer = peers.find((p) => p.id === e.related_finding_id);
    if (!peer) continue;
    for (const r of peer.regions) distinctRegionsAcrossPeers.add(r.toUpperCase().trim());
  }
  for (const r of finding.regions) distinctRegionsAcrossPeers.add(r.toUpperCase().trim());

  const ownRegions = new Set(finding.regions.map((r) => r.toUpperCase().trim()));

  if ((finding.timesSeenPrior ?? 0) >= 2) {
    return {
      cluster_role: 'repeated',
      rationale: `Observed ${finding.timesSeenPrior} prior runs — recurring pattern.`,
    };
  }

  if (edges.length === 0 && ownRegions.size <= 1) {
    return {
      cluster_role: 'isolated',
      rationale: 'No correlated peers in this run; single-region.',
    };
  }

  if (distinctRegionsAcrossPeers.size >= 3 && edges.some((e) => e.relation === 'topic_similarity')) {
    return {
      cluster_role: 'market_wide',
      rationale: `Topic-similar peers span ${distinctRegionsAcrossPeers.size} regions — broad pattern.`,
    };
  }

  // Localized anomaly: this finding is high-impact + region-concentrated while
  // category peers are diversified across regions.
  const categoryPeers = peers.filter((p) => p.category === finding.category);
  const categoryPeerRegions = new Set<string>();
  for (const p of categoryPeers) for (const r of p.regions) categoryPeerRegions.add(r.toUpperCase().trim());
  if (
    ownRegions.size === 1 &&
    categoryPeerRegions.size >= 2 &&
    finding.impactType === 'risk' &&
    (finding.relevanceScore ?? 0) >= 70
  ) {
    return {
      cluster_role: 'localized_anomaly',
      rationale: `High-relevance risk concentrated in ${Array.from(ownRegions)[0]} while category peers span ${categoryPeerRegions.size} regions.`,
    };
  }

  // Default: isolated when there are no edges, repeated handled above; if
  // there are some edges but no broader pattern, classify as isolated with
  // a softer rationale.
  return {
    cluster_role: 'isolated',
    rationale: edges.length === 0
      ? 'No correlated peers detected in this run.'
      : `Correlated with ${edges.length} peer${edges.length === 1 ? '' : 's'} but no broader regional pattern.`,
  };
}

/**
 * Detect contradicting peers — same competitor mentioned but opposite impact
 * type, or same category in same region with opposite impact. Used by
 * trustScoringService to dampen evidence_strength for contested findings.
 */
export function countContradictingPeers(
  finding: { id: string; impactType: string; category: string; regions: string[]; competitorMentions?: Set<string> },
  allFindings: Array<{ id: string; impactType: string; category: string; regions: string[]; competitorMentions?: Set<string> }>,
): number {
  let count = 0;
  for (const other of allFindings) {
    if (other.id === finding.id) continue;
    if (other.impactType === finding.impactType) continue;
    // Same competitor mentioned with opposite impact = contradiction.
    if (
      finding.competitorMentions && other.competitorMentions &&
      finding.competitorMentions.size > 0 && other.competitorMentions.size > 0
    ) {
      let shared = 0;
      for (const c of finding.competitorMentions) if (other.competitorMentions.has(c)) shared++;
      if (shared > 0) {
        count++;
        continue;
      }
    }
    // Same category + region overlap with opposite impact.
    if (other.category === finding.category) {
      const sa = new Set(finding.regions.map((r) => r.toUpperCase().trim()));
      let regHit = 0;
      for (const r of other.regions) if (sa.has(r.toUpperCase().trim())) regHit++;
      if (regHit > 0) count++;
    }
  }
  return count;
}
