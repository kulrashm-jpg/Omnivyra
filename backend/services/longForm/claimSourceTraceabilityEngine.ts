/**
 * Phase 4 — Claim ↔ source traceability engine.
 *
 * For each ExtractedClaim, attempt to match it to source fragments in the
 * RetrievalGroundingProfile. Produces per-claim traceability records with
 * supporting fragments + lineage + a 0–100 traceability score. Claims with
 * no acceptable match become "orphans" with a reason code.
 *
 * Match heuristic: per-fragment token Jaccard ≥ MATCH_FLOOR, weighted by
 * source trust. Multiple fragments can support a claim.
 */

import type {
  ClaimSupportingFragment,
  ClaimTraceability,
  ExtractedClaim,
  KnowledgeSource,
  OrphanReason,
  RetrievalGroundingProfile,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

const STOPWORDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','for','with','by','at','is','are',
  'be','as','from','that','this','these','those','it','its','can','should','would','will',
]);

const MATCH_FLOOR = 0.20;             // minimum jaccard to count a fragment as supporting
const ORPHAN_FLOOR = 0.10;             // below this, claim is marked orphan with 'low_match_score'
const STRONG_MATCH = 0.45;

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

function isClaimTypeRequiringSupport(claim: ExtractedClaim): boolean {
  // Opinion / speculative / strategic claims don't strictly need sources.
  return (
    claim.claimType === 'factual_claim'
    || claim.claimType === 'statistic'
    || claim.claimType === 'benchmark_comparison'
    || claim.claimType === 'market_statement'
    || claim.claimType === 'historical_statement'
    || claim.claimType === 'product_capability_claim'
    || claim.claimType === 'operational_assertion'
  );
}

export interface TraceClaimsInput {
  claims: ExtractedClaim[];
  profile: RetrievalGroundingProfile | null;
}

export function traceClaimsToSources(input: TraceClaimsInput): ClaimTraceability[] {
  const { claims, profile } = input;

  if (!profile) {
    // No grounding profile → every claim that needs support is an orphan.
    return claims.map((c) => ({
      claimId: c.claimId,
      supportingSourceIds: [],
      supportingEvidenceFragments: [],
      evidenceConfidence: 0,
      sourceLineage: [],
      claimTraceabilityScore: isClaimTypeRequiringSupport(c) ? 0 : 60,
      isOrphan: isClaimTypeRequiringSupport(c),
      orphanReason: isClaimTypeRequiringSupport(c) ? 'no_grounding_profile' : undefined,
    }));
  }

  const trustBySource = calibrateManySources(profile.approvedSources);
  // Pre-tokenize all source fragments for speed.
  const fragmentIndex: Array<{ source: KnowledgeSource; fragmentId: string; text: string; tokens: Set<string> }> = [];
  for (const source of profile.approvedSources) {
    for (const fragment of source.contentFragments) {
      fragmentIndex.push({
        source,
        fragmentId: fragment.fragmentId,
        text: fragment.text,
        tokens: tokens(fragment.text),
      });
    }
  }
  // Anchor index too — anchors can themselves act as evidence bindings.
  for (const anchor of profile.factualAnchors) {
    for (const sid of anchor.sourceIds) {
      const source = profile.approvedSources.find((s) => s.sourceId === sid);
      if (!source) continue;
      fragmentIndex.push({
        source,
        fragmentId: `anchor:${anchor.anchorId}`,
        text: anchor.text,
        tokens: tokens(anchor.text),
      });
    }
  }

  const out: ClaimTraceability[] = [];
  for (const claim of claims) {
    const claimTokens = tokens(claim.claimText);
    const matches: ClaimSupportingFragment[] = [];

    for (const entry of fragmentIndex) {
      const score = jaccard(claimTokens, entry.tokens);
      if (score >= MATCH_FLOOR) {
        matches.push({
          fragmentId: entry.fragmentId,
          text: entry.text.slice(0, 220),
          sourceId: entry.source.sourceId,
          matchScore: Number(score.toFixed(3)),
        });
      }
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);

    const supportingSourceIds = Array.from(new Set(matches.map((m) => m.sourceId)));
    const sourceLineage = supportingSourceIds.map((sid) => {
      const trust = trustBySource.get(sid);
      return { sourceId: sid, trustBand: trust?.sourceReliabilityBand ?? 'unreliable' as const };
    });

    // Evidence confidence: weighted average of top-3 match scores × trust.
    const topMatches = matches.slice(0, 3);
    const weightedConfidence = topMatches.length === 0
      ? 0
      : topMatches.reduce((sum, m) => {
          const trust = trustBySource.get(m.sourceId);
          return sum + m.matchScore * 100 * ((trust?.sourceTrustScore ?? 50) / 100);
        }, 0) / topMatches.length;
    const evidenceConfidence = Math.round(weightedConfidence);

    // Traceability score: base on best match, lifted by trust + number of supports.
    const bestMatch = matches[0]?.matchScore ?? 0;
    const supportCount = matches.length;
    const trustBoost = supportingSourceIds.length === 0
      ? 0
      : supportingSourceIds.reduce((sum, sid) => sum + (trustBySource.get(sid)?.sourceTrustScore ?? 0), 0) / supportingSourceIds.length;
    const traceabilityScore = Math.round(
      bestMatch * 100 * 0.55
      + Math.min(20, supportCount * 5)
      + trustBoost * 0.20,
    );

    let isOrphan = false;
    let orphanReason: OrphanReason | undefined;
    if (isClaimTypeRequiringSupport(claim)) {
      if (matches.length === 0 || bestMatch < ORPHAN_FLOOR) {
        isOrphan = true;
        orphanReason = matches.length === 0 ? 'no_matching_source' : 'low_match_score';
      } else if (
        supportingSourceIds.every((sid) => {
          const trust = trustBySource.get(sid);
          return !trust || trust.citationConfidence < 40;
        })
      ) {
        isOrphan = true;
        orphanReason = 'no_eligible_citations';
      }
    }

    out.push({
      claimId: claim.claimId,
      supportingSourceIds,
      supportingEvidenceFragments: matches.slice(0, 5),
      evidenceConfidence,
      sourceLineage,
      claimTraceabilityScore: Math.max(0, Math.min(100, traceabilityScore)),
      isOrphan,
      orphanReason,
    });
  }
  return out;
}

export function traceabilityByClaimId(records: ClaimTraceability[]): Map<string, ClaimTraceability> {
  const out = new Map<string, ClaimTraceability>();
  for (const r of records) out.set(r.claimId, r);
  return out;
}

export { STRONG_MATCH as CLAIM_TRACE_STRONG_MATCH };
