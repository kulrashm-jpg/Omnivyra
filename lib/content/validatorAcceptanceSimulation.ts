import type { ValidatorDecisionPreparation, SectionDecisionPreparation } from './validatorDecisionPreparation';
import type { ValidatorResultContractReport } from './validatorResultContracts';
import type { ValidatorReviewSequence } from './validatorReviewSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type AcceptanceSimulationReadiness = 'ready' | 'conditional' | 'blocked';
export type SimulatedAcceptanceEligibility = 'acceptable' | 'deferred' | 'not_recommended';
export type AcceptanceSimulationConfidence = 'low' | 'medium' | 'high';

export interface SectionAcceptanceSimulation {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  simulatedAcceptanceEligibility: SimulatedAcceptanceEligibility;
  simulatedRisks: readonly string[];
  simulatedDeferrals: readonly string[];
  simulatedDependencies: readonly string[];
  preservationExpectations: readonly string[];
}

export interface ValidatorAcceptanceSimulation {
  version: 'validator-acceptance-simulation-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallAcceptanceSimulationReadiness: AcceptanceSimulationReadiness;
  simulatedAcceptanceEligibility: SimulatedAcceptanceEligibility;
  simulatedAcceptanceRisks: readonly string[];
  simulatedAcceptanceDeferrals: readonly number[];
  simulatedAcceptanceDependencies: readonly string[];
  sectionAcceptanceSimulations: readonly SectionAcceptanceSimulation[];
  acceptanceSimulationRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  acceptanceSimulationConfidence: AcceptanceSimulationConfidence;
}

export interface ValidatorAcceptanceSimulationInput {
  validatorDecisionPreparation: ValidatorDecisionPreparation;
  validatorResultContracts: ValidatorResultContractReport;
  validatorReviewSequence: ValidatorReviewSequence;
}

function unique(values: readonly string[], limit = 16): string[] {
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

function readiness(input: ValidatorAcceptanceSimulationInput): AcceptanceSimulationReadiness {
  if (
    input.validatorDecisionPreparation.overallDecisionPreparationReadiness === 'blocked'
    || input.validatorResultContracts.overallValidatorResultReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorDecisionPreparation.overallDecisionPreparationReadiness === 'conditional'
    || input.validatorResultContracts.overallValidatorResultReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function sectionEligibility(section: SectionDecisionPreparation): SimulatedAcceptanceEligibility {
  if (section.decisionEligibility === 'not_recommended') return 'not_recommended';
  if (section.decisionEligibility === 'deferred' || section.riskSignals.length > 0) return 'deferred';
  return 'acceptable';
}

function overallEligibility(sections: readonly SectionAcceptanceSimulation[]): SimulatedAcceptanceEligibility {
  if (sections.some((section) => section.simulatedAcceptanceEligibility === 'not_recommended')) return 'not_recommended';
  if (sections.some((section) => section.simulatedAcceptanceEligibility === 'deferred')) return 'deferred';
  return 'acceptable';
}

function confidence(readinessValue: AcceptanceSimulationReadiness, input: ValidatorAcceptanceSimulationInput): AcceptanceSimulationConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorDecisionPreparation.decisionPreparationConfidence === 'high'
    && input.validatorResultContracts.validatorResultConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorDecisionPreparation.decisionPreparationConfidence === 'low'
    || input.validatorResultContracts.validatorResultConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionSimulation(section: SectionDecisionPreparation): SectionAcceptanceSimulation {
  const simulatedAcceptanceEligibility = sectionEligibility(section);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    simulatedAcceptanceEligibility,
    simulatedRisks: unique([
      ...section.riskSignals,
      ...(section.boundarySignals.length === 0 ? ['missing boundary signal for acceptance simulation'] : []),
      ...(section.preservationSignals.length === 0 ? ['missing preservation signal for acceptance simulation'] : []),
    ], 10),
    simulatedDeferrals: simulatedAcceptanceEligibility === 'acceptable'
      ? []
      : unique([`defer simulated acceptance: ${simulatedAcceptanceEligibility}`], 4),
    simulatedDependencies: unique(section.dependencySignals, 10),
    preservationExpectations: unique(section.preservationSignals, 10),
  };
}

export function simulateValidatorAcceptance(input: ValidatorAcceptanceSimulationInput): ValidatorAcceptanceSimulation {
  const sectionAcceptanceSimulations = input.validatorDecisionPreparation.sectionDecisionPreparation.map(sectionSimulation);
  const overallAcceptanceSimulationReadiness = readiness(input);

  return {
    version: 'validator-acceptance-simulation-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorDecisionPreparation.contentType,
    topic: input.validatorDecisionPreparation.topic,
    overallAcceptanceSimulationReadiness,
    simulatedAcceptanceEligibility: overallEligibility(sectionAcceptanceSimulations),
    simulatedAcceptanceRisks: unique([
      ...input.validatorDecisionPreparation.decisionRiskSignals,
      ...sectionAcceptanceSimulations.flatMap((section) => section.simulatedRisks),
    ], 18),
    simulatedAcceptanceDeferrals: input.validatorReviewSequence.reviewDeferralOrdering,
    simulatedAcceptanceDependencies: unique([
      ...input.validatorDecisionPreparation.decisionDependencySignals,
      ...sectionAcceptanceSimulations.flatMap((section) => section.simulatedDependencies),
    ], 18),
    sectionAcceptanceSimulations,
    acceptanceSimulationRiskProfile: {
      lowRisk: input.validatorResultContracts.validatorResultRiskProfile.lowRisk,
      mediumRisk: input.validatorResultContracts.validatorResultRiskProfile.mediumRisk,
      highRisk: input.validatorResultContracts.validatorResultRiskProfile.highRisk,
      gaps: input.validatorResultContracts.validatorResultRiskProfile.gaps,
      deferred: sectionAcceptanceSimulations.filter((section) => section.simulatedAcceptanceEligibility !== 'acceptable').length,
    },
    acceptanceSimulationConfidence: confidence(overallAcceptanceSimulationReadiness, input),
  };
}

export function serializeValidatorAcceptanceSimulation(simulation: ValidatorAcceptanceSimulation): string {
  return [
    '## VALIDATOR ACCEPTANCE SIMULATION',
    `Version: ${simulation.version}`,
    `Topic: ${simulation.topic}`,
    `Content type: ${simulation.contentType}`,
    `Simulation readiness: ${simulation.overallAcceptanceSimulationReadiness}`,
    `Simulated eligibility: ${simulation.simulatedAcceptanceEligibility}`,
    `Simulation confidence: ${simulation.acceptanceSimulationConfidence}`,
    `Section simulations: ${simulation.sectionAcceptanceSimulations.length}`,
    `Deferred simulations: ${simulation.simulatedAcceptanceDeferrals.join(', ') || 'none'}`,
  ].join('\n');
}
