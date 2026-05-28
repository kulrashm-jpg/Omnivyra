/**
 * Phase 6 — Authority compounding engine.
 *
 * Models how the company's authority on each theme compounds across formats.
 * The premise: a theme covered by ONE long-form is fragile; a theme covered
 * by long-form + newsletter + thread + post is durable — the formats reinforce
 * each other through the buyer's journey.
 *
 * Outputs:
 *   ecosystemAuthorityScore       portfolio-wide authority strength (0..100)
 *   narrativeCompoundingScore     archetype compounding strength (0..100)
 *   crossFormatSynergyScore       how often themes appear in ≥3 formats (0..100)
 *   archetypeCompounding          per-archetype detail
 *   funnelProgressionPaths        per-ICP funnel sequences observed
 *
 * Pure / deterministic.
 */

import type {
  AuthorityCompoundingResult,
  CrossModalAsset,
  CrossModalFormat,
} from './longFormRecommendationTypes';

// ── Funnel position per format (heuristic) ─────────────────────────────────
const FORMAT_FUNNEL_RANK: Record<CrossModalFormat, number> = {
  post: 1,        // top-of-funnel discovery
  story: 1,
  thread: 2,
  newsletter: 2,
  long_form: 3,
  guide: 3,
  case_study: 4,  // decision-stage
  whitepaper: 4,
};

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function uniqueFormats(assets: CrossModalAsset[]): CrossModalFormat[] {
  return Array.from(new Set(assets.map((a) => a.format)));
}

export interface ComputeAuthorityCompoundingInput {
  assets: CrossModalAsset[];
}

export function computeAuthorityCompounding(input: ComputeAuthorityCompoundingInput): AuthorityCompoundingResult {
  const assets = input.assets;
  if (assets.length === 0) {
    return {
      ecosystemAuthorityScore: 0,
      narrativeCompoundingScore: 0,
      crossFormatSynergyScore: 0,
      archetypeCompounding: [],
      funnelProgressionPaths: [],
    };
  }

  // ── 1. Per-archetype compounding ────────────────────────────────────────
  const byArchetype = new Map<string, CrossModalAsset[]>();
  for (const a of assets) {
    const key = (a.narrativeArchetype ?? 'uncategorized').toString();
    const arr = byArchetype.get(key) ?? [];
    arr.push(a);
    byArchetype.set(key, arr);
  }
  const archetypeCompounding: AuthorityCompoundingResult['archetypeCompounding'] = [];
  let synergyCount = 0;
  for (const [archetype, group] of byArchetype) {
    const formats = uniqueFormats(group);
    if (formats.length >= 3) synergyCount += 1;
    // compoundingStrength = avg authority × format diversity bonus
    const avgAuth = group.reduce((s, a) => s + a.authorityClaimCoverage, 0) / group.length;
    const formatDiversityBonus = Math.min(40, (formats.length - 1) * 10); // +10 per extra format up to +40
    const compoundingStrength = clamp100(avgAuth * 0.7 + formatDiversityBonus);
    archetypeCompounding.push({
      archetype,
      coverageFormats: formats,
      compoundingStrength,
    });
  }
  archetypeCompounding.sort((a, b) => b.compoundingStrength - a.compoundingStrength);

  // ── 2. Funnel progression paths per ICP ─────────────────────────────────
  // Group assets by ICP; for each ICP, derive the sequence of unique
  // funnel ranks (sorted by publishedAt).
  const byIcp = new Map<string, CrossModalAsset[]>();
  for (const a of assets) {
    for (const icp of a.icpFocus) {
      const key = icp.toLowerCase();
      const arr = byIcp.get(key) ?? [];
      arr.push(a);
      byIcp.set(key, arr);
    }
  }
  const funnelProgressionPaths: AuthorityCompoundingResult['funnelProgressionPaths'] = [];
  for (const [icp, group] of byIcp) {
    const ordered = [...group].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const formats: CrossModalFormat[] = [];
    let lastRank = 0;
    for (const a of ordered) {
      const rank = FORMAT_FUNNEL_RANK[a.format];
      // Treat strictly increasing rank as a progression step.
      if (rank > lastRank) {
        formats.push(a.format);
        lastRank = rank;
      } else if (rank === lastRank && formats.length > 0 && formats[formats.length - 1] !== a.format) {
        // same-rank but different format → add as horizontal reinforcement
        formats.push(a.format);
      }
    }
    if (formats.length < 2) continue;
    // pathStrength = funnel reach (1..4) × format diversity at that reach
    const maxRank = lastRank;
    const distinctFormats = new Set(formats).size;
    const pathStrength = clamp100(maxRank * 20 + distinctFormats * 5);
    funnelProgressionPaths.push({ icp, orderedFormats: formats, pathStrength });
  }
  funnelProgressionPaths.sort((a, b) => b.pathStrength - a.pathStrength);

  // ── 3. ecosystemAuthorityScore ──────────────────────────────────────────
  // Mean of per-archetype compoundingStrength weighted by group size.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [archetype, group] of byArchetype) {
    const detail = archetypeCompounding.find((r) => r.archetype === archetype);
    if (!detail) continue;
    weightedSum += detail.compoundingStrength * group.length;
    weightTotal += group.length;
  }
  const ecosystemAuthorityScore = weightTotal === 0 ? 0 : clamp100(weightedSum / weightTotal);

  // ── 4. narrativeCompoundingScore ────────────────────────────────────────
  // High when same archetype reinforced by multiple formats AND total assets are non-trivial.
  const multiFormatArchetypes = archetypeCompounding.filter((a) => a.coverageFormats.length >= 2).length;
  const totalArchetypes = archetypeCompounding.length;
  const ratio = totalArchetypes === 0 ? 0 : multiFormatArchetypes / totalArchetypes;
  const sizeBoost = Math.min(20, assets.length); // tiny portfolios cap out at +20
  const narrativeCompoundingScore = clamp100(ratio * 80 + sizeBoost);

  // ── 5. crossFormatSynergyScore ──────────────────────────────────────────
  // Fraction of archetypes that span ≥3 formats.
  const crossFormatSynergyScore = totalArchetypes === 0 ? 0 : clamp100((synergyCount / totalArchetypes) * 100);

  return {
    ecosystemAuthorityScore,
    narrativeCompoundingScore,
    crossFormatSynergyScore,
    archetypeCompounding,
    funnelProgressionPaths,
  };
}

export { FORMAT_FUNNEL_RANK };
