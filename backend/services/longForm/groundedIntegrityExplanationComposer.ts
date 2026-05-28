/**
 * Phase 10 — Grounded integrity explanation composer.
 *
 * Canonical reasoning source → same result → same hash.
 */

import type {
  CitationOrchestrationResult,
  ClaimTraceability,
  GroundedIntegrityExplanation,
  GroundedRecoveryPlan,
  PostGenerationSourceIntegrityResult,
  RetrievalGroundingProfile,
  SourceConflictResult,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface ComposeGroundedIntegrityExplanationInput {
  profile: RetrievalGroundingProfile;
  traceability: ClaimTraceability[];
  citationResult: CitationOrchestrationResult;
  conflicts: SourceConflictResult;
  integrity: PostGenerationSourceIntegrityResult;
  recoveryPlan: GroundedRecoveryPlan;
}

export function composeGroundedIntegrityExplanation(
  input: ComposeGroundedIntegrityExplanationInput,
): GroundedIntegrityExplanation {
  const trustedClaimCount = input.traceability.filter((t) => !t.isOrphan).length;
  const totalClaims = input.traceability.length;
  const orphanCount = input.integrity.orphanClaims.length;
  const citedSources = Array.from(new Set(input.citationResult.citationPlan.map((c) => c.sourceId)));

  const canonical = {
    band: input.integrity.integrityBand,
    score: input.integrity.sourceIntegrityScore,
    grounding: input.integrity.groundingCoverageScore,
    trustedClaimCount,
    totalClaims,
    orphanCount,
    citedSourceCount: citedSources.length,
    rejectedFakeCitations: input.citationResult.rejectedFakeCitations,
    conflictCount: input.conflicts.conflicts.length,
    conflictSeverity: input.conflicts.sourceConflictSeverity,
    recoveryActions: input.recoveryPlan.steps.map((s) => s.action),
    profileSize: input.profile.approvedSources.length,
    warnings: input.integrity.citationIntegrityWarnings.slice(0, 4),
  };

  const whyClaimsAreTrusted = totalClaims === 0
    ? 'No factual claims surfaced for traceability.'
    : `${trustedClaimCount}/${totalClaims} factual claims trace to ${canonical.citedSourceCount} cited source(s) across ${canonical.profileSize} approved source(s). Grounding coverage ${canonical.grounding}/100.`;

  const whichEvidenceSupportedGeneration = canonical.citedSourceCount === 0
    ? 'No sources cited in the final article (citation plan was empty).'
    : `Cited sources: ${citedSources.slice(0, 5).join(', ')}${citedSources.length > 5 ? ` (+${citedSources.length - 5} more)` : ''}.`;

  const whereGroundingWasWeak = canonical.orphanCount === 0 && input.integrity.weakEvidenceAreas.length === 0
    ? 'No weak-evidence areas detected.'
    : `${canonical.orphanCount} orphan claim(s); ${input.integrity.weakEvidenceAreas.length} weak-evidence area(s) (e.g. ${input.integrity.weakEvidenceAreas.slice(0, 2).map((a) => a.topic).join('; ') || 'n/a'}).`;

  const whereCitationsWereInserted = input.citationResult.citationPlan.length === 0
    ? 'No citations were planned.'
    : `${input.citationResult.citationPlan.length} citation(s) planned across ${canonical.citedSourceCount} unique source(s). ${input.citationResult.rejectedFakeCitations} would-be citations rejected (no eligible source).`;

  const whereConflictsExisted = canonical.conflictCount === 0
    ? 'No source conflicts detected.'
    : `${canonical.conflictCount} conflict(s) at ${canonical.conflictSeverity} severity. Top resolution actions: ${input.conflicts.conflictResolutionRecommendations.slice(0, 2).map((r) => r.action).join('; ')}.`;

  const whereTrustWasDowngraded = canonical.recoveryActions.length === 0
    ? 'No trust downgrades or recovery actions required.'
    : `${canonical.recoveryActions.length} recovery action(s) recommended: ${Array.from(new Set(canonical.recoveryActions)).join('; ')}.`;

  return {
    whyClaimsAreTrusted,
    whichEvidenceSupportedGeneration,
    whereGroundingWasWeak,
    whereCitationsWereInserted,
    whereConflictsExisted,
    whereTrustWasDowngraded,
    reasoningSourceHash: `gie2_${stableHash(JSON.stringify(canonical))}`,
  };
}
