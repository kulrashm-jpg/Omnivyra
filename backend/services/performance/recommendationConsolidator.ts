/**
 * Performance Intelligence — Recommendation Consolidator.
 *
 * Pre-drill calibration: removes the "5 cards saying the same thing" problem
 * before the report renderer ever sees the list. Three operations:
 *
 *   1. Semantic dedup of `BehaviorRecommendation[]` — groups items with
 *      similar messages (Jaccard ≥ 0.55), same recommendation type, and
 *      overlapping page/section scope. Returns one representative per group
 *      plus a `group_size` so the renderer can show "+ N similar".
 *
 *   2. Semantic dedup of `SearchOpportunity[]` (GSC) — same idea, plus
 *      stronger suppression for SEO-style repeats keyed on (page_url, type).
 *
 *   3. Cross-source consolidation of "next moves" — when a behavior
 *      recommendation and a search opportunity converge on the same page or
 *      same theme, surface ONE next-move with both sources cited.
 *
 * Deterministic, no DB writes. The mapper consumes this BEFORE slicing the
 * lists into actions / quick_wins / next_moves so the slices are
 * consolidation-aware (not "first 5 of a noisy list").
 */

import type { BehaviorRecommendation } from '../behaviorRecommendationService';
import type { SearchOpportunity } from '../performanceSearchIntelligenceService';

// ─────────────────────────────────────────────────────────────────────────────
// Tokenization + similarity primitives (shared with cluster engine elsewhere
// in the codebase; kept local so this file has zero engine dependencies).
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','this','that','with','from','your','have','will','should','must',
  'into','about','their','these','those','them','they','what','when','where',
  'which','than','then','more','less','some','also','because','user','users',
  'page','pages','site','content','traffic','rate','rates','your','our',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Behavior recommendation consolidation
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsolidatedBehaviorRecommendation {
  representative: BehaviorRecommendation;
  group_size: number;
  members: BehaviorRecommendation[];
  /** Pages this group of recommendations touches (deduped). */
  page_urls: string[];
  /** Confidence boost: more members + same-page overlap → higher composite confidence. */
  composite_confidence: 'high' | 'medium' | 'low';
}

const SIMILARITY_THRESHOLD = 0.55;
const SAME_TYPE_LOWER_THRESHOLD = 0.4; // looser threshold when type matches

/**
 * Pick the strongest representative within a group:
 *   1. Highest priority (high > medium > low)
 *   2. Tie-break by impact context weight (sessions / visits / users)
 *   3. Tie-break by alphabetical message (deterministic).
 */
