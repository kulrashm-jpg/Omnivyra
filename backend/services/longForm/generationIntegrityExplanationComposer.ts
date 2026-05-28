/**
 * Phase 8 — Generation integrity explanation composer.
 *
 * One canonical source feeds every section. Same hash → same explanation.
 */

import type {
  GenerationIntegrityExplanation,
  GenerationOrchestrationContract,
  PostGenerationIntegrityResult,
  SectionContinuityResult,
  SectionRecoveryHistoryEntry,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function topDims(scores: PostGenerationIntegrityResult['dimensionScores'], n: number): Array<[string, number]> {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function bottomDims(scores: PostGenerationIntegrityResult['dimensionScores'], n: number): Array<[string, number]> {
  return Object.entries(scores).sort((a, b) => a[1] - b[1]).slice(0, n);
}

export interface ComposeIntegrityExplanationInput {
  contract: GenerationOrchestrationContract;
  integrity: PostGenerationIntegrityResult;
  sectionResults: SectionContinuityResult[];
  recoveryHistory: SectionRecoveryHistoryEntry[];
}

export function composeGenerationIntegrityExplanation(
  input: ComposeIntegrityExplanationInput,
): GenerationIntegrityExplanation {
  const canonical = {
    contractId: input.contract.generationContractId,
    lineageId: input.contract.generationLineageId,
    band: input.integrity.integrityBand,
    score: input.integrity.postGenerationIntegrityScore,
    failures: input.integrity.integrityFailures.map((f) => ({ dim: String(f.dimension), score: f.score, sev: f.severity })),
    warnings: input.integrity.integrityWarnings,
    topPreserved: topDims(input.integrity.dimensionScores, 3),
    bottomPreserved: bottomDims(input.integrity.dimensionScores, 3),
    weakSectionIndexes: input.sectionResults
      .map((s, i) => ({ i, score: s.sectionContinuityScore }))
      .filter((x) => x.score < 60)
      .map((x) => x.i),
    recoveryActions: input.recoveryHistory.map((h) => `[s${h.sectionIndex}] ${h.action}${h.improved ? '' : ' (no improvement)'}`),
  };

  const passed = canonical.band === 'strong' || canonical.band === 'exceptional' || (canonical.band === 'acceptable' && canonical.failures.length === 0);

  const whyPassed = passed
    ? `Article passed at ${canonical.band} integrity (${canonical.score}). Top-preserved dimensions: ${canonical.topPreserved.map(([d, v]) => `${d} (${v})`).join('; ')}.`
    : null;

  const whyFailed = !passed
    ? `Article did not pass: ${canonical.band} integrity (${canonical.score}). ${canonical.failures.length} failure(s): ${canonical.failures.map((f) => `${f.dim}@${f.score} [${f.sev}]`).join('; ')}.`
    : null;

  const whatStrategicContinuitySurvived = `Strategic continuity ${input.integrity.dimensionScores.strategicContinuity}. Narrative continuity ${input.integrity.dimensionScores.narrativeContinuity}. Editorial sequencing ${input.integrity.dimensionScores.editorialSequencing}.`;

  const whatOperationalDepthSurvived = `Operational continuity ${input.integrity.dimensionScores.operationalContinuity}. Capability preservation ${input.integrity.dimensionScores.capabilityPreservation}. ICP preservation ${input.integrity.dimensionScores.icpPreservation}.`;

  const whereDegradationOccurred = canonical.bottomPreserved.length === 0
    ? 'No dimension degraded.'
    : `Weakest dimensions: ${canonical.bottomPreserved.map(([d, v]) => `${d} (${v})`).join('; ')}.`;

  const whichSectionsWeakened = canonical.weakSectionIndexes.length === 0
    ? 'No sections below the 60 continuity floor.'
    : `Sections with continuity < 60: ${canonical.weakSectionIndexes.map((i) => `s${i}`).join(', ')}.`;

  const recoveryActionsUsed = input.recoveryHistory.length === 0
    ? 'No recovery actions executed.'
    : `${input.recoveryHistory.length} recovery action(s): ${canonical.recoveryActions.slice(0, 6).join('; ')}.`;

  const remainingIntegrityRisk = (() => {
    if (canonical.failures.length === 0 && canonical.warnings.length === 0) return 'No remaining integrity risks flagged.';
    const risks: string[] = [];
    if (canonical.failures.some((f) => f.sev === 'critical')) risks.push('one or more critical failures remain');
    if (canonical.failures.some((f) => f.sev === 'major')) risks.push('major failures present');
    if (canonical.warnings.length > 0) risks.push(`${canonical.warnings.length} warning(s)`);
    return `Remaining risks: ${risks.join(', ')}.`;
  })();

  return {
    whyPassed,
    whyFailed,
    whatStrategicContinuitySurvived,
    whatOperationalDepthSurvived,
    whereDegradationOccurred,
    whichSectionsWeakened,
    recoveryActionsUsed,
    remainingIntegrityRisk,
    reasoningSourceHash: `gie_${stableHash(JSON.stringify(canonical))}`,
  };
}
