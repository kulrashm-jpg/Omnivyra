/**
 * Phase 5 — Citation orchestration layer.
 *
 * Walks the traceability records + grounding profile and produces a citation
 * plan ready to inline into the generated article (or surface as footnotes).
 *
 * Capabilities:
 *   - inline citation planning (one citation per high-confidence claim)
 *   - evidence-aware attribution (uses source title + author when available)
 *   - source eligibility filtering (rejected / forbidden are dropped)
 *   - citation deduplication (cap citations per source for variety)
 *   - placement logic (inline_after_claim vs. footnote)
 *   - source-priority ordering (cite higher-trust sources first)
 *
 * Prevents fake citations: a claim with no source in the registry produces
 * NO citation (it remains an unsupported claim — the factual validator
 * picks it up separately).
 */

import type {
  CitationOrchestrationResult,
  CitationPlanItem,
  ClaimTraceability,
  ExtractedClaim,
  KnowledgeSource,
  RetrievalGroundingProfile,
  SourceTrustResult,
} from './longFormRecommendationTypes';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

const MAX_CITATIONS_PER_SOURCE = 3;       // Variety guard.
const MIN_CITATION_CONFIDENCE = 45;       // Source must clear this to be cited.
const FOOTNOTE_PRIORITY_BAND = 'moderate';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function attributionFor(source: KnowledgeSource): string {
  if (source.authorOrPublisher && source.title) {
    return `${source.authorOrPublisher} — "${source.title}"`;
  }
  if (source.title) return `"${source.title}"`;
  if (source.authorOrPublisher) return source.authorOrPublisher;
  // Fall back to origin (URL or filename), trimmed.
  return source.sourceOrigin.length > 80 ? `${source.sourceOrigin.slice(0, 77)}...` : source.sourceOrigin;
}

function placementFor(trust: SourceTrustResult): 'inline_after_claim' | 'footnote' | 'sidebar' {
  if (trust.sourceReliabilityBand === 'exceptional' || trust.sourceReliabilityBand === 'high') return 'inline_after_claim';
  if (trust.sourceReliabilityBand === FOOTNOTE_PRIORITY_BAND) return 'footnote';
  return 'sidebar';
}

export interface OrchestrateCitationsInput {
  claims: ExtractedClaim[];
  traceability: ClaimTraceability[];
  profile: RetrievalGroundingProfile;
}

export function orchestrateCitations(input: OrchestrateCitationsInput): CitationOrchestrationResult {
  const traceById = new Map(input.traceability.map((t) => [t.claimId, t]));
  const claimById = new Map(input.claims.map((c) => [c.claimId, c]));
  const sourceById = new Map(input.profile.approvedSources.map((s) => [s.sourceId, s]));
  const trustBySource = calibrateManySources(input.profile.approvedSources);

  const citationsPerSource = new Map<string, number>();
  const citationPlan: CitationPlanItem[] = [];
  const weakSourceOveruseWarnings: string[] = [];
  let rejectedFakeCitations = 0;
  let citationSeq = 0;

  // Order claims so higher evidence_requirement / lower confidence get prioritized.
  const orderedClaimIds = [...traceById.keys()].sort((a, b) => {
    const ta = traceById.get(a)!;
    const tb = traceById.get(b)!;
    // Higher traceability score first → strongest evidence anchors get cited.
    return tb.claimTraceabilityScore - ta.claimTraceabilityScore;
  });

  for (const claimId of orderedClaimIds) {
    const trace = traceById.get(claimId)!;
    const claim = claimById.get(claimId);
    if (!claim) continue;
    if (trace.isOrphan) continue;
    if (trace.supportingSourceIds.length === 0) {
      rejectedFakeCitations += 1; // no source → would have been a fake citation
      continue;
    }

    // Pick the best supporting source: prefer higher citationConfidence,
    // tiebreak by trust score, then evidence strength.
    const candidates = trace.supportingSourceIds
      .map((sid) => ({ sid, source: sourceById.get(sid), trust: trustBySource.get(sid) }))
      .filter((c): c is { sid: string; source: KnowledgeSource; trust: SourceTrustResult } =>
        Boolean(c.source) && Boolean(c.trust)
        && c.source!.verificationStatus !== 'rejected'
        && c.source!.citationEligibility !== 'forbidden'
        && c.source!.citationEligibility !== 'restricted'
        && c.trust!.citationConfidence >= MIN_CITATION_CONFIDENCE,
      )
      .sort((a, b) => {
        if (b.trust.citationConfidence !== a.trust.citationConfidence) return b.trust.citationConfidence - a.trust.citationConfidence;
        if (b.trust.sourceTrustScore !== a.trust.sourceTrustScore) return b.trust.sourceTrustScore - a.trust.sourceTrustScore;
        return b.source.evidenceStrength - a.source.evidenceStrength;
      });

    if (candidates.length === 0) {
      rejectedFakeCitations += 1;
      continue;
    }

    // Enforce per-source cap; if the top candidate is exhausted, fall through.
    let chosen: typeof candidates[number] | null = null;
    for (const c of candidates) {
      if ((citationsPerSource.get(c.sid) ?? 0) < MAX_CITATIONS_PER_SOURCE) {
        chosen = c;
        break;
      }
    }
    if (!chosen) continue;

    citationsPerSource.set(chosen.sid, (citationsPerSource.get(chosen.sid) ?? 0) + 1);
    const placement = placementFor(chosen.trust);

    citationPlan.push({
      citationId: `cit_${stableHash(claimId + chosen.sid).slice(0, 8)}_${citationSeq.toString(36)}`,
      claimId,
      sourceId: chosen.sid,
      attributionText: attributionFor(chosen.source),
      placementHint: placement,
      priority: chosen.trust.citationConfidence,
    });
    citationSeq += 1;
  }

  // Weak-source overuse: if any LOW or UNRELIABLE source produced more than 1 citation.
  for (const [sid, count] of citationsPerSource) {
    const trust = trustBySource.get(sid);
    if (!trust) continue;
    if ((trust.sourceReliabilityBand === 'low' || trust.sourceReliabilityBand === 'unreliable') && count > 1) {
      weakSourceOveruseWarnings.push(`Source ${sid} (${trust.sourceReliabilityBand}) cited ${count}× — consider replacing with a higher-trust source.`);
    }
  }

  return {
    citationPlan,
    dedupedSourceCount: citationsPerSource.size,
    rejectedFakeCitations,
    weakSourceOveruseWarnings,
  };
}