function pickRepresentative(members: BehaviorRecommendation[]): BehaviorRecommendation {
  const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const impactWeight = (r: BehaviorRecommendation) =>
    Math.max(
      Number(r.context?.entry_sessions ?? 0),
      Number(r.context?.sessions ?? 0),
      Number(r.context?.visits ?? 0),
      Number(r.context?.users ?? 0),
    );
  const sorted = [...members].sort((a, b) => {
    const p = (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
    if (p !== 0) return p;
    const w = impactWeight(b) - impactWeight(a);
    if (w !== 0) return w;
    return a.message.localeCompare(b.message);
  });
  return sorted[0];
}

function pageUrlOf(rec: BehaviorRecommendation): string | null {
  const url = rec.context?.page_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function compositeConfidenceFor(group: BehaviorRecommendation[]): 'high' | 'medium' | 'low' {
  const samePagePeers = new Set(group.map(pageUrlOf).filter((u): u is string => !!u)).size <= 1;
  const totalImpact = group.reduce(
    (s, r) =>
      s +
      Math.max(
        Number(r.context?.entry_sessions ?? 0),
        Number(r.context?.sessions ?? 0),
        Number(r.context?.visits ?? 0),
        Number(r.context?.users ?? 0),
      ),
    0,
  );
  if (group.length >= 3 && samePagePeers && totalImpact >= 100) return 'high';
  if (group.length >= 2 || totalImpact >= 50) return 'medium';
  return 'low';
}

/**
 * Consolidate a flat list of `BehaviorRecommendation` into deduped groups.
 * Order of input is preserved within groups for stable rendering.
 */
export function consolidateBehaviorRecommendations(
  recommendations: BehaviorRecommendation[],
): ConsolidatedBehaviorRecommendation[] {
  if (recommendations.length === 0) return [];

  const tokenSets = recommendations.map((r) => tokenize(`${r.message} ${r.reasoning}`));
  const assigned = new Array<number>(recommendations.length).fill(-1);
  const groups: number[][] = [];

  for (let i = 0; i < recommendations.length; i++) {
    if (assigned[i] !== -1) continue;
    const groupId = groups.length;
    assigned[i] = groupId;
    const memberIdxs = [i];
    for (let j = i + 1; j < recommendations.length; j++) {
      if (assigned[j] !== -1) continue;
      const sameType = recommendations[i].type === recommendations[j].type;
      const samePage = pageUrlOf(recommendations[i]) === pageUrlOf(recommendations[j]) &&
        pageUrlOf(recommendations[i]) !== null;
      const sameInsight = recommendations[i].linked_insight === recommendations[j].linked_insight;
      const sim = jaccard(tokenSets[i], tokenSets[j]);
      const threshold = sameType || samePage ? SAME_TYPE_LOWER_THRESHOLD : SIMILARITY_THRESHOLD;
      const groupable = sim >= threshold || (sameType && sameInsight && samePage);
      if (groupable) {
        assigned[j] = groupId;
        memberIdxs.push(j);
      }
    }
    groups.push(memberIdxs);
  }

  const consolidated: ConsolidatedBehaviorRecommendation[] = [];
  for (const memberIdxs of groups) {
    const members = memberIdxs.map((idx) => recommendations[idx]);
    const representative = pickRepresentative(members);
    const page_urls = Array.from(new Set(members.map(pageUrlOf).filter((u): u is string => !!u)));
    consolidated.push({
      representative,
      group_size: members.length,
      members,
      page_urls,
      composite_confidence: compositeConfidenceFor(members),
    });
  }
  return consolidated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search opportunity consolidation (SEO repeats are the noisiest source)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsolidatedSearchOpportunity {
  representative: SearchOpportunity;
  group_size: number;
  members: SearchOpportunity[];
  page_urls: string[];
}

/**
 * Consolidate `SearchOpportunity[]` so the same page doesn't appear three
 * times with cosmetic-different titles ("Improve title CTR" vs "CTR
 * opportunity on /pricing" vs "Increase organic clicks").
 *
 * Suppression rules (ANY hit collapses):
 *   - same `(page_url, type)` pair → collapse
 *   - same page_url + Jaccard(title) ≥ 0.5 → collapse
 *   - same type + Jaccard(title+recommendation) ≥ 0.65 → collapse
 */
export function consolidateSearchOpportunities(
  opportunities: SearchOpportunity[],
): ConsolidatedSearchOpportunity[] {
  if (opportunities.length === 0) return [];
  const tokenSets = opportunities.map((o) =>
    tokenize(`${o.title} ${o.recommendation}`),
  );
  const assigned = new Array<number>(opportunities.length).fill(-1);
  const groups: number[][] = [];

  for (let i = 0; i < opportunities.length; i++) {
    if (assigned[i] !== -1) continue;
    const groupId = groups.length;
    assigned[i] = groupId;
    const memberIdxs = [i];
    for (let j = i + 1; j < opportunities.length; j++) {
      if (assigned[j] !== -1) continue;
      const a = opportunities[i];
      const b = opportunities[j];
      const samePage = a.page_url && a.page_url === b.page_url;
      const sim = jaccard(tokenSets[i], tokenSets[j]);
      const collapse =
        (samePage && a.type === b.type) ||
        (samePage && sim >= 0.5) ||
        (a.type === b.type && sim >= 0.65);
      if (collapse) {
        assigned[j] = groupId;
        memberIdxs.push(j);
      }
    }
    groups.push(memberIdxs);
  }

  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const confidenceRank: Record<string, number> = { high: 4, medium: 3, low: 2, none: 1 };
  const consolidated: ConsolidatedSearchOpportunity[] = [];
  for (const memberIdxs of groups) {
    const members = memberIdxs.map((idx) => opportunities[idx]);
    const representative = [...members].sort(
      (a, b) =>
        (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) ||
        (confidenceRank[b.confidence] ?? 0) - (confidenceRank[a.confidence] ?? 0),
    )[0];
    const page_urls = Array.from(new Set(members.map((m) => m.page_url).filter(Boolean)));
    consolidated.push({ representative, group_size: members.length, members, page_urls });
  }
  return consolidated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-source convergence (when a GA recommendation and a GSC opportunity
// hit the same page, surface ONE next move with both sources cited).
// ─────────────────────────────────────────────────────────────────────────────

export interface ConvergedNextMove {
  page_url: string | null;
  /** Behavior recommendation, if any. */
  behavior?: BehaviorRecommendation;
  /** Search opportunity, if any. */
  search?: SearchOpportunity;
  /** Combined confidence ('high' if both sources agree, else min of the two). */
  combined_confidence: 'high' | 'medium' | 'low';
  /** Source label rendered in the report. */
  source_label: string;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

function lowestConfidence(a: string, b: string): 'high' | 'medium' | 'low' {
  const ra = CONFIDENCE_RANK[a] ?? 0;
  const rb = CONFIDENCE_RANK[b] ?? 0;
  const min = Math.min(ra, rb);
  if (min >= 3) return 'high';
  if (min >= 2) return 'medium';
  return 'low';
}

/**
 * Find behavior + search hits that converge on the same page and merge them
 * into one next-move with composite confidence. Pages that only have one
 * source still get returned — they just have a single-source label.
 */
export function buildConvergedNextMoves(
  behavior: ConsolidatedBehaviorRecommendation[],
  search: ConsolidatedSearchOpportunity[],
): ConvergedNextMove[] {
  const byPage = new Map<string, { behavior?: ConsolidatedBehaviorRecommendation; search?: ConsolidatedSearchOpportunity }>();
  for (const b of behavior) {
    const url = b.page_urls[0] ?? null;
    if (!url) continue;
    const existing = byPage.get(url) ?? {};
    if (!existing.behavior) existing.behavior = b;
    byPage.set(url, existing);
  }
  for (const s of search) {
    const url = s.representative.page_url ?? s.page_urls[0] ?? null;
    if (!url) continue;
    const existing = byPage.get(url) ?? {};
    if (!existing.search) existing.search = s;
    byPage.set(url, existing);
  }

  const out: ConvergedNextMove[] = [];
  for (const [page, sources] of byPage) {
    const behaviorRec = sources.behavior?.representative;
    const searchOpp = sources.search?.representative;
    let combined: 'high' | 'medium' | 'low' = 'low';
    let label = '';
    if (behaviorRec && searchOpp) {
      combined = 'high';
      label = 'GA + Search Console (converging signal)';
    } else if (behaviorRec) {
      combined = lowestConfidence(sources.behavior!.composite_confidence, sources.behavior!.composite_confidence);
      label = 'GA behavior';
    } else if (searchOpp) {
      combined = lowestConfidence(searchOpp.confidence, searchOpp.confidence);
      label = 'Search Console';
    }
    out.push({
      page_url: page,
      behavior: behaviorRec,
      search: searchOpp,
      combined_confidence: combined,
      source_label: label,
    });
  }

  // Append behavior items WITHOUT a page (still actionable but unscoped) and
  // search opportunities that didn't make it into byPage (no page_url at all).
  for (const b of behavior) {
    if (b.page_urls.length === 0) {
      out.push({
        page_url: null,
        behavior: b.representative,
        combined_confidence: b.composite_confidence,
        source_label: 'GA behavior',
      });
    }
  }

  // Sort: GA+GSC convergence first, then by behavior priority, then by search severity.
  const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  out.sort((a, b) => {
    const aBoth = a.behavior && a.search ? 1 : 0;
    const bBoth = b.behavior && b.search ? 1 : 0;
    if (aBoth !== bBoth) return bBoth - aBoth;
    const aPrio = (priorityRank[a.behavior?.priority ?? 'low'] ?? 0) +
      (severityRank[a.search?.severity ?? 'low'] ?? 0);
    const bPrio = (priorityRank[b.behavior?.priority ?? 'low'] ?? 0) +
      (severityRank[b.search?.severity ?? 'low'] ?? 0);
    return bPrio - aPrio;
  });
  return out;
}
