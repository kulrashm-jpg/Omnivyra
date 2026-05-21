import type { EditorialRemediationPriority } from './editorialRemediationHints';
import type { EditorialRemediationPlan } from './editorialRemediationPlanAssembler';
import type { EditorialQualityReadinessReport } from './editorialQualityReadiness';
import type {
  RegenerationCandidateSelection,
  SectionRecoveryCandidate,
} from './regenerationCandidateSelector';
import type { RegenerationReadinessContract } from './regenerationReadinessContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RegenerationExecutionReadiness = 'ready' | 'conditional' | 'deferred';
export type RegenerationExecutionConfidence = 'low' | 'medium' | 'high';

export interface SectionRegenerationExecutionManifest {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executionPriority: EditorialRemediationPriority;
  executionReadiness: RegenerationExecutionReadiness;
  recoveryTargets: readonly string[];
  rewriteBoundaries: readonly string[];
  preservationRequirements: readonly string[];
  executionConstraints: readonly string[];
}

export interface RegenerationExecutionManifest {
  version: 'regeneration-execution-manifest-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallExecutionReadiness: RegenerationExecutionReadiness;
  executionManifestVersion: 'regeneration-execution-manifest-v1';
  manifestExecutionOrder: readonly number[];
  manifestRecoveryTargets: readonly string[];
  safeExecutionCandidates: readonly number[];
  deferredExecutionCandidates: readonly number[];
  executionBoundaryMap: Record<string, readonly string[]>;
  preservationConstraintMap: Record<string, readonly string[]>;
  narrativePreservationMap: Record<string, readonly string[]>;
  authorityPreservationMap: Record<string, readonly string[]>;
  antiRepetitionPreservationMap: Record<string, readonly string[]>;
  sectionExecutionManifests: readonly SectionRegenerationExecutionManifest[];
  executionRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    deferred: number;
  };
  executionConfidence: RegenerationExecutionConfidence;
}

export interface RegenerationExecutionManifestInput {
  regenerationCandidateSelection: RegenerationCandidateSelection;
  regenerationReadinessContract: RegenerationReadinessContract;
  editorialRemediationPlan: EditorialRemediationPlan;
  editorialQualityReadiness: EditorialQualityReadinessReport;
}

