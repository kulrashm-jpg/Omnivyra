/**
 * Phase 2 — Source trust calibration engine.
 *
 * For each KnowledgeSource, compute 8 signals and aggregate into:
 *   sourceTrustScore        — 0–100
 *   sourceReliabilityBand   — unreliable | low | moderate | high | exceptional
 *   citationConfidence      — confidence (0–100) that this source is safe to cite
 */

import type {
  KnowledgeSource,
  SourceReliabilityBand,
  SourceTrustResult,
} from './longFormRecommendationTypes';

const WEIGHTS = {
  freshness: 0.14,
  verification: 0.16,
  attributionCompleteness: 0.10,
  sourceAuthority: 0.18,
  evidenceSpecificity: 0.14,
  provenanceQuality: 0.10,
  contradictionRisk: 0.10,    // inverted: lower risk = higher contribution
  ambiguityRisk: 0.08,        // inverted
} as const;

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function freshnessScore(s: KnowledgeSource): number {
  const f = s.freshnessMetadata;
  if (!f.staleAfterDays && !f.ageInDays) return 80;
  if (f.isStale) return 25;
  if (f.ageInDays == null || f.staleAfterDays == null) return 70;
  const remainingRatio = 1 - f.ageInDays / f.staleAfterDays;
  // Maps remainingRatio ∈ [0, 1] → [50, 100].
  return clamp100(50 + remainingRatio * 50);
}

function verificationScore(s: KnowledgeSource): number {
  switch (s.verificationStatus) {
    case 'verified': return 100;
    case 'reviewed': return 78;
    case 'unverified': return 45;
    case 'rejected': return 5;
  }
}

function attributionCompletenessScore(s: KnowledgeSource): number {
  let score = 30;
  if (s.authorOrPublisher) score += 25;
  if (s.title) score += 15;
  if (s.sourceOrigin && s.sourceOrigin.length > 0) score += 20;
  if (s.freshnessMetadata.publishedAt) score += 10;
  return clamp100(score);
}

function sourceAuthorityScore(s: KnowledgeSource): number {
  switch (s.trustLevel) {
    case 'authoritative': return 95;
    case 'high': return 80;
    case 'moderate': return 60;
    case 'low': return 35;
    case 'untrusted': return 5;
  }
}

function evidenceSpecificityScore(s: KnowledgeSource): number {
  if (!s.contentFragments || s.contentFragments.length === 0) return 35;
  const avgFragmentLength = s.contentFragments.reduce((sum, f) => sum + f.text.length, 0) / s.contentFragments.length;
  // 80–400 chars per fragment is the healthy band.
  if (avgFragmentLength < 30) return 25;
  if (avgFragmentLength < 80) return 50;
  if (avgFragmentLength < 400) return 90;
  if (avgFragmentLength < 800) return 80;
  return 65;
}

function provenanceQualityScore(s: KnowledgeSource): number {
  let score = 30;
  if (s.sourceType === 'verified_citation') score += 35;
  else if (s.sourceType === 'research_reference') score += 25;
  else if (s.sourceType === 'uploaded_document' || s.sourceType === 'internal_knowledge_block') score += 25;
  else if (s.sourceType === 'company_context') score += 30;
  else if (s.sourceType === 'approved_url') score += 18;
  else if (s.sourceType === 'planner_derived_evidence') score += 10;
  else if (s.sourceType === 'retrieved_web_evidence') score += 5;
  if (s.citationEligibility === 'eligible' || s.citationEligibility === 'eligible_with_attribution') score += 20;
  if (s.citationEligibility === 'forbidden') score -= 30;
  return clamp100(score);
}

function contradictionRiskScore(s: KnowledgeSource): number {
  // Returns 0..100 where 100 = LOW contradiction risk (safe to cite).
  // Sources with multiple numeric-fragments are riskier (mismatching figures
  // can appear across fragments). Untrusted sources are higher-risk by default.
  const numericFragmentCount = s.contentFragments.filter((f) => f.numericClaim).length;
  let base = 80;
  if (s.trustLevel === 'untrusted') base = 25;
  else if (s.trustLevel === 'low') base = 50;
  if (numericFragmentCount > 6) base -= 15;
  if (s.sourceType === 'retrieved_web_evidence' && numericFragmentCount > 2) base -= 10;
  return clamp100(base);
}

function ambiguityRiskScore(s: KnowledgeSource): number {
  // Returns 0..100 where 100 = LOW ambiguity (clear, specific).
  // Higher when fragments have topicHints, when source has tags.
  let base = 55;
  const hintedFragments = s.contentFragments.filter((f) => f.topicHint && f.topicHint.length > 0).length;
  const hintRatio = s.contentFragments.length === 0
    ? 0
    : hintedFragments / s.contentFragments.length;
  base += Math.round(hintRatio * 30);
  if (s.tags && s.tags.length >= 2) base += 10;
  if (!s.excerpt && !s.title) base -= 15;
  return clamp100(base);
}

function bandFor(score: number): SourceReliabilityBand {
  if (score < 30) return 'unreliable';
  if (score < 55) return 'low';
  if (score < 75) return 'moderate';
  if (score < 90) return 'high';
  return 'exceptional';
}

export function calibrateSourceTrust(source: KnowledgeSource): SourceTrustResult {
  const signals = {
    freshness: freshnessScore(source),
    verification: verificationScore(source),
    attributionCompleteness: attributionCompletenessScore(source),
    sourceAuthority: sourceAuthorityScore(source),
    evidenceSpecificity: evidenceSpecificityScore(source),
    provenanceQuality: provenanceQualityScore(source),
    contradictionRisk: contradictionRiskScore(source),
    ambiguityRisk: ambiguityRiskScore(source),
  };

  let weighted = 0;
  (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).forEach((k) => {
    weighted += signals[k] * WEIGHTS[k];
  });
  const sourceTrustScore = clamp100(weighted);
  const sourceReliabilityBand = bandFor(sourceTrustScore);

  // citationConfidence applies stricter weighting on verification + authority +
  // freshness (the things that matter most for "should I cite this?").
  const citationConfidence = clamp100(
    signals.verification * 0.35
    + signals.sourceAuthority * 0.25
    + signals.freshness * 0.15
    + signals.attributionCompleteness * 0.15
    + signals.provenanceQuality * 0.10,
  );

  const warnings: string[] = [];
  if (source.freshnessMetadata.isStale) warnings.push(`Source is stale (age ${source.freshnessMetadata.ageInDays} > staleAfter ${source.freshnessMetadata.staleAfterDays}).`);
  if (source.verificationStatus === 'rejected') warnings.push('Source has rejected verification status — should not be cited.');
  if (source.verificationStatus === 'unverified' && sourceAuthorityScore(source) < 70) warnings.push('Unverified source with low authority — citation use should be restricted.');
  if (source.citationEligibility === 'forbidden') warnings.push('Source is explicitly forbidden from citation.');
  if (signals.ambiguityRisk < 50) warnings.push('Source content lacks topic hints / tags — high ambiguity risk.');

  return {
    sourceId: source.sourceId,
    sourceTrustScore,
    sourceReliabilityBand,
    citationConfidence,
    signals,
    warnings,
  };
}

export function calibrateManySources(sources: KnowledgeSource[]): Map<string, SourceTrustResult> {
  const out = new Map<string, SourceTrustResult>();
  for (const s of sources) out.set(s.sourceId, calibrateSourceTrust(s));
  return out;
}
