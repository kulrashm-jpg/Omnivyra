/**
 * Phase 6 — Portfolio continuity governor.
 *
 * Looks across the portfolio for ecosystem-level integrity issues:
 *   - ECOSYSTEM_DRIFT          most-recent articles diverge from baseline narrative
 *   - STRATEGIC_INCONSISTENCY  articles contradict each other on positioning
 *   - PORTFOLIO_FRAGMENTATION  articles have no shared themes / ICPs / capabilities
 *   - AUTHORITY_DILUTION       too many articles claim authority on too many disparate topics
 */

import type {
  AuthorityMap,
  ContentPortfolioAsset,
  EditorialNoveltyResult,
  PortfolioContinuityResult,
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

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface GovernPortfolioContinuityInput {
  assets: ContentPortfolioAsset[];
  authorityMap: AuthorityMap;
  memory: EditorialNoveltyResult;
}

export function governPortfolioContinuity(input: GovernPortfolioContinuityInput): PortfolioContinuityResult {
  const assets = [...input.assets].sort((a, b) =>
    (a.publishedAt ?? a.lastUpdatedAt).localeCompare(b.publishedAt ?? b.lastUpdatedAt),
  );
  const detected: PortfolioContinuityResult['detectedIssues'] = [];

  // 1. ECOSYSTEM_DRIFT — first quartile vs last quartile narrative overlap.
  // Gated to ≥ 8 assets: smaller portfolios naturally have higher per-article
  // variance because each article is a larger share, so low overlap doesn't
  // indicate genuine drift.
  if (assets.length >= 8) {
    const quartile = Math.max(2, Math.floor(assets.length / 4));
    const firstQ = assets.slice(0, quartile);
    const lastQ = assets.slice(-quartile);
    const firstTokens = new Set<string>();
    const lastTokens = new Set<string>();
    for (const a of firstQ) { tokens(a.strategicNarrative).forEach((t) => firstTokens.add(t)); }
    for (const a of lastQ) { tokens(a.strategicNarrative).forEach((t) => lastTokens.add(t)); }
    const overlap = jaccard(firstTokens, lastTokens);
    if (overlap < 0.20) {
      detected.push({
        type: 'ECOSYSTEM_DRIFT',
        severity: 'high',
        detail: `Narrative-token overlap between first quartile (${firstQ.length}) and last quartile (${lastQ.length}) is ${overlap.toFixed(2)} — ecosystem narrative has drifted significantly.`,
        affectedArticleIds: lastQ.map((a) => a.articleId),
      });
    } else if (overlap < 0.35) {
      detected.push({
        type: 'ECOSYSTEM_DRIFT',
        severity: 'medium',
        detail: `Narrative-token overlap dropped to ${overlap.toFixed(2)} between earlier and recent articles.`,
        affectedArticleIds: lastQ.map((a) => a.articleId),
      });
    }
  }

  // 2. STRATEGIC_INCONSISTENCY — pairs with same archetype + same ICPs but opposing strategic narratives.
  for (let i = 0; i < assets.length; i += 1) {
    for (let j = i + 1; j < assets.length; j += 1) {
      const a = assets[i];
      const b = assets[j];
      if (a.narrativeArchetype && a.narrativeArchetype === b.narrativeArchetype) {
        const icpA = new Set(a.icpFocus.map((s) => s.toLowerCase()));
        const icpB = new Set(b.icpFocus.map((s) => s.toLowerCase()));
        const icpJ = jaccard(icpA, icpB);
        const narrA = a.strategicNarrative.toLowerCase();
        const narrB = b.strategicNarrative.toLowerCase();
        // Opposing if one asserts something and the other negates the same shape.
        const opposing = (
          (/sequenced before/.test(narrA) && /sequenced after|not.*sequenced before|alongside/.test(narrB))
          || (/only works when/.test(narrA) && /works without|optional/.test(narrB))
          || (/automated/.test(narrA) && /manual/.test(narrB))
        );
        if (icpJ >= 0.5 && opposing) {
          detected.push({
            type: 'STRATEGIC_INCONSISTENCY',
            severity: 'high',
            detail: `Articles "${a.title}" and "${b.title}" target overlapping ICPs but assert opposing positioning.`,
            affectedArticleIds: [a.articleId, b.articleId],
          });
        }
      }
    }
  }

  // 3. PORTFOLIO_FRAGMENTATION — no shared theme spans ≥30% of the portfolio.
  if (assets.length >= 4) {
    const themeCounts = new Map<string, number>();
    for (const a of assets) {
      const seen = new Set<string>();
      for (const t of a.authorityThemes) {
        const k = t.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        themeCounts.set(k, (themeCounts.get(k) ?? 0) + 1);
      }
    }
    const maxCount = Math.max(0, ...themeCounts.values());
    if (maxCount < Math.ceil(assets.length * 0.30)) {
      detected.push({
        type: 'PORTFOLIO_FRAGMENTATION',
        severity: 'medium',
        detail: `No single authority theme spans ≥30% of the portfolio (top theme covers ${maxCount}/${assets.length} articles).`,
        affectedArticleIds: assets.map((a) => a.articleId),
      });
    }
  }

  // 4. AUTHORITY_DILUTION — too many low-coverage theme nodes relative to portfolio size.
  const themeNodes = input.authorityMap.nodes.filter((n) => n.nodeType === 'theme');
  const lowCoverageThemes = themeNodes.filter((n) => n.coverageWeight <= 15).length;
  if (themeNodes.length >= 8 && lowCoverageThemes / themeNodes.length >= 0.5) {
    detected.push({
      type: 'AUTHORITY_DILUTION',
      severity: 'medium',
      detail: `${lowCoverageThemes}/${themeNodes.length} theme nodes have coverage ≤ 15 — authority claims spread too thin.`,
      affectedArticleIds: [],
    });
  }

  // Composite ecosystem coherence score.
  const highSev = detected.filter((d) => d.severity === 'high').length;
  const mediumSev = detected.filter((d) => d.severity === 'medium').length;
  let coherence = 100 - highSev * 25 - mediumSev * 12;
  if (input.memory.positioningDrift.detected) coherence -= 6;
  if (input.memory.editorialNoveltyScore < 50) coherence -= 8;
  const ecosystemCoherenceScore = clamp100(coherence);

  return {
    ecosystemCoherenceScore,
    detectedIssues: detected,
  };
}