function unique(values: readonly string[], limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function readinessFor(candidate: SectionRecoveryCandidate): RegenerationExecutionReadiness {
  if (candidate.eligibility !== 'eligible' || candidate.risk === 'high') return 'deferred';
  if (candidate.risk === 'medium' || candidate.confidence !== 'high') return 'conditional';
  return 'ready';
}

function executionConstraints(input: RegenerationExecutionManifestInput, candidate: SectionRecoveryCandidate): string[] {
  return unique([
    'non-executing manifest only',
    'future executor must honor section rewrite boundaries',
    'future executor must preserve section-level requirements',
    ...input.regenerationReadinessContract.recoveryExecutionConstraints.slice(0, 4),
    `candidate reason: ${candidate.selectionReason}`,
  ], 8);
}

function manifestForCandidate(
  input: RegenerationExecutionManifestInput,
  candidate: SectionRecoveryCandidate,
): SectionRegenerationExecutionManifest {
  return {
    sectionIndex: candidate.sectionIndex,
    progressionStage: candidate.progressionStage,
    narrativeRole: candidate.narrativeRole,
    executionPriority: candidate.priority,
    executionReadiness: readinessFor(candidate),
    recoveryTargets: candidate.recoveryTargets,
    rewriteBoundaries: candidate.rewriteBoundaries,
    preservationRequirements: candidate.preservationRequirements,
    executionConstraints: executionConstraints(input, candidate),
  };
}

function filterMap(
  manifests: readonly SectionRegenerationExecutionManifest[],
  pattern: RegExp,
): Record<string, readonly string[]> {
  return Object.fromEntries(manifests
    .filter((manifest) => manifest.recoveryTargets.some((target) => pattern.test(target)))
    .map((manifest) => [String(manifest.sectionIndex), manifest.preservationRequirements]));
}

function confidence(input: RegenerationExecutionManifestInput): RegenerationExecutionConfidence {
  if (
    input.regenerationReadinessContract.regenerationConfidence === 'high'
    && input.regenerationCandidateSelection.safeRewriteCandidates.length > 0
    && input.regenerationCandidateSelection.recoveryRiskBalance.highRisk === 0
  ) return 'high';
  if (
    input.regenerationReadinessContract.regenerationConfidence === 'low'
    || input.regenerationCandidateSelection.safeRewriteCandidates.length === 0
  ) return 'low';
  return 'medium';
}

export function buildRegenerationExecutionManifest(
  input: RegenerationExecutionManifestInput,
): RegenerationExecutionManifest {
  const orderedCandidates = input.regenerationCandidateSelection.candidateExecutionOrder;
  const deferredCandidates = input.regenerationCandidateSelection.rewriteDeferralCandidates;
  const sectionExecutionManifests = orderedCandidates.map((candidate) => manifestForCandidate(input, candidate));
  const deferredExecutionCandidates = deferredCandidates.map((candidate) => candidate.sectionIndex);
  const executionConfidence = confidence(input);
  const overallExecutionReadiness: RegenerationExecutionReadiness = sectionExecutionManifests.length === 0
    ? 'deferred'
    : input.regenerationReadinessContract.overallRegenerationReadiness === 'blocked'
      ? 'conditional'
      : executionConfidence === 'high'
        ? 'ready'
        : 'conditional';

  return {
    version: 'regeneration-execution-manifest-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.regenerationCandidateSelection.contentType,
    topic: input.regenerationCandidateSelection.topic,
    overallExecutionReadiness,
    executionManifestVersion: 'regeneration-execution-manifest-v1',
    manifestExecutionOrder: sectionExecutionManifests.map((manifest) => manifest.sectionIndex),
    manifestRecoveryTargets: unique([
      ...input.regenerationCandidateSelection.recommendedRecoveryTargets,
      ...sectionExecutionManifests.flatMap((manifest) => manifest.recoveryTargets),
    ], 14),
    safeExecutionCandidates: input.regenerationCandidateSelection.safeRewriteCandidates.map((candidate) => candidate.sectionIndex),
    deferredExecutionCandidates,
    executionBoundaryMap: Object.fromEntries(sectionExecutionManifests.map((manifest) => [
      String(manifest.sectionIndex),
      unique([
        ...manifest.rewriteBoundaries,
        ...(input.regenerationReadinessContract.sectionRewriteBoundaries[String(manifest.sectionIndex)] || []),
      ], 10),
    ])),
    preservationConstraintMap: Object.fromEntries(sectionExecutionManifests.map((manifest) => [
      String(manifest.sectionIndex),
      unique([
        ...input.regenerationReadinessContract.preservationConstraints,
        ...manifest.preservationRequirements,
        ...(input.regenerationReadinessContract.sectionPreservationRequirements[String(manifest.sectionIndex)] || []),
      ], 12),
    ])),
    narrativePreservationMap: filterMap(sectionExecutionManifests, /narrative|reader|transition/i),
    authorityPreservationMap: filterMap(sectionExecutionManifests, /authority|proof|claim/i),
    antiRepetitionPreservationMap: filterMap(sectionExecutionManifests, /anti-repetition|section differentiation/i),
    sectionExecutionManifests,
    executionRiskProfile: {
      lowRisk: input.regenerationCandidateSelection.recoveryRiskBalance.lowRisk,
      mediumRisk: input.regenerationCandidateSelection.recoveryRiskBalance.mediumRisk,
      highRisk: input.regenerationCandidateSelection.recoveryRiskBalance.highRisk,
      deferred: input.regenerationCandidateSelection.recoveryRiskBalance.deferred,
    },
    executionConfidence,
  };
}

export function serializeRegenerationExecutionManifest(manifest: RegenerationExecutionManifest): string {
  return [
    '## REGENERATION EXECUTION MANIFEST',
    `Version: ${manifest.version}`,
    `Topic: ${manifest.topic}`,
    `Content type: ${manifest.contentType}`,
    `Execution readiness: ${manifest.overallExecutionReadiness}`,
    `Execution confidence: ${manifest.executionConfidence}`,
    `Execution order: ${manifest.manifestExecutionOrder.join(', ') || 'none'}`,
    `Safe candidates: ${manifest.safeExecutionCandidates.length}`,
    `Deferred candidates: ${manifest.deferredExecutionCandidates.length}`,
  ].join('\n');
}
