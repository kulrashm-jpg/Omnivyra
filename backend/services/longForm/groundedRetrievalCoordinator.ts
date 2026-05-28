/**
 * Phase 3 — Grounded retrieval coordinator.
 *
 * Before generation runs, this layer assembles a `RetrievalGroundingProfile`
 * the orchestrator hands to the section generator. The profile carries:
 *   - approved sources (from the registry, filtered against rejected/forbidden)
 *   - approved terminology (domain + strategic, sourced from the recommendation)
 *   - factual anchors (atomic claim ↔ source bindings)
 *   - strategic + operational reference snippets
 *   - source priority index by reliability band
 *
 * No LLM. No network calls. Caller controls which sources enter; this layer
 * orchestrates them.
 */

import type {
  FactualAnchor,
  KnowledgeSource,
  LongFormRecommendation,
  RetrievalGroundingProfile,
  SourceReliabilityBand,
} from './longFormRecommendationTypes';
import type { KnowledgeSourceRegistry } from './knowledgeSourceRegistry';
import { calibrateManySources } from './sourceTrustCalibrationEngine';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function emptyPriorityIndex(): Record<SourceReliabilityBand, string[]> {
  return { unreliable: [], low: [], moderate: [], high: [], exceptional: [] };
}

export interface BuildRetrievalGroundingProfileInput {
  recommendation: LongFormRecommendation;
  registry: KnowledgeSourceRegistry;
  /** Optional terminology to add on top of recommendation-derived terms. */
  additionalTerminology?: string[];
  /** Optional explicit anchor list — if absent, anchors derive from the recommendation's operational proof + capability. */
  factualAnchors?: FactualAnchor[];
  /** Optional explicit source-id allowlist. If absent, all non-rejected sources in the registry are considered. */
  allowedSourceIds?: string[];
  /** Drop sources below this trust-score floor. Default 30. */
  minSourceTrustScore?: number;
}

export function buildRetrievalGroundingProfile(input: BuildRetrievalGroundingProfileInput): RetrievalGroundingProfile {
  const allSources = input.allowedSourceIds && input.allowedSourceIds.length > 0
    ? input.allowedSourceIds.map((id) => input.registry.get(id)).filter((s): s is KnowledgeSource => Boolean(s))
    : input.registry.list();

  // Filter rejected / forbidden up front.
  const filtered = allSources.filter((s) => s.verificationStatus !== 'rejected' && s.citationEligibility !== 'forbidden');

  // Trust-score floor.
  const trustResults = calibrateManySources(filtered);
  const minTrust = input.minSourceTrustScore ?? 30;
  const approvedSources = filtered.filter((s) => (trustResults.get(s.sourceId)?.sourceTrustScore ?? 0) >= minTrust);

  // Approved terminology: recommendation domain vocab + strategic terms + additional.
  const approvedTerminology: string[] = [];
  const seenTerms = new Set<string>();
  function pushTerm(t: string | undefined | null) {
    if (!t) return;
    const trimmed = t.trim();
    if (!trimmed) return;
    const k = trimmed.toLowerCase();
    if (seenTerms.has(k)) return;
    seenTerms.add(k);
    approvedTerminology.push(trimmed);
  }
  pushTerm(input.recommendation.whyThisFitsCompany.capabilityConnection);
  pushTerm(input.recommendation.narrativeArchetype ?? undefined);
  pushTerm(input.recommendation.familyClusterLabel ?? undefined);
  for (const term of input.additionalTerminology ?? []) pushTerm(term);
  // Pull any source-level tags into the terminology pool.
  for (const s of approvedSources) {
    for (const tag of s.tags ?? []) pushTerm(tag);
  }

  // Factual anchors: explicit override > recommendation-derived.
  const factualAnchors: FactualAnchor[] = input.factualAnchors && input.factualAnchors.length > 0
    ? input.factualAnchors
    : deriveAnchorsFromRecommendation(input.recommendation, approvedSources);

  // Strategic references — sources whose tags include 'strategic' OR fragments with topicHint='strategy'.
  const strategicReferences: Array<{ text: string; sourceIds: string[] }> = [];
  for (const s of approvedSources) {
    for (const f of s.contentFragments) {
      const hint = (f.topicHint ?? '').toLowerCase();
      if (hint.includes('strategy') || hint.includes('positioning') || hint.includes('narrative')) {
        strategicReferences.push({ text: f.text, sourceIds: [s.sourceId] });
      }
    }
  }

  // Operational context — fragments hinted as operational/workflow.
  const operationalContext: Array<{ text: string; sourceIds: string[] }> = [];
  for (const s of approvedSources) {
    for (const f of s.contentFragments) {
      const hint = (f.topicHint ?? '').toLowerCase();
      if (hint.includes('operational') || hint.includes('workflow') || hint.includes('execution')) {
        operationalContext.push({ text: f.text, sourceIds: [s.sourceId] });
      }
    }
  }

  // Source priority index.
  const sourcePriorityIndex = emptyPriorityIndex();
  for (const s of approvedSources) {
    const tr = trustResults.get(s.sourceId);
    if (!tr) continue;
    sourcePriorityIndex[tr.sourceReliabilityBand].push(s.sourceId);
  }

  return {
    retrievalProfileId: `rgp_${Date.now().toString(36)}_${stableHash(input.recommendation.recommendationId + approvedSources.map((s) => s.sourceId).join(',')).slice(0, 8)}`,
    recommendationId: input.recommendation.recommendationId,
    approvedSources,
    approvedTerminology,
    factualAnchors,
    strategicReferences,
    operationalContext,
    sourcePriorityIndex,
  };
}

function deriveAnchorsFromRecommendation(
  recommendation: LongFormRecommendation,
  approvedSources: KnowledgeSource[],
): FactualAnchor[] {
  const anchors: FactualAnchor[] = [];
  let seq = 0;
  function push(text: string, topicHint?: string) {
    if (!text || text.trim().length === 0) return;
    const trimmed = text.trim();
    const supportingSources = approvedSources
      .filter((s) => s.contentFragments.some((f) =>
        f.text.toLowerCase().includes(trimmed.toLowerCase().slice(0, 40))
        || (f.topicHint && trimmed.toLowerCase().includes(f.topicHint.toLowerCase())),
      ))
      .map((s) => s.sourceId);
    anchors.push({
      anchorId: `anc_${recommendation.recommendationId.slice(-8)}_${seq.toString(36)}`,
      text: trimmed,
      sourceIds: supportingSources,
      topicHint,
    });
    seq += 1;
  }

  push(recommendation.whyThisFitsCompany.capabilityConnection, 'capability');
  push(recommendation.whyThisFitsCompany.icpProblemMapping, 'icp');
  for (const proof of recommendation.recommendedContentDirection.operationalProof) {
    push(proof, 'operational');
  }
  push(recommendation.strategicNarrative, 'strategy');
  return anchors;
}
